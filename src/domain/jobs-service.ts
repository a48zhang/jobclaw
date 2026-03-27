import { readFile, writeFile } from 'node:fs/promises'
import { JobStore } from '../memory/jobStore.js'
import { getJobsDataPath } from '../infra/workspace/paths.js'
import { lockFile, unlockFile } from '../tools/lockFile.js'
import type { JobRecord, JobStatus } from '../runtime/contracts.js'

export interface JobViewRow {
  company: string
  title: string
  url: string
  status: string
  time: string
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

const DEFAULT_TIME = () => new Date().toISOString().split('T')[0]
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
    options: { lockHolder?: string } = {}
  ): Promise<{ action: 'added' | 'updated' | 'skipped'; record?: JobRecord }> {
    const status = normalizeJobStatus(input.status)
    if (!status) {
      throw new Error(`Unsupported job status: ${input.status}`)
    }

    return this.withStateLock(options.lockHolder, async () => {
      const records = await this.store.list()
      const existing = records.find((record) => record.url === input.url)
      if (existing && existing.status === 'applied' && status === 'discovered') {
        await this.store.exportToMarkdown()
        return { action: 'skipped', record: existing }
      }

      const saved = await this.store.upsert({
        id: existing?.id,
        company: input.company,
        title: input.title,
        url: input.url,
        status,
        discoveredAt: existing?.discoveredAt ?? normalizeTime(input.time),
      })

      await this.store.exportToMarkdown()
      return {
        action: existing ? 'updated' : 'added',
        record: saved,
      }
    })
  }

  async updateStatuses(
    updates: JobStatusUpdateInput[],
    options: { lockHolder?: string } = {}
  ): Promise<{ changed: number; requested: number; total: number }> {
    return this.withStateLock(options.lockHolder, async () => {
      const normalized: Array<{ url: string; status: JobStatus }> = []
      for (const item of updates) {
        const url = item.url.trim()
        const status = normalizeJobStatus(item.status)
        if (!url || !status) continue
        normalized.push({ url, status })
      }

      const result = await this.store.updateStatuses(normalized)
      await this.store.exportToMarkdown()
      return {
        changed: result.changed,
        requested: updates.length,
        total: result.total,
      }
    })
  }

  async deleteByUrls(
    urls: string[],
    options: { lockHolder?: string } = {}
  ): Promise<{ deleted: number; requested: number; total: number }> {
    return this.withStateLock(options.lockHolder, async () => {
      const normalized = urls.map((url) => url.trim()).filter(Boolean)
      const result = await this.store.deleteByUrls(normalized)
      await this.store.exportToMarkdown()
      return {
        deleted: result.deleted,
        requested: normalized.length,
        total: result.total,
      }
    })
  }

  async importMarkdown(
    content: string,
    options: { lockHolder?: string; mode?: 'merge' | 'replace' } = {}
  ): Promise<{ total: number }> {
    return this.withStateLock(options.lockHolder, async () => {
      const records = await this.store.importFromMarkdown(content, { mode: options.mode ?? 'replace' })
      await this.writeMarkdownSource(content)
      return { total: records.length }
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
      await this.store.exportToMarkdown()
      return this.readMarkdownSource()
    })
  }

  private async withStateLock<T>(
    lockHolder: string | undefined,
    run: () => Promise<T>
  ): Promise<T> {
    // Ensure lock target exists because lockFile requires an existing file.
    await this.store.list()

    const holder = lockHolder?.trim() || this.defaultLockHolder
    await lockFile(STATE_LOCK_PATH, holder, this.workspaceRoot)
    try {
      return await run()
    } finally {
      try {
        await unlockFile(STATE_LOCK_PATH, holder, this.workspaceRoot)
      } catch {
        // no-op
      }
    }
  }

  private async writeMarkdownSource(content: string): Promise<void> {
    await writeFile(this.jobsDataPath, content, 'utf-8')
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
