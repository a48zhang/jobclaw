// TUI 通道单元测试 — Team B
import { describe, test, expect, vi } from 'vitest'
import { TUIChannel } from '../../../src/channel/tui'
import type { ChannelMessage } from '../../../src/channel/base'

describe('TUIChannel 构造', () => {
  test('TC-A-01: 提供 callback 后不抛出异常', () => {
    expect(() => new TUIChannel(() => { })).not.toThrow()
  })
})

describe('TUIChannel.send', () => {
  test('TC-A-02: new_job 消息触发 info 日志，分为 Header 和内容两行', async () => {
    const cb = vi.fn((_line: string, _type: string) => { })
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'new_job',
      payload: { company: 'Acme', title: 'SWE' },
      timestamp: new Date('2026-03-07T10:00:00'),
    }

    await channel.send(msg)

    // 现在每条消息至少触发两次 logger (Header + Content)
    expect(cb).toHaveBeenCalledTimes(2)

    const [headerLine, headerType] = (cb as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(headerType).toBe('info')
    expect(headerLine).toContain('System|Job')

    const [contentLine, contentType] = (cb as ReturnType<typeof vi.fn>).mock.calls[1] as [string, string]
    expect(contentType).toBe('info')
    expect(contentLine).toContain('发现新职位')
    expect(contentLine).toContain('Acme')
    expect(contentLine).toContain('SWE')
  })

  test('TC-A-03: tool_error 消息触发 error 日志内容', async () => {
    const cb = vi.fn((_line: string, _type: string) => { })
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'tool_error',
      payload: { message: 'Auth Error' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    // 第二行是正文，应该为 error
    const [, contentType] = (cb as ReturnType<typeof vi.fn>).mock.calls[1] as [string, string]
    expect(contentType).toBe('error')
  })

  test('TC-A-04: cron_complete 消息触发 info 日志内容', async () => {
    const cb = vi.fn((_line: string, _type: string) => { })
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'cron_complete',
      payload: { message: 'done' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    const [, contentType] = (cb as ReturnType<typeof vi.fn>).mock.calls[1] as [string, string]
    expect(contentType).toBe('info')
  })

  test('TC-A-05: cron_complete 显示为 System 标签', async () => {
    const cb = vi.fn((_line: string, _type: string) => { })
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'cron_complete',
      payload: { message: 'Done' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    const [headerLine] = (cb as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string]
    expect(headerLine).toContain('(System)')

    const [contentLine] = (cb as ReturnType<typeof vi.fn>).mock.calls[1] as [string, string]
    expect(contentLine).toContain('任务完成')
    expect(contentLine).toContain('Done')
  })
})
