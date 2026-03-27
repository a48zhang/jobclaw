import type {
  EventStream,
  InterventionKind,
  InterventionRecord,
  InterventionStatus,
} from './contracts.js'
import { InterventionStore } from '../memory/interventionStore.js'
import { createRuntimeId, nowIso } from './utils.js'

export interface InterventionRequestInput {
  id?: string
  ownerType: InterventionRecord['ownerType']
  ownerId: string
  prompt: string
  kind?: InterventionKind
  options?: string[]
  allowEmpty?: boolean
  timeoutMs?: number
}

export interface ResolveInterventionInput {
  ownerId: string
  requestId?: string
  input: string
}

interface InterventionMutationOptions {
  emitEvent?: boolean
  sessionId?: string
  agentName?: string
  delegatedRunId?: string
}

export class InterventionManager {
  private readonly store: InterventionStore

  constructor(
    workspaceRoot: string,
    private readonly eventStream: EventStream
  ) {
    this.store = new InterventionStore(workspaceRoot)
  }

  async request(
    input: InterventionRequestInput,
    options: InterventionMutationOptions = {}
  ): Promise<InterventionRecord> {
    const now = nowIso()
    const record: InterventionRecord = {
      id: input.id ?? createRuntimeId('ivr'),
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      kind: input.kind ?? 'text',
      prompt: input.prompt,
      options: input.options,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      allowEmpty: input.allowEmpty,
      timeoutMs: input.timeoutMs,
    }

    await this.store.save(record)
    if (options.emitEvent !== false) {
      this.eventStream.publish(
        {
          type: 'intervention.requested',
          sessionId: options.sessionId,
          delegatedRunId: options.delegatedRunId,
          agentName: options.agentName,
          payload: {
            prompt: record.prompt,
            requestId: record.id,
            kind: record.kind,
            options: record.options ?? [],
            allowEmpty: record.allowEmpty ?? true,
            timeoutMs: record.timeoutMs,
          },
        },
        { origin: 'runtime' }
      )
    }
    return record
  }

  async resolve(
    input: ResolveInterventionInput,
    options: InterventionMutationOptions = {}
  ): Promise<InterventionRecord | null> {
    const record = await this.findPending(input.ownerId, input.requestId)
    if (!record) return null

    const nextRecord: InterventionRecord = {
      ...record,
      input: input.input,
      status: 'resolved',
      updatedAt: nowIso(),
    }
    await this.store.update(nextRecord)

    if (options.emitEvent !== false) {
      this.eventStream.publish(
        {
          type: 'intervention.resolved',
          sessionId: options.sessionId,
          delegatedRunId: options.delegatedRunId,
          agentName: options.agentName,
          payload: {
            input: input.input,
            requestId: nextRecord.id,
          },
        },
        { origin: 'runtime' }
      )
    }

    return nextRecord
  }

  async cancel(recordId: string): Promise<InterventionRecord | null> {
    return this.transition(recordId, 'cancelled')
  }

  async timeout(recordId: string): Promise<InterventionRecord | null> {
    return this.transition(recordId, 'timeout')
  }

  async syncTimeouts(now = Date.now()): Promise<InterventionRecord[]> {
    const timedOut: InterventionRecord[] = []
    for (const record of await this.list()) {
      if (record.status !== 'pending' || !record.timeoutMs) continue
      if (Date.parse(record.createdAt) + record.timeoutMs > now) continue
      const nextRecord = await this.timeout(record.id)
      if (nextRecord) timedOut.push(nextRecord)
    }
    return timedOut
  }

  async get(recordId: string): Promise<InterventionRecord | null> {
    return (await this.store.get(recordId)) ?? null
  }

  async list(): Promise<InterventionRecord[]> {
    const records = await this.store.list()
    return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }

  async listPending(ownerId?: string): Promise<InterventionRecord[]> {
    const records = await this.list()
    return records.filter((record) => {
      if (record.status !== 'pending') return false
      return ownerId ? record.ownerId === ownerId : true
    })
  }

  private async findPending(ownerId: string, requestId?: string): Promise<InterventionRecord | null> {
    const records = await this.listPending(ownerId)
    if (requestId) {
      return records.find((record) => record.id === requestId) ?? null
    }
    return records.at(-1) ?? null
  }

  private async transition(
    recordId: string,
    status: Exclude<InterventionStatus, 'pending' | 'resolved'>
  ): Promise<InterventionRecord | null> {
    const record = await this.get(recordId)
    if (!record || record.status !== 'pending') return null
    const nextRecord: InterventionRecord = {
      ...record,
      status,
      updatedAt: nowIso(),
    }
    await this.store.update(nextRecord)
    return nextRecord
  }
}
