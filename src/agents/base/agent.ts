/** BaseAgent - 基于 OpenAI Tool Calling 的自主循环 Agent 基类 */
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EventEmitter } from 'node:events'
import { executeTool, TOOLS, type ToolContext, type ToolResult } from '../../tools/index'
import type { AgentState, Session, Task } from '../../types'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_KEEP_RECENT_MESSAGES } from './constants'
import { ContextCompressor } from './context-compressor'
import type { MCPClient, AgentSnapshot, BaseAgentConfig } from './types'
import type { Channel } from '../../channel/base'

/** 工具调用超时时间（2 分钟） */
const TOOL_CALL_TIMEOUT_MS = 120_000

export abstract class BaseAgent extends EventEmitter {
  protected openai: OpenAI
  protected mcpClient?: MCPClient
  protected channel?: Channel
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
  protected runningEphemeral: boolean = false

  private interventionResolve?: (value: string) => void

  constructor(config: BaseAgentConfig) {
    super()
    this.openai = config.openai
    this.agentName = config.agentName
    this.model = config.model
    this.workspaceRoot = config.workspaceRoot
    this.mcpClient = config.mcpClient
    this.channel = config.channel
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

  /**
   * 请求人工干预（HITL）
   * 发出 `intervention_required` 事件，挂起 Agent 循环，等待外部调用 resolve 后恢复
   */
  async requestIntervention(prompt: string, timeoutMs?: number): Promise<string> {
    const defaultTimeout = this.runningEphemeral ? 30_000 : 300_000
    const timeout = timeoutMs ?? defaultTimeout

    let timeoutId: ReturnType<typeof setTimeout>

    const interventionPromise = new Promise<string>((resolve) => {
      this.interventionResolve = resolve
      this.emit('intervention_required', {
        prompt,
        resolve: (input: string) => {
          this.resolveIntervention(input)
          this.emit('intervention_handled', { prompt })
        },
      })
    })

    const timeoutPromise = new Promise<string>((resolve) => {
      timeoutId = setTimeout(() => {
        if (this.interventionResolve) {
          this.resolveIntervention('')
          this.emit('intervention_timeout', { prompt })
        }
        resolve('')
      }, timeout)
    })

    try {
      return await Promise.race([interventionPromise, timeoutPromise])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
    }
  }

  /** 供外部（如 TUI）调用以解决挂起的 intervention Promise */
  public resolveIntervention(input: string): void {
    this.interventionResolve?.(input)
    this.interventionResolve = undefined
  }

  /** 运行 Agent 主循环 */
  async run(input: string): Promise<string> {
    this.state = 'running'
    this.iterations = 0
    this.lastAction = 'start'

    try {
      await this.loadSession()
      this.initMessages(input)
      const tools = await this.getAvailableTools()

      const result = await this.runMainLoop(tools)

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
   * 主循环逻辑（不加载/保存 session）
   * 供 run() 和 runEphemeral() 共用
   */
  protected async runMainLoop(tools: ChatCompletionTool[]): Promise<string | null> {
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

    return result
  }

  /**
   * 无状态单次执行（Ephemeral 模式）
   * 不加载/保存 session，执行完后恢复原有消息上下文
   */
  async runEphemeral(
    initialPrompt: string,
    options: { timeoutMs?: number } = {}
  ): Promise<string> {
    const savedMessages = this.messages
    const savedState = this.state
    const savedEphemeral = this.runningEphemeral

    this.messages = []
    this.state = 'running'
    this.iterations = 0
    this.lastAction = 'ephemeral_start'
    this.runningEphemeral = true

    let timeoutId: ReturnType<typeof setTimeout> | undefined

    try {
      this.initMessages(initialPrompt)
      const tools = await this.getAvailableTools()
      const runPromise = this.runMainLoop(tools)

      const result = options.timeoutMs
        ? await Promise.race([
            runPromise,
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () =>
                  reject(
                    new Error(
                      `[${this.agentName}] runEphemeral timed out after ${options.timeoutMs}ms`
                    )
                  ),
                options.timeoutMs
              )
            }),
          ])
        : await runPromise

      return result ?? '任务完成'
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      // 销毁临时上下文，不调用 saveSession()
      this.messages = savedMessages
      this.state = savedState
      this.runningEphemeral = savedEphemeral
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
      'typst_compile',
    ]

    if (localToolNames.includes(toolName)) {
      const context: ToolContext = {
        workspaceRoot: this.workspaceRoot,
        agentName: this.agentName,
        logger: (line, type) => {
          if (this.channel) {
            this.channel.send({
              type: type === 'error' ? 'tool_error' : 'tool_warn',
              payload: { message: line, toolName },
              timestamp: new Date(),
            })
          }
        },
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
    return Promise.all(
      toolCalls.map((tc) =>
        Promise.race([
          this.executeToolCall(tc),
          new Promise<ChatCompletionMessageParam>((resolve) =>
            setTimeout(
              () =>
                resolve({
                  role: 'tool',
                  tool_call_id: tc.id,
                  content: `错误: 工具调用超时 (${TOOL_CALL_TIMEOUT_MS / 1000}s)`,
                }),
              TOOL_CALL_TIMEOUT_MS
            )
          ),
        ])
      )
    )
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

  /**
   * 加载 Skill 文件（SOP）
   * workspace/skills/ 中的用户版本优先于 src/agents/skills/ 中的代码版本
   */
  protected loadSkill(name: string): string {
    const userPath = path.join(this.workspaceRoot, 'skills', `${name}.md`)
    const codePath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../skills',
      `${name}.md`
    )
    if (fs.existsSync(userPath)) return fs.readFileSync(userPath, 'utf-8')
    if (fs.existsSync(codePath)) return fs.readFileSync(codePath, 'utf-8')
    return ''
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