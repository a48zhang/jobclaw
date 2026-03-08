/**
 * 全局事件总线 (EventBus) - Phase 5 Team A
 * 单例 EventEmitter，用于各模块间解耦通信
 */
import { EventEmitter } from 'node:events'

/** agent:state 事件载荷 */
export interface AgentStateEvent {
  agentName: string
  state: string
}

/** agent:log 事件载荷 */
export interface AgentLogEvent {
  agentName: string
  type: 'info' | 'warn' | 'error'
  message: string
  timestamp: string
}

/** job:updated 事件载荷 */
export interface JobUpdatedEvent {
  company: string
  title: string
  status: string
}

/** intervention:required 事件载荷 */
export interface InterventionRequiredEvent {
  agentName: string
  prompt: string
}

/** intervention:resolved 事件载荷 */
export interface InterventionResolvedEvent {
  agentName: string
  input: string
}

class EventBus extends EventEmitter {}

/** 全局事件总线单例 */
export const eventBus = new EventBus()
