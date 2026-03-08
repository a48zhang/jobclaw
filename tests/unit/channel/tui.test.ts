// TUIChannel 单元测试 — Phase 4 Team A
import { describe, test, expect, mock } from 'bun:test'
import { TUIChannel } from '../../../src/channel/tui'
import type { TUILogCallback } from '../../../src/channel/tui'
import type { ChannelMessage } from '../../../src/channel/base'

// ─── TC-A-01: TUIChannel 实例化 ───────────────────────────────────────────────
describe('TUIChannel 构造', () => {
  test('TC-A-01: 提供 callback 后不抛出异常', () => {
    const cb: TUILogCallback = mock(() => {})
    expect(() => new TUIChannel(cb)).not.toThrow()
  })
})

// ─── TC-A-02: send() 调用 callback ────────────────────────────────────────────
describe('TUIChannel.send', () => {
  test('TC-A-02: new_job 消息触发 info 日志，包含公司和职位', async () => {
    const cb: TUILogCallback = mock(() => {})
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'new_job',
      payload: { company: 'Acme', title: 'SWE', url: 'https://acme.com/jobs/1' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    expect(cb).toHaveBeenCalledTimes(1)
    const [line, type] = (cb as ReturnType<typeof mock>).mock.calls[0] as [string, string]
    expect(type).toBe('info')
    expect(line).toContain('new_job')
    expect(line).toContain('Acme')
    expect(line).toContain('SWE')
  })

  test('TC-A-03: delivery_failed 消息触发 error 日志', async () => {
    const cb: TUILogCallback = mock(() => {})
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'delivery_failed',
      payload: { company: 'Acme', title: 'SWE', url: 'https://acme.com' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    const [, type] = (cb as ReturnType<typeof mock>).mock.calls[0] as [string, string]
    expect(type).toBe('error')
  })

  test('TC-A-04: delivery_blocked 消息触发 warn 日志', async () => {
    const cb: TUILogCallback = mock(() => {})
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'delivery_blocked',
      payload: { company: 'Acme', title: 'SWE', url: 'https://acme.com' },
      timestamp: new Date(),
    }

    await channel.send(msg)

    const [, type] = (cb as ReturnType<typeof mock>).mock.calls[0] as [string, string]
    expect(type).toBe('warn')
  })

  test('TC-A-05: 无公司/职位时仍输出包含 type 的日志行', async () => {
    const cb: TUILogCallback = mock(() => {})
    const channel = new TUIChannel(cb)

    const msg: ChannelMessage = {
      type: 'cron_complete',
      payload: {},
      timestamp: new Date(),
    }

    await channel.send(msg)

    const [line] = (cb as ReturnType<typeof mock>).mock.calls[0] as [string, string]
    expect(line).toContain('cron_complete')
  })
})
