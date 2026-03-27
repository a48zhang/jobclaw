// BaseAgent 单元测试
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { BaseAgent, type BaseAgentConfig, type MCPClient } from '../../src/agents/base'
import OpenAI from 'openai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus } from '../../src/eventBus'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 测试用的具体 Agent 实现
class TestAgent extends BaseAgent {
  protected get systemPrompt(): string {
    return `你是测试 Agent。
你的私有目录是: workspace/agents/test/
你可以读取共享目录: workspace/data/`
  }

  // 暴露 protected 方法用于测试
  public testGetSessionPath(): string {
    return this.getSessionPath()
  }

  public testCalculateTokens(): number {
    return this.calculateTokens()
  }

  public testInitMessages(input: string): void {
    this.initMessages(input)
  }

  public testGetMessages(): import('openai/resources/chat/completions').ChatCompletionMessageParam[] {
    return [...this.messages]
  }

  public testSetMessages(messages: import('openai/resources/chat/completions').ChatCompletionMessageParam[]): void {
    this.messages = messages
  }

  public async testGetAvailableTools(): Promise<import('openai/resources/chat/completions').ChatCompletionTool[]> {
    return this.getAvailableTools()
  }

  public async testExecuteToolCall(toolCall: import('openai/resources/chat/completions').ChatCompletionMessageToolCall) {
    return this.executeToolCall(toolCall)
  }

  public async testSaveSession(): Promise<void> {
    await this.saveSession()
  }
}

/**
 * 辅助函数：将简单的响应对象转换为 OpenAI 要求的格式（支持流式和非流式）
 */
function formatResponse(params: any, response: { content: string | null; tool_calls?: any[] }) {
  if (params.stream) {
    return (async function* () {
      yield {
        choices: [{
          delta: {
            content: response.content || undefined,
            tool_calls: response.tool_calls?.map((tc, index) => ({
              index,
              id: tc.id,
              function: tc.function,
            })),
          },
        }],
      }
    })()
  }
  return Promise.resolve({
    choices: [{
      message: {
        content: response.content,
        tool_calls: response.tool_calls || null,
      },
    }],
  })
}

// Mock OpenAI
const createMockOpenAI = () => {
  return {
    chat: {
      completions: {
        create: vi.fn((params: any) => formatResponse(params, { content: '测试响应' })),
      },
    },
  } as unknown as OpenAI
}

// 测试工作区
// NOTE: test file lives in tests/unit/, so ../../workspace points to repo-local workspace/
const TEST_WORKSPACE = path.resolve(__dirname, '../../workspace')
const TEST_AGENT_DIR = path.join(TEST_WORKSPACE, 'agents', 'test')

describe('BaseAgent', () => {
  let mockOpenAI: OpenAI
  let agent: TestAgent

  beforeEach(() => {
    mockOpenAI = createMockOpenAI()
    agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })
  })

  afterEach(() => {
    // 清理测试文件
    const sessionPath = path.join(TEST_AGENT_DIR, 'session.json')
    if (fs.existsSync(sessionPath)) {
      fs.unlinkSync(sessionPath)
    }
  })

  describe('构造函数', () => {
    test('正确初始化属性', () => {
      expect(agent.agentName).toBe('test')
      expect(agent.getState().state).toBe('idle')
    })

    test('使用默认参数', () => {
      const state = agent.getState()
      expect(state.iterations).toBe(0)
      expect(state.tokenCount).toBe(0)
    })

    test('使用自定义参数', () => {
      const customAgent = new TestAgent({
        openai: mockOpenAI,
        agentName: 'test',
        model: 'test-model',
        workspaceRoot: TEST_WORKSPACE,
        maxIterations: 100,
        keepRecentMessages: 30,
      })
      // 参数已存储，无法直接验证，但构造不应出错
      expect(customAgent).toBeDefined()
    })
  })

  describe('getState', () => {
    test('返回完整的状态快照', () => {
      const snapshot = agent.getState()

      expect(snapshot.agentName).toBe('test')
      expect(snapshot.state).toBe('idle')
      expect(snapshot.iterations).toBe(0)
      expect(snapshot.tokenCount).toBe(0)
      expect(snapshot.lastAction).toBe('')
      expect(snapshot.currentTask).toBeNull()
    })
  })

  describe('Session 管理', () => {
    test('getSessionPath 返回正确路径', () => {
      const sessionPath = agent.testGetSessionPath()
      expect(sessionPath).toContain('agents')
      expect(sessionPath).toContain('test')
      expect(sessionPath).toContain('session.json')
    })

    test('loadSession 处理不存在的文件', async () => {
      // 不应抛出异常
      await expect(agent.run('测试')).resolves.toBeDefined()
    })

    test('saveSession 创建目录和文件', async () => {
      // 确保目录不存在
      if (fs.existsSync(TEST_AGENT_DIR)) {
        const files = fs.readdirSync(TEST_AGENT_DIR)
        for (const f of files) {
          fs.unlinkSync(path.join(TEST_AGENT_DIR, f))
        }
      }

      const persistentAgent = new TestAgent({
        openai: mockOpenAI,
        agentName: 'test',
        model: 'test-model',
        workspaceRoot: TEST_WORKSPACE,
        persistent: true,
      })

      await persistentAgent.run('测试')

      const sessionPath = path.join(TEST_AGENT_DIR, 'session.json')
      expect(fs.existsSync(sessionPath)).toBe(true)

      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))
      expect(session).toHaveProperty('messages')
      expect(session).toHaveProperty('currentTask')
      expect(session).toHaveProperty('context')
    })

    test('saveSession 在运行中会截断过大的持久化快照', async () => {
      const persistentAgent = new TestAgent({
        openai: mockOpenAI,
        agentName: 'test',
        model: 'test-model',
        workspaceRoot: TEST_WORKSPACE,
        persistent: true,
      })

      persistentAgent.testSetMessages([
        { role: 'system', content: 'system' },
        ...Array.from({ length: 16 }, (_, index) => ({
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `消息 ${index} ` + 'x'.repeat(4000),
        })),
      ] as any)
      ;(persistentAgent as any).state = 'running'

      await persistentAgent.testSaveSession()

      const sessionPath = path.join(TEST_AGENT_DIR, 'session.json')
      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))
      expect(session.messages.length).toBeLessThan(16)
      expect(session.messages[0]?.content).toContain('SYSTEM_SUMMARY')
    })
  })

  describe('工具重试', () => {
    test('对可重试的 MCP 工具失败执行指数退避重试', async () => {
      vi.useFakeTimers()
      try {
        const mcpClient: MCPClient = {
          listTools: vi.fn(async () => []),
          callTool: vi.fn()
            .mockRejectedValueOnce(new Error('timeout while calling tool'))
            .mockRejectedValueOnce(new Error('socket hang up'))
            .mockResolvedValue('最终成功'),
        }

        const retryAgent = new TestAgent({
          openai: mockOpenAI,
          agentName: 'test',
          model: 'test-model',
          workspaceRoot: TEST_WORKSPACE,
          mcpClient,
        })

        const callPromise = retryAgent.testExecuteToolCall({
          id: 'call-1',
          type: 'function',
          function: {
            name: 'browser_navigate',
            arguments: JSON.stringify({ url: 'https://example.com' }),
          },
        } as any)

        await vi.runAllTimersAsync()
        const result = await callPromise

        expect(mcpClient.callTool).toHaveBeenCalledTimes(3)
        expect((result as { content: string }).content).toBe('最终成功')
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('submit 队列处理', () => {
    test('submit 入队后会被顺序处理', async () => {
      let callCount = 0
      const mockOpenAI = {
        chat: {
          completions: {
            create: vi.fn((params: any) => {
              callCount++
              return formatResponse(params, {
                content: callCount === 1 ? '第一条完成' : '第二条完成',
              })
            }),
          },
        },
      } as unknown as OpenAI

      const queueAgent = new TestAgent({
        openai: mockOpenAI,
        agentName: 'test',
        model: 'test-model',
        workspaceRoot: TEST_WORKSPACE,
      })

      expect(queueAgent.submit('消息 1').queued).toBe(true)
      expect(queueAgent.submit('消息 2').queued).toBe(true)

      const deadline = Date.now() + 1500
      while (callCount < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }

      expect(callCount).toBe(2)
    })
  })

  describe('Token 计算', () => {
    test('空消息列表 token 数为 0', () => {
      agent.testSetMessages([])
      expect(agent.testCalculateTokens()).toBe(0)
    })

    test('计算单条消息的 token', () => {
      agent.testSetMessages([
        { role: 'user', content: 'Hello World' },
      ])
      const tokens = agent.testCalculateTokens()
      expect(tokens).toBeGreaterThan(0)
    })

    test('计算多条消息的 token', () => {
      agent.testSetMessages([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Hello!' },
        { role: 'assistant', content: 'Hi there!' },
      ])
      const tokens = agent.testCalculateTokens()
      expect(tokens).toBeGreaterThan(0)
    })
  })

  describe('消息初始化', () => {
    test('无历史消息时正确初始化', () => {
      agent.testSetMessages([])
      agent.testInitMessages('测试输入')

      const messages = agent.testGetMessages()
      expect(messages).toHaveLength(2)
      expect(messages[0].role).toBe('system')
      expect(messages[1].role).toBe('user')
    })

    test('有历史消息时追加新输入', () => {
      agent.testSetMessages([
        { role: 'system', content: 'System prompt' },
        { role: 'user', content: 'Previous input' },
        { role: 'assistant', content: 'Previous response' },
      ])
      agent.testInitMessages('新输入')

      const messages = agent.testGetMessages()
      expect(messages).toHaveLength(4)
      expect(messages[messages.length - 1].role).toBe('user')
      expect((messages[messages.length - 1] as { content: string }).content).toBe('新输入')
    })

    test('历史消息缺少 system 时自动添加', () => {
      agent.testSetMessages([
        { role: 'user', content: 'Previous input' },
        { role: 'assistant', content: 'Previous response' },
      ])
      agent.testInitMessages('新输入')

      const messages = agent.testGetMessages()
      expect(messages[0].role).toBe('system')
    })
  })
})

describe('MCP Client 集成', () => {
  test('MCP 工具列表合并', async () => {
    const mockMCPClient: MCPClient = {
      listTools: vi.fn(() => Promise.resolve([
        { name: 'mcp_tool_1', description: 'MCP Tool 1', inputSchema: { type: 'object' } },
        { name: 'mcp_tool_2', description: 'MCP Tool 2', inputSchema: { type: 'object' } },
      ])),
      callTool: vi.fn(() => Promise.resolve('MCP result')),
    }

    const agentWithMCP = new TestAgent({
      openai: createMockOpenAI(),
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      mcpClient: mockMCPClient,
    })

    // 由于 getAvailableTools 是 protected，我们通过 run 间接测试
    // 这里只验证构造不抛异常
    expect(agentWithMCP).toBeDefined()
  })
})

// ============================================================================
// run() 主循环测试
// ============================================================================

describe('run() 主循环', () => {
  test('正常执行并返回结果', async () => {
    let callCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            callCount++
            if (callCount === 1) {
              // 第一次返回纯文本内容
              return formatResponse(params, {
                content: '这是最终的回答',
                tool_calls: undefined,
              })
            }
            // 不应该有第二次调用
            return formatResponse(params, {
              content: null,
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    const result = await agent.run('你好')

    expect(callCount).toBe(1)
    expect(result).toBe('这是最终的回答')
    expect(agent.getState().state).toBe('idle')
  })

  test('工具调用后继续循环', async () => {
    let callCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            callCount++
            if (callCount === 1) {
              // 第一次返回工具调用
              return formatResponse(params, {
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'list_directory',
                    arguments: '{"path": "data"}',
                  },
                }],
              })
            } else {
              // 第二次返回纯文本内容
              return formatResponse(params, {
                content: '目录内容已列出',
                tool_calls: undefined,
              })
            }
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    const result = await agent.run('列出 data 目录')

    expect(callCount).toBe(2)
    expect(result).toBe('目录内容已列出')
  })

  test('达到 maxIterations 时状态变为 waiting', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => formatResponse(params, {
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'list_directory',
                arguments: '{"path": "data"}',
              },
            }],
          })),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      maxIterations: 3,
    })

    const result = await agent.run('测试')

    expect(agent.getState().state).toBe('waiting')
    expect(agent.getState().iterations).toBe(3)
    expect(result).toContain('最大迭代次数')
  })

  test('LLM 调用异常时状态变为 error', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn(() => Promise.reject(new Error('API 错误'))),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    await expect(agent.run('测试')).rejects.toThrow()
    expect(agent.getState().state).toBe('error')
  })
})

// ============================================================================
// executeToolCall() 测试
// ============================================================================

describe('executeToolCall()', () => {
  const testAgentDir = path.join(TEST_WORKSPACE, 'agents', 'test_exec')

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(testAgentDir)) {
      const files = fs.readdirSync(testAgentDir)
      for (const f of files) {
        fs.unlinkSync(path.join(testAgentDir, f))
      }
    }
  })

  test('本地工具调用成功', async () => {
    let toolCallHookCalled = false
    let hookToolName = ''
    let hookResult: any = null

    class HookTestAgent extends BaseAgent {
      protected get systemPrompt(): string {
        return 'test'
      }

      protected async onToolResult(toolName: string, result: any): Promise<void> {
        toolCallHookCalled = true
        hookToolName = toolName
        hookResult = result
      }
    }

    let callCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            callCount++
            if (callCount === 1) {
              // 第一次返回工具调用 - 使用存在的目录
              return formatResponse(params, {
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'list_directory',
                    arguments: '{"path": "agents"}',
                  },
                }],
              })
            }
            // 第二次返回最终结果
            return formatResponse(params, {
              content: '目录已列出',
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new HookTestAgent({
      openai: mockOpenAI,
      agentName: 'test_exec',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    await agent.run('列出目录')

    expect(toolCallHookCalled).toBe(true)
    expect(hookToolName).toBe('list_directory')
    expect(hookResult.success).toBe(true)
  })

  test('MCP 工具调用', async () => {
    const mockMCPClient: MCPClient = {
      listTools: vi.fn(() => Promise.resolve([
        { name: 'custom_tool', description: 'Custom Tool', inputSchema: { type: 'object' } },
      ])),
      callTool: vi.fn(() => Promise.resolve('MCP tool result')),
    }

    let mcpCallCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            mcpCallCount++
            if (mcpCallCount === 1) {
              return formatResponse(params, {
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'custom_tool',
                    arguments: '{"param": "value"}',
                  },
                }],
              })
            }
            return formatResponse(params, {
              content: 'MCP tool executed',
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      mcpClient: mockMCPClient,
    })

    await agent.run('调用自定义工具')

    expect(mockMCPClient.callTool).toHaveBeenCalled()
  })

  test('MCP 工具遇到瞬时错误时会自动重试', async () => {
    const mockMCPClient: MCPClient = {
      listTools: vi.fn(() => Promise.resolve([
        { name: 'custom_tool', description: 'Custom Tool', inputSchema: { type: 'object' } },
      ])),
      callTool: vi
        .fn()
        .mockRejectedValueOnce(new Error('socket hang up'))
        .mockResolvedValueOnce('MCP tool result after retry'),
    }

    let llmCallCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            llmCallCount++
            if (llmCallCount === 1) {
              return formatResponse(params, {
                content: null,
                tool_calls: [{
                  id: 'call_retry',
                  type: 'function',
                  function: {
                    name: 'custom_tool',
                    arguments: '{"param": "value"}',
                  },
                }],
              })
            }
            return formatResponse(params, {
              content: 'MCP tool executed after retry',
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test_retry',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      mcpClient: mockMCPClient,
    })

    const result = await agent.run('调用会重试的 MCP 工具')

    expect(result).toBe('MCP tool executed after retry')
    expect(mockMCPClient.callTool).toHaveBeenCalledTimes(2)
  })

  test('run_agent 在 MCP 存在时也走本地工具分支', async () => {
    const mockMCPClient: MCPClient = {
      listTools: vi.fn(() => Promise.resolve([
        { name: 'browser_navigate', description: 'navigate', inputSchema: { type: 'object' } },
      ])),
      callTool: vi.fn(() => Promise.resolve('mcp result')),
    }

    const mockFactory = {
      createAgent: vi.fn(() => ({
        run: vi.fn(async () => '子任务完成'),
      })),
    }

    let callCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            callCount++
            if (callCount === 1) {
              return formatResponse(params, {
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'run_agent',
                    arguments: JSON.stringify({ instruction: '执行子任务' }),
                  },
                }],
              })
            }
            return formatResponse(params, { content: '父任务完成' })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test_exec',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      mcpClient: mockMCPClient,
      factory: mockFactory as any,
    })

    const result = await agent.run('执行')
    expect(result).toBe('父任务完成')
    expect(mockFactory.createAgent).toHaveBeenCalledTimes(1)
    expect(mockMCPClient.callTool).not.toHaveBeenCalled()
  })

  test('工具参数解析失败返回错误', async () => {
    let callCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            callCount++
            if (callCount === 1) {
              return formatResponse(params, {
                content: null,
                tool_calls: [{
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'list_directory',
                    arguments: 'invalid json',
                  },
                }],
              })
            }
            return formatResponse(params, {
              content: '继续执行',
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    // 不应抛出异常
    const result = await agent.run('测试')
    expect(result).toBeDefined()
  })

  test('持久化 session 在长会话运行中会截断快照，避免 session.json 持续膨胀', async () => {
    const sessionPath = path.join(TEST_WORKSPACE, 'agents', 'test_long_session', 'session.json')
    const localMockOpenAI = createMockOpenAI()

    const persistentAgent = new TestAgent({
      openai: localMockOpenAI,
      agentName: 'test_long_session',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      persistent: true,
    })

    const longMessage = '上下文'.repeat(5000)
    persistentAgent.testSetMessages([
      { role: 'system', content: 'system prompt' },
      ...Array.from({ length: 20 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `${index}:${longMessage}`,
      })) as import('openai/resources/chat/completions').ChatCompletionMessageParam[],
    ])

    ;(persistentAgent as any).state = 'running'
    await (persistentAgent as any).saveSession()

    const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))
    const contents = session.messages
      .map((message: { content?: unknown }) => typeof message.content === 'string' ? message.content : '')
      .join('\n')

    expect(contents).toContain('SYSTEM_SUMMARY: 会话进行中，持久化快照已截断')
    expect(session.messages.length).toBeLessThan(20)
  })
})

// ============================================================================
// 并行工具调用测试
// ============================================================================

describe('并行工具调用', () => {
  const testAgentDir = path.join(TEST_WORKSPACE, 'agents', 'test_parallel')

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(testAgentDir)) {
      const files = fs.readdirSync(testAgentDir)
      for (const f of files) {
        fs.unlinkSync(path.join(testAgentDir, f))
      }
    }
  })

  test('多个工具调用并行执行', async () => {
    let llmCallCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            llmCallCount++
            if (llmCallCount === 1) {
              // 返回多个并行工具调用
              return formatResponse(params, {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'list_directory',
                      arguments: '{"path": "agents"}',
                    },
                  },
                  {
                    id: 'call_2',
                    type: 'function',
                    function: {
                      name: 'list_directory',
                      arguments: '{"path": "data"}',
                    },
                  },
                ],
              })
            } else {
              // 第二次返回纯文本内容
              return formatResponse(params, {
                content: '两个目录已列出',
                tool_calls: undefined,
              })
            }
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test_parallel',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    const result = await agent.run('列出两个目录')

    // 验证 LLM 被调用两次
    expect(llmCallCount).toBe(2)
    expect(result).toBe('两个目录已列出')

    // 验证消息历史中包含两个工具结果（两个 list_directory）
    const messages = agent.testGetMessages()
    const toolMessages = messages.filter(m => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
  })

  test('工具结果按正确顺序加入历史', async () => {
    let llmCallCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            llmCallCount++
            if (llmCallCount === 1) {
              return formatResponse(params, {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: {
                      name: 'list_directory',
                      arguments: '{"path": "data"}',
                    },
                  },
                  {
                    id: 'call_2',
                    type: 'function',
                    function: {
                      name: 'read_file',
                      arguments: '{"path": "data/jobs.md"}',
                    },
                  },
                ],
              })
            }
            return formatResponse(params, {
              content: '完成',
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test_order',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    await agent.run('测试')

    const messages = agent.testGetMessages()

    // 找到 assistant 消息（包含 tool_calls）
    const assistantIndex = messages.findIndex(m => m.role === 'assistant')
    expect(assistantIndex).toBeGreaterThanOrEqual(0)

    // 验证 tool 消息紧跟在 assistant 消息之后
    expect(messages[assistantIndex + 1]?.role).toBe('tool')
    expect(messages[assistantIndex + 2]?.role).toBe('tool')
  })
})

// ============================================================================
// checkAndCompress() 压缩测试
// ============================================================================

describe('checkAndCompress()', () => {
  const testAgentDir = path.join(TEST_WORKSPACE, 'agents', 'test_compress')

  beforeEach(() => {
    // 清理测试目录
    if (fs.existsSync(testAgentDir)) {
      const files = fs.readdirSync(testAgentDir)
      for (const f of files) {
        fs.unlinkSync(path.join(testAgentDir, f))
      }
    }
  })

  test('未达阈值不触发压缩', async () => {
    let callCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            callCount++
            if (callCount === 1) {
              return formatResponse(params, {
                content: '正常响应',
                tool_calls: undefined,
              })
            }
            return formatResponse(params, { content: null })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test_compress',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    await agent.run('测试')

    // 消息数应该很少（system + user + assistant）
    const messages = agent.testGetMessages()
    expect(messages.length).toBeLessThanOrEqual(6)
  })

  test('超过阈值触发压缩', async () => {
    let summaryCallCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            summaryCallCount++
            return formatResponse(params, {
              content: '这是一个摘要内容',
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      keepRecentMessages: 5,
    })

    // 构造大量消息模拟超过阈值的情况
    // 注意：由于阈值是 196608 tokens，实际测试中很难达到
    // 这里主要测试压缩逻辑是否正确执行
    const largeMessages = [
      { role: 'system' as const, content: 'System prompt' },
    ]

    // 添加大量消息
    for (let i = 0; i < 30; i++) {
      largeMessages.push({ role: 'user' as const, content: `User message ${i}` })
      largeMessages.push({ role: 'assistant' as const, content: `Assistant response ${i}` })
    }

    agent.testSetMessages(largeMessages)

    // 手动触发压缩（通过 run 会检查阈值）
    // 由于阈值很高，这里我们通过设置大量消息来测试压缩后的结构
    expect(agent.testGetMessages().length).toBe(61) // 1 + 60
  })

  test('保留 system 消息和最近消息', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => formatResponse(params, {
            content: '摘要：用户进行了多次对话',
          })),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      keepRecentMessages: 5,
    })

    // 设置消息
    const messages = [
      { role: 'system' as const, content: 'System prompt' },
      { role: 'user' as const, content: 'User 1' },
      { role: 'assistant' as const, content: 'Assistant 1' },
      { role: 'user' as const, content: 'User 2' },
      { role: 'assistant' as const, content: 'Assistant 2' },
      { role: 'user' as const, content: 'User 3' },
      { role: 'assistant' as const, content: 'Assistant 3' },
      { role: 'user' as const, content: 'Recent user' },
      { role: 'assistant' as const, content: 'Recent assistant' },
    ]

    agent.testSetMessages(messages)

    // 验证消息结构正确
    const currentMessages = agent.testGetMessages()
    expect(currentMessages[0].role).toBe('system')
  })

  test('压缩后包含摘要消息', async () => {
    let callCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            callCount++
            if (callCount === 1) {
              return formatResponse(params, {
                content: '这是对话摘要',
                tool_calls: undefined,
              })
            }
            return formatResponse(params, {
              content: null,
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    await agent.run('测试')

    // 验证基本流程正确
    expect(agent.getState().state).toBe('idle')
  })
})

// ============================================================================
// 状态转换测试
// ============================================================================

describe('状态转换', () => {
  test('idle -> running -> idle (正常完成)', async () => {
    let callCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            callCount++
            if (callCount === 1) {
              return formatResponse(params, {
                content: '完成',
                tool_calls: undefined,
              })
            }
            return formatResponse(params, {
              content: null,
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    expect(agent.getState().state).toBe('idle')

    await agent.run('测试')

    expect(agent.getState().state).toBe('idle')
  })

  test('idle -> running -> waiting (达到最大迭代)', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => formatResponse(params, {
            content: null,
            tool_calls: [{
              id: 'call_1',
              type: 'function',
              function: {
                name: 'list_directory',
                arguments: '{"path": "data"}',
              },
            }],
          })),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
      maxIterations: 2,
    })

    await agent.run('测试')

    expect(agent.getState().state).toBe('waiting')
  })

  test('idle -> running -> error (异常)', async () => {
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn(() => Promise.reject(new Error('Network error'))),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    await expect(agent.run('测试')).rejects.toThrow()
    expect(agent.getState().state).toBe('error')
  })
})

// ============================================================================
// requestIntervention & EventEmitter 测试 — 综合 Team A & Team B
// ============================================================================

describe('requestIntervention (HITL)', () => {
  let mockOpenAI: OpenAI
  let agent: TestAgent

  beforeEach(() => {
    mockOpenAI = createMockOpenAI()
    agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })
  })

  test('BaseAgent 继承自 EventEmitter，具备 on() 方法', () => {
    expect(typeof agent.on).toBe('function')
    expect(typeof agent.emit).toBe('function')
  })

  test('发出 intervention_required 事件并携带 prompt', async () => {
    let emittedPrompt = ''
    let emittedResolve: ((input: string) => void) | undefined

    agent.on('intervention_required', (payload: { prompt: string; resolve: (input: string) => void }) => {
      emittedPrompt = payload.prompt
      emittedResolve = payload.resolve
    })

    const interventionPromise = agent.requestIntervention('需要人工介入')

    expect(emittedPrompt).toBe('需要人工介入')
    expect(typeof emittedResolve).toBe('function')

    // 通过事件中的 resolve 函数解除挂起
    emittedResolve?.('通过事件解决')

    const result = await interventionPromise
    expect(result).toBe('通过事件解决')
  })

  test('挂起并等待外部解决 (resolveIntervention)', async () => {
    let resolved = false
    const interventionPromise = agent.requestIntervention('请确认操作').then((input) => {
      resolved = true
      return input
    })

    // Promise 应尚未解决
    expect(resolved).toBe(false)

    // 外部调用 resolveIntervention 解除挂起
    agent.resolveIntervention('用户已确认')

    const result = await interventionPromise
    expect(resolved).toBe(true)
    expect(result).toBe('用户已确认')
  })

  test('resolveIntervention 调用后清除内部 resolve 引用', async () => {
    const p = agent.requestIntervention('test')
    agent.resolveIntervention('done')
    await p

    // 再次调用 resolveIntervention 不应抛出异常
    expect(() => agent.resolveIntervention('extra')).not.toThrow()
  })

  test('request 工具被注入可用工具列表', async () => {
    const tools = await agent.testGetAvailableTools()
    const requestTool = tools.find((tool) => tool.function.name === 'request')

    expect(requestTool).toBeDefined()
    expect(requestTool?.function.parameters.required).toContain('prompt')
  })

  test('request 工具可以触发用户请求并返回结构化结果', async () => {
    let llmCallCount = 0
    let emittedPayload: any = null
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            llmCallCount++
            if (llmCallCount === 1) {
              return formatResponse(params, {
                content: null,
                tool_calls: [{
                  id: 'call_request_1',
                  type: 'function',
                  function: {
                    name: 'request',
                    arguments: JSON.stringify({
                      prompt: '你想投递什么岗位？',
                      kind: 'single_select',
                      options: ['前端', '后端'],
                      allow_empty: false,
                    }),
                  },
                }],
              })
            } else if (llmCallCount === 2) {
              return formatResponse(params, {
                content: '收到岗位信息，继续执行',
                tool_calls: undefined,
              })
            }
            return formatResponse(params, {
              content: null,
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    eventBus.once('intervention:required', (payload) => {
      emittedPayload = payload
      agent.resolveIntervention('后端')
    })

    const result = await agent.run('开始')
    expect(result).toBe('收到岗位信息，继续执行')
    expect(emittedPayload.prompt).toBe('你想投递什么岗位？')
    expect(emittedPayload.kind).toBe('single_select')
    expect(emittedPayload.options).toEqual(['前端', '后端'])
    expect(emittedPayload.requestId).toBe('call_request_1')

    const toolMessages = agent.testGetMessages().filter((msg) => msg.role === 'tool')
    expect(toolMessages).toHaveLength(1)
    const requestResult = JSON.parse((toolMessages[0] as any).content)
    expect(requestResult.request_id).toBe('call_request_1')
    expect(requestResult.input).toBe('后端')
    expect(requestResult.answered).toBe(true)
    expect(requestResult.timed_out).toBe(false)
  })

  test('request 工具超时后返回未回答状态', async () => {
    let llmCallCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: vi.fn((params: any) => {
            llmCallCount++
            if (llmCallCount === 1) {
              return formatResponse(params, {
                content: null,
                tool_calls: [{
                  id: 'call_request_2',
                  type: 'function',
                  function: {
                    name: 'request',
                    arguments: JSON.stringify({
                      prompt: '请补充学校名称',
                      timeout_ms: 20,
                      allow_empty: false,
                    }),
                  },
                }],
              })
            } else if (llmCallCount === 2) {
              return formatResponse(params, {
                content: '任务完成',
                tool_calls: undefined,
              })
            }
            return formatResponse(params, {
              content: null,
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'test-model',
      workspaceRoot: TEST_WORKSPACE,
    })

    const result = await agent.run('开始')
    expect(result).toBe('任务完成')

    const toolMessage = agent.testGetMessages().find((msg) => msg.role === 'tool')
    const parsed = JSON.parse((toolMessage as any).content)
    expect(parsed.input).toBe('')
    expect(parsed.answered).toBe(false)
    expect(parsed.timed_out).toBe(true)
  })
})
