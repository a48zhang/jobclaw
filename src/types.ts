// 类型定义 - Phase 1a 实现

import type {
  ChatCompletionMessageParam as OpenAIChatCompletionMessageParam,
  ChatCompletionTool as OpenAIChatCompletionTool,
  ChatCompletionMessageToolCall as OpenAIChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'

// 从 OpenAI SDK 重导出类型
export type ChatCompletionMessageParam = OpenAIChatCompletionMessageParam
export type ChatCompletionTool = OpenAIChatCompletionTool
export type ChatCompletionMessageToolCall = OpenAIChatCompletionMessageToolCall

/**
 * Agent 状态类型
 */
export type AgentState = 'idle' | 'running' | 'waiting' | 'error'

/**
 * 任务类型
 */
export type TaskType = 'search' | 'deliver'

/**
 * 任务状态
 */
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed'

/**
 * 任务定义
 */
export interface Task {
  /** 任务唯一标识 */
  id: string
  /** 任务类型 */
  type: TaskType
  /** 任务负载数据 */
  payload: Record<string, unknown>
  /** 任务状态 */
  status: TaskStatus
}

/**
 * Agent Session 状态
 * 与 workspace/agents/{name}/session.json 结构对应
 */
export interface Session {
  /** 当前任务 */
  currentTask: Task | null
  /** Agent 上下文数据 */
  context: Record<string, unknown>
  /** 消息历史 */
  messages: ChatCompletionMessageParam[]
  /** 待办事项列表 */
  todos: string[]
  /** 最后一次 LLM 响应的结束原因 */
  finishReason?: string
}