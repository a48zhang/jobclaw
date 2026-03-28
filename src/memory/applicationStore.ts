import { JsonFileStore } from '../infra/store/json-store.js'
import { getApplicationsPath } from '../infra/workspace/paths.js'
import type { ApplicationRecord } from '../runtime/contracts.js'

export class ApplicationStore {
  private readonly store: JsonFileStore<ApplicationRecord[]>

  constructor(workspaceRoot: string) {
    this.store = new JsonFileStore(getApplicationsPath(workspaceRoot), [])
  }

  async list(): Promise<ApplicationRecord[]> {
    const records = await this.store.read()
    return normalizeRecords(records)
  }

  async get(id: string): Promise<ApplicationRecord | undefined> {
    const records = await this.list()
    return records.find((record) => record.id === id)
  }

  async write(records: ApplicationRecord[]): Promise<void> {
    await this.store.write(normalizeRecords(records))
  }
}

function normalizeRecords(records: ApplicationRecord[]): ApplicationRecord[] {
  return records.map((record) => normalizeRecord(record))
}

function normalizeRecord(record: ApplicationRecord): ApplicationRecord {
  return {
    ...record,
    company: record.company.trim(),
    jobTitle: record.jobTitle.trim(),
    jobUrl: normalizeOptional(record.jobUrl),
    jobId: normalizeOptional(record.jobId),
    createdAt: normalizeTimestamp(record.createdAt),
    updatedAt: normalizeTimestamp(record.updatedAt),
    appliedAt: normalizeOptional(record.appliedAt),
    notes: (record.notes ?? []).map((note) => ({
      ...note,
      body: note.body.trim(),
      category: note.category ?? 'general',
      createdAt: normalizeTimestamp(note.createdAt),
      updatedAt: normalizeTimestamp(note.updatedAt),
    })),
    timeline: (record.timeline ?? []).map((entry) => ({
      ...entry,
      at: normalizeTimestamp(entry.at),
    })),
    reminders: (record.reminders ?? []).map((reminder) => ({
      ...reminder,
      title: reminder.title.trim(),
      dueAt: normalizeTimestamp(reminder.dueAt),
      createdAt: normalizeTimestamp(reminder.createdAt),
      updatedAt: normalizeTimestamp(reminder.updatedAt),
      completedAt: normalizeOptional(reminder.completedAt),
    })),
    nextAction: record.nextAction
      ? {
          ...record.nextAction,
          dueAt: normalizeOptional(record.nextAction.dueAt),
          updatedAt: normalizeTimestamp(record.nextAction.updatedAt),
          owner: record.nextAction.owner ?? 'user',
        }
      : undefined,
    rejection: record.rejection
      ? {
          ...record.rejection,
          recordedAt: normalizeTimestamp(record.rejection.recordedAt),
          reason: normalizeOptional(record.rejection.reason),
          notes: normalizeOptional(record.rejection.notes),
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
