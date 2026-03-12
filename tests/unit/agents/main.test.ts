// MainAgent 单元测试
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { MainAgent, type MainAgentConfig, type IDeliveryAgent } from '../../../src/agents/main/index'
import type { AgentSnapshot } from '../base/types'
import type { Channel, ChannelMessage } from '../../channel/base'
import OpenAI from 'openai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus } from '../../../src/eventBus'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// ============================================================================
// Helpers / Mocks
// ============================================================================

const TEST_WORKSPACE = path.resolve(__dirname, '../../../workspace')

/** 创建 Mock OpenAI，支持多轮响应数组并兼容流式 */
const createMockOpenAI = (responses: (string | { content: string | null; tool_calls?: any[] })[] | string = '任务完成') => {
  let callCount = 0
  const respArray = Array.isArray(responses) ? responses : [responses]

  return {
    chat: {
      completions: {
        create: vi.fn((params: any) => {
          const rawResp = respArray[callCount] || respArray[respArray.length - 1]
          callCount++
          const resp = typeof rawResp === 'string' ? { content: rawResp, tool_calls: null } : rawResp

          if (params.stream) {
            return (async function* () {
              yield {
                choices: [{
                  delta: {
                    content: resp.content || undefined,
                    tool_calls: resp.tool_calls?.map((tc, i) => ({
                      index: i,
                      id: tc.id,
                      function: tc.function
                    })),
                  },
                }],
              }
            })()
          }
          return Promise.resolve({
            choices: [{
              message: { content: resp.content, tool_calls: resp.tool_calls || null },
            }],
          })
        }),
      },
    },
  } as unknown as OpenAI
}

/** 创建 Mock DeliveryAgent */
const createMockDeliveryAgent = (
  runFn?: () => Promise<string>
): IDeliveryAgent & { runEphemeral: ReturnType<typeof vi.fn> } => {
  return {
    run: vi.fn(runFn ?? (() => Promise.resolve('已投递 2 个职位'))),
    getState: vi.fn(
      (): AgentSnapshot => ({
        agentName: 'delivery',
        state: 'idle',
        iterations: 0,
        tokenCount: 0,
        lastAction: '',
        currentTask: null,
      })
    ),
    runEphemeral: vi.fn(runFn ?? (() => Promise.resolve('已投递 2 个职位'))),
  }
}

/** 创建 Mock Channel */
const createMockChannel = (): Channel & { send: ReturnType<typeof vi.fn> } => {
  return {
    send: vi.fn((_msg: ChannelMessage) => Promise.resolve()),
  }
}

/** 基础配置工厂（默认使用 main-test 避免污染真实 session） */
const createConfig = (overrides: Partial<MainAgentConfig> = {}): MainAgentConfig => ({
  openai: createMockOpenAI(),
  agentName: 'main-test',
  model: 'test-model',
  workspaceRoot: TEST_WORKSPACE,
  deliveryAgent: createMockDeliveryAgent(),
  ...overrides,
})

// ============================================================================
// 测试套件
// ============================================================================

describe('MainAgent', () => {
  let agent: MainAgent

  beforeEach(() => {
    agent = new MainAgent(createConfig())
  })

  afterEach(() => {
    // 清理测试产生的 session 文件
    const sessionPath = path.join(TEST_WORKSPACE, 'agents', 'main-test', 'session.json')
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
    }
  })

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
    })
  })

  describe('TC-A-03: run_delivery_agent 转发', () => {
    test('调用 run_delivery_agent 时转发给 deliveryAgent.runEphemeral', async () => {
      const mockDelivery = createMockDeliveryAgent(() => Promise.resolve('已投递 2 个职位'))
      const mockOpenAI = createMockOpenAI([
        {
          content: null,
          tool_calls: [{
            id: 'call_001',
            type: 'function',
            function: { name: 'run_delivery_agent', arguments: JSON.stringify({ instruction: '投递' }) }
          }]
        },
        '完成'
      ])

      const a = new MainAgent(createConfig({ openai: mockOpenAI, deliveryAgent: mockDelivery }))
      await a.run('投递职位')
      expect(mockDelivery.runEphemeral).toHaveBeenCalled()
    })
  })

  describe('TC-A-04: DeliveryAgent 异常处理', () => {
    test('deliveryAgent 抛出异常时 agent.run() 正常返回', async () => {
      const mockDelivery = createMockDeliveryAgent()
      ;(mockDelivery.runEphemeral as any).mockImplementation(() => Promise.reject(new Error('网络超时')))

      const mockOpenAI = createMockOpenAI([
        {
          content: null,
          tool_calls: [{
            id: 'call_002',
            type: 'function',
            function: { name: 'run_delivery_agent', arguments: JSON.stringify({ instruction: '投递' }) }
          }]
        },
        '投递失败，已记录'
      ])

      const a = new MainAgent(createConfig({ openai: mockOpenAI, deliveryAgent: mockDelivery }))
      const result = await a.run('投递职位')
      expect(typeof result).toBe('string')
      expect(a.getState().state).toBe('idle')
    })
  })

  describe('TC-A-07: runEphemeral 不写入 session', () => {
    test('runEphemeral 不修改 session.json 内容', async () => {
      const sessionDir = path.join(TEST_WORKSPACE, 'agents', 'main-test')
      const sessionPath = path.join(sessionDir, 'session.json')
      if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true })
      
      const initialSession = { messages: [{ role: 'user', content: 'init' }], currentTask: null, context: {}, todos: [] }
      fs.writeFileSync(sessionPath, JSON.stringify(initialSession))

      const a = new MainAgent(createConfig({ openai: createMockOpenAI('ephemeral response') }))
      await a.loadSession()
      await a.runEphemeral('测试临时任务')

      const savedSession = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))
      expect(savedSession.messages).toHaveLength(1)
      expect(savedSession.messages[0].content).toBe('init')
    })
  })

  describe('TC-A-08: runEphemeral 恢复 messages', () => {
    test('执行完毕后 messages 恢复为执行前的值', async () => {
      const a = new MainAgent(createConfig({ openai: createMockOpenAI('resp') }))
      a.run('first') // 这会留下 system + user + assistant
      
      const messagesBefore = [...a.getMessages()]
      await a.runEphemeral('ephemeral')
      const messagesAfter = a.getMessages()
      
      expect(messagesAfter).toEqual(messagesBefore)
    })
  })

  describe('TC-A-09: loadSkill 优先级', () => {
    test('workspace/skills/ 中的版本优先于代码级版本', async () => {
      const skillDir = path.join(TEST_WORKSPACE, 'skills')
      const skillPath = path.join(skillDir, 'test-skill.md')
      if (!fs.existsSync(skillDir)) fs.mkdirSync(skillDir, { recursive: true })
      fs.writeFileSync(skillPath, 'user skill content')

      const a = new MainAgent(createConfig())
      const content = (a as any).loadSkill('test-skill')
      expect(content).toBe('user skill content')
      
      fs.unlinkSync(skillPath)
    })
  })

  describe('agent:log payload', () => {
    test('typst_compile 成功时 emit 的字段符合约定', async () => {
      const logs: any[] = []
      const handler = (p: any) => logs.push(p)
      eventBus.on('agent:log', handler)
      try {
        await (agent as any).onToolResult('typst_compile', { success: true, content: 'output/resume.pdf' })
        expect(logs.length).toBeGreaterThan(0)
        const last = logs[logs.length - 1]
        expect(last.agentName).toBeTruthy()
        expect(last.type).toBe('info')
        expect(typeof last.message).toBe('string')
        expect(typeof last.timestamp).toBe('string')
      } finally {
        eventBus.off('agent:log', handler)
      }
    })
  })
})
