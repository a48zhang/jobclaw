import nodemailer from 'nodemailer'
import type { Channel, ChannelMessage, ChannelMessageType } from './base'

export interface EmailChannelConfig {
  /** SMTP 主机 */
  smtpHost: string
  /** SMTP 端口 */
  smtpPort: number
  /** 发件人邮箱 */
  from: string
  /** 收件人邮箱 */
  to: string
  /** SMTP 用户名 */
  user: string
  /** SMTP 密码（从环境变量读取，不硬编码） */
  password: string
}

const SUBJECT_MAP: Record<ChannelMessageType, string> = {
  new_job: '【JobClaw】发现新职位',
  delivery_start: '【JobClaw】开始投递',
  delivery_success: '【JobClaw】投递成功',
  delivery_failed: '【JobClaw】投递失败',
  delivery_blocked: '【JobClaw】投递需人工介入',
  cron_complete: '【JobClaw】定时任务完成',
  tool_warn: '【JobClaw】工具运行警告',
  tool_error: '【JobClaw】工具运行错误',
  tool_call: '【JobClaw】工具调用通知',
  agent_response: '【JobClaw】Agent 回复',
  user_input: '【JobClaw】用户输入记录',
}

/** 对字符串做 HTML escape，防止注入 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export class EmailChannel implements Channel {
  private transporter: ReturnType<typeof nodemailer.createTransport>

  constructor(private config: EmailChannelConfig) {
    if (!config.smtpHost) throw new Error('[EmailChannel] 缺少 SMTP_HOST 配置')
    if (!config.smtpPort) throw new Error('[EmailChannel] 缺少 SMTP_PORT 配置')
    if (!config.from) throw new Error('[EmailChannel] 缺少 SMTP_USER (from) 配置')
    if (!config.to) throw new Error('[EmailChannel] 缺少 NOTIFY_EMAIL (to) 配置')
    if (!config.user) throw new Error('[EmailChannel] 缺少 SMTP_USER 配置')
    if (!config.password) throw new Error('[EmailChannel] 缺少 SMTP_PASSWORD 配置')

    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.user,
        pass: config.password,
      },
    })
  }

  async send(message: ChannelMessage): Promise<void> {
    try {
      const subject = this.buildSubject(message)
      const html = this.buildBody(message)
      await this.transporter.sendMail({
        from: this.config.from,
        to: this.config.to,
        subject,
        html,
      })
    } catch (error) {
      console.error(`[EmailChannel] 发送失败 (type=${message.type}, to=${this.config.to}):`, error)
      // 不 rethrow，避免影响 Agent 主流程
    }
  }

  private buildSubject(message: ChannelMessage): string {
    const base = SUBJECT_MAP[message.type] ?? `【JobClaw】${message.type}`
    const { company, title } = message.payload as Record<string, string>
    if (company || title) {
      const parts = [company, title].filter(Boolean).map((s) => escapeHtml(s))
      return `${base} — ${parts.join(' · ')}`
    }
    return base
  }

  private buildBody(message: ChannelMessage): string {
    const rows = Object.entries(message.payload)
      .map(([key, value]) => {
        const safeKey = escapeHtml(String(key))
        const safeValue = escapeHtml(String(value ?? ''))
        return `<tr><td><strong>${safeKey}</strong></td><td>${safeValue}</td></tr>`
      })
      .join('\n')

    return `
<html>
<body>
<h2>${escapeHtml(SUBJECT_MAP[message.type] ?? message.type)}</h2>
<table border="1" cellpadding="4" cellspacing="0">
${rows}
</table>
<p style="color:#888;font-size:12px;">发送时间: ${escapeHtml(message.timestamp.toISOString())}</p>
</body>
</html>`
  }
}
