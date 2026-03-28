import type {
  JobMutationOperation,
  JobMutationTrace,
  JobRecord,
  JobTraceability,
  JobWriteSource,
} from '../runtime/contracts.js'
import { JsonFileStore } from '../infra/store/json-store.js'
import { getJobsStatePath, getJobsDataPath, ensureWorkspaceData } from '../infra/workspace/paths.js'
import { readFile, writeFile } from 'node:fs/promises'
import * as crypto from 'node:crypto'

const JOBS_HEADER = '| 公司 | 职位 | 链接 | 状态 | 时间 |'
const JOBS_DIVIDER = '| --- | --- | --- | --- | --- |'
const LEGACY_TRACE_ACTOR = 'jobs-legacy'

type JobStatus = JobRecord['status']

export interface JobMutationContext {
  source: JobWriteSource
  actor: string
  reason?: string
  at?: string
}

export interface DeletedJobRecord {
  record: JobRecord
  trace: JobMutationTrace
}

export class JobStore {
  private store: JsonFileStore<JobRecord[]>
  private bootstrapPromise?: Promise<void>

  constructor(private workspaceRoot: string) {
    this.store = new JsonFileStore(getJobsStatePath(workspaceRoot), [])
  }

  async list(): Promise<JobRecord[]> {
    await this.ensureInitialized()
    const records = await this.store.read()
    return records.map((record) => normalizeStoredJobRecord(record))
  }

  async writeRecords(records: JobRecord[]): Promise<void> {
    await this.ensureInitialized()
    await this.store.write(records.map((record) => normalizeStoredJobRecord(record)))
  }

  async upsert(
    job: Omit<JobRecord, 'id' | 'discoveredAt' | 'updatedAt' | 'trace'> & Partial<JobRecord>,
    mutation: JobMutationContext
  ): Promise<JobRecord> {
    await this.ensureInitialized()
    const now = mutation.at ?? new Date().toISOString()
    const existing = await this.list()

    const matchIndex = existing.findIndex(
      (item) => (job.id && item.id === job.id) || (!job.id && job.url && item.url === job.url)
    )

    if (matchIndex >= 0) {
      const current = existing[matchIndex]
      const updated: JobRecord = {
        ...current,
        ...job,
        updatedAt: now,
        trace: advanceTraceability(current.trace, mutation, 'updated', now),
      }
      existing[matchIndex] = updated
      await this.writeRecords(existing)
      return updated
    }

    const newRecord: JobRecord = {
      id: job.id ?? crypto.randomUUID(),
      company: job.company,
      title: job.title,
      url: job.url,
      status: job.status,
      discoveredAt: job.discoveredAt ?? now,
      updatedAt: now,
      fitSummary: job.fitSummary,
      notes: job.notes,
      trace: createInitialTraceability(mutation, 'created', now),
    }
    existing.push(newRecord)
    await this.writeRecords(existing)
    return newRecord
  }

  async updateStatuses(
    updates: Array<{ url: string; status: JobStatus }>,
    mutation: JobMutationContext
  ): Promise<{ changed: number; total: number; updatedRecords: JobRecord[] }> {
    await this.ensureInitialized()
    const existing = await this.list()
    const statusByUrl = new Map(updates.map((item) => [item.url, item.status]))
    const updatedRecords: JobRecord[] = []
    let changed = 0
    const now = mutation.at ?? new Date().toISOString()

    const next = existing.map((record) => {
      const status = statusByUrl.get(record.url)
      if (!status || status === record.status) {
        return record
      }
      changed += 1
      const updatedRecord: JobRecord = {
        ...record,
        status,
        updatedAt: now,
        trace: advanceTraceability(record.trace, mutation, 'status_updated', now),
      }
      updatedRecords.push(updatedRecord)
      return updatedRecord
    })

    if (changed > 0) {
      await this.writeRecords(next)
    }

    return { changed, total: next.length, updatedRecords }
  }

  async deleteByUrls(
    urls: string[],
    mutation: JobMutationContext
  ): Promise<{ deleted: number; total: number; deletedRecords: DeletedJobRecord[] }> {
    await this.ensureInitialized()
    const existing = await this.list()
    const urlSet = new Set(urls)
    const now = mutation.at ?? new Date().toISOString()
    const deletedRecords: DeletedJobRecord[] = []
    const next = existing.filter((record) => {
      if (!urlSet.has(record.url)) {
        return true
      }
      deletedRecords.push({
        record,
        trace: createTrace(mutation, 'deleted', now),
      })
      return false
    })
    const deleted = existing.length - next.length

    if (deleted > 0) {
      await this.writeRecords(next)
    }

    return { deleted, total: next.length, deletedRecords }
  }

  async exportToMarkdown(options: { preserveContent?: string; records?: JobRecord[] } = {}): Promise<void> {
    const records = (options.records ?? await this.list()).map((record) => normalizeStoredJobRecord(record))
    await ensureWorkspaceData(this.workspaceRoot)
    const preservedRows = extractPreservedMarkdownRows(options.preserveContent ?? await this.readMarkdownSource())
    const markdownLines = [
      JOBS_HEADER,
      JOBS_DIVIDER,
      ...preservedRows,
      ...records.map((record) =>
        `| ${record.company} | ${record.title} | ${record.url} | ${record.status} | ${record.discoveredAt} |`
      ),
      '',
    ]
    await this.writeMarkdown(markdownLines.join('\n'))
  }

  async importFromMarkdown(
    content: string,
    options: { mode?: 'merge' | 'replace'; mutation?: JobMutationContext } = {}
  ): Promise<JobRecord[]> {
    await this.ensureInitialized()
    const mutation = options.mutation ?? defaultMutationContext('system', 'jobs-import')
    const records = parseJobsMarkdown(content, mutation)
    if (options.mode === 'merge') {
      const stored = await this.list()
      const merged = mergeImportedJobs(stored, records)
      await this.writeRecords(merged)
      return merged
    }

    const stored = await this.list()
    const replaced = replaceImportedJobs(stored, records)
    await this.writeRecords(replaced)
    return replaced
  }

  private async writeMarkdown(content: string): Promise<void> {
    await ensureWorkspaceData(this.workspaceRoot)
    await writeFile(getJobsDataPath(this.workspaceRoot), content, 'utf-8')
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.bootstrapFromMarkdownIfNeeded()
    }
    await this.bootstrapPromise
  }

  private async bootstrapFromMarkdownIfNeeded(): Promise<void> {
    const current = (await this.store.read()).map((record) => normalizeStoredJobRecord(record))
    if (current.length > 0) {
      return
    }

    const content = await this.readMarkdownSource()
    if (!content.trim()) {
      return
    }

    const imported = parseJobsMarkdown(content, defaultMutationContext('system', 'jobs-bootstrap'))
    if (imported.length === 0) {
      return
    }

    await this.store.write(imported)
  }

  private async readMarkdownSource(): Promise<string> {
    try {
      return await readFile(getJobsDataPath(this.workspaceRoot), 'utf-8')
    } catch {
      return ''
    }
  }
}

function parseJobsMarkdown(content: string, mutation: JobMutationContext): JobRecord[] {
  const lines = content.split(/\r?\n/)
  const rows = lines.slice(2).filter((line) => line.trim().startsWith('|'))
  const parsed: JobRecord[] = []
  for (const line of rows) {
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 6) continue
    const [, company, title, url, statusText, timeText] = cells
    if (!company || !title || !url) continue
    const status = normalizeStatus(statusText)
    if (!status) continue
    const timestamp = timeText || mutation.at || new Date().toISOString()
    parsed.push({
      id: crypto.createHash('md5').update(`${company}|${title}|${url}`).digest('hex'),
      company,
      title,
      url,
      status,
      discoveredAt: timestamp,
      updatedAt: timestamp,
      trace: createInitialTraceability({ ...mutation, at: timestamp }, 'imported', timestamp),
    })
  }
  return parsed
}

function replaceImportedJobs(existing: JobRecord[], incoming: JobRecord[]): JobRecord[] {
  const existingByUrl = new Map(existing.map((record) => [record.url, normalizeStoredJobRecord(record)]))
  return incoming.map((record) => {
    const stored = existingByUrl.get(record.url)
    if (!stored) {
      return normalizeStoredJobRecord(record)
    }
    const importTrace = record.trace?.lastUpdated ?? createTrace(defaultMutationContext('system', 'jobs-import'), 'imported', record.updatedAt)
    return {
      ...stored,
      ...record,
      id: stored.id,
      fitSummary: stored.fitSummary,
      notes: stored.notes,
      trace: advanceTraceability(stored.trace, mutationContextFromTrace(importTrace), 'imported', record.updatedAt),
    }
  })
}

function mergeImportedJobs(existing: JobRecord[], incoming: JobRecord[]): JobRecord[] {
  const mergedByUrl = new Map(existing.map((record) => [record.url, normalizeStoredJobRecord(record)]))
  for (const record of replaceImportedJobs(existing, incoming)) {
    mergedByUrl.set(record.url, normalizeStoredJobRecord(record))
  }
  return Array.from(mergedByUrl.values())
}

function normalizeStatus(value: string): JobStatus | undefined {
  const normalized = value.trim().toLowerCase()
  switch (normalized) {
    case 'discovered':
      return 'discovered'
    case 'favorite':
      return 'favorite'
    case 'applied':
      return 'applied'
    case 'failed':
      return 'failed'
    case 'login_required':
    case 'login required':
    case 'loginrequired':
      return 'login_required'
    default:
      return undefined
  }
}

function extractPreservedMarkdownRows(content: string): string[] {
  const lines = content.split(/\r?\n/)
  return lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('|')) return false
    if (trimmed === JOBS_HEADER || trimmed === JOBS_DIVIDER) return false

    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length < 6) return true

    const [, company, title, url, statusText] = cells
    if (!company || !title || !url) return true
    return !normalizeStatus(statusText)
  })
}

function normalizeStoredJobRecord(record: JobRecord): JobRecord {
  const discoveredAt = normalizeTimestamp(record.discoveredAt)
  const updatedAt = normalizeTimestamp(record.updatedAt || discoveredAt)
  const legacyCreated = createTrace(defaultMutationContext('system', LEGACY_TRACE_ACTOR), 'imported', discoveredAt)
  const legacyUpdated = createTrace(defaultMutationContext('system', LEGACY_TRACE_ACTOR), 'updated', updatedAt)
  const trace = normalizeTraceability(record.trace, legacyCreated, legacyUpdated)

  return {
    ...record,
    discoveredAt,
    updatedAt,
    trace,
  }
}

function normalizeTraceability(
  trace: JobRecord['trace'],
  fallbackCreated: JobMutationTrace,
  fallbackLastUpdated: JobMutationTrace
): JobTraceability {
  const created = normalizeTrace(trace?.created, fallbackCreated)
  const lastUpdated = normalizeTrace(trace?.lastUpdated, fallbackLastUpdated)
  return {
    revision: Math.max(trace?.revision ?? 1, 1),
    created,
    lastUpdated,
  }
}

function normalizeTrace(trace: JobMutationTrace | undefined, fallback: JobMutationTrace): JobMutationTrace {
  if (!trace) {
    return fallback
  }
  return {
    source: trace.source ?? fallback.source,
    actor: trace.actor?.trim() || fallback.actor,
    operation: trace.operation ?? fallback.operation,
    at: normalizeTimestamp(trace.at || fallback.at),
    reason: trace.reason?.trim() || fallback.reason,
  }
}

function createInitialTraceability(
  mutation: JobMutationContext,
  operation: Extract<JobMutationOperation, 'created' | 'imported'>,
  at: string
): JobTraceability {
  const trace = createTrace(mutation, operation, at)
  return {
    revision: 1,
    created: trace,
    lastUpdated: trace,
  }
}

function advanceTraceability(
  current: JobRecord['trace'],
  mutation: JobMutationContext,
  operation: Exclude<JobMutationOperation, 'created' | 'deleted'>,
  at: string
): JobTraceability {
  const normalized = normalizeTraceability(
    current,
    createTrace(defaultMutationContext('system', LEGACY_TRACE_ACTOR), 'imported', at),
    createTrace(defaultMutationContext('system', LEGACY_TRACE_ACTOR), 'updated', at)
  )

  return {
    revision: normalized.revision + 1,
    created: normalized.created,
    lastUpdated: createTrace(mutation, operation, at),
  }
}

function createTrace(
  mutation: JobMutationContext,
  operation: JobMutationOperation,
  at: string
): JobMutationTrace {
  return {
    source: mutation.source,
    actor: mutation.actor,
    operation,
    at: normalizeTimestamp(at),
    reason: mutation.reason?.trim() || undefined,
  }
}

function mutationContextFromTrace(trace: JobMutationTrace): JobMutationContext {
  return {
    source: trace.source,
    actor: trace.actor,
    reason: trace.reason,
    at: trace.at,
  }
}

function defaultMutationContext(source: JobWriteSource, actor: string): JobMutationContext {
  return { source, actor }
}

function normalizeTimestamp(value?: string): string {
  const trimmed = value?.trim()
  return trimmed || new Date().toISOString()
}
