/** 全局事件总线 (EventBus) — Phase 5 Team A
 * 单例模式：全应用共享同一个 EventEmitter 实例，用于 Agent / Server / UI 之间的解耦通信。
 */
import { EventEmitter } from 'node:events'
import type { AgentState } from './types.js'

// ─── Typed Event Payloads ──────────────────────────────────────────────────────

export interface AgentStatePayload {
  agentName: string
  state: AgentState
}

export interface AgentLogPayload {
  agentName: string
  type: 'info' | 'warn' | 'error'
  /** @deprecated Back-compat alias for older emitters/clients */
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

/** All typed events on the global event bus */
export interface EventBusMap {
  'agent:state': AgentStatePayload
  'agent:log': AgentLogPayload
  'agent:stream': AgentStreamPayload
  'agent:tool': AgentToolPayload
  'job:updated': JobUpdatedPayload
  'intervention:required': InterventionRequiredPayload
  'intervention:resolved': InterventionResolvedPayload
  'context:usage': ContextUsagePayload
}

// ─── TypedEventBus ─────────────────────────────────────────────────────────────

class TypedEventBus extends EventEmitter {
  // Typed overloads so callers get full type inference
  emit<K extends keyof EventBusMap>(event: K, payload: EventBusMap[K]): boolean
  emit(event: string | symbol, ...args: unknown[]): boolean
  emit(event: string | symbol, ...args: unknown[]): boolean {
    return super.emit(event, ...args)
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
}

/** Singleton event bus instance */
export const eventBus = new TypedEventBus()
