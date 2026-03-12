// Channel 单元测试 — Team B
import { describe, test, expect, beforeEach, vi } from 'vitest'
import type { Channel, ChannelMessage } from '../../../src/channel/base'
import { EmailChannel } from '../../../src/channel/email'
import type { EmailChannelConfig } from '../../../src/channel/email'

// ─── TC-B-01: Channel 接口类型检查 ─────────────────────────────────────────
describe('Channel 接口', () => {
  test('TC-B-01: MockChannel 可实现 Channel 接口，TypeScript 编译通过', () => {
    const messages: ChannelMessage[] = []

    // 匿名类实现 Channel 接口
    const mockChannel: Channel = {
      send: async (msg: ChannelMessage) => {
        messages.push(msg)
      },
    }

    const msg: ChannelMessage = {
      type: 'new_job',
      payload: { company: 'Acme', title: 'SWE', url: 'https://acme.com/jobs/1' },
      timestamp: new Date(),
    }

    expect(() => mockChannel.send(msg)).not.toThrow()
  })
})

// ─── 构造有效配置的辅助工厂 ────────────────────────────────────────────────
const makeConfig = (overrides: Partial<EmailChannelConfig> = {}): EmailChannelConfig => ({
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  from: 'noreply@example.com',
  to: 'user@example.com',
  user: 'noreply@example.com',
  password: 'secret',
  ...overrides,
})

// ─── TC-B-02: EmailChannel 正常实例化 ──────────────────────────────────────
describe('EmailChannel 构造', () => {
  test('TC-B-02: 有效配置不抛出异常', () => {
    expect(() => new EmailChannel(makeConfig())).not.toThrow()
  })

  test('缺少 smtpHost 时抛出明确错误', () => {
    expect(() => new EmailChannel(makeConfig({ smtpHost: '' }))).toThrow(/SMTP_HOST/)
  })

  test('缺少 password 时抛出明确错误', () => {
    expect(() => new EmailChannel(makeConfig({ password: '' }))).toThrow(/SMTP_PASSWORD/)
  })
})

// ─── TC-B-03 / TC-B-04: send() 调用 SMTP，失败时不抛出 ────────────────────
describe('EmailChannel.send', () => {
  let sendMailMock: ReturnType<typeof vi.fn>
  let channel: EmailChannel

  beforeEach(() => {
    sendMailMock = vi.fn(() => Promise.resolve({ messageId: 'test-id' }))

    channel = new EmailChannel(makeConfig())
    // 替换内部 transporter 的 sendMail
    ;(channel as unknown as { transporter: { sendMail: unknown } }).transporter.sendMail =
      sendMailMock
  })

  test('TC-B-03: 发送 new_job 消息，sendMail 被调用一次，subject 包含公司或职位名', async () => {
    const msg: ChannelMessage = {
      type: 'new_job',
      payload: { company: 'Acme', title: 'SWE', url: 'https://acme.com/jobs/1' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    expect(sendMailMock).toHaveBeenCalledTimes(1)
    const callArg = (sendMailMock.mock.calls[0] as unknown[])[0] as { subject: string }
    expect(callArg.subject).toMatch(/Acme|SWE/)
  })

  test('TC-B-04: SMTP 抛出 ECONNREFUSED 时 send() 不抛出异常', async () => {
    sendMailMock = vi.fn(() => {
      const err = new Error('connect ECONNREFUSED')
      ;(err as NodeJS.ErrnoException).code = 'ECONNREFUSED'
      return Promise.reject(err)
    })
    ;(channel as unknown as { transporter: { sendMail: unknown } }).transporter.sendMail =
      sendMailMock

    const msg: ChannelMessage = {
      type: 'delivery_success',
      payload: { company: 'Acme', title: 'SWE', url: 'https://acme.com', time: new Date().toISOString() },
      timestamp: new Date(),
    }

    // 不应该抛出
    await expect(channel.send(msg)).resolves.toBeUndefined()
  })
})

// ─── TC-B-05: buildBody HTML escape ────────────────────────────────────────
describe('EmailChannel buildBody HTML escape', () => {
  test('TC-B-05: payload 中的 XSS 字符串被正确 escape', async () => {
    const sendMailMock = vi.fn(() => Promise.resolve({ messageId: 'test-id' }))
    const channel = new EmailChannel(makeConfig())
    ;(channel as unknown as { transporter: { sendMail: unknown } }).transporter.sendMail =
      sendMailMock

    const msg: ChannelMessage = {
      type: 'new_job',
      payload: {
        company: '<script>alert(1)</script>',
        title: 'SWE',
        url: 'https://example.com',
      },
      timestamp: new Date(),
    }

    await channel.send(msg)

    const callArg = (sendMailMock.mock.calls[0] as unknown[])[0] as { html: string }
    expect(callArg.html).toContain('&lt;script&gt;')
    expect(callArg.html).not.toContain('<script>')
  })
})
