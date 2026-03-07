// Channel 抽象接口

export type ChannelMessageType =
  | 'new_job'
  | 'delivery_start'
  | 'delivery_success'
  | 'delivery_failed'
  | 'delivery_blocked'
  | 'cron_complete'

export interface ChannelMessage {
  type: ChannelMessageType
  payload: Record<string, unknown>
  timestamp: Date
}

export interface Channel {
  send(message: ChannelMessage): Promise<void>
}
