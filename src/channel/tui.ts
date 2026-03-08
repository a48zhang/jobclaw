import type { Channel, ChannelMessage } from './base'

export class TUIChannel implements Channel {
  constructor(private logger: (line: string, type: 'info' | 'warn' | 'error') => void) {}

  async send(message: ChannelMessage): Promise<void> {
    const time = message.timestamp.toLocaleTimeString()
    const headerPrefix = `[${time}]`
    let level: 'info' | 'warn' | 'error' = 'info'
    let label = ''
    let content = ''

    switch (message.type) {
      case 'new_job':
        label = 'System|Job'
        content = `🦞 发现新职位: ${message.payload['company']} - ${message.payload['title']}`
        break
      case 'delivery_start':
        label = 'Agent|Delivery'
        content = `🚀 开始投递: ${message.payload['company']}`
        break
      case 'delivery_success':
        label = 'Agent|Delivery'
        content = `✅ 投递成功: ${message.payload['company']}`
        break
      case 'delivery_failed':
        label = 'Agent|Delivery'
        content = `❌ 投递失败: ${message.payload['company']} (原因: ${message.payload['reason'] || '未知'})`
        level = 'error'
        break
      case 'delivery_blocked':
        label = 'Agent|Delivery'
        content = `⚠️ 投递受阻: ${message.payload['company']} (需要人工介入)`
        level = 'warn'
        break
      case 'cron_complete':
        label = 'System'
        content = `📅 定时任务完成: ${message.payload['summary'] || message.payload['message']}`
        break
      case 'user_input' as any:
        label = 'User'
        content = `${message.payload['message']}`
        break
      case 'agent_response' as any:
        label = 'Agent'
        content = `🤖 ${message.payload['message']}`
        break
      case 'tool_call':
        label = `tool:${message.payload['toolName']}`
        content = `🛠️ 正在调用工具 (参数: ${JSON.stringify(message.payload['args'])})`
        break
      case 'tool_error' as any:
        label = `tool:${message.payload['toolName'] || 'error'}`
        content = `❌ 🛠️ 错误: ${message.payload['message']}`
        level = 'error'
        break
      case 'tool_warn' as any:
        label = `tool:${message.payload['toolName'] || 'warn'}`
        content = `⚠️ 🛠️ 警告: ${message.payload['message']}`
        level = 'warn'
        break
      default:
        label = message.type
        content = JSON.stringify(message.payload)
    }

    // 第一行：打印时间与标签
    this.logger(`${headerPrefix} (${label})`, 'info')

    // 后续行：打印正文内容，不加空格缩进
    const lines = content.split('\n')
    lines.forEach((line) => {
      this.logger(line, level)
    })
  }
}
