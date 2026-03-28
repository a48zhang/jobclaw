import { readFile, writeFile } from 'node:fs/promises'
import { JobStore, type DeletedJobRecord, type JobMutationContext as StoreJobMutationContext } from '../memory/jobStore.js'
import { ensureWorkspaceData, getJobsDataPath } from '../infra/workspace/paths.js'
import { lockFile, unlockFile } from '../tools/lockFile.js'
import type { JobRecord, JobStatus, JobWriteSource } from '../runtime/contracts.js'

export interface JobViewRow {
  company: string
  title: string
  url: string
  status: string
  time: string
  updatedAt: string
  trace?: JobRecord['trace']
}

export interface JobUpsertInput {
  company: string
  title: string
  url: string
  status: string
  time?: string
}

export interface JobStatusUpdateInput {
  url: string
  status: string
}

export interface JobMutationInput {
  source?: JobWriteSource
  actor?: string
  reason?: string
}

interface JobMutationOptions {
  lockHolder?: string
  mutation?: JobMutationInput
}

interface LockedJobMutationResult<T> {
  result: T
  exportRecords?: JobRecord[]
  markdownContent?: string
}

const DEFAULT_TIME = () => new Date().toISOString().split('T')[0]
const DEFAULT_WRITE_SOURCE: JobWriteSource = 'system'
const STATE_LOCK_PATH = 'state/jobs/jobs.json'

export class JobsService {
  private readonly store: JobStore
  private readonly jobsDataPath: string

  constructor(
    private readonly workspaceRoot: string,
    private readonly defaultLockHolder = 'jobs-service'
  ) {
    this.store = new JobStore(workspaceRoot)
    this.jobsDataPath = getJobsDataPath(workspaceRoot)
  }

  async listRows(): Promise<JobViewRow[]> {
    const records = await this.store.list()
    return records.map((record) => toViewRow(record))
  }

  async getStats(): Promise<{ total: number; byStatus: Record<string, number> }> {
    const records = await this.store.list()
    const byStatus: Record<string, number> = {}
    for (const record of records) {
      byStatus[record.status] = (byStatus[record.status] ?? 0) + 1
    }
    return {
      total: records.length,
      byStatus,
    }
  }

  async upsert(
    input: JobUpsertInput,
    options: JobMutationOptions = {}
  ): Promise<{ action: 'added' | 'updated' | 'skipped'; record?: JobRecord }> {
    const status = normalizeJobStatus(input.status)
    if (!status) {
      throw new Error(`Unsupported job status: ${input.status}`)
    }

    return this.withLockedMutation<{ action: 'added' | 'updated' | 'skipped'; record?: JobRecord }>(
      options,
      async (mutation, currentRecords) => {
        const existing = currentRecords.find((record) => record.url === input.url)
        if (existing && existing.status === 'applied' && status === 'discovered') {
          return {
            result: { action: 'skipped', record: existing },
            exportRecords: currentRecords,
          }
        }

        const saved = await this.store.upsert(
          {
            id: existing?.id,
            company: input.company,
            title: input.title,
            url: input.url,
            status,
            discoveredAt: existing?.discoveredAt ?? normalizeTime(input.time),
          },
          mutation
        )

        const nextRecords = await this.store.list()
        return {
          result: {
            action: existing ? 'updated' : 'added',
            record: saved,
          },
          exportRecords: nextRecords,
        }
      }
    )
  }

  async updateStatuses(
    updates: JobStatusUpdateInput[],
    options: JobMutationOptions = {}
  ): Promise<{ changed: number; requested: number; total: number; updatedRecords: JobRecord[] }> {
    return this.withLockedMutation(options, async (mutation) => {
      const normalized: Array<{ url: string; status: JobStatus }> = []
      for (const item of updates) {
        const url = item.url.trim()
        const status = normalizeJobStatus(item.status)
        if (!url || !status) continue
        normalized.push({ url, status })
      }

      const result = await this.store.updateStatuses(normalized, mutation)
      const nextRecords = await this.store.list()
      return {
        result: {
          changed: result.changed,
          requested: updates.length,
          total: result.total,
          updatedRecords: result.updatedRecords,
        },
        exportRecords: nextRecords,
      }
    })
  }

  async deleteByUrls(
    urls: string[],
    options: JobMutationOptions = {}
  ): Promise<{ deleted: number; requested: number; total: number; deletedRecords: DeletedJobRecord[] }> {
    return this.withLockedMutation(options, async (mutation) => {
      const normalized = urls.map((url) => url.trim()).filter(Boolean)
      const result = await this.store.deleteByUrls(normalized, mutation)
      const nextRecords = await this.store.list()
      return {
        result: {
          deleted: result.deleted,
          requested: normalized.length,
          total: result.total,
          deletedRecords: result.deletedRecords,
        },
        exportRecords: nextRecords,
      }
    })
  }

  async importMarkdown(
    content: string,
    options: JobMutationOptions & { mode?: 'merge' | 'replace' } = {}
  ): Promise<{ total: number; records: JobRecord[] }> {
    return this.withLockedMutation(options, async (mutation) => {
      const records = await this.store.importFromMarkdown(content, {
        mode: options.mode ?? 'replace',
        mutation,
      })
      return {
        result: { total: records.length, records },
        markdownContent: content,
      }
    })
  }

  async readMarkdownSource(): Promise<string> {
    try {
      return await readFile(this.jobsDataPath, 'utf-8')
    } catch {
      return ''
    }
  }

  async exportMarkdownView(options: { lockHolder?: string } = {}): Promise<string> {
    return this.withStateLock(options.lockHolder, async () => {
      const records = await this.store.list()
      await this.store.exportToMarkdown({ preserveContent: await this.readMarkdownSource(), records })
      return this.readMarkdownSource()
    })
  }

  private async withLockedMutation<T>(
    options: JobMutationOptions,
    run: (mutation: StoreJobMutationContext, currentRecords: JobRecord[]) => Promise<LockedJobMutationResult<T>>
  ): Promise<T> {
    return this.withStateLock(options.lockHolder, async (holder) => {
      const beforeRecords = await this.store.list()
      const beforeMarkdown = await this.readMarkdownSource()
      const mutation = resolveMutationContext(options.mutation, holder)

      try {
        const outcome = await run(mutation, beforeRecords)
        if (typeof outcome.markdownContent === 'string') {
          await this.writeMarkdownSource(outcome.markdownContent)
        } else {
          await this.store.exportToMarkdown({
            preserveContent: beforeMarkdown,
            records: outcome.exportRecords ?? await this.store.list(),
          })
        }
        return outcome.result
      } catch (error) {
        await this.restoreState(beforeRecords, beforeMarkdown)
        throw error
      }
    })
  }

  private async restoreState(records: JobRecord[], markdown: string): Promise<void> {
    await this.store.writeRecords(records)
    await this.writeMarkdownSource(markdown)
  }

  private async withStateLock<T>(
    lockHolder: string | undefined,
    run: (holder: string) => Promise<T>
  ): Promise<T> {
    // Ensure lock target exists because lockFile requires an existing file.
    await this.store.list()

    const holder = lockHolder?.trim() || this.defaultLockHolder
    await lockFile(STATE_LOCK_PATH, holder, this.workspaceRoot)
    try {
      return await run(holder)
    } finally {
      try {
        await unlockFile(STATE_LOCK_PATH, holder, this.workspaceRoot)
      } catch {
        // no-op
      }
    }
  }

  private async writeMarkdownSource(content: string): Promise<void> {
    await ensureWorkspaceData(this.workspaceRoot)
    await writeFile(this.jobsDataPath, content, 'utf-8')
  }
}

function resolveMutationContext(input: JobMutationInput | undefined, fallbackActor: string): StoreJobMutationContext {
  const actor = input?.actor?.trim() || fallbackActor
  const reason = input?.reason?.trim()
  return {
    source: input?.source ?? DEFAULT_WRITE_SOURCE,
    actor,
    reason: reason || undefined,
  }
}

function normalizeTime(time?: string): string {
  const value = time?.trim()
  return value || DEFAULT_TIME()
}

function toViewRow(record: JobRecord): JobViewRow {
  return {
    company: record.company,
    title: record.title,
    url: record.url,
    status: record.status,
    time: record.discoveredAt,
    updatedAt: record.updatedAt,
    trace: record.trace,
  }
}

function normalizeJobStatus(value: string): JobStatus | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'discovered') return 'discovered'
  if (normalized === 'favorite') return 'favorite'
  if (normalized === 'applied') return 'applied'
  if (normalized === 'failed') return 'failed'
  if (normalized === 'login_required' || normalized === 'login required' || normalized === 'loginrequired') {
    return 'login_required'
  }
  return null
}
