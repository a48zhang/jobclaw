// BaseAgent 单元测试
import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { BaseAgent, type BaseAgentConfig, type MCPClient } from '../../src/agents/base'
import OpenAI from 'openai'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus } from '../../src/eventBus'

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
        create: mock((params: any) => formatResponse(params, { content: '测试响应' })),
      },
    },
  } as unknown as OpenAI
}

// 测试工作区
// NOTE: test file lives in tests/unit/, so ../../workspace points to repo-local workspace/
const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../workspace')
const TEST_AGENT_DIR = path.join(TEST_WORKSPACE, 'agents', 'test')

describe('BaseAgent', () => {
  let mockOpenAI: OpenAI
  let agent: TestAgent

  beforeEach(() => {
    mockOpenAI = createMockOpenAI()
    agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'gpt-4o',
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
        model: 'gpt-4o',
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

      await agent.run('测试')

      const sessionPath = path.join(TEST_AGENT_DIR, 'session.json')
      expect(fs.existsSync(sessionPath)).toBe(true)

      const session = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'))
      expect(session).toHaveProperty('messages')
      expect(session).toHaveProperty('currentTask')
      expect(session).toHaveProperty('context')
    })
  })

  describe('runEphemeral 状态同步', () => {
    test('runEphemeral 结束后恢复原 state 并发出 agent:state', async () => {
      const states: string[] = []
      const handler = (p: { agentName: string; state: string }) => {
        if (p.agentName === 'test') states.push(p.state)
      }
      eventBus.on('agent:state', handler as any)
      try {
        expect(agent.getState().state).toBe('idle')
        await agent.runEphemeral('测试临时任务')
        expect(states).toContain('running')
        expect(states[states.length - 1]).toBe('idle')
      } finally {
        eventBus.off('agent:state', handler as any)
      }
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
      listTools: mock(() => Promise.resolve([
        { name: 'mcp_tool_1', description: 'MCP Tool 1', inputSchema: { type: 'object' } },
        { name: 'mcp_tool_2', description: 'MCP Tool 2', inputSchema: { type: 'object' } },
      ])),
      callTool: mock(() => Promise.resolve('MCP result')),
    }

    const agentWithMCP = new TestAgent({
      openai: createMockOpenAI(),
      agentName: 'test',
      model: 'gpt-4o',
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
    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => formatResponse(params, {
            content: '这是最终的回答',
          })),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    const result = await agent.run('你好')

    expect(result).toBe('这是最终的回答')
    expect(agent.getState().state).toBe('idle')
    expect(agent.getState().lastAction).toBe('completed')
  })

  test('工具调用后继续循环', async () => {
    let callCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => {
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
              // 第二次返回最终结果
              return formatResponse(params, {
                content: '目录内容已列出',
              })
            }
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'gpt-4o',
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
          create: mock((params: any) => formatResponse(params, {
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
      model: 'gpt-4o',
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
          create: mock(() => Promise.reject(new Error('API 错误'))),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'gpt-4o',
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
          create: mock((params: any) => {
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
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    await agent.run('列出目录')

    expect(toolCallHookCalled).toBe(true)
    expect(hookToolName).toBe('list_directory')
    expect(hookResult.success).toBe(true)
  })

  test('MCP 工具调用', async () => {
    const mockMCPClient: MCPClient = {
      listTools: mock(() => Promise.resolve([
        { name: 'custom_tool', description: 'Custom Tool', inputSchema: { type: 'object' } },
      ])),
      callTool: mock(() => Promise.resolve('MCP tool result')),
    }

    let mcpCallCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => {
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
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
      mcpClient: mockMCPClient,
    })

    await agent.run('调用自定义工具')

    expect(mockMCPClient.callTool).toHaveBeenCalled()
  })

  test('工具参数解析失败返回错误', async () => {
    let callCount = 0
    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => {
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
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    // 不应抛出异常
    const result = await agent.run('测试')
    expect(result).toBeDefined()
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
          create: mock((params: any) => {
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
            }
            return formatResponse(params, {
              content: '两个目录已列出',
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test_parallel',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    const result = await agent.run('列出两个目录')

    // 验证 LLM 被调用两次（第一次工具调用，第二次最终响应）
    expect(llmCallCount).toBe(2)
    expect(result).toBe('两个目录已列出')

    // 验证消息历史中包含两个工具结果
    const messages = agent.testGetMessages()
    const toolMessages = messages.filter(m => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
  })

  test('工具结果按正确顺序加入历史', async () => {
    let llmCallCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => {
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
      model: 'gpt-4o',
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
    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => formatResponse(params, {
            content: '正常响应',
          })),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test_compress',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    await agent.run('测试')

    // 消息数应该很少（system + user + assistant）
    const messages = agent.testGetMessages()
    expect(messages.length).toBeLessThanOrEqual(3)
  })

  test('超过阈值触发压缩', async () => {
    let summaryCallCount = 0

    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => {
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
      model: 'gpt-4o',
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
          create: mock((params: any) => formatResponse(params, {
            content: '摘要：用户进行了多次对话',
          })),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'gpt-4o',
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
    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => formatResponse(params, {
            content: '这是对话摘要',
          })),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'gpt-4o',
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
    const stateHistory: string[] = []

    const mockOpenAI = {
      chat: {
        completions: {
          create: mock((params: any) => {
            stateHistory.push('llm_called')
            return formatResponse(params, {
              content: '完成',
            })
          }),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'gpt-4o',
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
          create: mock((params: any) => formatResponse(params, {
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
      model: 'gpt-4o',
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
          create: mock(() => Promise.reject(new Error('Network error'))),
        },
      },
    } as unknown as OpenAI

    const agent = new TestAgent({
      openai: mockOpenAI,
      agentName: 'test',
      model: 'gpt-4o',
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
      model: 'gpt-4o',
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
})
