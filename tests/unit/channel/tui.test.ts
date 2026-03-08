// TUI 通道单元测试 — Team B
import { describe, test, expect, mock } from 'bun:test'
import { TUIChannel } from '../../../src/channel/tui'
import type { ChannelMessage } from '../../../src/channel/base'

describe('TUIChannel 构造', () => {
  test('TC-A-01: 提供 callback 后不抛出异常', () => {
    expect(() => new TUIChannel(() => {})).not.toThrow()
  })
})

describe('TUIChannel.send', () => {
  test('TC-A-02: new_job 消息触发 info 日志，包含公司和职位', async () => {
    const cb = mock((_line: string, _type: string) => {})
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'new_job',
      payload: { company: 'Acme', title: 'SWE' },
      timestamp: new Date('2026-03-07T10:00:00'),
    }

    await channel.send(msg)

    expect(cb).toHaveBeenCalledTimes(1)
    const [line, type] = (cb as ReturnType<typeof mock>).mock.calls[0] as [string, string]
    expect(type).toBe('info')
    expect(line).toContain('发现新职位')
    expect(line).toContain('Acme')
    expect(line).toContain('SWE')
  })

  test('TC-A-03: delivery_failed 消息触发 error 日志', async () => {
    const cb = mock((_line: string, _type: string) => {})
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'delivery_failed',
      payload: { company: 'Acme', reason: 'Auth Error' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    const [, type] = (cb as ReturnType<typeof mock>).mock.calls[0] as [string, string]
    expect(type).toBe('error')
  })

  test('TC-A-04: delivery_blocked 消息触发 warn 日志', async () => {
    const cb = mock((_line: string, _type: string) => {})
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'delivery_blocked',
      payload: { company: 'Acme' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    const [, type] = (cb as ReturnType<typeof mock>).mock.calls[0] as [string, string]
    expect(type).toBe('warn')
  })

  test('TC-A-05: 无公司/职位时仍输出包含内容的日志行', async () => {
    const cb = mock((_line: string, _type: string) => {})
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'cron_complete',
      payload: { message: 'Done' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    const [line] = (cb as ReturnType<typeof mock>).mock.calls[0] as [string, string]
    expect(line).toContain('定时任务完成')
    expect(line).toContain('Done')
  })
})
