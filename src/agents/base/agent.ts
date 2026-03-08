/** BaseAgent - 基于 OpenAI Tool Calling 的自主循环 Agent 基类 */
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import { EventEmitter } from 'node:events'
import { executeTool, TOOLS, type ToolContext, type ToolResult } from '../../tools/index'
import type { AgentState, Session, Task } from '../../types'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_KEEP_RECENT_MESSAGES } from './constants'
import { ContextCompressor } from './context-compressor'
import type { MCPClient, AgentSnapshot, BaseAgentConfig } from './types'
import type { Channel } from '../../channel/base'
import { eventBus } from '../../eventBus'
import type { InterventionResolvedPayload } from '../../eventBus'
import * as utils from './agent-utils'

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
    this.channel = config.channel ? utils.wrapChannel(config.channel, this.agentName) : config.channel
    this.maxIterations = config.maxIterations ?? DEFAULT_MAX_ITERATIONS
    this.keepRecentMessages = config.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES
    this.summaryModel = config.summaryModel ?? 'gpt-4o-mini'

    this.compressor = new ContextCompressor({
      openai: this.openai,
      summaryModel: this.summaryModel,
      keepRecentMessages: this.keepRecentMessages,
    })
  }

  protected abstract get systemPrompt(): string

  protected setState(state: AgentState): void {
    this.state = state
    eventBus.emit('agent:state', { agentName: this.agentName, state })
  }

  async requestIntervention(prompt: string, timeoutMs?: number): Promise<string> {
    const timeout = timeoutMs ?? (this.runningEphemeral ? 30_000 : 300_000)
    eventBus.emit('intervention:required', { agentName: this.agentName, prompt })

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const interventionPromise = new Promise<string>((resolve) => {
      this.interventionResolve = resolve
      this.emit('intervention_required', { prompt, resolve: (i: string) => this.resolveIntervention(i) })
    })

    const busResolveHandler = (p: InterventionResolvedPayload): void => {
      if (p.agentName === this.agentName) this.resolveIntervention(p.input)
    }
    eventBus.on('intervention:resolved', busResolveHandler)

    const timeoutPromise = new Promise<string>((resolve) => {
      timeoutId = setTimeout(() => {
        if (this.interventionResolve) this.resolveIntervention('')
        resolve('')
      }, timeout)
    })

    try {
      return await Promise.race([interventionPromise, timeoutPromise])
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      eventBus.off('intervention:resolved', busResolveHandler)
    }
  }

  public resolveIntervention(input: string): void {
    this.interventionResolve?.(input)
    this.interventionResolve = undefined
  }

  async run(input: string): Promise<string> {
    this.setState('running')
    this.iterations = 0
    this.lastAction = 'start'
    try {
      await this.loadSession()
      this.messages = utils.initMessages(this.messages, this.systemPrompt, input)
      const tools = await this.getAvailableTools()
      const result = await this.runMainLoop(tools)
      this.messages = await this.compressor.checkAndCompress(this.messages)
      await this.saveSession()
      return result ?? '任务完成，但没有生成响应。'
    } catch (error) {
      this.setState('error')
      this.lastAction = `error: ${(error as Error).message}`
      throw error
    }
  }

  protected async runMainLoop(tools: ChatCompletionTool[]): Promise<string | null> {
    let result: string | null = null
    while (this.iterations < this.maxIterations) {
      this.iterations++
      this.lastAction = 'llm_call'
      let response
      try {
        response = await this.callLLM(tools)
      } catch (e: any) {
        // 捕获 OpenAI SDK 抛出的详细错误 (如 401, 429 等)
        const status = e.status || e.statusCode || 'Unknown'
        const code = e.code || e.type || 'None'
        const apiMsg = e.message || String(e)
        throw new Error(`LLM API 请求失败 [Status: ${status}, Code: ${code}]: ${apiMsg}`)
      }

      const message = response.choices && response.choices[0]?.message
      if (!message) {
        // 如果请求成功但没有 choices，打印原始响应的 JSON 片段
        const rawSnippet = JSON.stringify(response).slice(0, 200)
        throw new Error(`LLM 响应格式异常: 缺少 choices。原始响应前200位: ${rawSnippet}`)
      }
      if (message.content) result = message.content

      // 无论是否有工具调用，都应记录助手消息
      this.messages.push(message)

      if (message.tool_calls && message.tool_calls.length > 0) {
        this.lastAction = 'tool_call'
        const toolResults = await this.executeToolCalls(message.tool_calls)
        for (const tr of toolResults) this.messages.push(tr)
        continue
      }

      if (result) {
        this.setState('idle'); this.lastAction = 'completed'; break
      }
    }
    if (this.iterations >= this.maxIterations) {
      this.setState('waiting'); this.lastAction = 'max_iterations'
      result = `已达到最大迭代次数 (${this.maxIterations})，当前任务可能未完成。`
    }
    return result
  }

  async runEphemeral(initialPrompt: string, options: { timeoutMs?: number } = {}): Promise<string> {
    const saved = { messages: this.messages, state: this.state, runningEphemeral: this.runningEphemeral }
    this.messages = []; this.setState('running'); this.iterations = 0; this.lastAction = 'ephemeral_start'; this.runningEphemeral = true
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      this.messages = utils.initMessages(this.messages, this.systemPrompt, initialPrompt)
      const tools = await this.getAvailableTools()
      const runPromise = this.runMainLoop(tools)
      const result = options.timeoutMs ? await Promise.race([runPromise, new Promise<null>((_, r) => {
        timeoutId = setTimeout(() => r(new Error(`[${this.agentName}] runEphemeral timed out`)), options.timeoutMs)
      })]) : await runPromise
      return result ?? '任务完成'
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      this.messages = saved.messages; this.state = saved.state; this.runningEphemeral = saved.runningEphemeral
    }
  }

  getState(): AgentSnapshot {
    return {
      agentName: this.agentName, state: this.state, iterations: this.iterations,
      tokenCount: this.compressor.calculateTokens(this.messages),
      lastAction: this.lastAction, currentTask: this.currentTask,
    }
  }

  protected async getAvailableTools(): Promise<ChatCompletionTool[]> {
    if (this.availableTools) return this.availableTools
    const tools: ChatCompletionTool[] = [...TOOLS]
    if (this.mcpClient) {
      try {
        const mcpTools = await this.mcpClient.listTools()
        for (const t of mcpTools) tools.push({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })
      } catch (e) { console.error('获取 MCP 工具失败:', e) }
    }
    this.availableTools = tools
    return tools
  }

  protected async executeToolCall(toolCall: ChatCompletionMessageToolCall): Promise<ChatCompletionMessageParam> {
    const toolName = toolCall.function.name
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(toolCall.function.arguments) } catch {
      return { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: '无法解析工具参数' }) }
    }
    let result: ToolResult
    const localTools = ['read_file', 'write_file', 'append_file', 'list_directory', 'lock_file', 'unlock_file']
    if (localTools.includes(toolName)) {
      const ctx: ToolContext = {
        workspaceRoot: this.workspaceRoot, agentName: this.agentName,
        logger: (line, type) => {
          if (this.channel) this.channel.send({ type: type === 'error' ? 'tool_error' : 'tool_warn', payload: { message: line, toolName }, timestamp: new Date() })
        },
      }
      result = await executeTool(toolName, args, ctx)
    } else if (this.mcpClient) {
      try {
        const r = await this.mcpClient.callTool(toolName, args)
        result = { success: true, content: typeof r === 'string' ? r : JSON.stringify(r) }
      } catch (e) { result = { success: false, content: '', error: (e as Error).message } }
    } else {
      result = { success: false, content: '', error: `未知工具: ${toolName}` }
    }
    await this.onToolResult(toolName, result)
    return { role: 'tool', tool_call_id: toolCall.id, content: result.success ? result.content : `错误: ${result.error}` }
  }

  protected async executeToolCalls(toolCalls: ChatCompletionMessageToolCall[]): Promise<ChatCompletionMessageParam[]> {
    return Promise.all(toolCalls.map((tc) => Promise.race([
      this.executeToolCall(tc),
      new Promise<ChatCompletionMessageParam>((resolve) => setTimeout(() => resolve({ role: 'tool', tool_call_id: tc.id, content: `错误: 工具调用超时` }), TOOL_CALL_TIMEOUT_MS)),
    ])))
  }

  protected async onToolResult(_name: string, _res: ToolResult): Promise<void> {}

  protected async loadSession(): Promise<void> {
    const s = utils.loadSession(this.getSessionPath())
    if (s) { this.currentTask = s.currentTask; this.messages = s.messages || []; if (s.context) this.restoreContext(s.context) }
  }

  protected async saveSession(): Promise<void> {
    const session: Session = { currentTask: this.currentTask, context: this.extractContext(), messages: this.messages.filter((m) => m.role !== 'system'), todos: [] }
    utils.saveSession(this.getSessionPath(), session)
  }

  protected getSessionPath(): string {
    return utils.getSessionPath(this.workspaceRoot, this.agentName)
  }

  protected loadSkill(name: string): string {
    return utils.loadSkill(this.workspaceRoot, name)
  }

  protected initMessages(input: string): void {
    const systemContent = `${this.systemPrompt}\n\n重要：请始终使用中文与用户交流。`
    if (this.messages.length === 0) {
      this.messages = [
        { role: 'system', content: systemContent },
        { role: 'user', content: input },
      ]
    } else {
      const hasSystem = this.messages.length > 0 && this.messages[0].role === 'system'
      if (!hasSystem) {
        this.messages.unshift({ role: 'system', content: systemContent })
      } else {
        this.messages[0].content = systemContent
      }
      this.messages.push({ role: 'user', content: input })
    }
  }

  protected calculateTokens(): number {
    return this.compressor.calculateTokens(this.messages)
  }

  protected extractContext(): Record<string, unknown> { return {} }
  protected restoreContext(_c: Record<string, unknown>): void {}

  protected async callLLM(tools: ChatCompletionTool[]): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    return this.openai.chat.completions.create({ model: this.model, messages: this.messages, tools, tool_choice: 'auto' })
  }
}
