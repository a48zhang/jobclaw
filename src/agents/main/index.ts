// MainAgent - Phase 3 实现
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { BaseAgent } from '../base'
import type { BaseAgentConfig, AgentSnapshot } from '../base/types'
import type { ToolResult } from '../../tools/index'
import type { Channel } from '../../channel/base'

// ============================================================================
// 接口定义
// ============================================================================

/** DeliveryAgent 接口（开发时可用 stub 代替） */
export interface IDeliveryAgent {
  run(input: string): Promise<string>
  getState(): AgentSnapshot
  runEphemeral(initialPrompt: string, options?: { timeoutMs?: number }): Promise<string>
}

/** MainAgent 配置 */
export interface MainAgentConfig extends BaseAgentConfig {
  deliveryAgent: IDeliveryAgent
  /** 交互模式可选；Ephemeral/CronJob 模式时必须提供 */
  channel?: Channel
}

// ============================================================================
// run_delivery_agent 工具定义
// ============================================================================

const runDeliveryAgentTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'run_delivery_agent',
    description:
      '启动投递 Agent 执行简历投递。传入本次投递的具体指令，如"投递所有 discovered 状态的职位"。投递 Agent 会自动读取 jobs.md 并完成表单填写。',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: '传递给 DeliveryAgent 的具体指令',
        },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
}

/**
 * jobs.md discovered 行正则
 *
 * 捕获组：
 *   1 — 公司名（不跨列：[^|]+?）
 *   2 — 职位名（不跨列：[^|]+?）
 *   3 — 职位链接（非空白/非管道：[^\s|]+）
 *
 * 标志：
 *   g — 匹配所有行（一次 append 可能包含多条记录）
 *   m — 允许 ^ 匹配每行行首，适配多行 append 内容
 */
const DISCOVERED_JOB_PATTERN =
  /^\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(https?:\/\/[^\s|]+)\s*\|\s*discovered\s*\|/gm

/** MCP 未连接时注入 systemPrompt 的警告块 */
const MCP_NOT_CONNECTED_WARNING =
  '\n> ⚠️ **注意：MCP 未连接**。当前不可用 Playwright 浏览器工具，无法执行自动化网页搜索。请通知用户连接 MCP 后再执行搜索任务。\n'

// ============================================================================
// MainAgent 实现
// ============================================================================

export class MainAgent extends BaseAgent {
  private deliveryAgent: IDeliveryAgent
  private channel?: Channel
  private lastCronAt: string | null = null

  constructor(config: MainAgentConfig) {
    super({ ...config, agentName: config.agentName ?? 'main' })
    this.deliveryAgent = config.deliveryAgent
    this.channel = config.channel

    if (!config.mcpClient) {
      console.warn(
        '[MainAgent] 警告：未提供 mcpClient，Playwright 浏览器工具不可用。搜索功能将受限。'
      )
    }
  }

  /** 系统提示词，内嵌 jobclaw-skills SOP */
  protected get systemPrompt(): string {
    const skills = this.loadSkill('jobclaw-skills')
    const mcpWarning = this.mcpClient ? '' : MCP_NOT_CONNECTED_WARNING
    return `你是 JobClaw 的主 Agent（MainAgent），负责用户交互、职位搜索与任务调度。
${mcpWarning}
## 角色职责
- 与用户进行自然语言交互，持续保持对话
- 直接使用 Playwright MCP 工具访问招聘网站，搜索并发现职位
- 发现新职位后写入 data/jobs.md（需加锁）
- 通过 run_delivery_agent 工具委托 DeliveryAgent 执行简历投递

## 可用工具
- **run_delivery_agent**: 启动 DeliveryAgent 执行投递任务（串行，独立上下文）
- **read_file / write_file / append_file**: 读写工作区文件
- **lock_file / unlock_file**: 对共享文件加锁/解锁（写入 jobs.md 前必须加锁）
- **list_directory**: 列出目录内容
- **Playwright MCP 工具**: 浏览器操作（browser_navigate、browser_snapshot 等）

## 文件约定
- **data/targets.md**: 监测目标列表（公司名、招聘页 URL），可查看和引导用户维护
- **data/jobs.md**: 职位列表（发现后追加 \`| 公司 | 职位 | 链接 | discovered | |\`）
- **data/userinfo.md**: 用户简历信息（只读，引导用户补充）
- **agents/main/session.json**: 交互会话记忆（自动管理）
- **agents/main/notebook.md**: 跨会话持久化笔记

## 写入 jobs.md 格式
追加格式为：\`| {公司} | {职位} | {链接} | discovered | |\`
写入前必须先检查去重，再加锁写入：lock_file → append_file → unlock_file

## 搜索结果统计（必须遵守）
每次搜索完成后，在回复的**最后一行**输出以下结构化标记（N 为本次新增职位数）：
\`[FOUND: N]\`
示例：本次搜索发现 3 个新职位，回复结尾必须包含 \`[FOUND: 3]\`。
若无新职位，输出 \`[FOUND: 0]\`。

---

${skills}`
  }

  /** 获取可用工具列表（基础工具 + run_delivery_agent） */
  protected async getAvailableTools(): Promise<ChatCompletionTool[]> {
    const baseTools = await super.getAvailableTools()
    // 避免重复添加
    if (baseTools.some((t) => t.function.name === 'run_delivery_agent')) {
      return baseTools
    }
    return [...baseTools, runDeliveryAgentTool]
  }

  /** 执行工具调用，拦截 run_delivery_agent 路由到 spawnAgent */
  protected async executeToolCall(
    toolCall: import('openai/resources/chat/completions').ChatCompletionMessageToolCall
  ): Promise<ChatCompletionMessageParam> {
    if (toolCall.function.name === 'run_delivery_agent') {
      let args: { instruction?: string } = {}
      try {
        args = JSON.parse(toolCall.function.arguments)
      } catch {
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: '无法解析 run_delivery_agent 参数' }),
        }
      }

      const instruction = args.instruction ?? ''
      const result = await this.spawnAgent(this.deliveryAgent as unknown as BaseAgent, instruction)
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      }
    }

    return super.executeToolCall(toolCall)
  }

  /**
   * 启动子 Agent（封装 runEphemeral，统一错误处理）
   * 默认超时 5 分钟
   */
  protected async spawnAgent(
    agent: BaseAgent,
    initialPrompt: string,
    options: { timeoutMs?: number } = { timeoutMs: 300_000 }
  ): Promise<string> {
    try {
      return await agent.runEphemeral(initialPrompt, options)
    } catch (error) {
      const msg = (error as Error).message
      console.error(`[MainAgent] spawnAgent(${agent.agentName}) failed:`, msg)
      return `[子任务失败] ${agent.agentName}: ${msg}`
    }
  }

  /**
   * 工具结果钩子：检测 append_file 写入 jobs.md 的 discovered 行，发送 Channel 通知
   *
   * 使用 DISCOVERED_JOB_PATTERN（gm 标志）逐行扫描，兼容对齐填充的 Markdown 表格。
   */
  protected async onToolResult(toolName: string, result: ToolResult): Promise<void> {
    if (!this.channel || !result.success || toolName !== 'append_file') return

    // 重置 lastIndex，确保每次调用从头匹配（RegExp 实例共享时需要）
    DISCOVERED_JOB_PATTERN.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = DISCOVERED_JOB_PATTERN.exec(result.content)) !== null) {
      const [, company, title, url] = match
      await this.channel.send({
        type: 'new_job',
        payload: { company: company.trim(), title: title.trim(), url: url.trim() },
        timestamp: new Date(),
      })
    }
  }

  /** 提取上下文（持久化 lastCronAt） */
  protected extractContext(): Record<string, unknown> {
    return {
      lastCronAt: this.lastCronAt ?? null,
    }
  }

  /** 恢复上下文 */
  protected restoreContext(context: Record<string, unknown>): void {
    this.lastCronAt = (context.lastCronAt as string) ?? null
  }
}

export { BaseAgent } from '../base'
export type { BaseAgentConfig } from '../base/types'
