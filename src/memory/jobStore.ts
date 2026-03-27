import type { JobRecord } from '../runtime/contracts.js'
import { JsonFileStore } from '../infra/store/json-store.js'
import { getJobsStatePath, getJobsDataPath, ensureWorkspaceData } from '../infra/workspace/paths.js'
import { writeFile } from 'node:fs/promises'
import * as crypto from 'node:crypto'

const JOBS_HEADER = '| 公司 | 职位 | 链接 | 状态 | 时间 |'
const JOBS_DIVIDER = '| --- | --- | --- | --- | --- |'
type JobStatus = JobRecord['status']

export class JobStore {
  private store: JsonFileStore<JobRecord[]>

  constructor(private workspaceRoot: string) {
    this.store = new JsonFileStore(getJobsStatePath(workspaceRoot), [])
  }

  async list(): Promise<JobRecord[]> {
    return this.store.read()
  }

  async upsert(job: Omit<JobRecord, 'id' | 'discoveredAt' | 'updatedAt'> & Partial<JobRecord>): Promise<JobRecord> {
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

  async importFromMarkdown(content: string): Promise<JobRecord[]> {
    const records = parseJobsMarkdown(content)
    const stored = await this.list()
    const merged = mergeJobs(stored, records)
    await this.store.write(merged)
    return merged
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

function mergeJobs(existing: JobRecord[], incoming: JobRecord[]): JobRecord[] {
  const map = new Map(existing.map((record) => [record.id, record]))
  for (const incomingRecord of incoming) {
    const stored = map.get(incomingRecord.id)
    if (!stored) {
      map.set(incomingRecord.id, incomingRecord)
    } else {
      map.set(incomingRecord.id, { ...stored, ...incomingRecord, updatedAt: incomingRecord.updatedAt })
    }
  }
  return Array.from(map.values())
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
