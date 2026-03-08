import type { Channel, ChannelMessage } from './base'

export class TUIChannel implements Channel {
  constructor(private logger: (line: string, type: 'info' | 'warn' | 'error') => void) {}

  async send(message: ChannelMessage): Promise<void> {
    const time = message.timestamp.toLocaleTimeString()
    let prefix = `[${time}]`
    let text = ''
    let level: 'info' | 'warn' | 'error' = 'info'

    switch (message.type) {
      case 'new_job':
        text = `🦞 发现新职位: ${message.payload['company']} - ${message.payload['title']}`
        break
      case 'delivery_start':
        text = `🚀 开始投递: ${message.payload['company']}`
        break
      case 'delivery_success':
        text = `✅ 投递成功: ${message.payload['company']}`
        break
      case 'delivery_failed':
        text = `❌ 投递失败: ${message.payload['company']} (原因: ${message.payload['reason'] || '未知'})`
        level = 'error'
        break
      case 'delivery_blocked':
        text = `⚠️ 投递受阻: ${message.payload['company']} (需要人工介入)`
        level = 'warn'
        break
      case 'cron_complete':
        text = `📅 定时任务完成: ${message.payload['summary'] || message.payload['message']}`
        break
      case 'user_input' as any: // 新增用户输入类型
        text = `${message.payload['message']}` // 保持原始颜色标签
        break
      case 'agent_response' as any:
        text = `🤖 ${message.payload['message']}`
        break
      case 'tool_error' as any:
        text = `🛠️ 工具错误: ${message.payload['message']}`
        level = 'error'
        break
      case 'tool_warn' as any:
        text = `🛠️ 工具警告: ${message.payload['message']}`
        level = 'warn'
        break
      default:
        text = `[${message.type}] ${JSON.stringify(message.payload)}`
    }

    this.logger(`${prefix} ${text}`, level)
  }
}
