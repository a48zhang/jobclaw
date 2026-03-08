import type { Channel, ChannelMessage } from './base'

export class TUIChannel implements Channel {
  constructor(private logger: (line: string, type: 'info' | 'warn' | 'error') => void) {}

  async send(message: ChannelMessage): Promise<void> {
    const time = message.timestamp.toLocaleTimeString()
    const prefix = `[${time}]`
    let level: 'info' | 'warn' | 'error' = 'info'
    let icon = ''
    let content = ''

    switch (message.type) {
      case 'new_job':
        icon = '🦞'
        content = `发现新职位: ${message.payload['company']} - ${message.payload['title']}`
        break
      case 'delivery_start':
        icon = '🚀'
        content = `开始投递: ${message.payload['company']}`
        break
      case 'delivery_success':
        icon = '✅'
        content = `投递成功: ${message.payload['company']}`
        break
      case 'delivery_failed':
        icon = '❌'
        content = `投递失败: ${message.payload['company']} (原因: ${message.payload['reason'] || '未知'})`
        level = 'error'
        break
      case 'delivery_blocked':
        icon = '⚠️'
        content = `投递受阻: ${message.payload['company']} (需要人工介入)`
        level = 'warn'
        break
      case 'cron_complete':
        icon = '📅'
        content = `定时任务完成: ${message.payload['summary'] || message.payload['message']}`
        break
      case 'tool_call':
        icon = '🛠️'
        content = `正在调用工具: ${message.payload['toolName']} (参数: ${JSON.stringify(message.payload['args'])})`
        break
      case 'user_input' as any:
        content = `${message.payload['message']}`
        break
      case 'agent_response' as any:
        icon = '🤖'
        content = `${message.payload['message']}`
        break
      case 'tool_error' as any:
        icon = '🛠️'
        content = `工具错误: ${message.payload['message']}`
        level = 'error'
        break
      case 'tool_warn' as any:
        icon = '🛠️'
        content = `工具警告: ${message.payload['message']}`
        level = 'warn'
        break
      default:
        content = `[${message.type}] ${JSON.stringify(message.payload)}`
    }

    // 处理多行显示
    const lines = content.split('\n')
    lines.forEach((line, index) => {
      if (index === 0) {
        // 第一行带时间、图标
        const fullIcon = icon ? `${icon} ` : ''
        this.logger(`${prefix} ${fullIcon}${line}`, level)
      } else {
        // 后续行缩进对齐，不重复图标和时间
        const indent = ' '.repeat(prefix.length + 1)
        this.logger(`${indent}${line}`, level)
      }
    })
  }
}
