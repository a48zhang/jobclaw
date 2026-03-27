import type { JobRecord } from '../runtime/contracts.js'
import { JsonFileStore } from '../infra/store/json-store.js'
import { getJobsStatePath, getJobsDataPath, ensureWorkspaceData } from '../infra/workspace/paths.js'
import { readFile, writeFile } from 'node:fs/promises'
import * as crypto from 'node:crypto'

const JOBS_HEADER = '| 公司 | 职位 | 链接 | 状态 | 时间 |'
const JOBS_DIVIDER = '| --- | --- | --- | --- | --- |'
type JobStatus = JobRecord['status']

export class JobStore {
  private store: JsonFileStore<JobRecord[]>
  private bootstrapPromise?: Promise<void>

  constructor(private workspaceRoot: string) {
    this.store = new JsonFileStore(getJobsStatePath(workspaceRoot), [])
  }

  async list(): Promise<JobRecord[]> {
    await this.ensureInitialized()
    return this.store.read()
  }

  async upsert(job: Omit<JobRecord, 'id' | 'discoveredAt' | 'updatedAt'> & Partial<JobRecord>): Promise<JobRecord> {
    await this.ensureInitialized()
    const now = new Date().toISOString()
    const existing = await this.store.read()

    const matchIndex = existing.findIndex(
      (item) => (job.id && item.id === job.id) || (!job.id && job.url && item.url === job.url)
    )

    if (matchIndex >= 0) {
      const updated: JobRecord = {
        ...existing[matchIndex],
        ...job,
        updatedAt: now,
      }
      existing[matchIndex] = updated
      await this.store.write(existing)
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
    }
    existing.push(newRecord)
    await this.store.write(existing)
    return newRecord
  }

  async updateStatuses(updates: Array<{ url: string; status: JobStatus }>): Promise<{ changed: number; total: number }> {
    await this.ensureInitialized()
    const existing = await this.store.read()
    const statusByUrl = new Map(updates.map((item) => [item.url, item.status]))
    let changed = 0
    const now = new Date().toISOString()

    const next = existing.map((record) => {
      const status = statusByUrl.get(record.url)
      if (!status || status === record.status) {
        return record
      }
      changed += 1
      return {
        ...record,
        status,
        updatedAt: now,
      }
    })

    if (changed > 0) {
      await this.store.write(next)
    }

    return { changed, total: next.length }
  }

  async deleteByUrls(urls: string[]): Promise<{ deleted: number; total: number }> {
    await this.ensureInitialized()
    const existing = await this.store.read()
    const urlSet = new Set(urls)
    const next = existing.filter((record) => !urlSet.has(record.url))
    const deleted = existing.length - next.length

    if (deleted > 0) {
      await this.store.write(next)
    }

    return { deleted, total: next.length }
  }

  async exportToMarkdown(): Promise<void> {
    const records = await this.list()
    await ensureWorkspaceData(this.workspaceRoot)
    const markdownLines = [
      JOBS_HEADER,
      JOBS_DIVIDER,
      ...records.map((record) =>
        `| ${record.company} | ${record.title} | ${record.url} | ${record.status} | ${record.discoveredAt} |`
      ),
      '',
    ]
    await this.writeMarkdown(markdownLines.join('\n'))
  }

  private async writeMarkdown(content: string): Promise<void> {
    await ensureWorkspaceData(this.workspaceRoot)
    await writeFile(getJobsDataPath(this.workspaceRoot), content, 'utf-8')
  }

  async importFromMarkdown(
    content: string,
    options: { mode?: 'merge' | 'replace' } = {}
  ): Promise<JobRecord[]> {
    await this.ensureInitialized()
    const records = parseJobsMarkdown(content)
    if (options.mode === 'merge') {
      const stored = await this.store.read()
      const merged = mergeImportedJobs(stored, records)
      await this.store.write(merged)
      return merged
    }

    const stored = await this.store.read()
    const replaced = replaceImportedJobs(stored, records)
    await this.store.write(replaced)
    return replaced
  }

  private async ensureInitialized(): Promise<void> {
    if (!this.bootstrapPromise) {
      this.bootstrapPromise = this.bootstrapFromMarkdownIfNeeded()
    }
    await this.bootstrapPromise
  }

  private async bootstrapFromMarkdownIfNeeded(): Promise<void> {
    const current = await this.store.read()
    if (current.length > 0) {
      return
    }

    const content = await this.readMarkdownSource()
    if (!content.trim()) {
      return
    }

    const imported = parseJobsMarkdown(content)
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

function parseJobsMarkdown(content: string): JobRecord[] {
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
    parsed.push({
      id: crypto.createHash('md5').update(`${company}|${title}|${url}`).digest('hex'),
      company,
      title,
      url,
      status,
      discoveredAt: timeText || new Date().toISOString(),
      updatedAt: timeText || new Date().toISOString(),
    })
  }
  return parsed
}

function replaceImportedJobs(existing: JobRecord[], incoming: JobRecord[]): JobRecord[] {
  const existingByUrl = new Map(existing.map((record) => [record.url, record]))
  return incoming.map((record) => {
    const stored = existingByUrl.get(record.url)
    if (!stored) {
      return record
    }
    return {
      ...stored,
      ...record,
      id: stored.id,
      fitSummary: stored.fitSummary,
      notes: stored.notes,
    }
  })
}

function mergeImportedJobs(existing: JobRecord[], incoming: JobRecord[]): JobRecord[] {
  const mergedByUrl = new Map(existing.map((record) => [record.url, record]))
  for (const record of replaceImportedJobs(existing, incoming)) {
    mergedByUrl.set(record.url, record)
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
