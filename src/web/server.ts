import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer, WebSocket } from 'ws'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus, mapRuntimeEventToLegacyEvent } from '../eventBus.js'
import type { EventBusMap } from '../eventBus.js'
import { JobsService } from '../domain/jobs-service.js'
import { ArtifactStore } from '../memory/artifactStore.js'
import { ConversationStore } from '../memory/conversationStore.js'
import { DelegationStore } from '../memory/delegationStore.js'
import { InterventionStore } from '../memory/interventionStore.js'
import { SessionStore } from '../memory/sessionStore.js'
import { lockFile, unlockFile } from '../tools/lockFile.js'
import type { BaseAgent } from '../agents/base/agent.js'
import type { AgentFactory } from '../agents/factory.js'
import type { Config, ConfigStatus } from '../config.js'
import { getConfigStatus as readConfigStatus, readConfigFile, saveConfigFile } from '../config.js'
import type { MCPClientStatus } from '../mcp.js'
import type { AgentSession, DelegatedRun, EventStream, InterventionRecord, JobStatus, RuntimeEvent } from '../runtime/contracts.js'
import { buildSetupCapabilitySummary } from '../runtime/setup-summary.js'
import { RuntimeTaskResultsService } from '../runtime/task-results-service.js'

const agentRegistry = new Map<string, BaseAgent>()

interface RuntimeStatusPayload {
  mcp: MCPClientStatus
}

interface RuntimeSessionStore {
  list(): Promise<AgentSession[]>
  get(sessionId: string): Promise<AgentSession | null>
}

interface RuntimeDelegationStore {
  listByParent(parentSessionId: string): Promise<DelegatedRun[]>
  list(): Promise<DelegatedRun[]>
}

interface RuntimeInterventionManager {
  list(): Promise<InterventionRecord[]>
  listPending(ownerId?: string): Promise<InterventionRecord[]>
  resolve(
    input: { ownerId: string; requestId?: string; input: string },
    options?: { emitEvent?: boolean; sessionId?: string; agentName?: string; delegatedRunId?: string }
  ): Promise<InterventionRecord | null>
}

export interface ServerRuntime {
  getMainAgent(): BaseAgent | undefined
  getFactory(): AgentFactory | undefined
  getConfigStatus(): ConfigStatus
  reloadFromConfig(): Promise<void>
  getRuntimeStatus?(): RuntimeStatusPayload
  getEventStream?(): EventStream | undefined
  getSessionStore?(): RuntimeSessionStore | undefined
  getDelegationStore?(): RuntimeDelegationStore | undefined
  getInterventionManager?(): RuntimeInterventionManager | undefined
  getConversationStore?(): ConversationStore | undefined
}

export function registerAgent(agent: BaseAgent): void {
  agentRegistry.set(agent.agentName, agent)
}

export function clearAgentRegistry(): void {
  agentRegistry.clear()
}

export function clearAgentRegistryForTests(): void {
  clearAgentRegistry()
}

const wsClients = new Set<WebSocket>()
type WebSocketMessage = { event: string; data: unknown }

function broadcast(type: string, data: unknown): void {
  const msg = JSON.stringify({ event: type, data })
  for (const ws of wsClients) {
    try {
      if (ws.readyState === 1) {
        ws.send(msg)
      }
    } catch {
      wsClients.delete(ws)
    }
  }
}

function ensureFileExists(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8')
  }
}

function isJobStatus(value: string): value is JobStatus {
  return (
    value === 'discovered' ||
    value === 'favorite' ||
    value === 'applied' ||
    value === 'failed' ||
    value === 'login_required'
  )
}

function normalizeAgentState(state: string): AgentSession['state'] {
  if (state === 'waiting') return 'waiting_input'
  if (state === 'running') return 'running'
  if (state === 'error') return 'error'
  return 'idle'
}

function toConversationMessages(agent: BaseAgent): Array<{ role: 'user' | 'assistant'; content: string }> {
  return agent.getMessages()
    .filter(
      (
        message
      ): message is typeof message & {
        role: 'user' | 'assistant'
      } => message.role === 'user' || message.role === 'assistant'
    )
    .map((message) => ({
      role: message.role,
      content: typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? message.content
          .map((part) => ('type' in part && part.type === 'text' && 'text' in part ? part.text : ''))
          .filter(Boolean)
          .join('\n')
          : '',
    }))
    .filter((message) => {
      const content = message.content.trim()
      return content.length > 0 && !content.startsWith('SYSTEM_SUMMARY:')
    })
}

function toConversationSummary(agent: BaseAgent): string {
  const summaryMessage = agent.getMessages().find(
    (message) =>
      message.role === 'user' &&
      typeof message.content === 'string' &&
      message.content.startsWith('SYSTEM_SUMMARY:')
  )
  return typeof summaryMessage?.content === 'string' ? summaryMessage.content : ''
}

function buildLiveSession(agent: BaseAgent): AgentSession {
  const snapshot = agent.getState()
  const now = new Date().toISOString()
  return {
    id: agent.agentName,
    agentName: agent.agentName,
    profile: 'main',
    createdAt: now,
    updatedAt: now,
    state: normalizeAgentState(snapshot.state),
  }
}

function toAgentSnapshot(session: AgentSession): { agentName: string; state: string } {
  return {
    agentName: session.agentName,
    state: session.state,
  }
}

function resolveLiveAgent(runtime: ServerRuntime, agentName: string): BaseAgent | undefined {
  const registered = agentRegistry.get(agentName)
  if (registered) return registered
  const mainAgent = runtime.getMainAgent()
  if (mainAgent?.agentName === agentName) return mainAgent
  return undefined
}

const BUS_EVENTS: (keyof EventBusMap)[] = [
  'agent:state',
  'agent:log',
  'agent:stream',
  'agent:tool',
  'job:updated',
  'intervention:required',
  'intervention:resolved',
  'context:usage',
]

export async function getWebSocketSnapshots(runtime: ServerRuntime): Promise<Array<{ agentName: string; state: string }>> {
  const runtimeSessionStore = runtime.getSessionStore?.()
  if (runtimeSessionStore) {
    const sessions = await runtimeSessionStore.list()
    return sessions.map(toAgentSnapshot)
  }

  return [...agentRegistry.values()].map((agent) => {
    const snapshot = agent.getState()
    return {
      agentName: snapshot.agentName,
      state: normalizeAgentState(snapshot.state),
    }
  })
}

export async function getPendingInterventionMessages(runtime: ServerRuntime): Promise<WebSocketMessage[]> {
  const interventionManager = runtime.getInterventionManager?.()
  if (!interventionManager) return []

  const pending = await interventionManager.listPending()
  return pending.map((record) => ({
    event: 'intervention:required',
    data: {
      agentName: record.ownerType === 'session' ? record.ownerId : 'main',
      prompt: record.prompt,
      requestId: record.id,
      kind: record.kind,
      options: record.options,
      timeoutMs: record.timeoutMs,
      allowEmpty: record.allowEmpty,
    },
  }))
}

export function mapRuntimeEventToWebSocketMessages(event: RuntimeEvent): WebSocketMessage[] {
  if (event.type === 'intervention.timed_out' || event.type === 'intervention.cancelled') {
    const agentName = event.agentName ?? event.sessionId ?? 'main'
    const requestId = typeof event.payload.requestId === 'string' ? event.payload.requestId : undefined
    return [
      {
        event: 'intervention:resolved',
        data: {
          agentName,
          input: '',
          requestId,
        },
      },
      {
        event: 'agent:log',
        data: {
          agentName,
          type: 'warn',
          level: 'warn',
          message: event.type === 'intervention.timed_out' ? '输入请求已超时，系统已自动继续。' : '输入请求已取消。',
          timestamp: event.timestamp,
        },
      },
    ]
  }

  const legacy = mapRuntimeEventToLegacyEvent(event)
  if (!legacy) return []
  return [{ event: legacy.name, data: legacy.payload }]
}

function attachLegacyBusBroadcast(): () => void {
  const unbinders = BUS_EVENTS.map((event) => {
    const handler = (payload: EventBusMap[typeof event]) => broadcast(event, payload)
    eventBus.on(event, handler)
    return () => eventBus.off(event, handler)
  })
  return () => {
    for (const unbind of unbinders) {
      unbind()
    }
  }
}

function attachRuntimeBroadcast(runtime: ServerRuntime): () => void {
  const stream = runtime.getEventStream?.()
  if (!stream) {
    return attachLegacyBusBroadcast()
  }

  return stream.subscribe((event) => {
    for (const message of mapRuntimeEventToWebSocketMessages(event)) {
      broadcast(message.event, message.data)
    }
  })
}

async function buildConfigPayload(
  workspaceRoot: string,
  status: ConfigStatus,
  runtimeStatus?: RuntimeStatusPayload
) {
  const stored = readConfigFile(workspaceRoot)
  const setup = await buildSetupCapabilitySummary({
    workspaceRoot,
    configStatus: status,
    runtimeStatus,
  })
  return {
    ok: true,
    settings: {
      API_KEY: String(stored.API_KEY ?? ''),
      MODEL_ID: String(stored.MODEL_ID ?? ''),
      LIGHT_MODEL_ID: String(stored.LIGHT_MODEL_ID ?? ''),
      BASE_URL: String(stored.BASE_URL ?? ''),
      SERVER_PORT: status.config.SERVER_PORT,
    },
    status: {
      ready: status.ready,
      missingFields: status.missingFields,
      setup,
      capabilities: setup.capabilities,
      mcp: runtimeStatus?.mcp ?? {
        enabled: process.env.MCP_DISABLED !== '1',
        connected: false,
        message: 'Runtime status unavailable',
      },
    },
  }
}

function getUnavailableResponse(status: ConfigStatus) {
  return {
    ok: false,
    error: `基础配置未完成：缺少 ${status.missingFields.join(', ')}`,
    missingFields: status.missingFields,
  }
}

function isServerRuntime(value: unknown): value is ServerRuntime {
  return Boolean(value) && typeof (value as ServerRuntime).getConfigStatus === 'function'
}

export function createApp(workspaceRoot: string, runtimeOrFactory?: ServerRuntime | AgentFactory): Hono {
  const runtime: ServerRuntime = isServerRuntime(runtimeOrFactory)
    ? runtimeOrFactory
    : {
        getMainAgent: () => agentRegistry.get('main'),
        getFactory: () => runtimeOrFactory as AgentFactory | undefined,
        getConfigStatus: () => readConfigStatus(workspaceRoot),
        reloadFromConfig: async () => {},
        getRuntimeStatus: () => ({
          mcp: {
            enabled: process.env.MCP_DISABLED !== '1',
            connected: false,
            message: 'Runtime status unavailable',
          },
        }),
        getSessionStore: () => undefined,
        getDelegationStore: () => undefined,
        getInterventionManager: () => undefined,
        getConversationStore: () => undefined,
      }

  const app = new Hono()
  const jobs = new JobsService(workspaceRoot, 'web-server')
  const conversationStore = new ConversationStore(workspaceRoot)
  const sessionStore = new SessionStore(workspaceRoot)
  const delegationStore = new DelegationStore(workspaceRoot)
  const interventionStore = new InterventionStore(workspaceRoot)
  const artifactStore = new ArtifactStore(workspaceRoot)
  const uploadedResumeRelPath = 'data/uploads/resume-upload.pdf'
  const uploadedResumeAbsPath = path.resolve(workspaceRoot, uploadedResumeRelPath)

  app.get('/api/settings', async (c) => {
    const status = runtime.getConfigStatus()
    return c.json(await buildConfigPayload(workspaceRoot, status, runtime.getRuntimeStatus?.()))
  })

  app.post('/api/settings', async (c) => {
    try {
      const body = await c.req.json<Partial<Config>>()
      const updates: Partial<Config> = {
        API_KEY: typeof body.API_KEY === 'string' ? body.API_KEY.trim() : undefined,
        MODEL_ID: typeof body.MODEL_ID === 'string' ? body.MODEL_ID.trim() : undefined,
        LIGHT_MODEL_ID: typeof body.LIGHT_MODEL_ID === 'string' ? body.LIGHT_MODEL_ID.trim() : undefined,
        BASE_URL: typeof body.BASE_URL === 'string' ? body.BASE_URL.trim() : undefined,
        SERVER_PORT: body.SERVER_PORT,
      }

      saveConfigFile(workspaceRoot, updates)
      await runtime.reloadFromConfig()
      return c.json(await buildConfigPayload(workspaceRoot, runtime.getConfigStatus(), runtime.getRuntimeStatus?.()))
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/runtime/capabilities', async (c) => {
    try {
      const status = runtime.getConfigStatus()
      const collected = await buildSetupCapabilitySummary({
        workspaceRoot,
        configStatus: status,
        runtimeStatus: runtime.getRuntimeStatus?.(),
      })
      const summary = {
        ready: collected.overall.ready,
        mode: collected.overall.mode,
        message: collected.overall.message,
        missingFields: collected.config.missingFields,
        nextSteps: collected.recoverySuggestions,
        workspace: collected.workspace,
        capabilities: collected.capabilities,
        issues: collected.issues,
      }
      return c.json({ ok: true, summary })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/runtime/tasks', async (c) => {
    try {
      const sessionId = c.req.query('sessionId') || undefined
      const service = new RuntimeTaskResultsService(workspaceRoot)
      const snapshot = await service.aggregate({ sessionId })
      const tasks = snapshot.tasks.map((task) => ({
        id: `${task.kind}:${task.id}`,
        kind: task.kind,
        profile: task.profile,
        title: task.title,
        state: task.lifecycle,
        rawState: task.state,
        sessionId: task.sessionId,
        agentName: task.agentName,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        summary: task.summary,
        resultSummary: task.resultSummary,
        error: task.error,
      }))
      return c.json({ ok: true, tasks })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/runtime/results', async (c) => {
    try {
      const sessionId = c.req.query('sessionId') || undefined
      const service = new RuntimeTaskResultsService(workspaceRoot)
      const snapshot = await service.aggregate({ sessionId })
      return c.json({
        ok: true,
        generatedAt: snapshot.generatedAt,
        resultSummary: snapshot.resultSummary,
        recentFailures: snapshot.recentFailures.map((failure) => ({
          ...failure,
          id: `${failure.kind}:${failure.id}`,
        })),
        recentArtifacts: snapshot.recentArtifacts,
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/jobs', async (c) => {
    try {
      return c.json(await jobs.listRows())
    } catch {
      return c.json([], 500)
    }
  })

  app.get('/api/stats', async (c) => {
    try {
      return c.json(await jobs.getStats())
    } catch {
      return c.json({ total: 0, byStatus: {} })
    }
  })

  app.post('/api/intervention', async (c) => {
    try {
      const body = await c.req.json<{ input?: string; agentName?: string; ownerId?: string; requestId?: string }>()
      const input = typeof body.input === 'string' ? body.input : ''
      const agentName = typeof body.agentName === 'string' ? body.agentName : ([...agentRegistry.keys()][0] ?? 'main')
      const ownerId = typeof body.ownerId === 'string' ? body.ownerId : agentName
      const requestId = typeof body.requestId === 'string' ? body.requestId : undefined
      const interventionManager = runtime.getInterventionManager?.()
      if (interventionManager) {
        const record = await interventionManager.resolve(
          { ownerId, input, requestId },
          {
            sessionId: agentName,
            agentName,
          }
        )
        return c.json({ ok: Boolean(record), resolved: Boolean(record) }, record ? 200 : 404)
      }
      eventBus.emit('intervention:resolved', { agentName, input, requestId })
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false, error: 'Invalid request' }, 400)
    }
  })

  app.get('/api/runtime/sessions', async (c) => {
    try {
      const activeSessionStore = runtime.getSessionStore?.() ?? sessionStore
      const sessions = await activeSessionStore.list()
      return c.json({ ok: true, sessions })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/delegations/:sessionId', async (c) => {
    try {
      const sessionId = c.req.param('sessionId')
      const activeDelegationStore = runtime.getDelegationStore?.() ?? delegationStore
      const delegations = await activeDelegationStore.listByParent(sessionId)
      return c.json({ ok: true, runs: delegations, delegations })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/delegations', async (c) => {
    try {
      const sessionId = c.req.query('parentSessionId')
      if (!sessionId) {
        const activeDelegationStore = runtime.getDelegationStore?.() ?? delegationStore
        const delegations = await activeDelegationStore.list()
        return c.json({ ok: true, runs: delegations, delegations })
      }
      const activeDelegationStore = runtime.getDelegationStore?.() ?? delegationStore
      const delegations = await activeDelegationStore.listByParent(sessionId)
      return c.json({ ok: true, runs: delegations, delegations })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/interventions/:ownerId', async (c) => {
    try {
      const ownerId = c.req.param('ownerId')
      const status = c.req.query('status') || undefined
      const activeInterventionManager = runtime.getInterventionManager?.()
      const interventions = activeInterventionManager
        ? status && status !== 'pending'
          ? (await activeInterventionManager.list()).filter(
            (record) => record.ownerId === ownerId && record.status === status
          )
          : await activeInterventionManager.listPending(ownerId)
        : (await interventionStore.list()).filter(
          (record) => record.ownerId === ownerId && (!status || record.status === status)
        )
      return c.json({ ok: true, interventions })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/interventions', async (c) => {
    try {
      const ownerId = c.req.query('ownerId') || undefined
      const status = c.req.query('status') || undefined
      const activeInterventionManager = runtime.getInterventionManager?.()
      const interventions = activeInterventionManager
        ? status && status !== 'pending'
          ? (await activeInterventionManager.list()).filter(
            (record) =>
              (!ownerId || record.ownerId === ownerId) &&
              record.status === status
          )
          : await activeInterventionManager.listPending(ownerId)
        : (await interventionStore.list()).filter(
          (record) =>
            (!ownerId || record.ownerId === ownerId) &&
            (!status || record.status === status)
        )
      return c.json({ ok: true, interventions })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/session/:agentName', async (c) => {
    const agentName = c.req.param('agentName')
    const activeSessionStore = runtime.getSessionStore?.() ?? sessionStore
    const activeConversationStore = runtime.getConversationStore?.() ?? conversationStore
    const liveAgent = resolveLiveAgent(runtime, agentName)
    const [session, conversation] = await Promise.all([
      activeSessionStore.get(agentName),
      activeConversationStore.get(agentName),
    ])
    const liveSummary = liveAgent ? toConversationSummary(liveAgent) : ''
    const liveMessages = liveAgent ? toConversationMessages(liveAgent) : []
    const fallbackSession = liveAgent ? buildLiveSession(liveAgent) : null

    if (!session && !fallbackSession && (!conversation.recentMessages.length && !conversation.summary) && !liveMessages.length) {
      return c.json({ ok: false, error: 'Agent not found' }, 404)
    }

    return c.json({
      ok: true,
      session: session ?? fallbackSession,
      summary: conversation.summary || liveSummary,
      messages: conversation.recentMessages.length > 0 ? conversation.recentMessages : liveMessages,
    })
  })

  app.post('/api/chat', async (c) => {
    try {
      const status = runtime.getConfigStatus()
      if (!status.ready) {
        return c.json(getUnavailableResponse(status), 409)
      }

      const body = await c.req.json<{ message?: string }>()
      const message = typeof body.message === 'string' ? body.message : ''
      if (!message.trim()) return c.json({ ok: false, error: 'Empty message' }, 400)

      const mainAgent = runtime.getMainAgent()
      if (!mainAgent) return c.json({ ok: false, error: 'Main agent not found' }, 500)

      const result = mainAgent.submit(message)
      if (result.queued) {
        return c.json({ ok: true, queued: true, queueLength: result.queueLength })
      }
      return c.json({ ok: true, queued: false, message: result.message })
    } catch {
      return c.json({ ok: false, error: 'Invalid request' }, 400)
    }
  })

  app.post('/api/resume/build', async (c) => {
    const status = runtime.getConfigStatus()
    if (!status.ready) {
      return c.json(getUnavailableResponse(status), 409)
    }

    const mainAgent = runtime.getMainAgent()
    if (mainAgent) {
      mainAgent.submit('生成简历')
      return c.json({ ok: true })
    }

    const factory = runtime.getFactory()
    if (!factory) return c.json({ ok: false, error: 'Main agent not found' }, 500)

    const taskAgent = factory.createAgent({ persistent: false, profileName: 'resume' })
    taskAgent.run('生成简历').catch((err) => console.error('[Server] Resume build failed:', err))
    return c.json({ ok: true })
  })

  app.get('/api/resume/status', (c) => {
    try {
      const exists = fs.existsSync(path.resolve(workspaceRoot, 'output/resume.pdf'))
      const absolutePath = path.resolve(workspaceRoot, 'output/resume.pdf')
      const stats = exists ? fs.statSync(absolutePath) : null
      return c.json({
        ok: true,
        exists,
        path: '/workspace/output/resume.pdf',
        mtime: stats?.mtime.toISOString() ?? null,
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/resume/review', async (c) => {
    if (!fs.existsSync(uploadedResumeAbsPath)) {
      return c.json({ ok: false, error: 'Uploaded resume not found' }, 400)
    }

    const status = runtime.getConfigStatus()
    if (!status.ready) {
      return c.json(getUnavailableResponse(status), 409)
    }

    const prompt =
      '评价刚上传的简历。若 data/uploads/resume-upload.pdf 存在，请优先使用 read_pdf 读取内容，并严格按 resume-clinic skill 输出评价、问题分析、改写建议和可直接替换的表达。'

    const mainAgent = runtime.getMainAgent()
    if (mainAgent) {
      mainAgent.submit(prompt)
      return c.json({ ok: true, path: uploadedResumeRelPath })
    }

    const factory = runtime.getFactory()
    if (!factory) return c.json({ ok: false, error: 'Main agent not found' }, 500)

    const taskAgent = factory.createAgent({ persistent: false, profileName: 'review' })
    taskAgent.run(prompt).catch((err) => console.error('[Server] Resume review failed:', err))
    return c.json({ ok: true, path: uploadedResumeRelPath })
  })

  app.post('/api/resume/upload', async (c) => {
    try {
      const formData = await c.req.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return c.json({ ok: false, error: 'Missing file' }, 400)
      }
      if (file.size <= 0) {
        return c.json({ ok: false, error: 'Empty file' }, 400)
      }

      const fileName = file.name.toLowerCase()
      const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf')
      if (!isPdf) {
        return c.json({ ok: false, error: 'Only PDF files are supported' }, 400)
      }

      const uploadDir = path.resolve(workspaceRoot, 'data/uploads')
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }
      if (!fs.existsSync(uploadedResumeAbsPath)) {
        fs.writeFileSync(uploadedResumeAbsPath, new Uint8Array())
      }

      await lockFile(uploadedResumeRelPath, 'web-server', workspaceRoot)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        fs.writeFileSync(uploadedResumeAbsPath, bytes)
      } finally {
        await unlockFile(uploadedResumeRelPath, 'web-server', workspaceRoot)
      }

      await artifactStore.recordGenerated(file.name, 'uploaded', uploadedResumeRelPath, {
        mimeType: file.type || 'application/pdf',
        size: file.size,
        ownerId: 'main',
        sessionId: 'main',
      })

      return c.json({
        ok: true,
        path: uploadedResumeRelPath,
        name: file.name,
        size: file.size,
        type: file.type || 'application/pdf',
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/jobs/status', async (c) => {
    try {
      const body = await c.req.json<{ updates?: Array<{ url?: string; status?: string }> }>()
      const updates = Array.isArray(body.updates) ? body.updates : []
      const normalizedUpdates = updates
        .map((item) => ({
          url: typeof item.url === 'string' ? item.url.trim() : '',
          status: typeof item.status === 'string' ? item.status.trim() : '',
        }))
        .filter((item): item is { url: string; status: JobStatus } => isJobStatus(item.status) && Boolean(item.url))

      if (normalizedUpdates.length === 0) {
        return c.json({ ok: false, error: 'No valid updates provided' }, 400)
      }

      const result = await jobs.updateStatuses(normalizedUpdates, { lockHolder: 'web-server' })
      if (result.changed > 0) {
        eventBus.emit('job:updated', { company: 'system', title: 'jobs', status: 'updated' })
      }
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/jobs/delete', async (c) => {
    try {
      const body = await c.req.json<{ urls?: string[] }>()
      const urls = Array.isArray(body.urls)
        ? body.urls.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : []

      if (urls.length === 0) {
        return c.json({ ok: false, error: 'No valid urls provided' }, 400)
      }

      const result = await jobs.deleteByUrls(urls, { lockHolder: 'web-server' })
      if (result.deleted > 0) {
        eventBus.emit('job:updated', { company: 'system', title: 'jobs', status: 'updated' })
      }
      return c.json({ ok: true, ...result })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/config/:name', async (c) => {
    let name = c.req.param('name')
    if (!name.endsWith('.md')) name += '.md'
    if (name !== 'targets.md' && name !== 'userinfo.md' && name !== 'jobs.md') {
      return c.json({ ok: false, error: 'Unknown config name' }, 400)
    }
    try {
      if (name === 'jobs.md') {
        return c.json({ ok: true, content: await jobs.readMarkdownSource() })
      }
      const filePath = path.resolve(workspaceRoot, 'data', name)
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
      return c.json({ ok: true, content })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/config/:name', async (c) => {
    let name = c.req.param('name')
    if (!name.endsWith('.md')) name += '.md'
    if (name !== 'targets.md' && name !== 'userinfo.md' && name !== 'jobs.md') {
      return c.json({ ok: false, error: 'Unknown config name' }, 400)
    }
    const relPath = `data/${name}`
    try {
      const body = await c.req.json<{ content?: string }>()
      const content = typeof body.content === 'string' ? body.content : ''
      if (name === 'jobs.md') {
        await jobs.importMarkdown(content, { lockHolder: 'web-server', mode: 'replace' })
      } else {
        const filePath = path.resolve(workspaceRoot, relPath)
        ensureFileExists(filePath)
        await lockFile(relPath, 'web-server', workspaceRoot)
        try {
          fs.writeFileSync(filePath, content, 'utf-8')
        } finally {
          await unlockFile(relPath, 'web-server', workspaceRoot)
        }
      }
      if (name === 'jobs.md') {
        eventBus.emit('job:updated', { company: 'system', title: 'jobs', status: 'updated' })
      }
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/workspace/output/*', async (c) => {
    const relativePath = c.req.path.replace(/^\/workspace\/output\//, '')
    const outputRoot = path.resolve(workspaceRoot, 'output')
    const filePath = path.resolve(outputRoot, relativePath)

    if (filePath !== outputRoot && !filePath.startsWith(`${outputRoot}${path.sep}`)) {
      return c.text('Forbidden', 403)
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return c.text('404 Not Found', 404)
    }

    return c.body(fs.readFileSync(filePath))
  })

  app.use('/*', serveStatic({ root: './public' }))

  return app
}

const DEFAULT_PORT = 3000

export function startServer(workspaceRoot: string, port: number | undefined, runtime: ServerRuntime): void {
  const listenPort = port ?? parseInt(process.env['SERVER_PORT'] ?? String(DEFAULT_PORT), 10)
  const app = createApp(workspaceRoot, runtime)
  const server = serve({ fetch: app.fetch, port: listenPort })
  const detachBroadcast = attachRuntimeBroadcast(runtime)

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', async (ws: WebSocket) => {
    wsClients.add(ws)
    const snapshots = await getWebSocketSnapshots(runtime)
    ws.send(JSON.stringify({ event: 'snapshot', data: snapshots }))
    for (const message of await getPendingInterventionMessages(runtime)) {
      ws.send(JSON.stringify(message))
    }
    ws.on('close', () => {
      wsClients.delete(ws)
    })
  })

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, req)
    })
  })
  server.on('close', () => {
    detachBroadcast()
  })

  console.log(`[JobClaw] API server listening on port ${listenPort}`)
}
