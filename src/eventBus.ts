import { EventEmitter } from 'node:events'
import type { AgentState } from './types.js'
import type {
  AgentSession,
  DelegatedRun,
  DelegatedRunState,
  InterventionRecord,
  MemoryEventRecord,
  RuntimeEvent,
  EventStream,
  ToolEventRecord,
  AgentProfileName,
} from './runtime/contracts.js'

export interface AgentStatePayload {
  agentName: string
  state: AgentState
}

export interface AgentLogPayload {
  agentName: string
  type: 'info' | 'warn' | 'error'
  level?: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
}

export interface JobUpdatedPayload {
  company: string
  title: string
  status: string
}

export interface AgentStreamPayload {
  agentName: string
  chunk: string
  isFirst: boolean
  isFinal: boolean
}

export interface AgentToolPayload {
  agentName: string
  toolType: 'tool_call' | 'tool_output'
  message: string
  timestamp: string
}

export type RequestKind = 'text' | 'confirm' | 'single_select'

export interface InterventionRequiredPayload {
  agentName: string
  prompt: string
  requestId?: string
  kind?: RequestKind
  options?: string[]
  timeoutMs?: number
  allowEmpty?: boolean
}

export interface InterventionResolvedPayload {
  agentName: string
  input: string
  requestId?: string
}

export interface ContextUsagePayload {
  agentName: string
  tokenCount: number
}

export interface EventBusMap {
  'agent:state': AgentStatePayload
  'agent:log': AgentLogPayload
  'agent:stream': AgentStreamPayload
  'agent:tool': AgentToolPayload
  'job:updated': JobUpdatedPayload
  'intervention:required': InterventionRequiredPayload
  'intervention:resolved': InterventionResolvedPayload
  'context:usage': ContextUsagePayload
  'session.state_changed': AgentSession
  'session.output_chunk': AgentStreamPayload
  'delegation.created': DelegatedRun
  'delegation.state_changed': DelegatedRun
  'delegation.completed': DelegatedRun
  'delegation.failed': DelegatedRun
  'tool.started': ToolEventRecord
  'tool.finished': ToolEventRecord
  'intervention.requested': InterventionRecord
  'intervention.resolved': InterventionRecord
  'memory.updated': MemoryEventRecord
}

function isDelegatedProfileName(value: unknown): value is Exclude<AgentProfileName, 'main'> {
  return value === 'search' || value === 'delivery' || value === 'resume' || value === 'review'
}

function isDelegatedRunState(value: unknown): value is DelegatedRunState {
  return (
    value === 'queued' ||
    value === 'running' ||
    value === 'waiting_input' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'cancelled'
  )
}

function toRuntimeEvent(
  event: keyof EventBusMap,
  payload: EventBusMap[keyof EventBusMap]
): Omit<RuntimeEvent, 'id' | 'timestamp'> | null {
  switch (event) {
    case 'agent:state': {
      const value = payload as AgentStatePayload
      return {
        type: 'session.state_changed',
        sessionId: value.agentName,
        agentName: value.agentName,
        payload: { state: value.state },
      }
    }
    case 'agent:stream': {
      const value = payload as AgentStreamPayload
      return {
        type: 'session.output_chunk',
        sessionId: value.agentName,
        agentName: value.agentName,
        payload: {
          chunk: value.chunk,
          isFirst: value.isFirst,
          isFinal: value.isFinal,
        },
      }
    }
    case 'agent:tool': {
      const value = payload as AgentToolPayload
      return {
        type: value.toolType === 'tool_call' ? 'tool.started' : 'tool.finished',
        sessionId: value.agentName,
        agentName: value.agentName,
        payload: {
          message: value.message,
          toolType: value.toolType,
          timestamp: value.timestamp,
        },
      }
    }
    case 'job:updated': {
      const value = payload as JobUpdatedPayload
      return {
        type: 'memory.updated',
        payload: {
          company: value.company,
          title: value.title,
          status: value.status,
        },
      }
    }
    case 'intervention:required': {
      const value = payload as InterventionRequiredPayload
      return {
        type: 'intervention.requested',
        sessionId: value.agentName,
        agentName: value.agentName,
        payload: {
          prompt: value.prompt,
          requestId: value.requestId,
          kind: value.kind,
          options: value.options ?? [],
          timeoutMs: value.timeoutMs,
          allowEmpty: value.allowEmpty,
        },
      }
    }
    case 'intervention:resolved': {
      const value = payload as InterventionResolvedPayload
      return {
        type: 'intervention.resolved',
        sessionId: value.agentName,
        agentName: value.agentName,
        payload: {
          input: value.input,
          requestId: value.requestId,
        },
      }
    }
    case 'agent:log': {
      const value = payload as AgentLogPayload
      if (value.type === 'warn' || value.type === 'error') {
        return {
          type: value.type === 'warn' ? 'runtime.warning' : 'runtime.error',
          agentName: value.agentName,
          sessionId: value.agentName,
          payload: {
            message: value.message,
            timestamp: value.timestamp,
          },
        }
      }
      return null
    }
    case 'delegation.created':
    case 'delegation.state_changed':
    case 'delegation.completed':
    case 'delegation.failed': {
      const value = payload as DelegatedRun
      return {
        type: event,
        sessionId: value.parentSessionId,
        delegatedRunId: value.id,
        agentName: value.agentName ?? value.parentSessionId,
        payload: {
          profile: value.profile,
          state: value.state,
          instruction: value.instruction,
          createdAt: value.createdAt,
          updatedAt: value.updatedAt,
          resultSummary: value.resultSummary,
          error: value.error,
        },
      }
    }
    case 'context:usage':
      return null
    default:
      return null
  }
}

function toLegacyEvent(
  event: RuntimeEvent
): { name: keyof EventBusMap; payload: EventBusMap[keyof EventBusMap] } | null {
  switch (event.type) {
    case 'session.state_changed':
      return {
        name: 'agent:state',
        payload: {
          agentName: event.agentName ?? event.sessionId ?? 'main',
          state: String(event.payload.state ?? 'idle') as AgentState,
        },
      }
    case 'session.output_chunk':
      return {
        name: 'agent:stream',
        payload: {
          agentName: event.agentName ?? event.sessionId ?? 'main',
          chunk: String(event.payload.chunk ?? ''),
          isFirst: Boolean(event.payload.isFirst),
          isFinal: Boolean(event.payload.isFinal),
        },
      }
    case 'tool.started':
    case 'tool.finished':
      return {
        name: 'agent:tool',
        payload: {
          agentName: event.agentName ?? event.sessionId ?? 'main',
          toolType: event.type === 'tool.started' ? 'tool_call' : 'tool_output',
          message: String(event.payload.message ?? event.type),
          timestamp: String(event.payload.timestamp ?? event.timestamp),
        },
      }
    case 'intervention.requested':
      return {
        name: 'intervention:required',
        payload: {
          agentName: event.agentName ?? event.sessionId ?? 'main',
          prompt: String(event.payload.prompt ?? ''),
          requestId: typeof event.payload.requestId === 'string' ? event.payload.requestId : undefined,
          kind: event.payload.kind as RequestKind | undefined,
          options: Array.isArray(event.payload.options)
            ? event.payload.options.filter((item): item is string => typeof item === 'string')
            : undefined,
          timeoutMs: typeof event.payload.timeoutMs === 'number' ? event.payload.timeoutMs : undefined,
          allowEmpty: typeof event.payload.allowEmpty === 'boolean' ? event.payload.allowEmpty : undefined,
        },
      }
    case 'intervention.resolved':
      return {
        name: 'intervention:resolved',
        payload: {
          agentName: event.agentName ?? event.sessionId ?? 'main',
          input: String(event.payload.input ?? ''),
          requestId: typeof event.payload.requestId === 'string' ? event.payload.requestId : undefined,
        },
      }
    case 'memory.updated':
      if (
        typeof event.payload.company === 'string' &&
        typeof event.payload.title === 'string' &&
        typeof event.payload.status === 'string'
      ) {
        return {
          name: 'job:updated',
          payload: {
            company: event.payload.company,
            title: event.payload.title,
            status: event.payload.status,
          },
        }
      }
      return null
    case 'delegation.created':
    case 'delegation.state_changed':
    case 'delegation.completed':
    case 'delegation.failed': {
      const profile = isDelegatedProfileName(event.payload.profile) ? event.payload.profile : 'search'
      const state = isDelegatedRunState(event.payload.state) ? event.payload.state : 'queued'

      return {
        name: event.type,
        payload: {
          id: event.delegatedRunId ?? '',
          parentSessionId: event.sessionId ?? 'main',
          profile,
          state,
          instruction: String(event.payload.instruction ?? ''),
          createdAt: String(event.payload.createdAt ?? event.timestamp),
          updatedAt: String(event.payload.updatedAt ?? event.timestamp),
          resultSummary:
            typeof event.payload.resultSummary === 'string' ? event.payload.resultSummary : undefined,
          error: typeof event.payload.error === 'string' ? event.payload.error : undefined,
          agentName: event.agentName ?? event.sessionId ?? 'main',
        },
      }
    }
    case 'runtime.warning':
    case 'runtime.error':
      return {
        name: 'agent:log',
        payload: {
          agentName: event.agentName ?? 'system',
          type: event.type === 'runtime.warning' ? 'warn' : 'error',
          level: event.type === 'runtime.warning' ? 'warn' : 'error',
          message: String(event.payload.message ?? event.type),
          timestamp: String(event.payload.timestamp ?? event.timestamp),
        },
      }
    default:
      return null
  }
}

class LegacyEventBus extends EventEmitter {
  private stream?: EventStream
  private unbind?: () => void

  bindStream(stream?: EventStream): void {
    this.unbind?.()
    this.stream = stream

    if (!stream) {
      this.unbind = undefined
      return
    }

    this.unbind = stream.subscribe((event, meta) => {
      if (meta.origin === 'legacy') return
      const legacy = toLegacyEvent(event)
      if (!legacy) return
      this.emitLegacyOnly(legacy.name, legacy.payload)
    })
  }

  emit<K extends keyof EventBusMap>(event: K, payload: EventBusMap[K]): boolean
  emit(event: string | symbol, ...args: unknown[]): boolean
  emit(event: string | symbol, ...args: unknown[]): boolean {
    const emitted = this.emitLegacyOnly(event, ...args)

    if (typeof event === 'string' && this.stream && args.length > 0) {
      const runtimeEvent = toRuntimeEvent(event as keyof EventBusMap, args[0] as EventBusMap[keyof EventBusMap])
      if (runtimeEvent) {
        this.stream.publish(runtimeEvent, { origin: 'legacy' })
      }
    }

    return emitted
  }

  on<K extends keyof EventBusMap>(event: K, listener: (payload: EventBusMap[K]) => void): this
  on(event: string | symbol, listener: (...args: unknown[]) => void): this
  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.on(event, listener)
  }

  off<K extends keyof EventBusMap>(event: K, listener: (payload: EventBusMap[K]) => void): this
  off(event: string | symbol, listener: (...args: unknown[]) => void): this
  off(event: string | symbol, listener: (...args: unknown[]) => void): this {
    return super.off(event, listener)
  }

  private emitLegacyOnly(event: string | symbol, ...args: unknown[]): boolean {
    return EventEmitter.prototype.emit.call(this, event, ...args)
  }
}

export const eventBus = new LegacyEventBus()

export function bindRuntimeEventStream(stream?: EventStream): void {
  eventBus.bindStream(stream)
}
