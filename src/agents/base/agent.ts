/** BaseAgent - 基于 OpenAI Tool Calling 的自主循环 Agent 基类 */
import type OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
  ChatCompletionMessageToolCall,
} from 'openai/resources/chat/completions'
import { EventEmitter } from 'node:events'
import * as path from 'node:path'
import { executeTool, LOCAL_TOOL_NAMES, TOOLS, type ToolContext, type ToolResult, TOOL_NAMES } from '../../tools/index.js'
import type { AgentState, Session, Task } from '../../types.js'
import { DEFAULT_MAX_ITERATIONS, DEFAULT_KEEP_RECENT_MESSAGES } from './constants.js'
import { ContextCompressor } from './context-compressor.js'
import type { MCPClient, AgentSnapshot, BaseAgentConfig } from './types.js'
import type { AgentFactory } from '../factory.js'
import type { Channel } from '../../channel/base.js'
import { eventBus } from '../../eventBus.js'
import type { InterventionResolvedPayload, RequestKind } from '../../eventBus.js'
import * as utils from './agent-utils.js'
import type { AgentProfile } from '../profiles.js'
import { DelegationManager, type DelegatedRun } from '../delegation-manager.js'
import { inferProfileFromSkill } from '../profiles.js'
import { defaultCapabilityPolicy } from '../../tools/capability-policy.js'

const TOOL_CALL_TIMEOUT_MS = 120_000
const REQUEST_TOOL_NAME = 'request'

class AgentAbortedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentAbortedError'
  }
}

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
  protected lastFinishReason?: string
  protected persistent: boolean
  protected factory?: AgentFactory
  protected readonly profile?: AgentProfile
  protected readonly sessionId: string
  protected readonly delegationManager: DelegationManager

  private interventionResolve?: (value: string) => void

  // ── 异步消息队列 ─────────────────────────────────────────────────────────
  private messageQueue: string[] = []
  private processing: boolean = false
  private executionChain: Promise<void> = Promise.resolve()
  private abortController: AbortController = new AbortController()
  private abortReason: string | null = null

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
    this.persistent = config.persistent ?? false
    this.factory = config.factory
    this.profile = config.profile
    const agentIdentity = this.agentName ?? 'main'
    this.sessionId = config.sessionId ?? agentIdentity
    this.delegationManager = new DelegationManager(this.sessionId, agentIdentity)

    this.compressor = new ContextCompressor({
      openai: this.openai,
      lightModel: this.lightModel,
      keepRecentMessages: this.keepRecentMessages,
    })
  }

  /**
   * 提交消息到队列（非阻塞）
   * - 命令立即执行并返回结果
   * - 普通消息入队，返回排队状态
   */
  submit(input: string): { queued: boolean; message?: string; queueLength?: number } {
    // 命令立即执行
    if (input.startsWith('/')) {
      const cmd = input.slice(1).toLowerCase().trim()

      if (cmd === 'new') {
        const archivePath = this.resetSession()
        const message = archivePath
          ? `会话已归档到 ${path.basename(archivePath)}，已开始新会话`
          : '已开始新会话'
        return { queued: false, message }
      }

      if (cmd === 'clear') {
        this.resetSession()
        return { queued: false, message: '会话已清空' }
      }

      return { queued: false, message: `未知命令: /${cmd}。可用命令: /new (新会话), /clear (清空会话)` }
    }

    // 普通消息入队
    const wasEmpty = this.messageQueue.length === 0
    this.messageQueue.push(input)

    // 如果之前队列为空且没有在处理，启动处理循环
    if (wasEmpty && !this.processing) {
      this.startProcessing()
    }

    return { queued: true, queueLength: this.messageQueue.length }
  }

  /**
   * 启动异步处理循环
   */
  private startProcessing(): void {
    if (this.processing) return
    this.processing = true
    this.processLoop().catch(err => {
      console.error(`[${this.agentName}] Process loop error:`, err)
      this.processing = false
    })
  }

  /**
   * 处理循环：从队列取消息并执行
   */
  private async processLoop(): Promise<void> {
    while (this.messageQueue.length > 0) {
      const input = this.messageQueue.shift()!
      try {
        await this.run(input)
      } catch (err) {
        console.error(`[${this.agentName}] Error processing message:`, err)
      }
    }
    this.processing = false
  }

  /** 同一 Agent 内串行执行 run 任务，避免共享状态并发读写。 */
  private enqueueExecution<T>(task: () => Promise<T>): Promise<T> {
    const runTask = this.executionChain.then(task, task)
    this.executionChain = runTask.then(() => undefined, () => undefined)
    return runTask
  }

  /**
   * 在安全边界（工具调用后 / 一轮完成前）吞掉 submit 队列里尚未处理的用户消息。
   */
  private consumePendingQueuedInputs(): number {
    if (this.messageQueue.length === 0) return 0

    const pending = this.messageQueue.splice(0)
    for (const input of pending) {
      this.messages.push({ role: 'user', content: input })
    }
    return pending.length
  }

  protected abstract get systemPrompt(): string

  protected setState(state: AgentState): void {
    this.state = state
    eventBus.emit('agent:state', { agentName: this.agentName, state })
  }

  public abort(reason = 'Agent aborted'): void {
    if (this.abortController.signal.aborted) return
    this.abortReason = reason
    this.abortController.abort(new AgentAbortedError(reason))
  }

  private resetAbortState(): void {
    this.abortController = new AbortController()
    this.abortReason = null
  }

  private throwIfAborted(): void {
    if (this.abortController.signal.aborted) {
      throw new AgentAbortedError(this.abortReason ?? 'Agent aborted')
    }
  }

  async requestIntervention(
    prompt: string,
    timeoutMs?: number,
    options: RequestInterventionOptions = {}
  ): Promise<string> {
    const timeout = timeoutMs ?? 300_000
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const expectedRequestId = options.requestId
    const interventionPromise = new Promise<string>((resolve) => {
      this.interventionResolve = resolve
      this.emit('intervention_required', {
        prompt,
        resolve: (i: string) => this.resolveIntervention(i),
        kind: options.kind,
        options: options.options,
      })
    })
    const busResolveHandler = (p: InterventionResolvedPayload): void => {
      if (p.agentName !== this.agentName) return
      if (expectedRequestId && p.requestId !== expectedRequestId) return
      this.resolveIntervention(p.input)
    }
    eventBus.on('intervention:resolved', busResolveHandler)
    let abortHandler: (() => void) | undefined
    const abortPromise = new Promise<string>((_, reject) => {
      const onAbort = () => reject(new AgentAbortedError(this.abortReason ?? 'Agent aborted'))
      this.abortController.signal.addEventListener('abort', onAbort, { once: true })
      abortHandler = onAbort
    })
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
      const result = await Promise.race([interventionPromise, timeoutPromise, abortPromise])
      this.emit('intervention_handled')
      return result
    } finally {
      if (timeoutId) clearTimeout(timeoutId)
      eventBus.off('intervention:resolved', busResolveHandler)
      if (abortHandler) {
        this.abortController.signal.removeEventListener('abort', abortHandler)
      }
    }
  }

  public resolveIntervention(input: string): void {
    this.interventionResolve?.(input)
    this.interventionResolve = undefined
  }

  async run(input: string): Promise<string> {
    return this.enqueueExecution(async () => {
      this.resetAbortState()
      // ── 正常处理 ─────────────────────────────────────────────────────────────
      this.setState('running'); this.iterations = 0; this.lastAction = 'start'
      try {
        this.initMessages(input)
        this.throwIfAborted()
        await this.saveSession()
        const tools = await this.getAvailableTools()
        this.throwIfAborted()
        const result = await this.runMainLoop(tools)
        this.throwIfAborted()
        this.messages = await this.compressor.checkAndCompress(this.messages)
        await this.saveSession()
        return result ?? '任务完成，但没有生成响应。'
      } catch (error) {
        if (error instanceof AgentAbortedError) {
          this.setState('idle')
          this.lastAction = `aborted: ${error.message}`
        } else {
          this.setState('error')
          this.lastAction = `error: ${(error as Error).message}`
        }
        await this.saveSession().catch(() => { })
        throw error
      }
    })
  }

  protected async runMainLoop(tools: ChatCompletionTool[]): Promise<string | null> {
    let result: string | null = null

    while (this.iterations < this.maxIterations) {
      this.throwIfAborted()
      this.iterations++; this.lastAction = 'llm_call'

      let fullContent = ''; let toolCalls: any[] = []
      let chunkCount = 0
      let finishReason: string | null = null

      const validMessages = this.messages.filter((m) => {
        if (m.role === 'assistant') {
          const hasContent = typeof m.content === 'string' && m.content.trim().length > 0
          const hasToolCalls = Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0
          return hasContent || hasToolCalls
        }
        return true
      })

      if (validMessages.length !== this.messages.length) {
        this.messages = validMessages
      }

      // 在系统提示词中添加当前时间
      const now = new Date()
      const timeInfo = now.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'long' })

      // 将时间信息注入到第一条 system 消息中
      const messagesWithTime: ChatCompletionMessageParam[] = this.messages.map((m, i) => {
        if (i === 0 && m.role === 'system') {
          return { role: 'system', content: `当前时间: ${timeInfo}\n\n${m.content}` }
        }
        return m
      })

      // 发送上下文使用量更新事件
      const tokenCount = this.compressor.calculateTokens(messagesWithTime)
      eventBus.emit('context:usage', { agentName: this.agentName, tokenCount })

      try {
        const stream = await this.openai.chat.completions.create(
          {
            model: this.model,
            messages: messagesWithTime,
            tools,
            tool_choice: 'auto',
            stream: true,
          },
          { signal: this.abortController.signal }
        )

        const iterator = stream[Symbol.asyncIterator]()
        let iterResult = await iterator.next()

        while (!iterResult.done) {
          this.throwIfAborted()
          const chunk = iterResult.value
          chunkCount++
          const choice = chunk.choices?.[0]
          if (!choice) {
            iterResult = await iterator.next()
            continue
          }

          // 捕获 finish_reason
          if ((choice as any).finish_reason) {
            finishReason = (choice as any).finish_reason
          }

          // 支持两种格式：
          // 1. 标准流式: delta.content, delta.tool_calls
          // 2. 非标准/单chunk: message.content, message.tool_calls
          const delta = choice.delta
          const message = (choice as any).message

          const content = delta?.content ?? message?.content
          const tc = delta?.tool_calls ?? message?.tool_calls

          // 1. 处理内容流
          if (content) {
            fullContent += content
            // 流式输出 agent 思考内容给用户
            if (this.channel) {
              this.channel.send({
                type: 'agent_response',
                payload: { message: content },
                streaming: {
                  isFirst: chunkCount === 1,
                  chunk: content,
                  isFinal: false
                },
                timestamp: new Date()
              })
            }
          }

          // 2. 处理工具调用流
          if (tc) {
            for (const t of tc) {
              const index = t.index ?? 0
              if (!toolCalls[index]) toolCalls[index] = { id: t.id, function: { name: '', arguments: '' }, type: 'function' }
              if (t.id) toolCalls[index].id = t.id
              if (t.function?.name) toolCalls[index].function.name += t.function.name
              if (t.function?.arguments) toolCalls[index].function.arguments += t.function.arguments
            }
          }

          iterResult = await iterator.next()
        }

        // 流结束，发送 isFinal 消息清理状态
        if (this.channel && fullContent) {
          this.channel.send({
            type: 'agent_response',
            payload: { message: '' },
            streaming: { isFirst: false, chunk: '', isFinal: true },
            timestamp: new Date()
          })
        }

        // LLM 请求结束后发送上下文使用量更新
        const tokensAfterResponse = this.compressor.calculateTokens(this.messages)
        eventBus.emit('context:usage', { agentName: this.agentName, tokenCount: tokensAfterResponse })
      } catch (e: any) {
        if (this.abortController.signal.aborted || e?.name === 'AbortError') {
          throw new AgentAbortedError(this.abortReason ?? 'Agent aborted')
        }
        const status = e?.status ? `Status: ${e.status}` : 'Status: unknown'
        const code = e?.code ? `Code: ${e.code}` : 'Code: unknown'
        throw new Error(`LLM API 请求失败（${status}, ${code}）。请检查 API_KEY、BASE_URL 和网络连接。`)
      }

      const finalToolCalls = toolCalls.filter(Boolean)
      this.throwIfAborted()

      // 不添加空的assistant消息
      if (!fullContent && finalToolCalls.length === 0) {
        console.error(`[${this.agentName}] LLM returned empty response after ${chunkCount} chunks`)
        console.error(`${this.messages.map(m => JSON.stringify(m)).join('\n')}`)
        this.setState('error')
        this.lastAction = 'empty_response'
        result = 'LLM返回空响应，请检查API配置或稍后重试。'
        break
      }

      // 保存 finish_reason 到实例和 message 中
      this.lastFinishReason = finishReason || undefined
      this.messages.push({
        role: 'assistant',
        content: fullContent || null,
        tool_calls: finalToolCalls.length > 0 ? finalToolCalls : undefined,
        finish_reason: finishReason || undefined,
      } as any)

      if (finalToolCalls.length > 0) {
        this.lastAction = 'tool_call'
        for (const tc of finalToolCalls) {
          if (this.channel) await this.channel.send({ type: 'tool_call', payload: { toolName: tc.function.name, args: tc.function.arguments }, timestamp: new Date() })
        }
        const toolResults = await this.executeToolCalls(finalToolCalls)
        for (const tr of toolResults) this.messages.push(tr)
        // 工具调用结果添加后发送上下文使用量更新
        const tokensAfterTools = this.compressor.calculateTokens(this.messages)
        eventBus.emit('context:usage', { agentName: this.agentName, tokenCount: tokensAfterTools })

        // 在工具边界消费 submit 队列中的待处理用户消息，避免下一轮还要重新排队。
        const consumed = this.consumePendingQueuedInputs()
        if (consumed > 0) {
          this.lastAction = `consumed_${consumed}_queued_messages`
        }

        await this.saveSession()
        continue
      }

      if (fullContent) {
        // LLM 返回纯文本（无工具调用），先检查是否有待处理的用户消息。
        const consumed = this.consumePendingQueuedInputs()
        if (consumed > 0) {
          this.lastAction = `consumed_${consumed}_queued_messages`
          await this.saveSession()
          continue
        }

        // 无新消息，正常结束
        result = fullContent
        this.setState('idle')
        this.lastAction = 'completed'
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
        for (const t of mcpTools) {
          tools.push({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.inputSchema },
          })
        }
      } catch (e) {
        console.error('获取 MCP 工具失败:', e)
      }
    }
    const filtered = tools.filter((tool) => tool.function?.name && this.isToolAllowed(tool.function.name))
    this.availableTools = filtered
    return filtered
  }

  protected async executeToolCall(toolCall: ChatCompletionMessageToolCall): Promise<ChatCompletionMessageParam> {
    this.throwIfAborted()
    const toolName = toolCall.function.name
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(toolCall.function.arguments)
    } catch {
      return { role: 'tool', tool_call_id: toolCall.id, content: JSON.stringify({ error: '无法解析工具参数' }) }
    }

    if (toolName === REQUEST_TOOL_NAME) {
      return this.executeRequestToolCall(toolCall, args)
    }

    if (!toolName) {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: '工具名称缺失' }),
      }
    }

    if (!this.isToolAllowed(toolName)) {
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: `未授权调用工具: ${toolName}` }),
      }
    }

    const decoratedArgs = { ...args }
    const runRecord = this.prepareDelegatedRun(toolName, decoratedArgs)
    if (runRecord) {
      this.delegationManager.updateState(runRecord.id, 'running')
    }

    const ctx: ToolContext = {
      workspaceRoot: this.workspaceRoot,
      agentName: this.agentName,
      profile: this.profile,
      capabilityPolicy: defaultCapabilityPolicy,
      logger: (line) => {
        if (this.channel) {
          this.channel.send({
            type: 'tool_output',
            payload: { message: line, toolName },
            timestamp: new Date(),
          })
        }
      },
      factory: this.factory,
      signal: this.abortController.signal,
    }

    const invokeTool = async (): Promise<ToolResult> => {
      if (LOCAL_TOOL_NAMES.includes(toolName as (typeof LOCAL_TOOL_NAMES)[number])) {
        return executeTool(toolName, decoratedArgs, ctx)
      }
      if (this.mcpClient) {
        try {
          const r = await this.mcpClient.callTool(toolName, decoratedArgs)
          return { success: true, content: typeof r === 'string' ? r : JSON.stringify(r) }
        } catch (error) {
          return { success: false, content: '', error: (error as Error).message }
        }
      }
      return { success: false, content: '', error: `未知工具: ${toolName}` }
    }

    let result: ToolResult
    try {
      result = await invokeTool()
      if (runRecord) {
        if (result.success) {
          this.delegationManager.completeRun(runRecord.id, result.content ?? '')
        } else {
          this.delegationManager.failRun(runRecord.id, result.error ?? result.content ?? '子 Agent 执行失败')
        }
      }
    } catch (error) {
      if (runRecord) {
        this.delegationManager.failRun(runRecord.id, (error as Error).message)
      }
      throw error
    }

    this.throwIfAborted()
    await this.onToolResult(toolName, result)
    return {
      role: 'tool',
      tool_call_id: toolCall.id,
      content: result.success ? result.content : `错误: ${result.error}`,
    }
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
    const results: ChatCompletionMessageParam[] = []
    for (const tc of toolCalls) {
      this.throwIfAborted()
      const result = await Promise.race([
        this.executeToolCall(tc),
        new Promise<ChatCompletionMessageParam>((resolve) =>
          setTimeout(() => resolve({ role: 'tool', tool_call_id: tc.id, content: `错误: 工具调用超时` }), TOOL_CALL_TIMEOUT_MS)
        ),
      ])
      this.throwIfAborted()
      results.push(result)
    }
    return results
  }

  protected isToolAllowed(toolName: string): boolean {
    if (toolName === REQUEST_TOOL_NAME) return true
    if (!this.profile) return true
    return defaultCapabilityPolicy.canUseTool(this.profile, toolName).allowed
  }

  private prepareDelegatedRun(toolName: string, args: Record<string, unknown>): DelegatedRun | undefined {
    if (toolName !== TOOL_NAMES.RUN_AGENT) return undefined
    const instruction = typeof args.instruction === 'string' ? args.instruction.trim() : ''
    if (!instruction) return undefined
    const skill = typeof args.skill === 'string' ? args.skill : undefined
    const profileName = inferProfileFromSkill(skill)
    if (this.profile && !defaultCapabilityPolicy.canDelegate(this.profile, profileName).allowed) {
      throw new Error(`当前 profile 不允许委派到 ${profileName}`)
    }
    args.profile = profileName
    const runRecord = this.delegationManager.createDelegatedRun(profileName, instruction)
    args.delegated_run_id = runRecord.id
    return runRecord
  }

  protected async onToolResult(_name: string, _res: ToolResult): Promise<void> { }

  public async loadSession(): Promise<void> {
    const s = utils.loadSession(this.getSessionPath())
    if (s) {
      this.currentTask = s.currentTask
      this.messages = s.messages || []
      if (s.context) this.restoreContext(s.context)
      if (s.finishReason) this.lastFinishReason = s.finishReason
    }
  }

  public getMessages(): ChatCompletionMessageParam[] { return this.messages }

  /**
   * 重置会话：归档当前 session.json，清空消息历史和状态
   * @returns 归档后的文件路径
   */
  public resetSession(): string | null {
    const archivePath = utils.archiveSession(this.getSessionPath())
    this.messages = []
    this.currentTask = null
    this.lastFinishReason = undefined
    this.iterations = 0
    this.state = 'idle'
    this.lastAction = ''
    return archivePath
  }

  protected async saveSession(): Promise<void> {
    if (!this.persistent) return

    const session: Session = {
      currentTask: this.currentTask,
      context: this.extractContext(),
      messages: this.messages.filter((m) => m.role !== 'system'),
      todos: [],
      finishReason: this.lastFinishReason,
    }
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
  protected restoreContext(_c: Record<string, unknown>): void { }

  protected async callLLM(tools: ChatCompletionTool[]): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    // 基础方法仍保留，但在 runMainLoop 中现在优先使用流式逻辑
    return this.openai.chat.completions.create(
      {
        model: this.model,
        messages: this.messages,
        tools,
        tool_choice: 'auto',
      },
      { signal: this.abortController.signal }
    )
  }
}
