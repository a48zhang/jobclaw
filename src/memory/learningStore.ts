import { JsonFileStore } from '../infra/store/json-store.js'
import { getLearningPath } from '../infra/workspace/paths.js'
import type { LearningRecord } from '../runtime/contracts.js'

export class LearningStore {
  private readonly store: JsonFileStore<LearningRecord[]>

  constructor(workspaceRoot: string) {
    this.store = new JsonFileStore(getLearningPath(workspaceRoot), [])
  }

  async list(): Promise<LearningRecord[]> {
    const records = await this.store.read()
    return normalizeRecords(records)
  }

  async get(id: string): Promise<LearningRecord | undefined> {
    const records = await this.list()
    return records.find((record) => record.id === id)
  }

  async write(records: LearningRecord[]): Promise<void> {
    await this.store.write(normalizeRecords(records))
  }
}

function normalizeRecords(records: LearningRecord[]): LearningRecord[] {
  return records.map((record) => normalizeRecord(record))
}

function normalizeRecord(record: LearningRecord): LearningRecord {
  return {
    ...record,
    title: record.title.trim(),
    summary: record.summary.trim(),
    createdAt: normalizeTimestamp(record.createdAt),
    updatedAt: normalizeTimestamp(record.updatedAt),
    tags: uniqueStrings(record.tags ?? []),
    links: {
      applicationId: normalizeOptional(record.links?.applicationId),
      jobId: normalizeOptional(record.links?.jobId),
      taskId: normalizeOptional(record.links?.taskId),
      artifactPaths: uniqueStrings(record.links?.artifactPaths ?? []),
    },
    findings: (record.findings ?? []).map((finding) => ({
      ...finding,
      title: finding.title.trim(),
      summary: finding.summary.trim(),
      evidence: uniqueStrings(finding.evidence ?? []),
    })),
    actionItems: (record.actionItems ?? []).map((item) => ({
      ...item,
      summary: item.summary.trim(),
      linkedTaskId: normalizeOptional(item.linkedTaskId),
      dueAt: normalizeOptional(item.dueAt),
      note: normalizeOptional(item.note),
      updatedAt: normalizeTimestamp(item.updatedAt),
      owner: item.owner ?? 'user',
      status: item.status ?? 'pending',
    })),
    metrics: record.metrics
      ? {
          interviewScore: normalizeNumber(record.metrics.interviewScore),
          hitRate: normalizeNumber(record.metrics.hitRate),
          gapCount: normalizeNumber(record.metrics.gapCount),
          failureCount: normalizeNumber(record.metrics.failureCount),
        }
      : undefined,
  }
}

function normalizeTimestamp(value?: string): string {
  const trimmed = value?.trim()
  return trimmed || new Date().toISOString()
}

function normalizeOptional(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function normalizeNumber(value?: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
