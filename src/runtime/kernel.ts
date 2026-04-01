import OpenAI from 'openai'
import type { Channel } from '../channel/base.js'
import { AgentFactory } from '../agents/factory.js'
import { MainAgent } from '../agents/main/index.js'
import { getConfigStatus, loadConfig, type ConfigStatus } from '../config.js'
import { bindRuntimeEventStream } from '../eventBus.js'
import { createMCPClient, type MCPClientStatus } from '../mcp.js'
import { ArtifactStore } from '../memory/artifactStore.js'
import { ConversationStore } from '../memory/conversationStore.js'
import { DelegationStore } from '../memory/delegationStore.js'
import { InMemoryEventStream } from './event-stream.js'
import { InterventionManager } from './intervention-manager.js'
import { cancelActiveDelegations } from './recovery.js'
import { JsonSessionStore } from './session-store.js'
import { RuntimeTaskResultsService } from './task-results-service.js'
import { createRuntimeId, ensureRuntimeStateDirs, nowIso } from './utils.js'
import type { AgentSession, DelegatedRun, DelegatedRunState, EventStream } from './contracts.js'

type ClosableMCPClient = Awaited<ReturnType<typeof createMCPClient>>['client']

export interface RuntimeStatus {
  mcp: MCPClientStatus
}

export interface RuntimeKernelConfig {
  workspaceRoot: string
  mainAgentName?: string
  mainChannel?: Channel
  mainAgentPersistent?: boolean
  onMainAgentChanged?: (agent: MainAgent | undefined) => Promise<void> | void
}

export class RuntimeKernel {
  private readonly workspaceRoot: string
  private readonly mainAgentName: string
  private readonly mainChannel?: Channel
  private readonly mainAgentPersistent: boolean
  private readonly onMainAgentChanged?: RuntimeKernelConfig['onMainAgentChanged']
  private readonly unsubscribers: Array<() => void> = []

  private readonly eventStream: EventStream
  private readonly sessionStore: JsonSessionStore
  private readonly interventionManager: InterventionManager
  private readonly delegationStore: DelegationStore
  private readonly conversationStore: ConversationStore
  private readonly artifactStore: ArtifactStore
  private readonly taskResultsService: RuntimeTaskResultsService

  private mcpClient: ClosableMCPClient = null
  private mcpStatus: MCPClientStatus = {
    enabled: process.env.MCP_DISABLED !== '1',
    connected: false,
    message: 'MCP 尚未初始化',
  }
  private mainAgent?: MainAgent
  private factory?: AgentFactory
  private started = false
  private interventionSweepTimer?: ReturnType<typeof setInterval>

  constructor(config: RuntimeKernelConfig) {
    this.workspaceRoot = config.workspaceRoot
    this.mainAgentName = config.mainAgentName ?? 'main'
    this.mainChannel = config.mainChannel
    this.mainAgentPersistent = config.mainAgentPersistent ?? true
    this.onMainAgentChanged = config.onMainAgentChanged

    ensureRuntimeStateDirs(this.workspaceRoot)
    this.eventStream = new InMemoryEventStream()
    this.sessionStore = new JsonSessionStore(this.workspaceRoot)
    this.interventionManager = new InterventionManager(this.workspaceRoot, this.eventStream)
    this.delegationStore = new DelegationStore(this.workspaceRoot)
    this.conversationStore = new ConversationStore(this.workspaceRoot)
    this.artifactStore = new ArtifactStore(this.workspaceRoot)
    this.taskResultsService = new RuntimeTaskResultsService({
      workspaceRoot: this.workspaceRoot,
      sessionStore: this.sessionStore,
      delegationStore: this.delegationStore,
      interventionStore: this.interventionManager,
      artifactStore: this.artifactStore,
      conversationStore: this.conversationStore,
    })
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    bindRuntimeEventStream(this.eventStream)
    this.installRuntimeObservers()
    this.startMaintenanceLoop()
    await this.reloadConfig()
  }

  async shutdown(): Promise<void> {
    await this.gracefulAgentAbort('Runtime shutdown')
    this.mainAgent = undefined
    this.factory = undefined

    for (const unsubscribe of this.unsubscribers.splice(0)) {
      unsubscribe()
    }
    bindRuntimeEventStream(undefined)

    if (this.mcpClient) {
      await this.mcpClient.close()
      this.mcpClient = null
    }
    if (this.interventionSweepTimer) {
      clearInterval(this.interventionSweepTimer)
      this.interventionSweepTimer = undefined
    }
    this.mcpStatus = {
      enabled: process.env.MCP_DISABLED !== '1',
      connected: false,
      message: 'Runtime 已关闭',
    }

    this.started = false
  }

  /**
   * Gracefully abort the main agent with timeout and cleanup.
   * - Waits for agent to finish current work (with timeout)
   * - Emits 'agent:aborted' event for observability
   * - Clears pending message queue
   * - Handles timeout case with force abort
   */
  private async gracefulAgentAbort(reason: string): Promise<void> {
    const GRACEFUL_TIMEOUT_MS = 5_000

    if (!this.mainAgent) return

    // Emit abort event before aborting for observability
    await this.eventStream.publish({
      type: 'agent:aborted',
      sessionId: this.mainAgentName,
      agentName: this.mainAgent.agentName,
      payload: {
        reason,
        graceful: true,
      },
    })

    // Abort the agent (triggers AbortController in BaseAgent)
    this.mainAgent.abort(reason)

    // Wait for graceful cleanup with timeout - actually check if agent stops
    const agentStopped = new Promise<void>((resolve) => {
      const checkInterval = setInterval(() => {
        const state = this.mainAgent?.getState?.()?.state
        if (state === 'idle' || state === undefined) {
          clearInterval(checkInterval)
          resolve()
        }
      }, 100)
    })

    const timeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Graceful abort timeout')), GRACEFUL_TIMEOUT_MS)
    )

    try {
      await Promise.race([agentStopped, timeout])
    } catch {
      console.warn('[Kernel] Agent abort timed out after', GRACEFUL_TIMEOUT_MS, 'ms, forcing cleanup')
    }

    // Force cleanup: clear any remaining message queue
    try {
      (this.mainAgent as any).messageQueue?.splice(0)
      ;(this.mainAgent as any).processing = false
    } catch (err) {
      console.error('[Kernel] Failed to clear message queue during force cleanup:', err)
    }

    // Emit final abort event with graceful=false to indicate timeout or cleanup complete
    await this.eventStream.publish({
      type: 'agent:aborted',
      sessionId: this.mainAgentName,
      agentName: this.mainAgent?.agentName ?? this.mainAgentName,
      payload: {
        reason,
        graceful: false,
      },
    }).catch(err => {
      console.warn('[Kernel] Failed to emit agent:aborted event:', err)
    })
  }

  async reloadConfig(): Promise<void> {
    await this.reloadFromConfig()
  }

  async reloadFromConfig(): Promise<void> {
    const recoveryReason = this.mainAgent || this.factory
      ? 'Runtime reloaded before delegated run completed'
      : 'Runtime restarted before delegated run completed'
    await this.gracefulAgentAbort('Runtime reload')
    this.mainAgent = undefined
    this.factory = undefined
    await this.onMainAgentChanged?.(undefined)
    await this.recoverRuntimeState(recoveryReason)

    const status = this.getConfigStatus()
    if (!status.ready) {
      await this.ensureMainSession('idle')
      await this.eventStream.publish({
        type: 'runtime.warning',
        sessionId: this.mainAgentName,
        agentName: 'system',
        payload: {
          message: `基础配置未完成：缺少 ${status.missingFields.join(', ')}`,
          missingFields: status.missingFields,
        },
      })
      return
    }

    if (!this.mcpClient) {
      const mcpConnection = await createMCPClient()
      this.mcpClient = mcpConnection.client
      this.mcpStatus = mcpConnection.status
    } else {
      this.mcpStatus = { enabled: true, connected: true, message: 'MCP 已连接' }
    }

    if (!this.mcpStatus.connected) {
      await this.eventStream.publish({
        type: 'runtime.warning',
        sessionId: this.mainAgentName,
        agentName: 'system',
        payload: {
          message: `Playwright MCP 不可用：${this.mcpStatus.message ?? '连接失败'}`,
          subsystem: 'mcp',
          mcpConnected: false,
          mcpEnabled: this.mcpStatus.enabled,
          mcpMessage: this.mcpStatus.message,
        },
      })
    }

    const config = loadConfig(this.workspaceRoot)
    const openai = new OpenAI({
      apiKey: config.API_KEY,
      baseURL: config.BASE_URL,
    })

    this.factory = new AgentFactory({
      openai,
      mcpClient: this.mcpClient ?? undefined,
      workspaceRoot: this.workspaceRoot,
      model: config.MODEL_ID,
      lightModel: config.LIGHT_MODEL_ID,
    })

    this.mainAgent = new MainAgent({
      openai,
      agentName: this.mainAgentName,
      model: config.MODEL_ID,
      lightModel: config.LIGHT_MODEL_ID,
      workspaceRoot: this.workspaceRoot,
      mcpClient: this.mcpClient ?? undefined,
      channel: this.mainChannel,
      factory: this.factory,
      persistent: this.mainAgentPersistent,
    })

    await this.mainAgent.loadSession()
    await this.ensureMainSession(this.normalizeAgentState(this.mainAgent.getState().state))
    await this.onMainAgentChanged?.(this.mainAgent)

    await this.eventStream.publish({
      type: 'session.state_changed',
      sessionId: this.mainAgentName,
      agentName: this.mainAgentName,
      payload: {
        state: this.normalizeAgentState(this.mainAgent.getState().state),
      },
    })
  }

  getMainAgent(): MainAgent | undefined {
    return this.mainAgent
  }

  getFactory(): AgentFactory | undefined {
    return this.factory
  }

  getConfigStatus(): ConfigStatus {
    return getConfigStatus(this.workspaceRoot)
  }

  getRuntimeStatus(): RuntimeStatus {
    return {
      mcp: { ...this.mcpStatus },
    }
  }

  getEventStream(): EventStream {
    return this.eventStream
  }

  getSessionStore(): JsonSessionStore {
    return this.sessionStore
  }

  getInterventionManager(): InterventionManager {
    return this.interventionManager
  }

  getDelegationStore(): DelegationStore {
    return this.delegationStore
  }

  getConversationStore(): ConversationStore {
    return this.conversationStore
  }

  getTaskResultsService(): RuntimeTaskResultsService {
    return this.taskResultsService
  }

  async dispatchProfileTask(
    profile: Exclude<DelegatedRun['profile'], 'main'>,
    instruction: string,
    options: { parentSessionId?: string } = {}
  ): Promise<{ runId: string; dispatch: 'profile_agent' } | null> {
    if (!this.factory) return null

    const task = await this.createProfileTaskRun(profile, instruction, options)
    void task.completion.catch(() => {})
    return { runId: task.runId, dispatch: 'profile_agent' }
  }

  async runProfileTask(
    profile: Exclude<DelegatedRun['profile'], 'main'>,
    instruction: string,
    options: { parentSessionId?: string } = {}
  ): Promise<{ runId: string; result: string }> {
    if (!this.factory) {
      throw new Error('Runtime factory unavailable')
    }

    const task = await this.createProfileTaskRun(profile, instruction, options)
    return {
      runId: task.runId,
      result: await task.completion,
    }
  }

  private async createProfileTaskRun(
    profile: Exclude<DelegatedRun['profile'], 'main'>,
    instruction: string,
    options: { parentSessionId?: string } = {}
  ): Promise<{ runId: string; completion: Promise<string> }> {
    if (!this.factory) {
      throw new Error('Runtime factory unavailable')
    }

    const parentSessionId = options.parentSessionId ?? this.mainAgentName
    const taskAgent = this.factory.createAgent({ persistent: false, profileName: profile })
    const createdAt = nowIso()
    const runId = createRuntimeId('delegation')
    const basePayload = {
      profile,
      instruction,
      createdAt,
      updatedAt: createdAt,
    }

    await this.eventStream.publish({
      type: 'delegation.created',
      sessionId: parentSessionId,
      delegatedRunId: runId,
      agentName: taskAgent.agentName,
      payload: {
        ...basePayload,
        state: 'queued',
      },
    })

    const completion = (async () => {
      const runningAt = nowIso()
      await this.eventStream.publish({
        type: 'delegation.state_changed',
        sessionId: parentSessionId,
        delegatedRunId: runId,
        agentName: taskAgent.agentName,
        payload: {
          ...basePayload,
          state: 'running',
          updatedAt: runningAt,
        },
      })

      try {
        const result = await taskAgent.run(instruction)
        await this.eventStream.publish({
          type: 'delegation.completed',
          sessionId: parentSessionId,
          delegatedRunId: runId,
          agentName: taskAgent.agentName,
          payload: {
            ...basePayload,
            state: 'completed',
            updatedAt: nowIso(),
            resultSummary: summarizeDelegatedResult(result),
          },
        })
        return result
      } catch (error) {
        await this.eventStream.publish({
          type: 'delegation.failed',
          sessionId: parentSessionId,
          delegatedRunId: runId,
          agentName: taskAgent.agentName,
          payload: {
            ...basePayload,
            state: 'failed',
            updatedAt: nowIso(),
            error: (error as Error).message,
          },
        })
        throw error
      }
    })()

    return { runId, completion }
  }

  private startMaintenanceLoop(): void {
    if (this.interventionSweepTimer) return
    this.interventionSweepTimer = setInterval(() => {
      void this.interventionManager.syncTimeouts().catch((error) => {
        void this.eventStream.publish({
          type: 'runtime.warning',
          sessionId: this.mainAgentName,
          agentName: 'system',
          payload: {
            message: `Intervention timeout sweep failed: ${(error as Error).message}`,
          },
        })
      })
    }, 1_000)
  }

  private installRuntimeObservers(): void {
    this.unsubscribers.push(
      this.eventStream.subscribe(async (event) => {
        if (event.type === 'session.state_changed') {
          const sessionId = event.sessionId ?? this.mainAgentName
          const current = await this.sessionStore.get(sessionId)
          if (!current) {
            await this.ensureMainSession(this.readSessionState(event))
            return
          }
          await this.sessionStore.update(sessionId, {
            state: this.readSessionState(event),
            updatedAt: event.timestamp,
          })
          return
        }

        if (event.type === 'session.output_chunk') {
          const sessionId = event.sessionId ?? this.mainAgentName
          const current = await this.sessionStore.get(sessionId)
          if (!current) return
          await this.sessionStore.update(sessionId, {
            updatedAt: event.timestamp,
            lastMessageAt: event.timestamp,
          })
          return
        }

        if (event.type === 'intervention.requested') {
          const ownerType = event.delegatedRunId ? 'delegated_run' : 'session'
          const ownerId = event.delegatedRunId ?? event.sessionId ?? event.agentName ?? this.mainAgentName
          const prompt = typeof event.payload.prompt === 'string' ? event.payload.prompt : ''
          if (!prompt) return
          await this.interventionManager.request(
            {
              id: typeof event.payload.requestId === 'string' ? event.payload.requestId : undefined,
              ownerType,
              ownerId,
              prompt,
              kind: this.asInterventionKind(event.payload.kind),
              options: Array.isArray(event.payload.options)
                ? event.payload.options.filter((item): item is string => typeof item === 'string')
                : undefined,
              allowEmpty: typeof event.payload.allowEmpty === 'boolean' ? event.payload.allowEmpty : undefined,
              timeoutMs: typeof event.payload.timeoutMs === 'number' ? event.payload.timeoutMs : undefined,
            },
            {
              emitEvent: false,
              sessionId: event.sessionId,
              delegatedRunId: event.delegatedRunId,
              agentName: event.agentName,
            }
          )
          return
        }

        if (event.type === 'intervention.resolved') {
          const ownerId = event.delegatedRunId ?? event.sessionId ?? event.agentName ?? this.mainAgentName
          const input = typeof event.payload.input === 'string' ? event.payload.input : ''
          await this.interventionManager.resolve(
            {
              ownerId,
              requestId: typeof event.payload.requestId === 'string' ? event.payload.requestId : undefined,
              input,
            },
            {
              emitEvent: false,
              sessionId: event.sessionId,
              delegatedRunId: event.delegatedRunId,
              agentName: event.agentName,
            }
          )
          return
        }

        if (
          event.type === 'delegation.created' ||
          event.type === 'delegation.state_changed' ||
          event.type === 'delegation.completed' ||
          event.type === 'delegation.failed'
        ) {
          const run = this.readDelegatedRun(event)
          if (!run) return
          await this.delegationStore.save(run)
        }
      })
    )
  }

  private async recoverRuntimeState(reason: string): Promise<void> {
    await this.interventionManager.syncTimeouts()
    await cancelActiveDelegations(this.delegationStore, { reason })
  }

  private async ensureMainSession(state: AgentSession['state']): Promise<AgentSession> {
    const existing = await this.sessionStore.get(this.mainAgentName)
    if (existing) {
      return this.sessionStore.update(this.mainAgentName, {
        state,
        updatedAt: nowIso(),
      })
    }

    return this.sessionStore.save({
      id: this.mainAgentName,
      agentName: this.mainAgentName,
      profile: 'main',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      state,
    })
  }

  private normalizeAgentState(state: string): AgentSession['state'] {
    if (state === 'waiting') return 'waiting_input'
    if (state === 'running') return 'running'
    if (state === 'error') return 'error'
    return 'idle'
  }

  private readSessionState(event: { payload: Record<string, unknown> }): AgentSession['state'] {
    return this.normalizeAgentState(String(event.payload.state ?? 'idle'))
  }

  private asInterventionKind(value: unknown): 'text' | 'confirm' | 'single_select' | undefined {
    if (value === 'text' || value === 'confirm' || value === 'single_select') return value
    return undefined
  }

  private readDelegatedRun(event: {
    type: string
    sessionId?: string
    delegatedRunId?: string
    agentName?: string
    timestamp: string
    payload: Record<string, unknown>
  }): DelegatedRun | null {
    if (!event.delegatedRunId || typeof event.payload.instruction !== 'string') {
      return null
    }

    const profile = this.asDelegatedProfile(event.payload.profile)
    if (!profile) return null

    return {
      id: event.delegatedRunId,
      parentSessionId: event.sessionId ?? this.mainAgentName,
      profile,
      state: this.asDelegatedRunState(event.payload.state),
      instruction: event.payload.instruction,
      createdAt: typeof event.payload.createdAt === 'string' ? event.payload.createdAt : event.timestamp,
      updatedAt: typeof event.payload.updatedAt === 'string' ? event.payload.updatedAt : event.timestamp,
      resultSummary:
        typeof event.payload.resultSummary === 'string' ? event.payload.resultSummary : undefined,
      error: typeof event.payload.error === 'string' ? event.payload.error : undefined,
      agentName: event.agentName,
    }
  }

  private asDelegatedProfile(value: unknown): DelegatedRun['profile'] | null {
    if (value === 'search' || value === 'delivery' || value === 'resume' || value === 'review') {
      return value
    }
    return null
  }

  private asDelegatedRunState(value: unknown): DelegatedRunState {
    if (
      value === 'queued' ||
      value === 'running' ||
      value === 'waiting_input' ||
      value === 'completed' ||
      value === 'failed' ||
      value === 'cancelled'
    ) {
      return value
    }
    return 'queued'
  }
}

function summarizeDelegatedResult(result: string): string {
  const normalized = result.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 180) return normalized
  return `${normalized.slice(0, 177)}...`
}
