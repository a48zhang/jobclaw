import { eventBus } from '../eventBus.js'
import { InMemoryEventStream } from './event-stream.js'
import { createRuntimeId, nowIso } from './utils.js'
import type {
  AgentProfileName,
  AgentSession,
  AgentSessionState,
  DelegatedRun,
  DelegatedRunState,
  InterventionRecord,
  RuntimeEvent,
  RuntimeEventInput,
  RuntimeEventMeta,
  ToolEventRecord,
  MemoryEventRecord,
} from './contracts.js'
import type { InterventionRequiredPayload, InterventionResolvedPayload, AgentStreamPayload, JobUpdatedPayload } from '../eventBus.js'

const TOOL_LOG_LIMIT = 30
const MEMORY_LOG_LIMIT = 8

type ToolEventType = 'tool.started' | 'tool.finished'

interface ToolEventInput {
  agentName: string
  toolName: string
  type: ToolEventType
  sessionId?: string
  delegatedRunId?: string
  message?: string
  success?: boolean
  result?: string
  error?: string
  timestamp?: string
}

export class ObservabilityStore {
  public readonly eventStream = new InMemoryEventStream({ maxHistory: 1200 })
  private readonly sessions = new Map<string, AgentSession>()
  private readonly delegations = new Map<string, DelegatedRun>()
  private readonly interventions = new Map<string, InterventionRecord>()
  private readonly toolLog: ToolEventRecord[] = []
  private readonly memoryLog: MemoryEventRecord[] = []
  private readonly busAttached = this.attachEventListeners()

  private attachEventListeners(): true {
    eventBus.on('agent:stream', (payload: AgentStreamPayload) => {
      this.recordStreamChunk({
        agentName: payload.agentName,
        chunk: payload.chunk,
        isFirst: payload.isFirst,
        isFinal: payload.isFinal,
      })
    })
    eventBus.on('intervention:required', (payload: InterventionRequiredPayload) => {
      this.recordInterventionRequest(payload)
    })
    eventBus.on('intervention:resolved', (payload: InterventionResolvedPayload) => {
      this.recordInterventionResolution(payload)
    })
    eventBus.on('job:updated', (payload: JobUpdatedPayload) => {
      this.recordMemoryUpdate('job', {
        company: payload.company,
        title: payload.title,
        status: payload.status,
      })
    })
    return true
  }

  public async publishRuntimeEvent(input: RuntimeEventInput, meta?: RuntimeEventMeta): Promise<RuntimeEvent> {
    return this.eventStream.publish(input, meta)
  }

  public recordSessionState(input: {
    sessionId: string
    agentName: string
    profile: 'main'
    state: AgentSessionState
    lastMessageAt?: string
  }): AgentSession {
    const now = input.lastMessageAt ?? nowIso()
    const sessionId = input.sessionId || input.agentName
    const existing = this.sessions.get(sessionId)
    const session: AgentSession = {
      id: sessionId,
      agentName: input.agentName,
      profile: input.profile,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      state: input.state,
      lastMessageAt: now,
    }
    this.sessions.set(sessionId, session)
    eventBus.emit('session.state_changed', session)
    this.publishRuntimeEvent({
      type: 'session.state_changed',
      timestamp: now,
      sessionId,
      agentName: input.agentName,
      payload: { ...session },
    })
    return session
  }

  private recordStreamChunk(event: {
    agentName?: string
    chunk: string
    isFirst: boolean
    isFinal: boolean
  }): void {
    if (!event.agentName) return
    const payload = {
      agentName: event.agentName,
      chunk: event.chunk,
      isFirst: event.isFirst,
      isFinal: event.isFinal,
      timestamp: nowIso(),
    }
    eventBus.emit('session.output_chunk', payload)
    this.publishRuntimeEvent({
      type: 'session.output_chunk',
      sessionId: event.agentName,
      agentName: event.agentName,
      payload,
    })
  }

  public listSessions(): AgentSession[] {
    return Array.from(this.sessions.values())
  }

  public getSession(sessionId: string): AgentSession | null {
    return this.sessions.get(sessionId) ?? null
  }

  public createDelegation(options: {
    parentSessionId: string
    profile: DelegatedRun['profile']
    instruction: string
  }): DelegatedRun {
    const now = nowIso()
    const delegation: DelegatedRun = {
      id: createRuntimeId('delegation'),
      parentSessionId: options.parentSessionId,
      profile: options.profile,
      state: 'queued',
      instruction: options.instruction,
      createdAt: now,
      updatedAt: now,
    }
    this.delegations.set(delegation.id, delegation)
    this.emitDelegationEvent('delegation.created', delegation)
    return delegation
  }

  public updateDelegationState(
    id: string,
    state: DelegatedRunState,
    extras?: { resultSummary?: string; error?: string }
  ): DelegatedRun | null {
    const existing = this.delegations.get(id)
    if (!existing) return null
    const next: DelegatedRun = {
      ...existing,
      state,
      updatedAt: nowIso(),
      resultSummary: extras?.resultSummary ?? existing.resultSummary,
      error: extras?.error ?? existing.error,
    }
    this.delegations.set(id, next)
    const eventName =
      state === 'completed'
        ? 'delegation.completed'
        : state === 'failed'
        ? 'delegation.failed'
        : 'delegation.state_changed'
    this.emitDelegationEvent(eventName, next)
    return next
  }

  private emitDelegationEvent(eventName: string, delegation: DelegatedRun) {
    eventBus.emit(eventName as any, delegation)
  }

  public listDelegations(): DelegatedRun[] {
    return Array.from(this.delegations.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    )
  }

  private recordInterventionRequest(payload: InterventionRequiredPayload): void {
    const id = payload.requestId ?? createRuntimeId('intervention')
    const now = nowIso()
    const record: InterventionRecord = {
      id,
      ownerType: 'session',
      ownerId: payload.agentName ?? 'main',
      kind: (payload.kind || 'text') as InterventionRecord['kind'],
      prompt: payload.prompt,
      options: payload.options,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      allowEmpty: payload.allowEmpty,
      timeoutMs: payload.timeoutMs,
    }
    this.interventions.set(record.id, record)
    eventBus.emit('intervention.requested', record)
    this.publishRuntimeEvent({
      type: 'intervention.requested',
      sessionId: record.ownerId,
      payload: { ...record },
    })
  }

  private recordInterventionResolution(payload: InterventionResolvedPayload): void {
    const id = payload.requestId ?? ''
    const existing = this.interventions.get(id)
    if (!existing) return
    existing.status = payload.input ? 'resolved' : 'cancelled'
    existing.input = payload.input
    existing.updatedAt = nowIso()
    this.interventions.set(id, existing)
    eventBus.emit('intervention.resolved', existing)
    this.publishRuntimeEvent({
      type: 'intervention.resolved',
      sessionId: existing.ownerId,
      payload: { ...existing },
    })
  }

  public listInterventions(): InterventionRecord[] {
    return Array.from(this.interventions.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )
  }

  public recordToolEvent(input: ToolEventInput): ToolEventRecord {
    const timestamp = input.timestamp ?? nowIso()
    const record: ToolEventRecord = {
      ...input,
      id: createRuntimeId('tool'),
      timestamp,
    }
    this.toolLog.unshift(record)
    if (this.toolLog.length > TOOL_LOG_LIMIT) this.toolLog.pop()
    const payload = {
      agentName: record.agentName,
      toolName: record.toolName,
      message: record.message,
      success: record.success,
      error: record.error,
      result: record.result,
      timestamp: record.timestamp,
    }
    eventBus.emit(record.type as any, payload)
    this.publishRuntimeEvent({
      type: record.type,
      sessionId: record.sessionId,
      delegatedRunId: record.delegatedRunId,
      agentName: record.agentName,
      payload,
    })
    return record
  }

  public listToolEvents(): ToolEventRecord[] {
    return [...this.toolLog]
  }

  public recordMemoryUpdate(type: string, payload: Record<string, unknown>, summary?: string): MemoryEventRecord {
    const event: MemoryEventRecord = {
      id: createRuntimeId('memory'),
      type,
      summary: summary ?? `${type} updated`,
      payload,
      timestamp: nowIso(),
    }
    this.memoryLog.unshift(event)
    if (this.memoryLog.length > MEMORY_LOG_LIMIT) this.memoryLog.pop()
    eventBus.emit('memory.updated', event)
    this.publishRuntimeEvent({
      type: 'memory.updated',
      payload: { ...event },
      sessionId: undefined,
      agentName: undefined,
    })
    return event
  }

  public listMemoryEvents(): MemoryEventRecord[] {
    return [...this.memoryLog]
  }
}

export const observability = new ObservabilityStore()
