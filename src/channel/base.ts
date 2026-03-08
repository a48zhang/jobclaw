/** 通知消息类型 */
export type ChannelMessageType =
  | 'new_job'
  | 'delivery_start'
  | 'delivery_success'
  | 'delivery_failed'
  | 'delivery_blocked'
  | 'cron_complete'
  | 'tool_warn'
  | 'tool_error'
  | 'tool_call'
  | 'tool_output'
  | 'agent_response'
  | 'user_input'

/** 通知消息结构 */
export interface ChannelMessage {
  type: ChannelMessageType
  payload: Record<string, unknown>
  timestamp: Date
  /** 流式传输标识 (Phase 6) */
  streaming?: {
    isFirst: boolean  // 是否是第一块（用于打印 Header）
    isFinal: boolean  // 是否是最后一块（用于收尾）
    chunk: string     // 当前片段
  }
}

export interface Channel {
  send(message: ChannelMessage): Promise<void>
}
