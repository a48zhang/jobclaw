import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { ArtifactStore } from '../memory/artifactStore.js'
import { ConversationStore } from '../memory/conversationStore.js'
import { DelegationStore } from '../memory/delegationStore.js'
import { InterventionStore } from '../memory/interventionStore.js'
import { JsonSessionStore } from './session-store.js'
import type {
  AgentProfileName,
  AgentSession,
  AgentSessionState,
  ArtifactRecord,
  ConversationMemory,
  DelegatedRun,
  DelegatedRunState,
  InterventionRecord,
  InterventionStatus,
} from './contracts.js'
import { nowIso } from './utils.js'

export type UnifiedTaskKind = 'session' | 'delegation'
export type UnifiedTaskLifecycle = 'idle' | 'running' | 'waiting' | 'failed' | 'completed' | 'cancelled'

export interface TaskResultsAggregateOptions {
  sessionId?: string
  taskLimit?: number
  failureLimit?: number
  artifactLimit?: number
}

export interface UnifiedTaskInterventionSummary {
  id: string
  kind: InterventionRecord['kind']
  prompt: string
  status: InterventionRecord['status']
  createdAt: string
  updatedAt: string
  timeoutMs?: number
  allowEmpty?: boolean
}

export interface UnifiedTaskArtifactSummary {
  id: string
  name: string
  type: ArtifactRecord['type']
  path: string
  createdAt: string
  relatedTaskIds: string[]
  meta: Record<string, unknown>
}

export interface UnifiedTaskRecord {
  id: string
  kind: UnifiedTaskKind
  profile: AgentProfileName
  sessionId: string
  agentName: string
  title: string
  state: AgentSessionState | DelegatedRunState
  lifecycle: UnifiedTaskLifecycle
  createdAt: string
  updatedAt: string
  activityAt: string
  lastMessageAt?: string
  summary: string
  conversationSummary?: string
  resultSummary?: string
  error?: string
  pendingIntervention?: UnifiedTaskInterventionSummary
  interventionCounts: Record<InterventionStatus, number>
  artifactCount: number
  latestArtifact?: UnifiedTaskArtifactSummary
}

export interface UnifiedFailureRecord {
  id: string
  kind: 'session' | 'delegation' | 'intervention'
  ownerId: string
  sessionId?: string
  profile: AgentProfileName | 'system'
  state: string
  title: string
  reason: string
  createdAt: string
  updatedAt: string
}

export interface UnifiedArtifactRecord extends UnifiedTaskArtifactSummary {
  ownerHints: {
    sessionId?: string
    delegatedRunId?: string
    ownerId?: string
  }
}

export interface TaskResultsSummary {
  generatedAt: string
  headline: string
  totalTasks: number
  sessionTasks: number
  delegatedTasks: number
  idleTasks: number
  runningTasks: number
  waitingTasks: number
  failedTasks: number
  completedTasks: number
  cancelledTasks: number
  pendingInterventions: number
  recentFailures: number
  recentArtifacts: number
}

export interface TaskResultsAggregate {
  generatedAt: string
  tasks: UnifiedTaskRecord[]
  recentFailures: UnifiedFailureRecord[]
  recentArtifacts: UnifiedArtifactRecord[]
  resultSummary: TaskResultsSummary
}

interface TaskAggregationData {
  sessions: AgentSession[]
  delegations: DelegatedRun[]
  interventions: InterventionRecord[]
  artifacts: ArtifactRecord[]
  conversations: Map<string, ConversationMemory>
}

interface ArtifactOwnerHints {
  sessionId?: string
  delegatedRunId?: string
  ownerId?: string
}

export interface TaskResultsServiceDependencies {
  workspaceRoot: string
  sessionStore?: Pick<JsonSessionStore, 'list'>
  delegationStore?: Pick<DelegationStore, 'list'>
  interventionStore?: { list(): Promise<InterventionRecord[]> }
  artifactStore?: Pick<ArtifactStore, 'list'>
  conversationStore?: Pick<ConversationStore, 'get'>
}

export class RuntimeTaskResultsService {
  private readonly sessionStore: Pick<JsonSessionStore, 'list'>
  private readonly delegationStore: Pick<DelegationStore, 'list'>
  private readonly interventionStore: { list(): Promise<InterventionRecord[]> }
  private readonly artifactStore: Pick<ArtifactStore, 'list'>
  private readonly conversationStore: Pick<ConversationStore, 'get'>

  constructor(config: string | TaskResultsServiceDependencies) {
    const dependencies = typeof config === 'string' ? { workspaceRoot: config } : config
    this.workspaceRoot = dependencies.workspaceRoot
    this.sessionStore = dependencies.sessionStore ?? new JsonSessionStore(this.workspaceRoot)
    this.delegationStore = dependencies.delegationStore ?? new DelegationStore(this.workspaceRoot)
    this.interventionStore = dependencies.interventionStore ?? new InterventionStore(this.workspaceRoot)
    this.artifactStore = dependencies.artifactStore ?? new ArtifactStore(this.workspaceRoot)
    this.conversationStore = dependencies.conversationStore ?? new ConversationStore(this.workspaceRoot)
  }

  private readonly workspaceRoot: string

  async aggregate(options: TaskResultsAggregateOptions = {}): Promise<TaskResultsAggregate> {
    const generatedAt = nowIso()
    const data = await this.loadAggregationData()
    const allTasks = this.buildTasks(data)
    const allRecentArtifacts = this.buildRecentArtifacts(data.artifacts)
    const tasks = filterTasksBySession(allTasks, options.sessionId)
    const visibleTaskIds = new Set(tasks.map((task) => task.id))
    const recentFailures = this.buildRecentFailures(data, tasks, visibleTaskIds)
    const recentArtifacts = filterArtifactsByTaskIds(allRecentArtifacts, visibleTaskIds)

    return {
      generatedAt,
      tasks: applyLimit(tasks, options.taskLimit),
      recentFailures: applyLimit(recentFailures, options.failureLimit),
      recentArtifacts: applyLimit(recentArtifacts, options.artifactLimit),
      resultSummary: this.buildSummary(
        generatedAt,
        tasks,
        filterInterventionsByTaskIds(data.interventions, visibleTaskIds),
        recentFailures,
        recentArtifacts
      ),
    }
  }

  async listTasks(options: number | TaskResultsAggregateOptions = {}): Promise<UnifiedTaskRecord[]> {
    const normalized = typeof options === 'number' ? { taskLimit: options } : options
    const snapshot = await this.aggregate(normalized)
    return snapshot.tasks
  }

  async listRecentFailures(options: number | TaskResultsAggregateOptions = {}): Promise<UnifiedFailureRecord[]> {
    const normalized = typeof options === 'number' ? { failureLimit: options } : options
    const snapshot = await this.aggregate(normalized)
    return snapshot.recentFailures
  }

  async listRecentArtifacts(options: number | TaskResultsAggregateOptions = {}): Promise<UnifiedArtifactRecord[]> {
    const normalized = typeof options === 'number' ? { artifactLimit: options } : options
    const snapshot = await this.aggregate(normalized)
    return snapshot.recentArtifacts
  }

  async getResultsSummary(
    options: Pick<TaskResultsAggregateOptions, 'sessionId' | 'failureLimit' | 'artifactLimit'> = {}
  ): Promise<Pick<TaskResultsAggregate, 'generatedAt' | 'recentFailures' | 'recentArtifacts' | 'resultSummary'>> {
    const snapshot = await this.aggregate(options)
    return {
      generatedAt: snapshot.generatedAt,
      recentFailures: snapshot.recentFailures,
      recentArtifacts: snapshot.recentArtifacts,
      resultSummary: snapshot.resultSummary,
    }
  }

  private async loadAggregationData(): Promise<TaskAggregationData> {
    const [sessions, delegations, interventions, artifacts] = await Promise.all([
      this.sessionStore.list(),
      this.delegationStore.list(),
      this.interventionStore.list(),
      this.artifactStore.list(),
    ])
    const allArtifacts = await this.withFallbackArtifacts(artifacts)

    const conversationIds = new Set<string>([
      ...sessions.map((session) => session.id),
      ...delegations.map((delegation) => delegation.id),
    ])
    const conversations = new Map<string, ConversationMemory>()
    await Promise.all(
      Array.from(conversationIds).map(async (id) => {
        conversations.set(id, await this.conversationStore.get(id))
      })
    )

    return {
      sessions,
      delegations,
      interventions,
      artifacts: allArtifacts,
      conversations,
    }
  }

  private async withFallbackArtifacts(existing: ArtifactRecord[]): Promise<ArtifactRecord[]> {
    const records = [...existing]
    const knownPaths = new Set(records.map((record) => record.path))
    const fallbacks: Array<{ relPath: string; name: string; type: ArtifactRecord['type'] }> = [
      { relPath: 'data/uploads/resume-upload.pdf', name: '上传简历 PDF', type: 'uploaded' },
      { relPath: 'output/resume.pdf', name: '生成简历 PDF', type: 'generated' },
    ]

    for (const candidate of fallbacks) {
      if (knownPaths.has(candidate.relPath)) continue
      const absolutePath = path.resolve(this.workspaceRoot, candidate.relPath)
      try {
        const stats = await fs.stat(absolutePath)
        if (!stats.isFile()) continue
        records.push({
          id: `fs:${candidate.relPath}`,
          name: candidate.name,
          type: candidate.type,
          path: candidate.relPath,
          createdAt: stats.mtime.toISOString(),
          meta: {
            source: 'filesystem',
            sessionId: 'main',
            ownerId: 'main',
            size: stats.size,
          },
        })
      } catch {
        // ignore missing fallback artifacts
      }
    }

    return records
  }

  private buildTasks(data: TaskAggregationData): UnifiedTaskRecord[] {
    const interventionsByOwner = groupBy(data.interventions, (record) => record.ownerId)
    const artifactsByTask = new Map<string, UnifiedArtifactRecord[]>()
    for (const artifact of this.buildRecentArtifacts(data.artifacts)) {
      for (const relatedTaskId of artifact.relatedTaskIds) {
        const bucket = artifactsByTask.get(relatedTaskId) ?? []
        bucket.push(artifact)
        artifactsByTask.set(relatedTaskId, bucket)
      }
    }

    const tasks: UnifiedTaskRecord[] = []

    for (const session of data.sessions) {
      const conversation = data.conversations.get(session.id)
      const relatedInterventions = interventionsByOwner.get(session.id) ?? []
      const pendingIntervention = latestPendingIntervention(relatedInterventions)
      const relatedArtifacts = sortByDesc(
        artifactsByTask.get(session.id) ?? [],
        (artifact) => artifact.createdAt
      )
      const latestArtifact = relatedArtifacts.at(0)
      const lifecycle = deriveSessionLifecycle(session.state, pendingIntervention)
      tasks.push({
        id: session.id,
        kind: 'session',
        profile: session.profile,
        sessionId: session.id,
        agentName: session.agentName,
        title: session.agentName === 'main' ? 'Main Session' : `Session ${session.agentName}`,
        state: session.state,
        lifecycle,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        activityAt: maxIso(
          session.updatedAt,
          session.lastMessageAt,
          conversation?.lastActivityAt,
          pendingIntervention?.updatedAt,
          latestArtifact?.createdAt
        ),
        lastMessageAt: session.lastMessageAt,
        summary: buildTaskSummary({
          kind: 'session',
          title: session.agentName,
          lifecycle,
          conversation,
          pendingIntervention,
        }),
        conversationSummary: nonEmptyString(conversation?.summary),
        pendingIntervention: toInterventionSummary(pendingIntervention),
        interventionCounts: countInterventions(relatedInterventions),
        artifactCount: relatedArtifacts.length,
        latestArtifact,
      })
    }

    for (const delegation of data.delegations) {
      const conversation = data.conversations.get(delegation.id)
      const relatedInterventions = interventionsByOwner.get(delegation.id) ?? []
      const pendingIntervention = latestPendingIntervention(relatedInterventions)
      const relatedArtifacts = sortByDesc(
        artifactsByTask.get(delegation.id) ?? [],
        (artifact) => artifact.createdAt
      )
      const latestArtifact = relatedArtifacts.at(0)
      const lifecycle = deriveDelegationLifecycle(delegation.state, pendingIntervention)
      tasks.push({
        id: delegation.id,
        kind: 'delegation',
        profile: delegation.profile,
        sessionId: delegation.parentSessionId,
        agentName: delegation.agentName ?? delegation.id,
        title: delegation.instruction,
        state: delegation.state,
        lifecycle,
        createdAt: delegation.createdAt,
        updatedAt: delegation.updatedAt,
        activityAt: maxIso(
          delegation.updatedAt,
          conversation?.lastActivityAt,
          pendingIntervention?.updatedAt,
          latestArtifact?.createdAt
        ),
        summary: buildTaskSummary({
          kind: 'delegation',
          title: delegation.instruction,
          lifecycle,
          conversation,
          pendingIntervention,
          resultSummary: delegation.resultSummary,
          error: delegation.error,
        }),
        conversationSummary: nonEmptyString(conversation?.summary),
        resultSummary: nonEmptyString(delegation.resultSummary),
        error: nonEmptyString(delegation.error),
        pendingIntervention: toInterventionSummary(pendingIntervention),
        interventionCounts: countInterventions(relatedInterventions),
        artifactCount: relatedArtifacts.length,
        latestArtifact,
      })
    }

    return sortByDesc(tasks, (task) => task.activityAt)
  }

  private buildRecentFailures(
    data: TaskAggregationData,
    tasks: UnifiedTaskRecord[],
    visibleTaskIds: Set<string>
  ): UnifiedFailureRecord[] {
    const failures: UnifiedFailureRecord[] = []

    for (const task of tasks) {
      if (task.kind === 'session' && task.lifecycle === 'failed') {
        failures.push({
          id: task.id,
          kind: 'session',
          ownerId: task.id,
          sessionId: task.sessionId,
          profile: task.profile,
          state: String(task.state),
          title: task.title,
          reason: task.conversationSummary ?? task.summary,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })
      }

      if (task.kind === 'delegation' && (task.lifecycle === 'failed' || task.lifecycle === 'cancelled')) {
        failures.push({
          id: task.id,
          kind: 'delegation',
          ownerId: task.id,
          sessionId: task.sessionId,
          profile: task.profile,
          state: String(task.state),
          title: task.title,
          reason: task.error ?? task.resultSummary ?? task.summary,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        })
      }
    }

    for (const intervention of data.interventions) {
      if (intervention.status !== 'timeout' && intervention.status !== 'cancelled') continue
      if (visibleTaskIds.size > 0 && !visibleTaskIds.has(intervention.ownerId)) continue
      failures.push({
        id: intervention.id,
        kind: 'intervention',
        ownerId: intervention.ownerId,
        sessionId: intervention.ownerType === 'session' ? intervention.ownerId : undefined,
        profile: intervention.ownerType === 'session' ? 'main' : 'system',
        state: intervention.status,
        title: intervention.prompt,
        reason:
          intervention.status === 'timeout'
            ? `Intervention timed out for ${intervention.ownerId}`
            : `Intervention cancelled for ${intervention.ownerId}`,
        createdAt: intervention.createdAt,
        updatedAt: intervention.updatedAt,
      })
    }

    return sortByDesc(failures, (failure) => failure.updatedAt)
  }

  private buildRecentArtifacts(artifacts: ArtifactRecord[]): UnifiedArtifactRecord[] {
    const records = artifacts.map((artifact) => {
      const ownerHints = extractArtifactOwnerHints(artifact.meta)
      const relatedTaskIds = uniqueStrings([ownerHints.sessionId, ownerHints.delegatedRunId, ownerHints.ownerId])
      return {
        id: artifact.id,
        name: artifact.name,
        type: artifact.type,
        path: artifact.path,
        createdAt: artifact.createdAt,
        relatedTaskIds,
        meta: artifact.meta,
        ownerHints,
      }
    })
    return sortByDesc(records, (artifact) => artifact.createdAt)
  }

  private buildSummary(
    generatedAt: string,
    tasks: UnifiedTaskRecord[],
    interventions: InterventionRecord[],
    recentFailures: UnifiedFailureRecord[],
    recentArtifacts: UnifiedArtifactRecord[]
  ): TaskResultsSummary {
    const summary: TaskResultsSummary = {
      generatedAt,
      headline: 'No structured tasks found',
      totalTasks: tasks.length,
      sessionTasks: tasks.filter((task) => task.kind === 'session').length,
      delegatedTasks: tasks.filter((task) => task.kind === 'delegation').length,
      idleTasks: tasks.filter((task) => task.lifecycle === 'idle').length,
      runningTasks: tasks.filter((task) => task.lifecycle === 'running').length,
      waitingTasks: tasks.filter((task) => task.lifecycle === 'waiting').length,
      failedTasks: tasks.filter((task) => task.lifecycle === 'failed').length,
      completedTasks: tasks.filter((task) => task.lifecycle === 'completed').length,
      cancelledTasks: tasks.filter((task) => task.lifecycle === 'cancelled').length,
      pendingInterventions: interventions.filter((record) => record.status === 'pending').length,
      recentFailures: recentFailures.length,
      recentArtifacts: recentArtifacts.length,
    }

    if (summary.totalTasks === 0 && summary.recentArtifacts > 0) {
      summary.headline = `${summary.recentArtifacts} recent artifacts recorded`
      return summary
    }
    if (summary.failedTasks > 0 || summary.recentFailures > 0) {
      summary.headline = `${summary.failedTasks} tasks failed, ${summary.recentFailures} recent failure records need attention`
      return summary
    }
    if (summary.waitingTasks > 0 || summary.pendingInterventions > 0) {
      summary.headline = `${summary.waitingTasks} tasks waiting on input, ${summary.pendingInterventions} interventions pending`
      return summary
    }
    if (summary.runningTasks > 0) {
      summary.headline = `${summary.runningTasks} tasks are currently running`
      return summary
    }
    if (summary.completedTasks > 0) {
      summary.headline = `${summary.completedTasks} tasks completed with ${summary.recentArtifacts} recent artifacts`
      return summary
    }
    if (summary.idleTasks > 0) {
      summary.headline = `${summary.idleTasks} tasks are idle`
    }
    return summary
  }
}

function applyLimit<T>(items: T[], limit?: number): T[] {
  if (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0) {
    return items
  }
  return items.slice(0, limit)
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const key = getKey(item)
    const current = buckets.get(key) ?? []
    current.push(item)
    buckets.set(key, current)
  }
  return buckets
}

function sortByDesc<T>(items: T[], select: (item: T) => string): T[] {
  return [...items].sort((left, right) => select(right).localeCompare(select(left)))
}

function filterTasksBySession(items: UnifiedTaskRecord[], sessionId?: string): UnifiedTaskRecord[] {
  if (!sessionId) return items
  return items.filter((item) => item.sessionId === sessionId || item.id === sessionId)
}

function filterArtifactsByTaskIds(items: UnifiedArtifactRecord[], visibleTaskIds: Set<string>): UnifiedArtifactRecord[] {
  if (visibleTaskIds.size === 0) return items
  return items.filter((item) => item.relatedTaskIds.some((taskId) => visibleTaskIds.has(taskId)))
}

function filterInterventionsByTaskIds(items: InterventionRecord[], visibleTaskIds: Set<string>): InterventionRecord[] {
  if (visibleTaskIds.size === 0) return items
  return items.filter((item) => visibleTaskIds.has(item.ownerId))
}

function maxIso(...values: Array<string | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? nowIso()
}

function latestPendingIntervention(records: InterventionRecord[]): InterventionRecord | undefined {
  return sortByDesc(
    records.filter((record) => record.status === 'pending'),
    (record) => record.updatedAt
  ).at(0)
}

function countInterventions(records: InterventionRecord[]): Record<InterventionStatus, number> {
  return {
    pending: records.filter((record) => record.status === 'pending').length,
    resolved: records.filter((record) => record.status === 'resolved').length,
    timeout: records.filter((record) => record.status === 'timeout').length,
    cancelled: records.filter((record) => record.status === 'cancelled').length,
  }
}

function toInterventionSummary(
  record?: InterventionRecord
): UnifiedTaskInterventionSummary | undefined {
  if (!record) return undefined
  return {
    id: record.id,
    kind: record.kind,
    prompt: record.prompt,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    timeoutMs: record.timeoutMs,
    allowEmpty: record.allowEmpty,
  }
}

function deriveSessionLifecycle(
  state: AgentSessionState,
  pendingIntervention?: InterventionRecord
): UnifiedTaskLifecycle {
  if (pendingIntervention || state === 'waiting_input') return 'waiting'
  if (state === 'running') return 'running'
  if (state === 'error') return 'failed'
  return 'idle'
}

function deriveDelegationLifecycle(
  state: DelegatedRunState,
  pendingIntervention?: InterventionRecord
): UnifiedTaskLifecycle {
  if (pendingIntervention || state === 'waiting_input') return 'waiting'
  if (state === 'failed') return 'failed'
  if (state === 'completed') return 'completed'
  if (state === 'cancelled') return 'cancelled'
  return 'running'
}

function buildTaskSummary(input: {
  kind: UnifiedTaskKind
  title: string
  lifecycle: UnifiedTaskLifecycle
  conversation?: ConversationMemory
  pendingIntervention?: InterventionRecord
  resultSummary?: string
  error?: string
}): string {
  if (input.pendingIntervention) {
    return `Waiting for input: ${input.pendingIntervention.prompt}`
  }
  if (input.error) {
    return input.error
  }
  if (input.resultSummary) {
    return input.resultSummary
  }
  if (input.conversation?.summary) {
    return input.conversation.summary
  }

  const lastAssistantMessage = [...(input.conversation?.recentMessages ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant' && nonEmptyString(message.content))
  if (lastAssistantMessage?.content) {
    return lastAssistantMessage.content
  }

  if (input.kind === 'delegation') {
    return `${capitalize(input.lifecycle)} delegation: ${input.title}`
  }
  return `${capitalize(input.lifecycle)} session: ${input.title}`
}

function extractArtifactOwnerHints(meta: Record<string, unknown>): ArtifactOwnerHints {
  return {
    sessionId: firstString(meta, ['sessionId', 'session_id']),
    delegatedRunId: firstString(meta, ['delegatedRunId', 'delegated_run_id', 'delegationId', 'delegation_id', 'runId', 'run_id']),
    ownerId: firstString(meta, ['ownerId', 'owner_id', 'taskId', 'task_id']),
  }
}

function firstString(meta: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = meta[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value
    }
  }
  return undefined
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

function nonEmptyString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function capitalize(value: string): string {
  if (!value) return value
  return value[0].toUpperCase() + value.slice(1)
}

export class TaskResultsService extends RuntimeTaskResultsService {}
