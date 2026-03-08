import type { Channel, ChannelMessage } from './base'

export class TUIChannel implements Channel {
  private streamingContent: string = ''
  private isStreaming: boolean = false
  private streamStartLines: number = 0

  private lastStreamLineCount: number = 0

  constructor(private logger: (line: string, type: 'info' | 'warn' | 'error') => void, private getRawLog?: () => any) {}

  async send(message: ChannelMessage): Promise<void> {
    const time = message.timestamp.toLocaleTimeString()
    const headerPrefix = `[${time}]`
    let level: 'info' | 'warn' | 'error' = 'info'
    let label = ''
    let content = ''

    // ─── 流式处理逻辑 (Phase 6) ──────────────────────────────────────────────
    if (message.streaming) {
      const logObj = this.getRawLog ? this.getRawLog() : null

      if (message.streaming.isFirst) {
        this.logger(`${headerPrefix} (Agent)`, 'info');
        this.streamingContent = '';
        this.isStreaming = true;
        if (logObj) {
          logObj.log('🤖 '); // 占位
          this.streamStartLines = (logObj as any).getLines().length - 1;
        }
      }

      if (message.streaming.chunk) {
        this.streamingContent += message.streaming.chunk;
      }

      if (logObj && this.isStreaming) {
        const contentLines = ('🤖 ' + this.streamingContent).split('\n');
        contentLines.forEach((l, i) => {
          const targetIdx = this.streamStartLines + i;
          const currentLinesCount = (logObj as any).getLines().length;
          const tagged = `{green-fg}${l}{/}`;
          
          if (targetIdx < currentLinesCount) {
            (logObj as any).setLine(targetIdx, tagged);
          } else {
            logObj.log(tagged);
          }
        });
        
        logObj.setScrollPerc(100);
        logObj.screen.render();
      }

      if (message.streaming.isFinal) {
        this.streamingContent = ''
        this.isStreaming = false
      }
      return
    }

    // ─── 常规消息逻辑 ─────────────────────────────────────────────────────────
    if (message.type === 'tool_output') {
      const text = String(message.payload['message'] || '')
      text.split('\n').forEach(line => {
        if (line.trim()) this.logger(line, 'info')
      })
      return
    }

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
        content = `📅 任务完成: ${message.payload['summary'] || message.payload['message']}`
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
        const toolName = message.payload['toolName']
        label = `tool:${toolName}`
        let argsRaw = String(message.payload['args'] || '')
        if (toolName === 'write_file' || toolName === 'append_file') {
          try {
            const argsObj = JSON.parse(argsRaw)
            const targetKey = toolName === 'write_file' ? 'new_string' : 'content'
            const targetText = argsObj[targetKey]
            if (typeof targetText === 'string') {
              const lines = targetText.split('\n')
              if (lines.length > 10) {
                const folded = [...lines.slice(0, 3), `... (已折叠 ${lines.length - 6} 行) ...`, ...lines.slice(-3)].join('\n')
                argsObj[targetKey] = folded
                argsRaw = JSON.stringify(argsObj, null, 2)
              }
            }
          } catch {}
        }
        content = `🛠️ 正在执行 (参数: ${argsRaw})`
        break
      case 'tool_error':
        label = `tool:error`
        content = `❌ 🛠️ 失败: ${message.payload['message']}`
        level = 'error'
        break
      default:
        label = message.type
        content = JSON.stringify(message.payload)
    }

    this.logger(`${headerPrefix} (${label})`, 'info')
    content.split('\n').forEach((line) => {
      this.logger(line, level)
    })
  }
}
