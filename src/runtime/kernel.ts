import OpenAI from 'openai'
import type { Channel } from '../channel/base.js'
import { AgentFactory } from '../agents/factory.js'
import { MainAgent } from '../agents/main/index.js'
import { getConfigStatus, loadConfig, type ConfigStatus } from '../config.js'
import { createMCPClient, type MCPClientStatus } from '../mcp.js'
import { bindRuntimeEventStream } from '../eventBus.js'
import { ConversationStore } from '../memory/conversationStore.js'
import { DelegationStore } from '../memory/delegationStore.js'
import { InMemoryEventStream } from './event-stream.js'
import { InterventionManager } from './intervention-manager.js'
import { JsonSessionStore } from './session-store.js'
import { ensureRuntimeStateDirs, nowIso } from './utils.js'
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

  private mcpClient: ClosableMCPClient = null
  private mcpStatus: MCPClientStatus = {
    enabled: process.env.MCP_DISABLED !== '1',
    connected: false,
    message: 'MCP 尚未初始化',
  }
  private mainAgent?: MainAgent
  private factory?: AgentFactory
  private started = false

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
  }

  async start(): Promise<void> {
    if (this.started) return
    this.started = true
    bindRuntimeEventStream(this.eventStream)
    this.installRuntimeObservers()
    await this.reloadConfig()
  }

  async shutdown(): Promise<void> {
    this.mainAgent?.abort('Runtime shutdown')
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
    this.mcpStatus = {
      enabled: process.env.MCP_DISABLED !== '1',
      connected: false,
      message: 'Runtime 已关闭',
    }

    this.started = false
  }

  async reloadConfig(): Promise<void> {
    await this.reloadFromConfig()
  }

  async reloadFromConfig(): Promise<void> {
    this.mainAgent?.abort('Runtime reload')
    this.mainAgent = undefined
    this.factory = undefined
    await this.onMainAgentChanged?.(undefined)

    const status = this.getConfigStatus()
    if (!status.ready) {
      await this.ensureMainSession('idle')
      this.eventStream.publish({
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
      this.eventStream.publish({
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

    this.eventStream.publish({
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
