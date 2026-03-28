import { LearningStore } from '../memory/learningStore.js'
import type {
  LearningActionItem,
  LearningActionItemStatus,
  LearningFinding,
  LearningFindingSeverity,
  LearningRecord,
  LearningRecordKind,
  LearningRecordLinks,
  LearningRecordMetrics,
  LearningRecordStatus,
} from '../runtime/contracts.js'
import { createRuntimeId, nowIso } from '../runtime/utils.js'
import type { ApplicationMutationContext } from './application-service.js'

export interface LearningListFilters {
  kinds?: LearningRecordKind[]
  statuses?: LearningRecordStatus[]
  applicationId?: string
  jobId?: string
  taskId?: string
  tag?: string
  limit?: number
  sortBy?: 'updatedAt' | 'createdAt'
  order?: 'asc' | 'desc'
}

export interface LearningUpsertInput {
  id?: string
  kind: LearningRecordKind
  status?: LearningRecordStatus
  title: string
  summary: string
  tags?: string[]
  links?: Partial<LearningRecordLinks>
  findings?: Array<{
    id?: string
    title: string
    summary: string
    severity?: LearningFindingSeverity
    evidence?: string[]
  }>
  actionItems?: Array<{
    id?: string
    summary: string
    owner?: LearningActionItem['owner']
    status?: LearningActionItemStatus
    linkedTaskId?: string
    dueAt?: string
    note?: string
  }>
  metrics?: LearningRecordMetrics
}

export class LearningService {
  private readonly store: LearningStore

  constructor(workspaceRoot: string) {
    this.store = new LearningStore(workspaceRoot)
  }

  async list(filters: LearningListFilters = {}): Promise<LearningRecord[]> {
    const records = await this.store.list()
    const filtered = records.filter((record) => matchesRecord(record, filters))
    return sortRecords(filtered, filters.sortBy ?? 'updatedAt', filters.order ?? 'desc')
      .slice(0, typeof filters.limit === 'number' && filters.limit > 0 ? filters.limit : filtered.length)
  }

  async get(id: string): Promise<LearningRecord | undefined> {
    return this.store.get(id)
  }

  async findLinked(input: { applicationId?: string; jobId?: string; taskId?: string }): Promise<LearningRecord[]> {
    const records = await this.store.list()
    return sortRecords(
      records.filter((record) => {
        if (input.applicationId && record.links.applicationId === input.applicationId) return true
        if (input.jobId && record.links.jobId === input.jobId) return true
        if (input.taskId && record.links.taskId === input.taskId) return true
        return false
      }),
      'updatedAt',
      'desc'
    )
  }

  async upsert(input: LearningUpsertInput, mutation: ApplicationMutationContext): Promise<LearningRecord> {
    const records = await this.store.list()
    const now = nowIso()
    const title = requireNonEmpty(input.title, 'title')
    const summary = requireNonEmpty(input.summary, 'summary')
    const existingIndex = input.id ? records.findIndex((record) => record.id === input.id) : -1

    if (existingIndex >= 0) {
      const current = records[existingIndex]
      const updated: LearningRecord = {
        ...current,
        kind: input.kind,
        status: input.status ?? current.status,
        title,
        summary,
        updatedAt: now,
        source: mutation.source,
        actor: mutation.actor,
        tags: normalizeTags(input.tags ?? current.tags),
        links: buildLinks(input.links ?? current.links),
        findings: input.findings ? buildFindings(input.findings) : current.findings,
        actionItems: input.actionItems ? buildActionItems(input.actionItems, mutation, now) : current.actionItems,
        metrics: normalizeMetrics(input.metrics ?? current.metrics),
      }
      records[existingIndex] = updated
      await this.store.write(records)
      return updated
    }

    const record: LearningRecord = {
      id: input.id ?? createRuntimeId('learning'),
      kind: input.kind,
      status: input.status ?? 'open',
      title,
      summary,
      createdAt: now,
      updatedAt: now,
      source: mutation.source,
      actor: mutation.actor,
      tags: normalizeTags(input.tags ?? []),
      links: buildLinks(input.links),
      findings: buildFindings(input.findings ?? []),
      actionItems: buildActionItems(input.actionItems ?? [], mutation, now),
      metrics: normalizeMetrics(input.metrics),
    }
    records.push(record)
    await this.store.write(records)
    return record
  }

  async updateActionItem(
    id: string,
    actionItemId: string,
    input: {
      status?: LearningActionItemStatus
      dueAt?: string
      note?: string
      linkedTaskId?: string
    },
    mutation: ApplicationMutationContext
  ): Promise<LearningRecord> {
    const records = await this.store.list()
    const index = records.findIndex((record) => record.id === id)
    if (index < 0) throw new Error(`Learning record not found: ${id}`)
    const now = nowIso()
    const current = records[index]
    const updatedItems = current.actionItems.map((item) => {
      if (item.id !== actionItemId) return item
      return {
        ...item,
        status: input.status ?? item.status,
        dueAt: normalizeOptional(input.dueAt) ?? item.dueAt,
        note: normalizeOptional(input.note) ?? item.note,
        linkedTaskId: normalizeOptional(input.linkedTaskId) ?? item.linkedTaskId,
        updatedAt: now,
        source: mutation.source,
        actor: mutation.actor,
      }
    })
    if (!updatedItems.some((item) => item.id === actionItemId)) {
      throw new Error(`Learning action item not found: ${actionItemId}`)
    }
    const updated: LearningRecord = {
      ...current,
      updatedAt: now,
      source: mutation.source,
      actor: mutation.actor,
      actionItems: updatedItems,
    }
    records[index] = updated
    await this.store.write(records)
    return updated
  }

  async getInsights() {
    const records = await this.store.list()
    const byKind = records.reduce<Record<LearningRecordKind, number>>((acc, record) => {
      acc[record.kind] += 1
      return acc
    }, emptyByKind())
    const byStatus = records.reduce<Record<LearningRecordStatus, number>>((acc, record) => {
      acc[record.status] += 1
      return acc
    }, emptyByStatus())
    const actionItems = records.flatMap((record) =>
      record.actionItems.map((item) => ({
        recordId: record.id,
        recordTitle: record.title,
        ...item,
      }))
    )
    const pendingActionItems = actionItems.filter((item) => item.status === 'pending')
    const overdueActionItems = pendingActionItems.filter((item) => item.dueAt && item.dueAt < nowIso())
    const criticalFindings = records.flatMap((record) =>
      record.findings.filter((finding) => finding.severity === 'critical').map((finding) => ({
        recordId: record.id,
        recordTitle: record.title,
        ...finding,
      }))
    )

    const tagCounts = new Map<string, number>()
    for (const record of records) {
      for (const tag of record.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
      }
    }

    return {
      ok: true,
      generatedAt: nowIso(),
      totals: {
        records: records.length,
        pendingActionItems: pendingActionItems.length,
        overdueActionItems: overdueActionItems.length,
        criticalFindings: criticalFindings.length,
        linkedApplications: new Set(records.map((record) => record.links.applicationId).filter(Boolean)).size,
        linkedJobs: new Set(records.map((record) => record.links.jobId).filter(Boolean)).size,
        linkedTasks: new Set(records.map((record) => record.links.taskId).filter(Boolean)).size,
      },
      byKind,
      byStatus,
      nextFocus: pendingActionItems
        .sort((left, right) => (left.dueAt ?? left.updatedAt).localeCompare(right.dueAt ?? right.updatedAt))[0] ?? null,
      topTags: Array.from(tagCounts.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .slice(0, 5)
        .map(([tag, count]) => ({ tag, count })),
      criticalFindings: criticalFindings.slice(0, 5),
      pendingActionItems: pendingActionItems.slice(0, 10),
    }
  }
}

function matchesRecord(record: LearningRecord, filters: LearningListFilters): boolean {
  if (filters.kinds?.length && !filters.kinds.includes(record.kind)) return false
  if (filters.statuses?.length && !filters.statuses.includes(record.status)) return false
  if (filters.applicationId && record.links.applicationId !== filters.applicationId) return false
  if (filters.jobId && record.links.jobId !== filters.jobId) return false
  if (filters.taskId && record.links.taskId !== filters.taskId) return false
  if (filters.tag && !record.tags.includes(filters.tag.trim())) return false
  return true
}

function sortRecords(
  records: LearningRecord[],
  sortBy: LearningListFilters['sortBy'],
  order: LearningListFilters['order']
): LearningRecord[] {
  const direction = order === 'asc' ? 1 : -1
  return [...records].sort((left, right) => {
    const value = (left[sortBy ?? 'updatedAt'] ?? '').localeCompare(right[sortBy ?? 'updatedAt'] ?? '')
    return value * direction
  })
}

function buildLinks(input?: Partial<LearningRecordLinks>): LearningRecordLinks {
  return {
    applicationId: normalizeOptional(input?.applicationId),
    jobId: normalizeOptional(input?.jobId),
    taskId: normalizeOptional(input?.taskId),
    artifactPaths: uniqueStrings(input?.artifactPaths ?? []),
  }
}

function buildFindings(
  findings: Array<{
    id?: string
    title: string
    summary: string
    severity?: LearningFindingSeverity
    evidence?: string[]
  }>
): LearningFinding[] {
  return findings.map((finding) => ({
    id: finding.id ?? createRuntimeId('learning-finding'),
    title: requireNonEmpty(finding.title, 'finding.title'),
    summary: requireNonEmpty(finding.summary, 'finding.summary'),
    severity: finding.severity ?? 'info',
    evidence: uniqueStrings(finding.evidence ?? []),
  }))
}

function buildActionItems(
  items: Array<{
    id?: string
    summary: string
    owner?: LearningActionItem['owner']
    status?: LearningActionItemStatus
    linkedTaskId?: string
    dueAt?: string
    note?: string
  }>,
  mutation: ApplicationMutationContext,
  now: string
): LearningActionItem[] {
  return items.map((item) => ({
    id: item.id ?? createRuntimeId('learning-action'),
    summary: requireNonEmpty(item.summary, 'actionItem.summary'),
    owner: item.owner ?? 'user',
    status: item.status ?? 'pending',
    linkedTaskId: normalizeOptional(item.linkedTaskId),
    dueAt: normalizeOptional(item.dueAt),
    note: normalizeOptional(item.note),
    updatedAt: now,
    source: mutation.source,
    actor: mutation.actor,
  }))
}

function normalizeMetrics(metrics?: LearningRecordMetrics): LearningRecordMetrics | undefined {
  if (!metrics) return undefined
  return {
    interviewScore: normalizeNumber(metrics.interviewScore),
    hitRate: normalizeNumber(metrics.hitRate),
    gapCount: normalizeNumber(metrics.gapCount),
    failureCount: normalizeNumber(metrics.failureCount),
  }
}

function emptyByKind(): Record<LearningRecordKind, number> {
  return {
    resume_review: 0,
    jd_gap_analysis: 0,
    interview_session: 0,
    failure_analysis: 0,
    hit_rate_snapshot: 0,
    improvement_plan: 0,
  }
}

function emptyByStatus(): Record<LearningRecordStatus, number> {
  return {
    open: 0,
    in_progress: 0,
    completed: 0,
    archived: 0,
  }
}

function normalizeTags(tags: string[]): string[] {
  return uniqueStrings(tags)
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeOptional(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function normalizeNumber(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function requireNonEmpty(value: string, field: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${field} is required`)
  }
  return trimmed
}
