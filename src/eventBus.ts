/**
 * src/eventBus.ts — 全局单例事件总线
 *
 * 供各模块（Agent、工具层、Web 服务）跨组件通信使用。
 * 前端通过 WebSocket 订阅这些事件并展示在活动流水中。
 */

import { EventEmitter } from 'node:events'
import type { AgentState } from './types'

// ============================================================================
// 事件载荷类型
// ============================================================================

export interface AgentStateEvent {
  agentName: string
  state: AgentState
  timestamp: Date
}

export interface AgentLogEvent {
  agentName: string
  level: 'info' | 'warn' | 'error'
  message: string
  timestamp: Date
}

export interface JobUpdatedEvent {
  company: string
  title: string
  url: string
  status: string
  timestamp: Date
}

export interface InterventionRequiredEvent {
  agentName: string
  prompt: string
  resolve: (input: string) => void
}

export interface InterventionResolvedEvent {
  agentName: string
  prompt: string
}

// ============================================================================
// 类型化事件总线
// ============================================================================

export interface EventBusEvents {
  'agent:state': (event: AgentStateEvent) => void
  'agent:log': (event: AgentLogEvent) => void
  'job:updated': (event: JobUpdatedEvent) => void
  'intervention:required': (event: InterventionRequiredEvent) => void
  'intervention:resolved': (event: InterventionResolvedEvent) => void
}

class TypedEventBus extends EventEmitter {
  emit<K extends keyof EventBusEvents>(event: K, payload: Parameters<EventBusEvents[K]>[0]): boolean {
    return super.emit(event, payload)
  }

  on<K extends keyof EventBusEvents>(event: K, listener: EventBusEvents[K]): this {
    return super.on(event, listener as (...args: unknown[]) => void)
  }

  off<K extends keyof EventBusEvents>(event: K, listener: EventBusEvents[K]): this {
    return super.off(event, listener as (...args: unknown[]) => void)
  }

  once<K extends keyof EventBusEvents>(event: K, listener: EventBusEvents[K]): this {
    return super.once(event, listener as (...args: unknown[]) => void)
  }
}

/**
 * 全局单例事件总线
 * 所有模块应通过此实例发布与订阅事件
 */
export const eventBus = new TypedEventBus()
