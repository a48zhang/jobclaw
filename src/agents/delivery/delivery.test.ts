// src/agents/delivery/delivery.test.ts

import { describe, test, expect, beforeEach, mock } from 'bun:test'

// Mock gpt-tokenizer before any imports that depend on it
mock.module('gpt-tokenizer', () => ({
  encode: (text: string) => new Array(Math.ceil(text.length / 4)).fill(0),
}))

import { DeliveryAgent } from './index'
import type { DeliveryAgentConfig } from './index'
import type { Channel, ChannelMessage } from '../../channel/base'
import OpenAI from 'openai'
import * as path from 'node:path'

// Mock OpenAI
const createMockOpenAI = () => {
  return {
    chat: {
      completions: {
        create: mock(() =>
          Promise.resolve({
            choices: [
              {
                message: {
                  content: '投递完成',
                  tool_calls: null,
                },
              },
            ],
          })
        ),
      },
    },
  } as unknown as OpenAI
}

// Mock Channel
const createMockChannel = (): Channel & { sentMessages: ChannelMessage[] } => {
  const sentMessages: ChannelMessage[] = []
  return {
    sentMessages,
    send: mock(async (message: ChannelMessage) => {
      sentMessages.push(message)
    }),
  }
}

const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../../workspace')

const createConfig = (channel: Channel): DeliveryAgentConfig => ({
  openai: createMockOpenAI(),
  agentName: 'delivery',
  model: 'gpt-4o',
  workspaceRoot: TEST_WORKSPACE,
  channel,
})

describe('DeliveryAgent', () => {
  let mockChannel: ReturnType<typeof createMockChannel>
  let agent: DeliveryAgent

  beforeEach(() => {
    mockChannel = createMockChannel()
    agent = new DeliveryAgent(createConfig(mockChannel))
  })

  // TC-C-01: DeliveryAgent 正常实例化
  test('TC-C-01: 正常实例化，agentName === delivery', () => {
    expect(agent).toBeDefined()
    expect(agent.agentName).toBe('delivery')
  })

  // TC-C-02: onToolResult - write_file jobs.md applied → 发送 delivery_success
  test('TC-C-02: write_file applied → channel.send delivery_success', async () => {
    await (agent as unknown as { onToolResult(t: string, r: unknown): Promise<void> }).onToolResult('write_file', {
      success: true,
      content: '| Acme Corp | SWE | https://acme.com/j/1 | applied | 2026-03-07 14:30 |',
    })

    expect(mockChannel.send).toHaveBeenCalledTimes(1)
    const msg = mockChannel.sentMessages[0]
    expect(msg.type).toBe('delivery_success')
    expect(msg.payload.company).toBe('Acme Corp')
    expect(msg.payload.status).toBe('applied')
  })

  // TC-C-03: onToolResult - write_file jobs.md failed → 发送 delivery_failed
  test('TC-C-03: write_file failed → channel.send delivery_failed', async () => {
    await (agent as unknown as { onToolResult(t: string, r: unknown): Promise<void> }).onToolResult('write_file', {
      success: true,
      content: '| Foo Inc | Backend Dev | https://foo.com/j/2 | failed | 2026-03-07 15:00 |',
    })

    expect(mockChannel.send).toHaveBeenCalledTimes(1)
    expect(mockChannel.sentMessages[0].type).toBe('delivery_failed')
  })

  // TC-C-04: onToolResult - write_file jobs.md login_required → 发送 delivery_blocked
  test('TC-C-04: write_file login_required → channel.send delivery_blocked', async () => {
    await (agent as unknown as { onToolResult(t: string, r: unknown): Promise<void> }).onToolResult('write_file', {
      success: true,
      content: '| Bar LLC | PM | https://bar.com/j/3 | login_required | 2026-03-07 16:00 |',
    })

    expect(mockChannel.send).toHaveBeenCalledTimes(1)
    expect(mockChannel.sentMessages[0].type).toBe('delivery_blocked')
  })

  // TC-C-05: onToolResult - read_file → channel.send 不被调用
  test('TC-C-05: read_file → channel.send 不被调用', async () => {
    await (agent as unknown as { onToolResult(t: string, r: unknown): Promise<void> }).onToolResult('read_file', {
      success: true,
      content: '# jobs.md content',
    })

    expect(mockChannel.send).not.toHaveBeenCalled()
  })

  // TC-C-06: onToolResult - write_file 失败 → channel.send 不被调用
  test('TC-C-06: write_file 失败 → channel.send 不被调用', async () => {
    await (agent as unknown as { onToolResult(t: string, r: unknown): Promise<void> }).onToolResult('write_file', {
      success: false,
      content: '',
      error: '锁争抢',
    })

    expect(mockChannel.send).not.toHaveBeenCalled()
  })

  // TC-C-07: onToolResult - browser_navigate 成功 → 发送 delivery_start
  test('TC-C-07: browser_navigate 成功 → channel.send delivery_start', async () => {
    await (agent as unknown as { onToolResult(t: string, r: unknown): Promise<void> }).onToolResult('browser_navigate', {
      success: true,
      content: '已导航至 https://acme.com/jobs/123',
    })

    expect(mockChannel.send).toHaveBeenCalledTimes(1)
    expect(mockChannel.sentMessages[0].type).toBe('delivery_start')
  })

  // TC-C-08: channel.send 抛出异常时不影响后续执行
  test('TC-C-08: channel.send 抛出异常时不影响执行', async () => {
    const throwingChannel: Channel = {
      send: mock(async () => {
        throw new Error('邮件发送失败')
      }),
    }
    const throwingAgent = new DeliveryAgent(createConfig(throwingChannel))

    await expect(
      (throwingAgent as unknown as { onToolResult(t: string, r: unknown): Promise<void> }).onToolResult('write_file', {
        success: true,
        content: '| Acme Corp | SWE | https://acme.com/j/1 | applied | 2026-03-07 14:30 |',
      })
    ).resolves.toBeUndefined()
  })

  // TC-C-09: systemPrompt 包含必要关键词
  test('TC-C-09: systemPrompt 包含必要关键词', () => {
    const prompt = (agent as unknown as { systemPrompt: string }).systemPrompt
    expect(prompt).toContain('jobs.md')
    expect(prompt).toContain('userinfo.md')
    expect(prompt).toContain('lock_file')
    expect(prompt).toContain('write_file')
    expect(prompt).toContain('applied')
    expect(prompt).toContain('failed')
    expect(prompt).toContain('login_required')
  })

  // TC-C-10: extractContext / restoreContext 保存恢复已投递 URL
  test('TC-C-10: extractContext / restoreContext 保存恢复已投递 URL', () => {
    const agentInternal = agent as unknown as {
      deliveredUrls: Set<string>
      extractContext(): Record<string, unknown>
      restoreContext(ctx: Record<string, unknown>): void
    }

    agentInternal.deliveredUrls.add('https://acme.com/j/1')

    const context = agentInternal.extractContext()
    expect(context.deliveredUrls).toContain('https://acme.com/j/1')

    const newAgent = new DeliveryAgent(createConfig(mockChannel))
    const newAgentInternal = newAgent as unknown as {
      deliveredUrls: Set<string>
      restoreContext(ctx: Record<string, unknown>): void
    }

    newAgentInternal.restoreContext(context)
    expect(newAgentInternal.deliveredUrls.has('https://acme.com/j/1')).toBe(true)
  })
})
