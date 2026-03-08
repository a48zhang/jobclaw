import type { Channel, ChannelMessage } from './base'

/** TUIChannel 消息处理回调 */
export type TUILogCallback = (line: string, type: 'info' | 'warn' | 'error') => void

/**
 * TUIChannel - 将 Agent 消息实时输出到 TUI Activity Log 窗口
 * 实现 Channel 接口，供 MainAgent / DeliveryAgent 使用
 */
export class TUIChannel implements Channel {
  private onLog: TUILogCallback

  constructor(onLog: TUILogCallback) {
    this.onLog = onLog
  }

  async send(message: ChannelMessage): Promise<void> {
    const type = this.resolveLogType(message)
    const line = this.formatMessage(message)
    this.onLog(line, type)
  }

  private resolveLogType(message: ChannelMessage): 'info' | 'warn' | 'error' {
    switch (message.type) {
      case 'delivery_failed':
      case 'tool_error':
        return 'error'
      case 'delivery_blocked':
      case 'tool_warn':
        return 'warn'
      default:
        return 'info'
    }
  }

  private formatMessage(message: ChannelMessage): string {
    const ts = message.timestamp.toLocaleTimeString()
    const company = typeof message.payload['company'] === 'string' ? message.payload['company'] : ''
    const title = typeof message.payload['title'] === 'string' ? message.payload['title'] : ''
    const msg = typeof message.payload['message'] === 'string' ? message.payload['message'] : ''
    const subject = [company, title].filter(Boolean).join(' · ')
    
    let content = subject
    if (msg) content = content ? `${content} | ${msg}` : msg

    return content
      ? `[${ts}] [${message.type}] ${content}`
      : `[${ts}] [${message.type}]`
  }
}
