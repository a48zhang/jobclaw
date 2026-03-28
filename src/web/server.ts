import { Hono } from 'hono'
import type { Context } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer, WebSocket } from 'ws'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus, mapRuntimeEventToLegacyEvent } from '../eventBus.js'
import type { EventBusMap } from '../eventBus.js'
import { ApplicationService } from '../domain/application-service.js'
import { LearningService } from '../domain/learning-service.js'
import { JobsService } from '../domain/jobs-service.js'
import { RecommendationService } from '../domain/recommendation-service.js'
import { ArtifactStore } from '../memory/artifactStore.js'
import { ConversationStore } from '../memory/conversationStore.js'
import { DelegationStore } from '../memory/delegationStore.js'
import { InterventionStore } from '../memory/interventionStore.js'
import { SessionStore } from '../memory/sessionStore.js'
import { StrategyStore } from '../memory/strategyStore.js'
import { lockFile, unlockFile } from '../tools/lockFile.js'
import type { BaseAgent } from '../agents/base/agent.js'
import type { AgentFactory } from '../agents/factory.js'
import type { Config, ConfigStatus } from '../config.js'
import { getConfigStatus as readConfigStatus, readConfigFile, saveConfigFile } from '../config.js'
import type { MCPClientStatus } from '../mcp.js'
import type {
  AgentSession,
  ApplicationRecord,
  ApplicationStatus,
  DelegatedRun,
  EventStream,
  InterventionRecord,
  JobRecord,
  JobStrategyPreferences,
  JobStrategyScoringWeights,
  JobStatus,
  RuntimeEvent,
} from '../runtime/contracts.js'
import { AutomationInsightsService } from '../runtime/automation-insights-service.js'
import { ExecutionTraceService } from '../runtime/execution-trace-service.js'
import { ResumeWorkflowService } from '../runtime/resume-workflow-service.js'
import { buildSetupCapabilitySummary } from '../runtime/setup-summary.js'
import { RuntimeTaskResultsService } from '../runtime/task-results-service.js'
import { createRuntimeId, nowIso } from '../runtime/utils.js'

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

type StrategyUpdatePayload = Omit<Partial<JobStrategyPreferences>, 'scoringWeights'> & {
  scoringWeights?: Partial<JobStrategyScoringWeights>
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
  getTaskResultsService?(): RuntimeTaskResultsService | undefined
  dispatchProfileTask?(
    profile: DelegatedRun['profile'],
    instruction: string
  ): { runId: string; dispatch: 'profile_agent' } | null
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

function isApplicationStatus(value: string): value is ApplicationStatus {
  return (
    value === 'draft' ||
    value === 'applied' ||
    value === 'follow_up' ||
    value === 'screening' ||
    value === 'interview' ||
    value === 'offer' ||
    value === 'rejected' ||
    value === 'withdrawn' ||
    value === 'ghosted'
  )
}

type JobQuerySortField = 'updatedAt' | 'discoveredAt' | 'company' | 'title' | 'status'
type ApplicationSortField = 'updatedAt' | 'createdAt' | 'nextActionAt' | 'company' | 'status'

function splitCsv(value?: string | null): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseJobSortField(value?: string | null): JobQuerySortField {
  if (value === 'discoveredAt') return 'discoveredAt'
  if (value === 'company') return 'company'
  if (value === 'title') return 'title'
  if (value === 'status') return 'status'
  return 'updatedAt'
}

function parseApplicationSortField(value?: string | null): ApplicationSortField {
  if (value === 'createdAt') return 'createdAt'
  if (value === 'nextActionAt') return 'nextActionAt'
  if (value === 'company') return 'company'
  if (value === 'status') return 'status'
  return 'updatedAt'
}

function parseSortOrder(value?: string | null): 'asc' | 'desc' {
  return value === 'asc' ? 'asc' : 'desc'
}

function parseCsv(value?: string | null): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseTaskReference(value?: string | null): { taskId: string; taskKind: 'session' | 'delegation' } | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('session:')) {
    const taskId = trimmed.slice('session:'.length).trim()
    if (!taskId) return null
    return {
      taskId,
      taskKind: 'session',
    }
  }
  if (trimmed.startsWith('delegation:')) {
    const taskId = trimmed.slice('delegation:'.length).trim()
    if (!taskId) return null
    return {
      taskId,
      taskKind: 'delegation',
    }
  }
  return {
    taskId: trimmed,
    taskKind: 'delegation',
  }
}

function parseLearningKinds(value?: string | null) {
  const allowed = new Set([
    'resume_review',
    'jd_gap_analysis',
    'interview_session',
    'failure_analysis',
    'hit_rate_snapshot',
    'improvement_plan',
  ])
  return parseCsv(value).filter((item): item is
    | 'resume_review'
    | 'jd_gap_analysis'
    | 'interview_session'
    | 'failure_analysis'
    | 'hit_rate_snapshot'
    | 'improvement_plan' => allowed.has(item))
}

function parseLearningStatuses(value?: string | null) {
  const allowed = new Set(['open', 'in_progress', 'completed', 'archived'])
  return parseCsv(value).filter((item): item is 'open' | 'in_progress' | 'completed' | 'archived' => allowed.has(item))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function sanitizeStringList(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`)
  }
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
    )
  )
}

function sanitizeStrategyBody(body: unknown): StrategyUpdatePayload {
  if (!isRecord(body)) {
    throw new Error('strategy payload must be an object')
  }

  const patch: StrategyUpdatePayload = {}
  const listFields = [
    'preferredRoles',
    'preferredLocations',
    'preferredCompanies',
    'excludedCompanies',
    'preferredKeywords',
    'excludedKeywords',
    'workModes',
    'sourceRefs',
  ] as const

  for (const field of listFields) {
    if (body[field] !== undefined) {
      patch[field] = sanitizeStringList(body[field], field)
    }
  }

  if (body.scoringWeights !== undefined) {
    if (!isRecord(body.scoringWeights)) {
      throw new Error('scoringWeights must be an object')
    }
    patch.scoringWeights = sanitizeScoringWeights(body.scoringWeights)
  }

  return patch
}

function sanitizeScoringWeights(value: Record<string, unknown>): Partial<JobStrategyScoringWeights> {
  const patch: Partial<JobStrategyScoringWeights> = {}
  const keys = [
    'roleMatch',
    'locationMatch',
    'skillSignal',
    'companyPreference',
    'keywordPreference',
    'constraintPenalty',
    'statusPenalty',
    'recency',
    'fitSummary',
  ] as const

  for (const key of keys) {
    const raw = value[key]
    if (raw === undefined) continue
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error(`scoringWeights.${key} must be a finite number`)
    }
    patch[key] = raw
  }

  return patch
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /not found/i.test(error.message)
}

function respondWithDomainError(c: Context, error: unknown) {
  if (isNotFoundError(error)) {
    return c.json({ ok: false, error: (error as Error).message }, 404)
  }
  return c.json({ ok: false, error: (error as Error).message }, 500)
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  if (typeof value !== 'string') return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return fallback
  return parsed
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (typeof value !== 'string') return undefined
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

function toTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function buildJobTrace(record: JobRecord) {
  const discoveredAtMs = toTimestamp(record.discoveredAt)
  const updatedAtMs = toTimestamp(record.updatedAt)
  const hasPostDiscoveryUpdate = updatedAtMs > discoveredAtMs
  return {
    firstSeenAt: record.discoveredAt,
    lastChangedAt: record.updatedAt,
    hasPostDiscoveryUpdate,
    changeKind: hasPostDiscoveryUpdate ? 'updated' as const : 'discovered' as const,
    updatedAfterDiscoveryMs: Math.max(0, updatedAtMs - discoveredAtMs),
  }
}

function toJobRow(record: JobRecord): { company: string; title: string; url: string; status: string; time: string } {
  return {
    company: record.company,
    title: record.title,
    url: record.url,
    status: record.status,
    time: record.discoveredAt,
  }
}

function toDetailedJob(record: JobRecord) {
  return {
    id: record.id,
    company: record.company,
    title: record.title,
    url: record.url,
    status: record.status,
    discoveredAt: record.discoveredAt,
    updatedAt: record.updatedAt,
    fitSummary: record.fitSummary ?? null,
    notes: record.notes ?? null,
    trace: buildJobTrace(record),
  }
}

function matchesJobQuery(
  record: JobRecord,
  filters: {
    statuses: JobStatus[]
    company?: string
    q?: string
    changedSince?: string
  }
): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.includes(record.status)) {
    return false
  }

  if (filters.company) {
    const companyNeedle = filters.company.toLowerCase()
    if (!record.company.toLowerCase().includes(companyNeedle)) {
      return false
    }
  }

  if (filters.q) {
    const needle = filters.q.toLowerCase()
    const haystacks = [
      record.company,
      record.title,
      record.url,
      record.fitSummary ?? '',
      record.notes ?? '',
    ]
    if (!haystacks.some((value) => value.toLowerCase().includes(needle))) {
      return false
    }
  }

  if (filters.changedSince && toTimestamp(record.updatedAt) < toTimestamp(filters.changedSince)) {
    return false
  }

  return true
}

function sortJobRecords(records: JobRecord[], sortBy: JobQuerySortField, order: 'asc' | 'desc'): JobRecord[] {
  const direction = order === 'asc' ? 1 : -1
  return [...records].sort((left, right) => {
    let comparison = 0
    switch (sortBy) {
      case 'company':
        comparison = left.company.localeCompare(right.company)
        break
      case 'title':
        comparison = left.title.localeCompare(right.title)
        break
      case 'status':
        comparison = left.status.localeCompare(right.status)
        break
      case 'discoveredAt':
        comparison = toTimestamp(left.discoveredAt) - toTimestamp(right.discoveredAt)
        break
      case 'updatedAt':
      default:
        comparison = toTimestamp(left.updatedAt) - toTimestamp(right.updatedAt)
        break
    }

    if (comparison !== 0) return comparison * direction
    return left.url.localeCompare(right.url) * direction
  })
}

function buildJobsStats(records: JobRecord[]) {
  const now = Date.now()
  const byStatus: Record<string, number> = {}
  const byCompany = new Map<string, number>()
  let changedAfterDiscovery = 0
  let neverUpdatedSinceDiscovery = 0
  let lastUpdatedAt: string | null = null

  for (const record of records) {
    byStatus[record.status] = (byStatus[record.status] ?? 0) + 1
    byCompany.set(record.company, (byCompany.get(record.company) ?? 0) + 1)
    if (!lastUpdatedAt || toTimestamp(record.updatedAt) > toTimestamp(lastUpdatedAt)) {
      lastUpdatedAt = record.updatedAt
    }
    if (toTimestamp(record.updatedAt) > toTimestamp(record.discoveredAt)) {
      changedAfterDiscovery += 1
    } else {
      neverUpdatedSinceDiscovery += 1
    }
  }

  const byCompanyList = Array.from(byCompany.entries())
    .map(([company, total]) => ({ company, total }))
    .sort((left, right) => {
      if (right.total !== left.total) return right.total - left.total
      return left.company.localeCompare(right.company)
    })

  const updatedInLast24h = records.filter((record) => now - toTimestamp(record.updatedAt) <= 24 * 60 * 60 * 1000).length
  const updatedInLast7d = records.filter((record) => now - toTimestamp(record.updatedAt) <= 7 * 24 * 60 * 60 * 1000).length

  return {
    total: records.length,
    byStatus,
    lastUpdatedAt,
    updatedInLast24h,
    updatedInLast7d,
    byCompany: byCompanyList,
    traceability: {
      changedAfterDiscovery,
      neverUpdatedSinceDiscovery,
    },
  }
}

async function readJobsForApi(workspaceRoot: string, jobs: JobsService): Promise<JobRecord[]> {
  const jobsStatePath = path.resolve(workspaceRoot, 'state/jobs/jobs.json')
  if (!fs.existsSync(jobsStatePath)) {
    const rows = await jobs.listRows()
    return rows.map((row, index) => ({
      id: `${index}:${row.url}`,
      company: row.company,
      title: row.title,
      url: row.url,
      status: isJobStatus(row.status) ? row.status : 'discovered',
      discoveredAt: row.time,
      updatedAt: row.time,
    }))
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(jobsStatePath, 'utf-8'))
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed as JobRecord[]
    }
    const rows = await jobs.listRows()
    return rows.map((row, index) => ({
      id: `${index}:${row.url}`,
      company: row.company,
      title: row.title,
      url: row.url,
      status: isJobStatus(row.status) ? row.status : 'discovered',
      discoveredAt: row.time,
      updatedAt: row.time,
    }))
  } catch {
    return []
  }
}

function matchesApplicationQuery(
  record: ApplicationRecord,
  filters: {
    statuses: ApplicationStatus[]
    company?: string
    q?: string
    dueBefore?: string
  }
): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.includes(record.status)) return false
  if (filters.company && !record.company.toLowerCase().includes(filters.company.toLowerCase())) return false
  if (filters.q) {
    const needle = filters.q.toLowerCase()
    const haystacks = [
      record.company,
      record.jobTitle,
      record.jobUrl ?? '',
      record.nextAction?.summary ?? '',
      ...record.notes.map((note) => note.body),
    ]
    if (!haystacks.some((value) => value.toLowerCase().includes(needle))) return false
  }
  if (filters.dueBefore) {
    const dueAt = toTimestamp(record.nextAction?.dueAt ?? '')
    if (!dueAt || dueAt > toTimestamp(filters.dueBefore)) return false
  }
  return true
}

function sortApplications(
  records: ApplicationRecord[],
  sortBy: ApplicationSortField,
  order: 'asc' | 'desc'
): ApplicationRecord[] {
  const direction = order === 'asc' ? 1 : -1
  return [...records].sort((left, right) => {
    let comparison = 0
    switch (sortBy) {
      case 'createdAt':
        comparison = toTimestamp(left.createdAt) - toTimestamp(right.createdAt)
        break
      case 'nextActionAt':
        comparison = toTimestamp(left.nextAction?.dueAt ?? '') - toTimestamp(right.nextAction?.dueAt ?? '')
        break
      case 'company':
        comparison = left.company.localeCompare(right.company)
        break
      case 'status':
        comparison = left.status.localeCompare(right.status)
        break
      case 'updatedAt':
      default:
        comparison = toTimestamp(left.updatedAt) - toTimestamp(right.updatedAt)
        break
    }
    if (comparison !== 0) return comparison * direction
    return left.company.localeCompare(right.company) * direction
  })
}

function toDetailedApplication(record: ApplicationRecord) {
  return {
    ...record,
    overdueReminderCount: record.reminders.filter(
      (reminder) => reminder.status === 'pending' && toTimestamp(reminder.dueAt) < Date.now()
    ).length,
  }
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

function summarizeDelegatedResult(result: string): string {
  const normalized = result.replace(/\s+/g, ' ').trim()
  if (normalized.length <= 180) return normalized
  return `${normalized.slice(0, 177)}...`
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
        getTaskResultsService: () => undefined,
        dispatchProfileTask: () => null,
      }

  const app = new Hono()
  const jobs = new JobsService(workspaceRoot, 'web-server')
  const applications = new ApplicationService(workspaceRoot)
  const learning = new LearningService(workspaceRoot)
  const recommendations = new RecommendationService(workspaceRoot)
  const strategyStore = new StrategyStore(workspaceRoot)
  const conversationStore = new ConversationStore(workspaceRoot)
  const sessionStore = new SessionStore(workspaceRoot)
  const delegationStore = new DelegationStore(workspaceRoot)
  const interventionStore = new InterventionStore(workspaceRoot)
  const artifactStore = new ArtifactStore(workspaceRoot)
  const runtimeTaskResultsService = runtime.getTaskResultsService?.() ?? new RuntimeTaskResultsService(workspaceRoot)
  const executionTraceService = new ExecutionTraceService({
    workspaceRoot,
    applicationService: applications,
    learningService: learning,
    recommendationService: recommendations,
    taskResultsService: runtimeTaskResultsService,
  })
  const uploadedResumeRelPath = 'data/uploads/resume-upload.pdf'
  const uploadedResumeAbsPath = path.resolve(workspaceRoot, uploadedResumeRelPath)

  function toApiTaskId(kind: 'session' | 'delegation', id: string): string {
    return `${kind}:${id}`
  }

  function mapTaskForApi(task: Awaited<ReturnType<typeof runtimeTaskResultsService.aggregate>>['tasks'][number]) {
    return {
      id: toApiTaskId(task.kind, task.id),
      kind: task.kind,
      profile: task.profile,
      title: task.title,
      state: task.lifecycle,
      status: task.status,
      statusLabel: task.statusLabel,
      rawState: task.state,
      sessionId: task.sessionId,
      agentName: task.agentName,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      summary: task.summary,
      resultSummary: task.resultSummary,
      error: task.error,
      nextAction: task.nextAction,
      nextStep: task.nextAction,
      retryHint: task.retryHint,
      detail: task.detail,
    }
  }

  function mapArtifactForApi(artifact: Awaited<ReturnType<typeof runtimeTaskResultsService.aggregate>>['recentArtifacts'][number]) {
    const relatedTaskIds = Array.from(new Set([
      ...(artifact.ownerHints.sessionId ? [toApiTaskId('session', artifact.ownerHints.sessionId)] : []),
      ...(artifact.ownerHints.delegatedRunId ? [toApiTaskId('delegation', artifact.ownerHints.delegatedRunId)] : []),
      ...artifact.relatedTaskIds
        .filter((taskId) => taskId !== artifact.ownerHints.sessionId && taskId !== artifact.ownerHints.delegatedRunId)
        .map((taskId) => taskId === 'main' ? toApiTaskId('session', taskId) : toApiTaskId('delegation', taskId)),
    ]))
    return {
      ...artifact,
      relatedTaskIds,
    }
  }

  function dispatchTrackedProfileTask(
    profile: DelegatedRun['profile'],
    instruction: string
  ): { runId: string; dispatch: 'profile_agent' } | null {
    const runtimeDispatch = runtime.dispatchProfileTask?.(profile, instruction)
    if (runtimeDispatch) return runtimeDispatch

    const factory = runtime.getFactory()
    if (!factory) return null

    const taskAgent = factory.createAgent({ persistent: false, profileName: profile })
    const createdAt = nowIso()
    const runId = createRuntimeId('delegation')
    const baseRun: DelegatedRun = {
      id: runId,
      parentSessionId: 'main',
      profile,
      state: 'queued',
      instruction,
      createdAt,
      updatedAt: createdAt,
      agentName: taskAgent.agentName,
    }

    void delegationStore.save(baseRun)
    eventBus.emit('delegation.created', baseRun)

    void (async () => {
      const runningRun: DelegatedRun = {
        ...baseRun,
        state: 'running',
        updatedAt: nowIso(),
      }
      await delegationStore.save(runningRun)
      eventBus.emit('delegation.state_changed', runningRun)

      try {
        const result = await taskAgent.run(instruction)
        const completedRun: DelegatedRun = {
          ...runningRun,
          state: 'completed',
          updatedAt: nowIso(),
          resultSummary: summarizeDelegatedResult(result),
        }
        await delegationStore.save(completedRun)
        eventBus.emit('delegation.completed', completedRun)
      } catch (err) {
        const failedRun: DelegatedRun = {
          ...runningRun,
          state: 'failed',
          updatedAt: nowIso(),
          error: (err as Error).message,
        }
        await delegationStore.save(failedRun)
        eventBus.emit('delegation.failed', failedRun)
        console.error(`[Server] ${profile} task failed:`, err)
      }
    })()

    return { runId, dispatch: 'profile_agent' }
  }

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
      const snapshot = await runtimeTaskResultsService.aggregate({ sessionId })
      const tasks = snapshot.tasks.map((task) => mapTaskForApi(task))
      return c.json({ ok: true, tasks })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/runtime/tasks/detail', async (c) => {
    try {
      const id = c.req.query('id')?.trim()
      if (!id) return c.json({ ok: false, error: 'id is required' }, 400)
      const detail = await runtimeTaskResultsService.getTaskDetail(id)
      if (!detail) return c.json({ ok: false, error: 'Task not found' }, 404)
      return c.json({
        ok: true,
        detail: {
          task: mapTaskForApi(detail.task),
          interventions: detail.interventions,
          artifacts: detail.artifacts.map((artifact) => mapArtifactForApi(artifact)),
          failures: detail.failures.map((failure) => ({
            ...failure,
            id: `${failure.kind}:${failure.id}`,
          })),
          nextActions: detail.nextActions,
        },
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/runtime/results', async (c) => {
    try {
      const sessionId = c.req.query('sessionId') || undefined
      const snapshot = await runtimeTaskResultsService.aggregate({ sessionId })
      return c.json({
        ok: true,
        generatedAt: snapshot.generatedAt,
        resultSummary: snapshot.resultSummary,
        recentFailures: snapshot.recentFailures.map((failure) => ({
          ...failure,
          id: `${failure.kind}:${failure.id}`,
        })),
        recentArtifacts: snapshot.recentArtifacts.map((artifact) => mapArtifactForApi(artifact)),
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/resume/workflow', async (c) => {
    try {
      const service = new ResumeWorkflowService({
        workspaceRoot,
        configStatus: runtime.getConfigStatus(),
        runtimeStatus: runtime.getRuntimeStatus?.(),
        artifactStore,
        taskResultsService: runtimeTaskResultsService,
      })
      const overview = await service.getOverview({
        sessionId: c.req.query('sessionId') || undefined,
      })
      return c.json({ ok: true, overview })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/resume/artifacts', async (c) => {
    try {
      const limit = parsePositiveInt(c.req.query('limit'))
      const service = new ResumeWorkflowService({
        workspaceRoot,
        configStatus: runtime.getConfigStatus(),
        runtimeStatus: runtime.getRuntimeStatus?.(),
        artifactStore,
        taskResultsService: runtimeTaskResultsService,
      })
      const artifacts = await service.listArtifacts(limit)
      return c.json({ ok: true, total: artifacts.length, artifacts })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/jobs', async (c) => {
    try {
      const records = await readJobsForApi(workspaceRoot, jobs)
      const statuses = splitCsv(c.req.query('status')).filter(isJobStatus)
      const company = c.req.query('company')?.trim()
      const q = c.req.query('q')?.trim()
      const changedSince = c.req.query('changedSince')?.trim()
      const sortBy = parseJobSortField(c.req.query('sortBy'))
      const order = parseSortOrder(c.req.query('order'))
      const offset = parseNonNegativeInt(c.req.query('offset'), 0)
      const limit = parsePositiveInt(c.req.query('limit'))
      const filtered = sortJobRecords(
        records.filter((record) => matchesJobQuery(record, { statuses, company, q, changedSince })),
        sortBy,
        order
      )
      const paged = limit ? filtered.slice(offset, offset + limit) : filtered.slice(offset)
      return c.json(paged.map(toJobRow))
    } catch {
      return c.json([], 500)
    }
  })

  app.get('/api/stats', async (c) => {
    try {
      return c.json(buildJobsStats(await readJobsForApi(workspaceRoot, jobs)))
    } catch {
      return c.json({ total: 0, byStatus: {} })
    }
  })

  app.get('/api/jobs/query', async (c) => {
    try {
      const records = await readJobsForApi(workspaceRoot, jobs)
      const statuses = splitCsv(c.req.query('status')).filter(isJobStatus)
      const company = c.req.query('company')?.trim()
      const q = c.req.query('q')?.trim()
      const changedSince = c.req.query('changedSince')?.trim()
      const sortBy = parseJobSortField(c.req.query('sortBy'))
      const order = parseSortOrder(c.req.query('order'))
      const offset = parseNonNegativeInt(c.req.query('offset'), 0)
      const limit = parsePositiveInt(c.req.query('limit')) ?? 50
      const filtered = sortJobRecords(
        records.filter((record) => matchesJobQuery(record, { statuses, company, q, changedSince })),
        sortBy,
        order
      )
      const paged = filtered.slice(offset, offset + limit)
      return c.json({
        ok: true,
        total: filtered.length,
        items: paged.map(toDetailedJob),
        filters: {
          status: statuses,
          company: company || null,
          q: q || null,
          changedSince: changedSince || null,
          sortBy,
          order,
        },
        page: {
          offset,
          limit,
          returned: paged.length,
        },
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/jobs/detail', async (c) => {
    try {
      const id = c.req.query('id')?.trim()
      const url = c.req.query('url')?.trim()
      if (!id && !url) {
        return c.json({ ok: false, error: 'id or url is required' }, 400)
      }

      const record = (await readJobsForApi(workspaceRoot, jobs)).find((item) => (id ? item.id === id : item.url === url))
      if (!record) {
        return c.json({ ok: false, error: 'Job not found' }, 404)
      }

      return c.json({ ok: true, job: toDetailedJob(record) })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/jobs/stats', async (c) => {
    try {
      return c.json({ ok: true, stats: buildJobsStats(await readJobsForApi(workspaceRoot, jobs)) })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/jobs/changes', async (c) => {
    try {
      const records = await readJobsForApi(workspaceRoot, jobs)
      const statuses = splitCsv(c.req.query('status')).filter(isJobStatus)
      const changedSince = c.req.query('changedSince')?.trim()
      const limit = parsePositiveInt(c.req.query('limit')) ?? 20
      const items = sortJobRecords(
        records.filter((record) => matchesJobQuery(record, { statuses, changedSince })),
        'updatedAt',
        'desc'
      )
        .slice(0, limit)
        .map((record) => ({
          ...toDetailedJob(record),
          changedAt: record.updatedAt,
        }))

      return c.json({
        ok: true,
        total: items.length,
        items,
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/jobs/recommendations', async (c) => {
    try {
      const statuses = splitCsv(c.req.query('status')).filter(isJobStatus)
      const limit = parsePositiveInt(c.req.query('limit')) ?? 20
      const includeAvoid = c.req.query('includeAvoid') === '1'
      const minScore = parsePositiveInt(c.req.query('minScore'))
      const items = await recommendations.list({
        statuses,
        limit,
        includeAvoid,
        minScore,
      })
      return c.json({ ok: true, total: items.length, items })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/jobs/recommendations/detail', async (c) => {
    try {
      const id = c.req.query('id')?.trim()
      if (!id) return c.json({ ok: false, error: 'id is required' }, 400)
      const item = await recommendations.get(id)
      if (!item) return c.json({ ok: false, error: 'Recommendation not found' }, 404)
      return c.json({ ok: true, recommendation: item })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/strategy', async (c) => {
    try {
      const strategy = await strategyStore.get()
      return c.json({ ok: true, strategy })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/strategy', async (c) => {
    try {
      const body = sanitizeStrategyBody(await c.req.json())
      const strategy = await strategyStore.update((current) => ({
        ...current,
        ...body,
        version: current.version + 1,
        updatedAt: nowIso(),
        scoringWeights: {
          ...current.scoringWeights,
          ...body.scoringWeights,
        },
        sourceRefs: body.sourceRefs ?? current.sourceRefs,
      }))
      return c.json({ ok: true, strategy })
    } catch (err) {
      const status = err instanceof Error && /must be|payload/i.test(err.message) ? 400 : 500
      return c.json({ ok: false, error: (err as Error).message }, status)
    }
  })

  app.get('/api/applications', async (c) => {
    try {
      const statuses = splitCsv(c.req.query('status')).filter(isApplicationStatus)
      const company = c.req.query('company')?.trim()
      const q = c.req.query('q')?.trim()
      const dueBefore = c.req.query('dueBefore')?.trim()
      const sortBy = parseApplicationSortField(c.req.query('sortBy'))
      const order = parseSortOrder(c.req.query('order'))
      const limit = parsePositiveInt(c.req.query('limit'))
      const items = sortApplications(
        (await applications.list()).filter((record) => matchesApplicationQuery(record, { statuses, company, q, dueBefore })),
        sortBy,
        order
      )
      const paged = typeof limit === 'number' ? items.slice(0, limit) : items
      return c.json({ ok: true, total: items.length, items: paged.map(toDetailedApplication) })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/applications/detail', async (c) => {
    try {
      const id = c.req.query('id')?.trim()
      if (!id) return c.json({ ok: false, error: 'id is required' }, 400)
      const application = await applications.get(id)
      if (!application) return c.json({ ok: false, error: 'Application not found' }, 404)
      return c.json({ ok: true, application: toDetailedApplication(application) })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/applications/summary', async (c) => {
    try {
      return c.json({ ok: true, summary: await applications.getSummary() })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/applications/progress', async (c) => {
    try {
      const id = c.req.query('id')?.trim()
      if (!id) return c.json({ ok: false, error: 'id is required' }, 400)
      const trace = await executionTraceService.getByApplicationId(id)
      if (!trace) return c.json({ ok: false, error: 'Application not found' }, 404)
      return c.json(trace)
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/applications/upsert', async (c) => {
    try {
      const body = await c.req.json<{
        id?: string
        company?: string
        jobTitle?: string
        jobUrl?: string
        jobId?: string
        status?: ApplicationStatus
        appliedAt?: string
        nextAction?: { summary?: string; dueAt?: string; owner?: 'user' | 'agent' | 'system'; note?: string }
        note?: { body?: string; category?: 'general' | 'follow_up' | 'interview' | 'rejection' }
      }>()
      if (!body.company?.trim() || !body.jobTitle?.trim()) {
        return c.json({ ok: false, error: 'company and jobTitle are required' }, 400)
      }
      const application = await applications.upsert(
        {
          id: body.id,
          company: body.company.trim(),
          jobTitle: body.jobTitle.trim(),
          jobUrl: body.jobUrl?.trim(),
          jobId: body.jobId?.trim(),
          status: body.status,
          appliedAt: body.appliedAt,
          nextAction: body.nextAction?.summary?.trim()
            ? {
                summary: body.nextAction.summary.trim(),
                dueAt: body.nextAction.dueAt,
                owner: body.nextAction.owner,
                note: body.nextAction.note,
              }
            : undefined,
          note: body.note?.body?.trim()
            ? {
                body: body.note.body.trim(),
                category: body.note.category,
              }
            : undefined,
        },
        { source: 'manual', actor: 'web-server' }
      )
      return c.json({ ok: true, application: toDetailedApplication(application) })
    } catch (err) {
      return respondWithDomainError(c, err)
    }
  })

  app.post('/api/applications/status', async (c) => {
    try {
      const body = await c.req.json<{ id?: string; status?: ApplicationStatus; rejectionReason?: string; rejectionNotes?: string }>()
      if (!body.id?.trim() || !body.status || !isApplicationStatus(body.status)) {
        return c.json({ ok: false, error: 'id and valid status are required' }, 400)
      }
      const application = await applications.updateStatus(
        body.id.trim(),
        body.status,
        { source: 'manual', actor: 'web-server' },
        { rejectionReason: body.rejectionReason, rejectionNotes: body.rejectionNotes }
      )
      return c.json({ ok: true, application: toDetailedApplication(application) })
    } catch (err) {
      return respondWithDomainError(c, err)
    }
  })

  app.post('/api/applications/reminders', async (c) => {
    try {
      const body = await c.req.json<{ id?: string; title?: string; dueAt?: string; note?: string }>()
      if (!body.id?.trim() || !body.title?.trim() || !body.dueAt?.trim()) {
        return c.json({ ok: false, error: 'id, title, and dueAt are required' }, 400)
      }
      const application = await applications.addReminder(
        body.id.trim(),
        { title: body.title.trim(), dueAt: body.dueAt.trim(), note: body.note?.trim() },
        { source: 'manual', actor: 'web-server' }
      )
      return c.json({ ok: true, application: toDetailedApplication(application) })
    } catch (err) {
      return respondWithDomainError(c, err)
    }
  })

  app.post('/api/applications/reminders/complete', async (c) => {
    try {
      const body = await c.req.json<{ id?: string; reminderId?: string; status?: 'completed' | 'cancelled' }>()
      if (!body.id?.trim() || !body.reminderId?.trim() || (body.status !== 'completed' && body.status !== 'cancelled')) {
        return c.json({ ok: false, error: 'id, reminderId, and valid status are required' }, 400)
      }
      const application = await applications.completeReminder(
        body.id.trim(),
        body.reminderId.trim(),
        body.status,
        { source: 'manual', actor: 'web-server' }
      )
      return c.json({ ok: true, application: toDetailedApplication(application) })
    } catch (err) {
      return respondWithDomainError(c, err)
    }
  })

  app.post('/api/applications/notes', async (c) => {
    try {
      const body = await c.req.json<{ id?: string; body?: string; category?: 'general' | 'follow_up' | 'interview' | 'rejection' }>()
      if (!body.id?.trim() || !body.body?.trim()) {
        return c.json({ ok: false, error: 'id and body are required' }, 400)
      }
      const application = await applications.addNote(
        body.id.trim(),
        { body: body.body.trim(), category: body.category },
        { source: 'manual', actor: 'web-server' }
      )
      return c.json({ ok: true, application: toDetailedApplication(application) })
    } catch (err) {
      return respondWithDomainError(c, err)
    }
  })

  app.post('/api/applications/link-task', async (c) => {
    try {
      const body = await c.req.json<{ id?: string; taskId?: string; role?: 'delivery' | 'follow_up' | 'supporting'; note?: string }>()
      if (!body.id?.trim() || !body.taskId?.trim()) {
        return c.json({ ok: false, error: 'id and taskId are required' }, 400)
      }
      const parsed = parseTaskReference(body.taskId)
      if (!parsed) return c.json({ ok: false, error: 'taskId is required' }, 400)
      const application = await applications.linkTask(
        body.id.trim(),
        {
          taskId: parsed.taskId,
          taskKind: parsed.taskKind,
          role: body.role,
          note: body.note,
        },
        { source: 'manual', actor: 'web-server' }
      )
      return c.json({ ok: true, application: toDetailedApplication(application) })
    } catch (err) {
      return respondWithDomainError(c, err)
    }
  })

  app.get('/api/learning/records', async (c) => {
    try {
      const items = await learning.list({
        kinds: parseLearningKinds(c.req.query('kinds')),
        statuses: parseLearningStatuses(c.req.query('statuses')),
        applicationId: c.req.query('applicationId')?.trim(),
        jobId: c.req.query('jobId')?.trim(),
        taskId: parseTaskReference(c.req.query('taskId'))?.taskId ?? c.req.query('taskId')?.trim(),
        tag: c.req.query('tag')?.trim(),
        limit: parsePositiveInt(c.req.query('limit')),
        sortBy: c.req.query('sortBy') === 'createdAt' ? 'createdAt' : 'updatedAt',
        order: parseSortOrder(c.req.query('order')),
      })
      return c.json({ ok: true, items })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/learning/detail', async (c) => {
    try {
      const id = c.req.query('id')?.trim()
      if (!id) return c.json({ ok: false, error: 'id is required' }, 400)
      const record = await learning.get(id)
      if (!record) return c.json({ ok: false, error: 'Learning record not found' }, 404)
      return c.json({ ok: true, record })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/learning/records', async (c) => {
    try {
      const body = await c.req.json<{
        id?: string
        kind?: 'resume_review' | 'jd_gap_analysis' | 'interview_session' | 'failure_analysis' | 'hit_rate_snapshot' | 'improvement_plan'
        status?: 'open' | 'in_progress' | 'completed' | 'archived'
        title?: string
        summary?: string
        tags?: string[]
        links?: {
          applicationId?: string
          jobId?: string
          taskId?: string
          artifactPaths?: string[]
        }
        findings?: Array<{
          id?: string
          title?: string
          summary?: string
          severity?: 'info' | 'warning' | 'critical'
          evidence?: string[]
        }>
        actionItems?: Array<{
          id?: string
          summary?: string
          owner?: 'user' | 'agent' | 'system'
          status?: 'pending' | 'done' | 'dismissed'
          linkedTaskId?: string
          dueAt?: string
          note?: string
        }>
        metrics?: {
          interviewScore?: number
          hitRate?: number
          gapCount?: number
          failureCount?: number
        }
      }>()

      if (!body.kind || !body.title?.trim() || !body.summary?.trim()) {
        return c.json({ ok: false, error: 'kind, title, and summary are required' }, 400)
      }

      const record = await learning.upsert({
        id: body.id,
        kind: body.kind,
        status: body.status,
        title: body.title,
        summary: body.summary,
        tags: body.tags,
        links: {
          ...body.links,
          taskId: parseTaskReference(body.links?.taskId)?.taskId ?? body.links?.taskId,
        },
        findings: body.findings?.map((item) => ({
          id: item.id,
          title: item.title ?? '',
          summary: item.summary ?? '',
          severity: item.severity,
          evidence: item.evidence,
        })),
        actionItems: body.actionItems?.map((item) => ({
          id: item.id,
          summary: item.summary ?? '',
          owner: item.owner,
          status: item.status,
          linkedTaskId: parseTaskReference(item.linkedTaskId)?.taskId ?? item.linkedTaskId,
          dueAt: item.dueAt,
          note: item.note,
        })),
        metrics: body.metrics,
      }, { source: 'manual', actor: 'web-server' })

      return c.json({ ok: true, record })
    } catch (err) {
      return respondWithDomainError(c, err)
    }
  })

  app.post('/api/learning/action-items', async (c) => {
    try {
      const body = await c.req.json<{
        id?: string
        actionItemId?: string
        status?: 'pending' | 'done' | 'dismissed'
        dueAt?: string
        note?: string
        linkedTaskId?: string
      }>()
      if (!body.id?.trim() || !body.actionItemId?.trim()) {
        return c.json({ ok: false, error: 'id and actionItemId are required' }, 400)
      }
      const record = await learning.updateActionItem(
        body.id.trim(),
        body.actionItemId.trim(),
        {
          status: body.status,
          dueAt: body.dueAt,
          note: body.note,
          linkedTaskId: parseTaskReference(body.linkedTaskId)?.taskId ?? body.linkedTaskId,
        },
        { source: 'manual', actor: 'web-server' }
      )
      return c.json({ ok: true, record })
    } catch (err) {
      return respondWithDomainError(c, err)
    }
  })

  app.get('/api/learning/insights', async (c) => {
    try {
      return c.json(await learning.getInsights())
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/runtime/automation-insights', async (c) => {
    try {
      const service = new AutomationInsightsService({
        workspaceRoot,
        configStatus: runtime.getConfigStatus(),
        runtimeStatus: runtime.getRuntimeStatus?.(),
        taskResultsService: runtimeTaskResultsService,
      })
      return c.json(await service.getInsights({ sessionId: c.req.query('sessionId') || undefined }))
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/runtime/execution-trace', async (c) => {
    try {
      const applicationId = c.req.query('applicationId')?.trim()
      const taskId = c.req.query('taskId')?.trim()
      if (!applicationId && !taskId) {
        return c.json({ ok: false, error: 'applicationId or taskId is required' }, 400)
      }
      const trace = applicationId
        ? await executionTraceService.getByApplicationId(applicationId)
        : await executionTraceService.getByTaskId(taskId!)
      if (!trace) {
        return c.json({ ok: false, error: applicationId ? 'Application not found' : 'Task not found' }, 404)
      }
      return c.json(trace)
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
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

    const trackedRun = dispatchTrackedProfileTask('resume', '生成简历')
    if (trackedRun) {
      return c.json({ ok: true, workflow: '/api/resume/workflow', dispatch: trackedRun.dispatch, runId: trackedRun.runId })
    }

    const mainAgent = runtime.getMainAgent()
    if (!mainAgent) return c.json({ ok: false, error: 'Main agent not found' }, 500)

    mainAgent.submit('生成简历')
    return c.json({ ok: true, workflow: '/api/resume/workflow', dispatch: 'main_agent' })
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

    const trackedRun = dispatchTrackedProfileTask('review', prompt)
    if (trackedRun) {
      return c.json({
        ok: true,
        path: uploadedResumeRelPath,
        workflow: '/api/resume/workflow',
        dispatch: trackedRun.dispatch,
        runId: trackedRun.runId,
      })
    }

    const mainAgent = runtime.getMainAgent()
    if (!mainAgent) return c.json({ ok: false, error: 'Main agent not found' }, 500)

    mainAgent.submit(prompt)
    return c.json({ ok: true, path: uploadedResumeRelPath, workflow: '/api/resume/workflow', dispatch: 'main_agent' })
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
        workflow: '/api/resume/workflow',
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

      const result = await jobs.updateStatuses(normalizedUpdates, {
        lockHolder: 'web-server',
        mutation: {
          source: 'manual',
          actor: 'web-server',
        },
      })
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

      const result = await jobs.deleteByUrls(urls, {
        lockHolder: 'web-server',
        mutation: {
          source: 'manual',
          actor: 'web-server',
        },
      })
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
        await jobs.importMarkdown(content, {
          lockHolder: 'web-server',
          mode: 'replace',
          mutation: {
            source: 'manual',
            actor: 'web-server',
          },
        })
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
