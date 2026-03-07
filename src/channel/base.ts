// Channel 抽象接口 - Phase 3 定义

/** Channel 消息类型 */
export type ChannelMessageType = 'new_job' | 'delivery_done' | 'error' | string

/** Channel 消息 */
export interface ChannelMessage {
  type: ChannelMessageType
  payload: Record<string, unknown>
  timestamp: Date
}

/** Channel 接口 - 用于向外部发送通知（邮件/Webhook 等） */
export interface Channel {
  send(message: ChannelMessage): Promise<void>
}
