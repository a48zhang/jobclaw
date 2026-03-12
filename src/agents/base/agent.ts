/** BaseAgent - 基于 OpenAI Tool Calling 的自主循环 Agent 基类 */
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import { EventEmitter } from 'node:events'
import { executeTool, TOOLS, type ToolContext, type ToolResult } from '../../tools/index.js'
import type { AgentState, Session, Task } from '../../types.js'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_KEEP_RECENT_MESSAGES } from './constants.js'
import { ContextCompressor } from './context-compressor.js'
import type { MCPClient, AgentSnapshot, BaseAgentConfig } from './types.js'
import type { Channel } from '../../channel/base.js'
import { eventBus } from '../../eventBus.js'
import type { InterventionResolvedPayload, RequestKind } from '../../eventBus.js'
import * as utils from './agent-utils.js'

const TOOL_CALL_TIMEOUT_MS = 120_000
const REQUEST_TOOL_NAME = 'request'
const REQUEST_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: REQUEST_TOOL_NAME,
    description: '向用户请求补充输入并暂停执行，直到用户回复或超时。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '要展示给用户的问题或提示' },
        kind: {
          type: 'string',
          enum: ['text', 'confirm', 'single_select'],
          description: '请求的交互类型，默认 text',
        },
        options: {
          type: 'array',
          items: { type: 'string' },
          description: '当 kind=single_select 时可选，用于展示候选项',
        },
        timeout_ms: { type: 'number', description: '等待用户输入的超时时间（毫秒）' },
        allow_empty: { type: 'boolean', description: '是否允许空输入，默认 true' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
}

interface RequestInterventionOptions {
  requestId?: string
  kind?: RequestKind
  options?: string[]
  allowEmpty?: boolean
}

export abstract class BaseAgent extends EventEmitter {
  protected openai: OpenAI
  protected mcpClient?: MCPClient
  protected channel?: Channel
  public readonly agentName: string
  protected model: string
  protected workspaceRoot: string
  protected maxIterations: number
  protected keepRecentMessages: number
  protected lightModel: string

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
    this.lightModel = config.lightModel || config.model

    this.compressor = new ContextCompressor({
      openai: this.openai,
      lightModel: this.lightModel,
      keepRecentMessages: this.keepRecentMessages,
    })
  }

  protected abstract get systemPrompt(): string

  protected setState(state: AgentState): void {
    this.state = state
    eventBus.emit('agent:state', { agentName: this.agentName, state })
  }

  async requestIntervention(
    prompt: string,
    timeoutMs?: number,
    options: RequestInterventionOptions = {}
  ): Promise<string> {
    const timeout = timeoutMs ?? (this.runningEphemeral ? 30_000 : 300_000)
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const expectedRequestId = options.requestId
    const interventionPromise = new Promise<string>((resolve) => {
      this.interventionResolve = resolve
      this.emit('intervention_required', { prompt, resolve: (i: string) => this.resolveIntervention(i) })
    })
    const busResolveHandler = (p: InterventionResolvedPayload): void => {
      if (p.agentName !== this.agentName) return
      if (expectedRequestId && p.requestId !== expectedRequestId) return
      this.resolveIntervention(p.input)
    }
    eventBus.on('intervention:resolved', busResolveHandler)
    const timeoutPromise = new Promise<string>((resolve) => {
      timeoutId = setTimeout(() => {
        if (this.interventionResolve) {
          this.resolveIntervention('')
          this.emit('intervention_timeout')
        }
        resolve('')
      }, timeout)
    })
    eventBus.emit('intervention:required', {
      agentName: this.agentName,
      prompt,
      requestId: options.requestId,
      kind: options.kind,
      options: options.options,
      timeoutMs: timeout,
      allowEmpty: options.allowEmpty,
    })
    try {
      const result = await Promise.race([interventionPromise, timeoutPromise])
      this.emit('intervention_handled')
      return result
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
    this.setState('running'); this.iterations = 0; this.lastAction = 'start'
    try {
      this.initMessages(input)
      if (!this.runningEphemeral) await this.saveSession()
      const tools = await this.getAvailableTools()
      const result = await this.runMainLoop(tools)
      this.messages = await this.compressor.checkAndCompress(this.messages)
      if (!this.runningEphemeral) await this.saveSession()
      return result ?? '任务完成，但没有生成响应。'
    } catch (error) {
      this.setState('error'); this.lastAction = `error: ${(error as Error).message}`
      if (!this.runningEphemeral) await this.saveSession().catch(() => {})
      throw error
    }
  }

  protected async runMainLoop(tools: ChatCompletionTool[]): Promise<string | null> {
    let result: string | null = null
    while (this.iterations < this.maxIterations) {
      this.iterations++; this.lastAction = 'llm_call'
      let fullContent = ''; let toolCalls: any[] = []; let isFirstChunk = true
      try {
        const stream = await this.openai.chat.completions.create({
          model: this.model, messages: this.messages, tools, tool_choice: 'auto', stream: true
        })

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta
          if (!delta) continue

          // 1. 处理内容流
          if (delta.content) {
            fullContent += delta.content
            if (this.channel) {
              await this.channel.send({
                type: 'agent_response', timestamp: new Date(), payload: {},
                streaming: { isFirst: isFirstChunk, isFinal: false, chunk: delta.content }
              })
              isFirstChunk = false
            }
          }

          // 2. 处理工具调用流
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (!toolCalls[tc.index]) toolCalls[tc.index] = { id: tc.id, function: { name: '', arguments: '' }, type: 'function' }
              if (tc.id) toolCalls[tc.index].id = tc.id
              if (tc.function?.name) toolCalls[tc.index].function.name += tc.function.name
              if (tc.function?.arguments) toolCalls[tc.index].function.arguments += tc.function.arguments
            }
          }
        }

        // 流结束：只要流启动过，就必须发送 Final 标识以重置 TUI 状态
        if (!isFirstChunk && this.channel) {
          await this.channel.send({
            type: 'agent_response', timestamp: new Date(), payload: {},
            streaming: { isFirst: false, isFinal: true, chunk: '' }
          })
        }
      } catch (e: any) {
        throw new Error(`LLM API 请求失败 [Status: ${e.status}, Code: ${e.code}]: ${e.message}`)
      }

      const finalToolCalls = toolCalls.filter(Boolean)
      this.messages.push({ role: 'assistant', content: fullContent || null, tool_calls: finalToolCalls.length > 0 ? finalToolCalls : undefined })

      if (finalToolCalls.length > 0) {
        this.lastAction = 'tool_call'
        for (const tc of finalToolCalls) {
          if (this.channel) await this.channel.send({ type: 'tool_call', payload: { toolName: tc.function.name, args: tc.function.arguments }, timestamp: new Date() })
        }
        const toolResults = await this.executeToolCalls(finalToolCalls)
        for (const tr of toolResults) this.messages.push(tr)
        if (!this.runningEphemeral) await this.saveSession()
        continue
      }

      if (fullContent) {
        result = fullContent; this.setState('idle'); this.lastAction = 'completed'
        // 确保非流式模式下也能看到回复，或者作为流式结束的兜底
        if (this.channel && isFirstChunk) {
          await this.channel.send({ type: 'agent_response', payload: { message: fullContent }, timestamp: new Date() })
        }
        if (!this.runningEphemeral) await this.saveSession()
        break
      }
    }

    if (!result && this.iterations >= this.maxIterations) {
      this.setState('waiting')
      this.lastAction = 'max_iterations_reached'
      result = `已达到最大迭代次数 (${this.maxIterations})，任务可能尚未完成，已挂起等待用户指示。`
    }

    return result
  }

  async runEphemeral(initialPrompt: string, options: { timeoutMs?: number } = {}): Promise<string> {
    const saved = { messages: [...this.messages], state: this.state, runningEphemeral: this.runningEphemeral }
    this.messages = []; this.setState('running'); this.iterations = 0; this.lastAction = 'ephemeral_start'; this.runningEphemeral = true
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    try {
      this.initMessages(initialPrompt)
      const tools = await this.getAvailableTools()
      const runPromise = this.runMainLoop(tools)
      const result = options.timeoutMs ? await Promise.race([runPromise, new Promise<null>((_, r) => {
        timeoutId = setTimeout(() => r(new Error(`[${this.agentName}] runEphemeral timed out`)), options.timeoutMs)
      })]) : await runPromise
      return result ?? '任务完成'
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      this.messages = saved.messages
      this.runningEphemeral = saved.runningEphemeral
      this.setState(saved.state)
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
    const tools: ChatCompletionTool[] = [...TOOLS, REQUEST_TOOL]
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

    if (toolName === REQUEST_TOOL_NAME) {
      return this.executeRequestToolCall(toolCall, args)
    }

    let result: ToolResult
    const localTools = ['read_file', 'write_file', 'append_file', 'list_directory', 'lock_file', 'unlock_file', 'upsert_job', 'typst_compile', 'install_typst', 'run_shell_command', 'read_pdf']
    if (localTools.includes(toolName)) {
      const ctx: ToolContext = {
        workspaceRoot: this.workspaceRoot, agentName: this.agentName,
        logger: (line) => { if (this.channel) this.channel.send({ type: 'tool_output', payload: { message: line, toolName }, timestamp: new Date() }) },
      }
      result = await executeTool(toolName, args, ctx)
    } else if (this.mcpClient) {
      try {
        const r = await this.mcpClient.callTool(toolName, args)
        result = { success: true, content: typeof r === 'string' ? r : JSON.stringify(r) }
      } catch (e) { result = { success: false, content: '', error: (e as Error).message } }
    } else { result = { success: false, content: '', error: `未知工具: ${toolName}` } }
    await this.onToolResult(toolName, result)
    return { role: 'tool', tool_call_id: toolCall.id, content: result.success ? result.content : `错误: ${result.error}` }
  }

  private async executeRequestToolCall(
    toolCall: ChatCompletionMessageToolCall,
    args: Record<string, unknown>
  ): Promise<ChatCompletionMessageParam> {
    const {
      prompt,
      kind = 'text',
      options,
      timeout_ms: timeoutMs,
      allow_empty: allowEmpty = true,
    } = args as {
      prompt?: unknown
      kind?: unknown
      options?: unknown
      timeout_ms?: unknown
      allow_empty?: unknown
    }

    if (typeof prompt !== 'string' || prompt.trim() === '') {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'prompt 参数必须是非空字符串' }),
      }
    }
    if (!['text', 'confirm', 'single_select'].includes(String(kind))) {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'kind 参数不合法' }),
      }
    }
    if (options !== undefined && (!Array.isArray(options) || options.some((item) => typeof item !== 'string'))) {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'options 参数必须是字符串数组' }),
      }
    }
    if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'timeout_ms 参数必须是正数' }),
      }
    }
    if (typeof allowEmpty !== 'boolean') {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: 'allow_empty 参数必须是布尔值' }),
      }
    }

    const input = await this.requestIntervention(prompt, timeoutMs as number, {
      requestId: toolCall.id,
      kind: kind as RequestKind,
      options: options as string[] | undefined,
      allowEmpty,
    })
    const answered = allowEmpty ? true : input.trim().length > 0
    const timedOut = input === ''
    const result: ToolResult = {
      success: true,
      content: JSON.stringify({
        request_id: toolCall.id,
        prompt,
        kind,
        options: options ?? [],
        input,
        answered,
        timed_out: timedOut,
      }),
    }
    await this.onToolResult(REQUEST_TOOL_NAME, result)
    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: result.content,
    }
  }

  protected async executeToolCalls(toolCalls: ChatCompletionMessageToolCall[]): Promise<ChatCompletionMessageParam[]> {
    return Promise.all(toolCalls.map((tc) => Promise.race([
      this.executeToolCall(tc),
      new Promise<ChatCompletionMessageParam>((resolve) => setTimeout(() => resolve({ role: 'tool', tool_call_id: tc.id, content: `错误: 工具调用超时` }), TOOL_CALL_TIMEOUT_MS)),
    ])))
  }

  protected async onToolResult(_name: string, _res: ToolResult): Promise<void> {}

  public async loadSession(): Promise<void> {
    const s = utils.loadSession(this.getSessionPath())
    if (s) { this.currentTask = s.currentTask; this.messages = s.messages || []; if (s.context) this.restoreContext(s.context) }
  }

  public getMessages(): ChatCompletionMessageParam[] { return this.messages }

  protected async saveSession(): Promise<void> {
    const session: Session = { currentTask: this.currentTask, context: this.extractContext(), messages: this.messages.filter((m) => m.role !== 'system'), todos: [] }
    utils.saveSession(this.getSessionPath(), session)
  }

  protected getSessionPath(): string { return utils.getSessionPath(this.workspaceRoot, this.agentName) }
  protected loadSkill(name: string): string { return utils.loadSkill(this.workspaceRoot, name) }

  protected initMessages(input: string): void {
    const systemContent = `${this.systemPrompt}\n\n## 核心行为准则\n1. **严禁编造**: 遇到无法解决的技术问题或信息缺失时，必须如实告知用户或通过 \`request\` 工具请求用户补充输入。绝不能编造虚假信息。\n2. **写入前反思**: 在向 \`data/\` 写入信息前，必须核实数据真实性。\n3. **中文交流**: 始终使用中文与用户交流。`
    if (this.messages.length === 0) {
      this.messages.push({ role: 'system', content: systemContent }, { role: 'user', content: input })
    } else {
      const hasSystem = this.messages.length > 0 && this.messages[0].role === 'system'
      if (!hasSystem) this.messages.unshift({ role: 'system', content: systemContent })
      else this.messages[0].content = systemContent
      this.messages.push({ role: 'user', content: input })
    }
  }

  protected calculateTokens(): number { return this.compressor.calculateTokens(this.messages) }
  protected extractContext(): Record<string, unknown> { return {} }
  protected restoreContext(_c: Record<string, unknown>): void {}

  protected async callLLM(tools: ChatCompletionTool[]): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    // 基础方法仍保留，但在 runMainLoop 中现在优先使用流式逻辑
    return this.openai.chat.completions.create({ model: this.model, messages: this.messages, tools, tool_choice: 'auto' })
  }
}
