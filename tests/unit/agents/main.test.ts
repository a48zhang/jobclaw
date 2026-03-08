// MainAgent 单元测试
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test'
import { MainAgent, type MainAgentConfig, type IDeliveryAgent } from '../../../src/agents/main/index'
import type { AgentSnapshot } from '../base/types'
import type { Channel, ChannelMessage } from '../../channel/base'
import OpenAI from 'openai'
import * as fs from 'node:fs'
import * as path from 'node:path'

// ============================================================================
// Helpers / Mocks
// ============================================================================

const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../../workspace')

/** 创建 Mock OpenAI，默认直接返回 stop */
const createMockOpenAI = (overrideFn?: () => Promise<OpenAI.Chat.Completions.ChatCompletion>) => {
  return {
    chat: {
      completions: {
        create: mock(
          overrideFn ??
            (() =>
              Promise.resolve({
                choices: [
                  {
                    message: {
                      content: '任务完成',
                      tool_calls: null,
                    },
                  },
                ],
              }))
        ),
      },
    },
  } as unknown as OpenAI
}

/** 创建 Mock DeliveryAgent */
const createMockDeliveryAgent = (
  runFn?: () => Promise<string>
): IDeliveryAgent & { runEphemeral: ReturnType<typeof mock> } => {
  return {
    run: mock(runFn ?? (() => Promise.resolve('已投递 2 个职位'))),
    getState: mock(
      (): AgentSnapshot => ({
        agentName: 'delivery',
        state: 'idle',
        iterations: 0,
        tokenCount: 0,
        lastAction: '',
        currentTask: null,
      })
    ),
    runEphemeral: mock(runFn ?? (() => Promise.resolve('已投递 2 个职位'))),
  }
}

/** 创建 Mock Channel */
const createMockChannel = (): Channel & { send: ReturnType<typeof mock> } => {
  return {
    send: mock((_msg: ChannelMessage) => Promise.resolve()),
  }
}

/** 基础配置工厂（默认使用 main-test 避免污染真实 session） */
const createConfig = (overrides: Partial<MainAgentConfig> = {}): MainAgentConfig => ({
  openai: createMockOpenAI(),
  agentName: 'main-test',
  model: 'gpt-4o',
  workspaceRoot: TEST_WORKSPACE,
  deliveryAgent: createMockDeliveryAgent(),
  ...overrides,
})

/** 类型安全地调用 MainAgent 的 protected onToolResult */
const callOnToolResult = (
  agent: MainAgent,
  toolName: string,
  result: { success: boolean; content: string }
) =>
  (agent as unknown as { onToolResult(n: string, r: typeof result): Promise<void> }).onToolResult(
    toolName,
    result
  )

// ============================================================================
// 测试套件
// ============================================================================

describe('MainAgent', () => {
  let agent: MainAgent

  beforeEach(() => {
    agent = new MainAgent(createConfig())
  })

  afterEach(() => {
    // 清理测试产生的 session 文件（使用 main-test 避免污染真实 main session）
    const sessionPath = path.join(TEST_WORKSPACE, 'agents', 'main-test', 'session.json')
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
    }
  })

  // --------------------------------------------------------------------------
  // TC-A-01: 正常实例化
  // --------------------------------------------------------------------------
  describe('TC-A-01: 实例化', () => {
    test('不带 channel 时正常实例化', () => {
      const a = new MainAgent(createConfig({ agentName: 'main' }))
      expect(a.agentName).toBe('main')
      expect(a.getState().state).toBe('idle')
    })

    test('带 channel 时正常实例化', () => {
      const channel = createMockChannel()
      const a = new MainAgent(createConfig({ agentName: 'main', channel }))
      expect(a.agentName).toBe('main')
      expect(a.getState().state).toBe('idle')
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-02: getAvailableTools
  // --------------------------------------------------------------------------
  describe('TC-A-02: getAvailableTools', () => {
    test('包含 run_delivery_agent', async () => {
      const tools = await agent.getAvailableTools()
      const names = tools.map((t) => t.function.name)
      expect(names).toContain('run_delivery_agent')
    })

    test('不包含 run_search_agent', async () => {
      const tools = await agent.getAvailableTools()
      const names = tools.map((t) => t.function.name)
      expect(names).not.toContain('run_search_agent')
    })

    test('包含所有 BaseAgent 文件工具', async () => {
      const tools = await agent.getAvailableTools()
      const names = tools.map((t) => t.function.name)
      expect(names).toContain('read_file')
      expect(names).toContain('write_file')
      expect(names).toContain('append_file')
      expect(names).toContain('list_directory')
      expect(names).toContain('lock_file')
      expect(names).toContain('unlock_file')
    })

    test('重复调用不会重复添加 run_delivery_agent', async () => {
      await agent.getAvailableTools()
      const tools = await agent.getAvailableTools()
      const count = tools.filter((t) => t.function.name === 'run_delivery_agent').length
      expect(count).toBe(1)
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-03: run_delivery_agent 工具调用转发给 DeliveryAgent
  // --------------------------------------------------------------------------
  describe('TC-A-03: run_delivery_agent 转发', () => {
    test('调用 run_delivery_agent 时转发给 deliveryAgent.runEphemeral', async () => {
      const mockDelivery = createMockDeliveryAgent(() => Promise.resolve('已投递 2 个职位'))

      // mock OpenAI: 第一次返回 tool_call，第二次返回 stop
      let callCount = 0
      const mockOpenAI = createMockOpenAI(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_001',
                      type: 'function' as const,
                      function: {
                        name: 'run_delivery_agent',
                        arguments: JSON.stringify({ instruction: '投递所有 discovered 职位' }),
                      },
                    },
                  ],
                },
              },
            ],
          })
        }
        return Promise.resolve({
          choices: [{ message: { content: '投递完成', tool_calls: null } }],
        })
      })

      const a = new MainAgent(createConfig({ openai: mockOpenAI, deliveryAgent: mockDelivery }))
      await a.run('帮我投递所有待投递职位')

      expect(mockDelivery.runEphemeral).toHaveBeenCalledTimes(1)
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-04: DeliveryAgent 抛出异常时不崩溃
  // --------------------------------------------------------------------------
  describe('TC-A-04: DeliveryAgent 异常处理', () => {
    test('deliveryAgent 抛出异常时 agent.run() 正常返回', async () => {
      const mockDelivery = createMockDeliveryAgent()
      ;(mockDelivery.runEphemeral as ReturnType<typeof mock>).mockImplementation(() =>
        Promise.reject(new Error('网络超时'))
      )

      let callCount = 0
      const mockOpenAI = createMockOpenAI(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            choices: [
              {
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'call_002',
                      type: 'function' as const,
                      function: {
                        name: 'run_delivery_agent',
                        arguments: JSON.stringify({ instruction: '投递' }),
                      },
                    },
                  ],
                },
              },
            ],
          })
        }
        return Promise.resolve({
          choices: [{ message: { content: '投递失败，已记录', tool_calls: null } }],
        })
      })

      const a = new MainAgent(createConfig({ openai: mockOpenAI, deliveryAgent: mockDelivery }))
      // 不应 throw
      const result = await a.run('投递职位')
      expect(typeof result).toBe('string')
      expect(a.getState().state).toBe('idle')
    })
  })

  /*
  // --------------------------------------------------------------------------
  // TC-A-05: onToolResult - append_file + discovered → channel.send new_job
  // --------------------------------------------------------------------------
  describe('TC-A-05: onToolResult 发送 Channel 通知', () => {
    test('append_file 包含 discovered 行时发送 new_job 通知', async () => {
      const mockChannel = createMockChannel()
      const a = new MainAgent(createConfig({ channel: mockChannel }))

      const result = {
        success: true,
        content:
          '已追加到 data/jobs.md\n| ByteDance | 前端工程师 | https://jobs.bytedance.com/1234 | discovered | |',
      }

      await callOnToolResult(a, 'append_file', result)

      expect(mockChannel.send).toHaveBeenCalledTimes(1)
      const sentMsg = (mockChannel.send as ReturnType<typeof mock>).mock.calls[0]?.[0] as ChannelMessage
      expect(sentMsg.type).toBe('new_job')
      expect(sentMsg.payload.company).toBe('ByteDance')
      expect(sentMsg.payload.title).toBe('前端工程师')
      expect(sentMsg.payload.url).toBe('https://jobs.bytedance.com/1234')
    })

    test('非 discovered 行不发送通知', async () => {
      const mockChannel = createMockChannel()
      const a = new MainAgent(createConfig({ channel: mockChannel }))

      const result = {
        success: true,
        content: '已追加到 data/jobs.md\n| ByteDance | 前端工程师 | https://jobs.bytedance.com/1234 | applied | |',
      }

      await callOnToolResult(a, 'append_file', result)

      expect(mockChannel.send).not.toHaveBeenCalled()
    })

    test('多个 discovered 行时发送多条通知', async () => {
      const mockChannel = createMockChannel()
      const a = new MainAgent(createConfig({ channel: mockChannel }))

      const result = {
        success: true,
        content: [
          '已追加到 data/jobs.md',
          '| ByteDance  |  前端工程师  |  https://jobs.bytedance.com/1234  | discovered |',
          '|  Tencent  |  后端工程师  |  https://careers.tencent.com/5678  |  discovered  |  |',
        ].join('\n'),
      }

      await callOnToolResult(a, 'append_file', result)

      expect(mockChannel.send).toHaveBeenCalledTimes(2)
    })

    test('列间多余空格不影响匹配（对齐格式）', async () => {
      const mockChannel = createMockChannel()
      const a = new MainAgent(createConfig({ channel: mockChannel }))

      // 故意使用多余空格对齐的 Markdown 表格行
      const result = {
        success: true,
        content:
          '|  ByteDance  |  前端工程师  |  https://jobs.bytedance.com/1234  |  discovered  |  |',
      }

      await callOnToolResult(a, 'append_file', result)

      expect(mockChannel.send).toHaveBeenCalledTimes(1)
      const sentMsg = (mockChannel.send as ReturnType<typeof mock>).mock.calls[0]?.[0] as ChannelMessage
      expect(sentMsg.payload.company).toBe('ByteDance')
      expect(sentMsg.payload.url).toBe('https://jobs.bytedance.com/1234')
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-06: onToolResult - 无 channel 时不崩溃
  // --------------------------------------------------------------------------
  describe('TC-A-06: onToolResult 无 channel 时安全', () => {
    test('无 channel 时 onToolResult 不抛出异常', async () => {
      const a = new MainAgent(createConfig()) // 不带 channel

      const result = {
        success: true,
        content:
          '| ByteDance | 前端工程师 | https://jobs.bytedance.com/1234 | discovered | |',
      }

      await expect(callOnToolResult(a, 'append_file', result)).resolves.toBeUndefined()
    })
  })
  */

  // --------------------------------------------------------------------------
  // TC-A-07: runEphemeral 不修改 session.json
  // --------------------------------------------------------------------------
  describe('TC-A-07: runEphemeral 不写入 session', () => {
    test('runEphemeral 不修改 session.json 内容', async () => {
      // 使用独立的 agentName 确保测试隔离
      const testAgent = new MainAgent(createConfig({ agentName: 'main-ephemeral-test' }))
      const sessionPath = path.join(TEST_WORKSPACE, 'agents', 'main-ephemeral-test', 'session.json')

      // 确保目录存在并写入初始 session
      const sessionDir = path.dirname(sessionPath)
      if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })
      const initialContent = JSON.stringify({ currentTask: null, context: {}, messages: [], todos: [] })
      fs.writeFileSync(sessionPath, initialContent, 'utf-8')

      try {
        await testAgent.runEphemeral('搜索新职位')

        const afterContent = fs.readFileSync(sessionPath, 'utf-8')
        expect(afterContent).toBe(initialContent)
      } finally {
        // 清理
        if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath)
      }
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-08: runEphemeral 执行后恢复原有 messages
  // --------------------------------------------------------------------------
  describe('TC-A-08: runEphemeral 恢复 messages', () => {
    test('执行完毕后 messages 恢复为执行前的值', async () => {
      const existingMsg = { role: 'user' as const, content: '之前的消息' }
      ;(agent as unknown as { messages: typeof existingMsg[] }).messages = [existingMsg]

      await agent.runEphemeral('临时任务')

      const messages = (agent as unknown as { messages: typeof existingMsg[] }).messages
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content).toBe('之前的消息')
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-09-a: runEphemeral 超时时抛出 timeout 错误并恢复消息
  // --------------------------------------------------------------------------
  describe('TC-A-09-a: runEphemeral 超时', () => {
    test('超时时抛出包含 timed out 的错误，并恢复消息', async () => {
      // Mock OpenAI 永不返回
      const hangingOpenAI = {
        chat: {
          completions: {
            create: mock(() => new Promise(() => {})), // 永远 pending
          },
        },
      } as unknown as OpenAI

      const existingMsg = { role: 'user' as const, content: '已有消息' }
      const a = new MainAgent(createConfig({ openai: hangingOpenAI }))
      ;(a as unknown as { messages: typeof existingMsg[] }).messages = [existingMsg]

      await expect(a.runEphemeral('任务', { timeoutMs: 100 })).rejects.toThrow(/timed out/)

      // 消息应恢复
      const messages = (a as unknown as { messages: typeof existingMsg[] }).messages
      expect(messages).toHaveLength(1)
      expect(messages[0]?.content).toBe('已有消息')
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-09-b: spawnAgent 子 Agent 超时时返回失败字符串
  // --------------------------------------------------------------------------
  describe('TC-A-09-b: spawnAgent 超时返回失败字符串', () => {
    test('子 Agent runEphemeral 抛出时返回 [子任务失败] 字符串', async () => {
      const hangingDelivery = createMockDeliveryAgent()
      ;(hangingDelivery.runEphemeral as ReturnType<typeof mock>).mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 50))
      )

      const a = new MainAgent(createConfig({ deliveryAgent: hangingDelivery }))
      const result = await (
        a as unknown as {
          spawnAgent(agent: IDeliveryAgent, prompt: string, opts: object): Promise<string>
        }
      ).spawnAgent(hangingDelivery, '投递', { timeoutMs: 200 })

      expect(result).toContain('[子任务失败]')
      expect(typeof result).toBe('string')
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-09-c/d: loadSkill 优先级
  // --------------------------------------------------------------------------
  describe('TC-A-09-c/d: loadSkill 优先级', () => {
    const skillsUserDir = path.join(TEST_WORKSPACE, 'skills')
    const testSkillFile = path.join(skillsUserDir, 'test-skill.md')

    afterEach(() => {
      if (fs.existsSync(testSkillFile)) fs.unlinkSync(testSkillFile)
    })

    test('workspace/skills/ 中的版本优先于代码级版本', () => {
      if (!fs.existsSync(skillsUserDir)) fs.mkdirSync(skillsUserDir, { recursive: true })
      fs.writeFileSync(testSkillFile, 'custom skill content', 'utf-8')

      const content = (
        agent as unknown as { loadSkill(name: string): string }
      ).loadSkill('test-skill')
      expect(content).toBe('custom skill content')
    })

    test('无用户版本时返回代码级版本', () => {
      // jobclaw-skills.md 在代码中存在
      const content = (
        agent as unknown as { loadSkill(name: string): string }
      ).loadSkill('jobclaw-skills')
      expect(content.length).toBeGreaterThan(0)
      expect(content).toContain('搜索职位 SOP')
    })

    test('两者均不存在时返回空字符串', () => {
      const content = (
        agent as unknown as { loadSkill(name: string): string }
      ).loadSkill('nonexistent-skill')
      expect(content).toBe('')
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-09: systemPrompt 包含必要关键词
  // --------------------------------------------------------------------------
  describe('TC-A-09: systemPrompt 关键词', () => {
    test('systemPrompt 包含所有必要关键词', () => {
      const prompt = (agent as unknown as { systemPrompt: string }).systemPrompt
      expect(prompt).toContain('run_delivery_agent')
      expect(prompt).toContain('jobs.md')
      expect(prompt).toContain('upsert_job')
      expect(prompt).toContain('discovered')
      expect(prompt).toContain('targets.md')
    })

    /*
    test('systemPrompt 包含 [FOUND: N] 统计标记说明', () => {
      const prompt = (agent as unknown as { systemPrompt: string }).systemPrompt
      expect(prompt).toContain('[FOUND:')
    })
    */

    test('未提供 mcpClient 时 systemPrompt 包含 MCP 警告', () => {
      // createConfig 默认不传 mcpClient
      const a = new MainAgent(createConfig())
      const prompt = (a as unknown as { systemPrompt: string }).systemPrompt
      expect(prompt).toContain('MCP 未连接')
    })

    test('提供 mcpClient 时 systemPrompt 不包含 MCP 警告', () => {
      const mockMcpClient = {
        listTools: mock(() => Promise.resolve([])),
        callTool: mock(() => Promise.resolve('')),
      }
      const a = new MainAgent(createConfig({ mcpClient: mockMcpClient }))
      const prompt = (a as unknown as { systemPrompt: string }).systemPrompt
      expect(prompt).not.toContain('MCP 未连接')
    })
  })

  // --------------------------------------------------------------------------
  // TC-A-10: extractContext / restoreContext
  // --------------------------------------------------------------------------
  describe('TC-A-10: extractContext / restoreContext', () => {
    test('能保存和恢复 lastCronAt', () => {
      const testDate = '2026-03-07T12:00:00.000Z'
      ;(agent as unknown as { lastCronAt: string }).lastCronAt = testDate

      const context = (
        agent as unknown as { extractContext(): Record<string, unknown> }
      ).extractContext()
      expect(context.lastCronAt).toBe(testDate)

      // 重置再恢复
      ;(agent as unknown as { lastCronAt: string | null }).lastCronAt = null
      ;(agent as unknown as { restoreContext(c: typeof context): void }).restoreContext(context)

      expect((agent as unknown as { lastCronAt: string }).lastCronAt).toBe(testDate)
    })

    test('lastCronAt 为 null 时正常处理', () => {
      const context = (
        agent as unknown as { extractContext(): Record<string, unknown> }
      ).extractContext()
      expect(context.lastCronAt).toBeNull()
    })
  })
})
