/** BaseAgent - 基于 OpenAI Tool Calling 的自主循环 Agent 基类 */
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { executeTool, TOOLS, type ToolContext, type ToolResult } from '../../tools/index'
import type { AgentState, Session, Task } from '../../types'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_KEEP_RECENT_MESSAGES } from './constants'
import { ContextCompressor } from './context-compressor'
import type { MCPClient, AgentSnapshot, BaseAgentConfig } from './types'

export abstract class BaseAgent {
  protected openai: OpenAI
  protected mcpClient?: MCPClient
  public readonly agentName: string
  protected model: string
  protected workspaceRoot: string
  protected maxIterations: number
  protected keepRecentMessages: number
  protected summaryModel: string

  protected state: AgentState = 'idle'
  protected iterations: number = 0
  protected lastAction: string = ''
  protected messages: ChatCompletionMessageParam[] = []
  protected currentTask: Task | null = null
  protected compressor: ContextCompressor
  protected availableTools: ChatCompletionTool[] | null = null

  constructor(config: BaseAgentConfig) {
    this.openai = config.openai
    this.agentName = config.agentName
    this.model = config.model
    this.workspaceRoot = config.workspaceRoot
    this.mcpClient = config.mcpClient
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS
    this.keepRecentMessages = config.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES
    this.summaryModel = config.summaryModel ?? 'gpt-4o-mini'

    this.compressor = new ContextCompressor({
      openai: this.openai,
      summaryModel: this.summaryModel,
      keepRecentMessages: this.keepRecentMessages,
    })
  }

  /** 系统提示词 - 子类必须实现 */
  protected abstract get systemPrompt(): string

  /** 运行 Agent 主循环 */
  async run(input: string): Promise<string> {
    this.state = 'running'
    this.iterations = 0
    this.lastAction = 'start'

    try {
      await this.loadSession()
      this.initMessages(input)
      const tools = await this.getAvailableTools()

      let result: string | null = null

      while (this.iterations < this.maxIterations) {
        this.iterations++
        this.lastAction = 'llm_call'

        const response = await this.callLLM(tools)
        const message = response.choices[0]?.message

        if (!message) {
          throw new Error('LLM 返回空响应')
        }

        if (message.content) {
          result = message.content
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          this.lastAction = 'tool_call'

          this.messages.push({
            role: 'assistant',
            content: message.content,
            tool_calls: message.tool_calls,
          })

          const toolResults = await this.executeToolCalls(message.tool_calls)
          for (const toolResult of toolResults) {
            this.messages.push(toolResult)
          }

          continue
        }

        if (result) {
          this.state = 'idle'
          this.lastAction = 'completed'
          break
        }
      }

      if (this.iterations >= this.maxIterations) {
        this.state = 'waiting'
        this.lastAction = 'max_iterations'
        result = `已达到最大迭代次数 (${this.maxIterations})，当前任务可能未完成。`
      }

      this.messages = await this.compressor.checkAndCompress(this.messages)
      await this.saveSession()

      return result ?? '任务完成，但没有生成响应。'
    } catch (error) {
      this.state = 'error'
      this.lastAction = `error: ${(error as Error).message}`
      throw error
    }
  }

  /**
   * 无状态单次执行模式（供 CronJob 使用）
   * 不读写 session.json，执行完毕后上下文销毁
   */
  async runEphemeral(input: string): Promise<string> {
    const savedMessages = this.messages
    const savedTask = this.currentTask

    // 使用干净的上下文执行
    this.messages = []
    this.currentTask = null
    this.state = 'running'
    this.iterations = 0
    this.lastAction = 'start'

    try {
      this.initMessages(input)
      const tools = await this.getAvailableTools()

      let result: string | null = null

      while (this.iterations < this.maxIterations) {
        this.iterations++
        this.lastAction = 'llm_call'

        const response = await this.callLLM(tools)
        const message = response.choices[0]?.message

        if (!message) {
          throw new Error('LLM 返回空响应')
        }

        if (message.content) {
          result = message.content
        }

        if (message.tool_calls && message.tool_calls.length > 0) {
          this.lastAction = 'tool_call'

          this.messages.push({
            role: 'assistant',
            content: message.content,
            tool_calls: message.tool_calls,
          })

          const toolResults = await this.executeToolCalls(message.tool_calls)
          for (const toolResult of toolResults) {
            this.messages.push(toolResult)
          }

          continue
        }

        if (result) {
          this.state = 'idle'
          this.lastAction = 'completed'
          break
        }
      }

      if (this.iterations >= this.maxIterations) {
        this.state = 'waiting'
        this.lastAction = 'max_iterations'
        result = `已达到最大迭代次数 (${this.maxIterations})，当前任务可能未完成。`
      }

      return result ?? '任务完成，但没有生成响应。'
    } catch (error) {
      this.state = 'error'
      this.lastAction = `error: ${(error as Error).message}`
      throw error
    } finally {
      // 恢复原有会话上下文，保证不污染交互会话
      this.messages = savedMessages
      this.currentTask = savedTask
    }
  }

  /** 获取当前状态快照 */
  getState(): AgentSnapshot {
    return {
      agentName: this.agentName,
      state: this.state,
      iterations: this.iterations,
      tokenCount: this.compressor.calculateTokens(this.messages),
      lastAction: this.lastAction,
      currentTask: this.currentTask,
    }
  }

  protected async getAvailableTools(): Promise<ChatCompletionTool[]> {
    if (this.availableTools) {
      return this.availableTools
    }

    const tools: ChatCompletionTool[] = [...TOOLS]

    if (this.mcpClient) {
      try {
        const mcpTools = await this.mcpClient.listTools()
        for (const tool of mcpTools) {
          tools.push({
            type: 'function',
            function: {
              name: tool.name,
              description: tool.description,
              parameters: tool.inputSchema,
            },
          })
        }
      } catch (error) {
        console.error('获取 MCP 工具失败:', error)
      }
    }

    this.availableTools = tools
    return tools
  }

  protected async executeToolCall(toolCall: ChatCompletionMessageToolCall): Promise<ChatCompletionMessageParam> {
    const toolName = toolCall.function.name
    let args: Record<string, unknown> = {}

    try {
      args = JSON.parse(toolCall.function.arguments)
    } catch {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: '无法解析工具参数' }),
      }
    }

    let result: ToolResult

    const localToolNames = [
      'read_file',
      'write_file',
      'append_file',
      'list_directory',
      'lock_file',
      'unlock_file',
    ]

    if (localToolNames.includes(toolName)) {
      const context: ToolContext = {
        workspaceRoot: this.workspaceRoot,
        agentName: this.agentName,
      }
      result = await executeTool(toolName, args, context)
    } else if (this.mcpClient) {
      try {
        const mcpResult = await this.mcpClient.callTool(toolName, args)
        result = {
          success: true,
          content: typeof mcpResult === 'string' ? mcpResult : JSON.stringify(mcpResult),
        }
      } catch (error) {
        result = {
          success: false,
          content: '',
          error: (error as Error).message,
        }
      }
    } else {
      result = {
        success: false,
        content: '',
        error: `未知工具: ${toolName}`,
      }
    }

    await this.onToolResult(toolName, result)

    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: result.success ? result.content : `错误: ${result.error}`,
    }
  }

  protected async executeToolCalls(toolCalls: ChatCompletionMessageToolCall[]): Promise<ChatCompletionMessageParam[]> {
    return Promise.all(toolCalls.map((tc) => this.executeToolCall(tc)))
  }

  /** 工具执行结果钩子 - 子类可覆盖实现副作用（如发送通知） */
  protected async onToolResult(_toolName: string, _result: ToolResult): Promise<void> {}

  protected getSessionPath(): string {
    return path.resolve(this.workspaceRoot, 'agents', this.agentName, 'session.json')
  }

  protected async loadSession(): Promise<void> {
    const sessionPath = this.getSessionPath()

    if (fs.existsSync(sessionPath)) {
      try {
        const content = fs.readFileSync(sessionPath, 'utf-8')
        const session: Session = JSON.parse(content)

        this.currentTask = session.currentTask
        this.messages = session.messages || []

        if (session.context) {
          this.restoreContext(session.context)
        }
      } catch (error) {
        console.error('加载会话失败:', error)
        this.messages = []
      }
    }
  }

  /** 保存会话 - 不保存 system 消息，每次启动使用最新的 systemPrompt */
  protected async saveSession(): Promise<void> {
    const sessionPath = this.getSessionPath()
    const dir = path.dirname(sessionPath)

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    const messagesToSave = this.messages.filter((m) => m.role !== 'system')

    const session: Session = {
      currentTask: this.currentTask,
      context: this.extractContext(),
      messages: messagesToSave,
      todos: [],
    }

    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
  }

  protected extractContext(): Record<string, unknown> {
    return {}
  }

  protected restoreContext(_context: Record<string, unknown>): void {}

  protected initMessages(input: string): void {
    if (this.messages.length === 0) {
      this.messages = [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: input },
      ]
    } else {
      const hasSystem = this.messages.length > 0 && this.messages[0].role === 'system'
      if (!hasSystem) {
        this.messages.unshift({ role: 'system', content: this.systemPrompt })
      }
      this.messages.push({ role: 'user', content: input })
    }
  }

  protected calculateTokens(): number {
    return this.compressor.calculateTokens(this.messages)
  }

  protected async callLLM(tools: ChatCompletionTool[]): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return this.openai.chat.completions.create({
      model: this.model,
      messages: this.messages,
      tools,
      tool_choice: 'auto',
    })
  }
}