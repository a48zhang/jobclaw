import { ApplicationStore } from '../memory/applicationStore.js'
import type {
  ApplicationActionOwner,
  ApplicationNote,
  ApplicationNoteCategory,
  ApplicationRecord,
  ApplicationReminder,
  ApplicationReminderStatus,
  ApplicationStatus,
  ApplicationTimelineEntry,
  ApplicationWriteSource,
} from '../runtime/contracts.js'
import { createRuntimeId, nowIso } from '../runtime/utils.js'

export interface ApplicationMutationContext {
  source: ApplicationWriteSource
  actor: string
}

export interface ApplicationUpsertInput {
  id?: string
  company: string
  jobTitle: string
  jobUrl?: string
  jobId?: string
  status?: ApplicationStatus
  appliedAt?: string
  nextAction?: {
    summary: string
    dueAt?: string
    owner?: ApplicationActionOwner
    note?: string
  }
  note?: {
    body: string
    category?: ApplicationNoteCategory
  }
}

export interface ApplicationListFilters {
  statuses?: ApplicationStatus[]
  company?: string
  q?: string
  reminderStatus?: ApplicationReminderStatus
  dueBefore?: string
  sortBy?: 'updatedAt' | 'createdAt' | 'nextActionAt'
  order?: 'asc' | 'desc'
  limit?: number
}

export class ApplicationService {
  private readonly store: ApplicationStore

  constructor(workspaceRoot: string) {
    this.store = new ApplicationStore(workspaceRoot)
  }

  async list(filters: ApplicationListFilters = {}): Promise<ApplicationRecord[]> {
    const records = await this.store.list()
    const filtered = records.filter((record) => matchesRecord(record, filters))
    return sortRecords(filtered, filters.sortBy ?? 'updatedAt', filters.order ?? 'desc')
      .slice(0, typeof filters.limit === 'number' && filters.limit > 0 ? filters.limit : filtered.length)
  }

  async get(id: string): Promise<ApplicationRecord | undefined> {
    return this.store.get(id)
  }

  async upsert(input: ApplicationUpsertInput, mutation: ApplicationMutationContext): Promise<ApplicationRecord> {
    const records = await this.store.list()
    const now = nowIso()
    const company = input.company.trim()
    const jobTitle = input.jobTitle.trim()
    const jobUrl = normalizeOptional(input.jobUrl)
    const jobId = normalizeOptional(input.jobId)
    const noteBody = normalizeOptional(input.note?.body)
    const nextAction = normalizeNextAction(input.nextAction, mutation, now)
    const existingIndex = records.findIndex(
      (record) => record.id === input.id || (!input.id && jobUrl && record.jobUrl === jobUrl)
    )

    if (existingIndex >= 0) {
      const current = records[existingIndex]
      const timeline = [...current.timeline]
      const notes = [...current.notes]
      const status = input.status ?? current.status
      const mergedNextAction = nextAction ?? current.nextAction
      if (status !== current.status) {
        timeline.push(buildTimelineEntry('status_changed', mutation, {
          at: now,
          summary: `Application status changed to ${status}`,
          fromStatus: current.status,
          toStatus: status,
        }))
      }
      if (noteBody) {
        const note = buildNote(noteBody, input.note?.category ?? 'general', mutation, now)
        notes.push(note)
        timeline.push(buildTimelineEntry('note_added', mutation, {
          at: now,
          summary: 'Application note added',
          noteId: note.id,
        }))
      }
      if (nextAction) {
        timeline.push(buildTimelineEntry('next_action_set', mutation, {
          at: now,
          summary: nextAction.summary,
        }))
      }

      const updated: ApplicationRecord = {
        ...current,
        company,
        jobTitle,
        jobUrl: jobUrl ?? current.jobUrl,
        jobId: jobId ?? current.jobId,
        status,
        appliedAt: input.appliedAt ?? current.appliedAt ?? (status === 'applied' ? now : undefined),
        nextAction: mergedNextAction,
        notes,
        timeline,
        updatedAt: now,
      }
      records[existingIndex] = updated
      await this.store.write(records)
      return updated
    }

    const id = input.id ?? createRuntimeId('application')
    const notes: ApplicationNote[] = []
    const timeline: ApplicationTimelineEntry[] = []
    if (noteBody) {
      const note = buildNote(noteBody, input.note?.category ?? 'general', mutation, now)
      notes.push(note)
      timeline.push(buildTimelineEntry('note_added', mutation, {
        at: now,
        summary: 'Application note added',
        noteId: note.id,
      }))
    }

    const record: ApplicationRecord = {
      id,
      company,
      jobTitle,
      jobUrl,
      jobId,
      status: input.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
      appliedAt: input.appliedAt ?? (input.status === 'applied' ? now : undefined),
      notes,
      timeline: [
        buildTimelineEntry('created', mutation, {
          at: now,
          summary: 'Application created',
          toStatus: input.status ?? 'draft',
        }),
        ...timeline,
      ],
      reminders: [],
      nextAction,
    }
    if (record.nextAction) {
      record.timeline.push(buildTimelineEntry('next_action_set', mutation, {
        at: now,
        summary: record.nextAction.summary,
      }))
    }
    records.push(record)
    await this.store.write(records)
    return record
  }

  async updateStatus(
    id: string,
    status: ApplicationStatus,
    mutation: ApplicationMutationContext,
    options: { rejectionReason?: string; rejectionNotes?: string } = {}
  ): Promise<ApplicationRecord> {
    const records = await this.store.list()
    const index = records.findIndex((record) => record.id === id)
    if (index < 0) throw new Error(`Application not found: ${id}`)

    const current = records[index]
    const now = nowIso()
    const updated: ApplicationRecord = {
      ...current,
      status,
      updatedAt: now,
      appliedAt: current.appliedAt ?? (status === 'applied' ? now : undefined),
      rejection: status === 'rejected'
        ? {
          recordedAt: now,
          reason: options.rejectionReason,
          notes: options.rejectionNotes,
          source: mutation.source,
          actor: mutation.actor,
        }
        : undefined,
      timeline: [
        ...current.timeline,
        buildTimelineEntry('status_changed', mutation, {
          at: now,
          summary: `Application status changed to ${status}`,
          fromStatus: current.status,
          toStatus: status,
        }),
        ...(status === 'rejected'
          ? [buildTimelineEntry('rejection_recorded', mutation, {
              at: now,
              summary: options.rejectionReason?.trim() || 'Application rejected',
            })]
          : []),
      ],
    }
    records[index] = updated
    await this.store.write(records)
    return updated
  }

  async addReminder(
    id: string,
    input: { title: string; dueAt: string; note?: string },
    mutation: ApplicationMutationContext
  ): Promise<ApplicationRecord> {
    return this.updateRecord(id, mutation, (current, now) => {
      const reminder: ApplicationReminder = {
        id: createRuntimeId('reminder'),
        title: input.title,
        dueAt: input.dueAt,
        status: 'pending',
        note: input.note,
        createdAt: now,
        updatedAt: now,
        source: mutation.source,
        actor: mutation.actor,
      }
      return {
        ...current,
        updatedAt: now,
        reminders: [...current.reminders, reminder],
        timeline: [
          ...current.timeline,
          buildTimelineEntry('reminder_added', mutation, {
            at: now,
            summary: input.title,
            reminderId: reminder.id,
          }),
        ],
      }
    })
  }

  async completeReminder(
    id: string,
    reminderId: string,
    status: Exclude<ApplicationReminderStatus, 'pending'>,
    mutation: ApplicationMutationContext
  ): Promise<ApplicationRecord> {
    return this.updateRecord(id, mutation, (current, now) => {
      const reminder = current.reminders.find((item) => item.id === reminderId)
      if (!reminder) {
        throw new Error(`Reminder not found: ${reminderId}`)
      }
      const reminders = current.reminders.map((reminder) =>
        reminder.id === reminderId
          ? {
              ...reminder,
              status,
              updatedAt: now,
              completedAt: status === 'completed' ? now : reminder.completedAt,
            }
          : reminder
      )
      return {
        ...current,
        updatedAt: now,
        reminders,
        timeline: [
          ...current.timeline,
          buildTimelineEntry(status === 'completed' ? 'reminder_completed' : 'reminder_cancelled', mutation, {
            at: now,
            summary: `Reminder ${status}`,
            reminderId,
          }),
        ],
      }
    })
  }

  async addNote(
    id: string,
    input: { body: string; category?: ApplicationNoteCategory },
    mutation: ApplicationMutationContext
  ): Promise<ApplicationRecord> {
    return this.updateRecord(id, mutation, (current, now) => {
      const note = buildNote(input.body, input.category ?? 'general', mutation, now)
      return {
        ...current,
        updatedAt: now,
        notes: [...current.notes, note],
        timeline: [
          ...current.timeline,
          buildTimelineEntry('note_added', mutation, {
            at: now,
            summary: 'Application note added',
            noteId: note.id,
          }),
        ],
      }
    })
  }

  async getSummary(): Promise<{
    total: number
    byStatus: Record<ApplicationStatus, number>
    overdueReminders: number
    pendingReminders: number
    upcomingNextActions: number
    byCompany: Array<{ company: string; total: number; active: number }>
  }> {
    const records = await this.store.list()
    const byStatus = createStatusCounts()
    const companyMap = new Map<string, { total: number; active: number }>()
    let overdueReminders = 0
    let pendingReminders = 0
    let upcomingNextActions = 0
    const now = Date.now()

    for (const record of records) {
      byStatus[record.status] += 1
      const existing = companyMap.get(record.company) ?? { total: 0, active: 0 }
      existing.total += 1
      if (!['rejected', 'withdrawn', 'ghosted'].includes(record.status)) {
        existing.active += 1
      }
      companyMap.set(record.company, existing)

      for (const reminder of record.reminders) {
        if (reminder.status !== 'pending') continue
        pendingReminders += 1
        if (Date.parse(reminder.dueAt) < now) overdueReminders += 1
      }

      if (record.nextAction?.dueAt && Date.parse(record.nextAction.dueAt) >= now) {
        upcomingNextActions += 1
      }
    }

    return {
      total: records.length,
      byStatus,
      overdueReminders,
      pendingReminders,
      upcomingNextActions,
      byCompany: Array.from(companyMap.entries())
        .map(([company, value]) => ({ company, ...value }))
        .sort((left, right) => right.total - left.total || left.company.localeCompare(right.company)),
    }
  }

  private async updateRecord(
    id: string,
    mutation: ApplicationMutationContext,
    update: (current: ApplicationRecord, now: string) => ApplicationRecord
  ): Promise<ApplicationRecord> {
    const records = await this.store.list()
    const index = records.findIndex((record) => record.id === id)
    if (index < 0) throw new Error(`Application not found: ${id}`)
    const now = nowIso()
    const next = update(records[index], now)
    records[index] = next
    await this.store.write(records)
    return next
  }
}

function buildNote(
  body: string,
  category: ApplicationNoteCategory,
  mutation: ApplicationMutationContext,
  now: string
): ApplicationNote {
  return {
    id: createRuntimeId('note'),
    body,
    category,
    createdAt: now,
    updatedAt: now,
    source: mutation.source,
    actor: mutation.actor,
  }
}

function buildTimelineEntry(
  type: ApplicationTimelineEntry['type'],
  mutation: ApplicationMutationContext,
  options: {
    at: string
    summary: string
    fromStatus?: ApplicationStatus
    toStatus?: ApplicationStatus
    reminderId?: string
    noteId?: string
    meta?: Record<string, unknown>
  }
): ApplicationTimelineEntry {
  return {
    id: createRuntimeId('timeline'),
    type,
    at: options.at,
    source: mutation.source,
    actor: mutation.actor,
    summary: options.summary,
    fromStatus: options.fromStatus,
    toStatus: options.toStatus,
    reminderId: options.reminderId,
    noteId: options.noteId,
    meta: options.meta,
  }
}

function matchesRecord(record: ApplicationRecord, filters: ApplicationListFilters): boolean {
  if (filters.statuses?.length && !filters.statuses.includes(record.status)) return false
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
  if (filters.reminderStatus) {
    const hasStatus = record.reminders.some((reminder) => reminder.status === filters.reminderStatus)
    if (!hasStatus) return false
  }
  if (filters.dueBefore) {
    const dueBefore = Date.parse(filters.dueBefore)
    const dueAt = Date.parse(record.nextAction?.dueAt ?? '')
    if (!Number.isFinite(dueAt) || dueAt > dueBefore) return false
  }
  return true
}

function sortRecords(
  records: ApplicationRecord[],
  sortBy: NonNullable<ApplicationListFilters['sortBy']>,
  order: NonNullable<ApplicationListFilters['order']>
): ApplicationRecord[] {
  const direction = order === 'asc' ? 1 : -1
  return [...records].sort((left, right) => {
    const leftValue = sortBy === 'createdAt'
      ? Date.parse(left.createdAt)
      : sortBy === 'nextActionAt'
        ? Date.parse(left.nextAction?.dueAt ?? '')
        : Date.parse(left.updatedAt)
    const rightValue = sortBy === 'createdAt'
      ? Date.parse(right.createdAt)
      : sortBy === 'nextActionAt'
        ? Date.parse(right.nextAction?.dueAt ?? '')
        : Date.parse(right.updatedAt)
    if (leftValue !== rightValue) return (leftValue - rightValue) * direction
    return left.company.localeCompare(right.company) * direction
  })
}

function createStatusCounts(): Record<ApplicationStatus, number> {
  return {
    draft: 0,
    applied: 0,
    follow_up: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
    ghosted: 0,
  }
}

function normalizeNextAction(
  input: ApplicationUpsertInput['nextAction'],
  mutation: ApplicationMutationContext,
  now: string
) {
  const summary = normalizeOptional(input?.summary)
  if (!summary) return undefined
  return {
    summary,
    dueAt: normalizeOptional(input?.dueAt),
    owner: input?.owner ?? 'user',
    note: normalizeOptional(input?.note),
    updatedAt: now,
    source: mutation.source,
    actor: mutation.actor,
  }
}

function normalizeOptional(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}
