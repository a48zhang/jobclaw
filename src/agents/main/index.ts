// MainAgent - Phase 3 实现
import type { ChatCompletionTool, ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { BaseAgent } from '../base'
import type { BaseAgentConfig, AgentSnapshot } from '../base/types'
import type { ToolResult } from '../../tools/index'
import type { Channel } from '../../channel/base'

// ============================================================================
// 接口定义
// ============================================================================

export interface IDeliveryAgent {
  run(input: string): Promise<string>
  getState(): AgentSnapshot
  runEphemeral(initialPrompt: string, options?: { timeoutMs?: number }): Promise<string>
}

export interface MainAgentConfig extends BaseAgentConfig {
  deliveryAgent: IDeliveryAgent
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
      '启动投递 Agent 执行简历投递。投递 Agent 会自动读取 jobs.md 并完成表单填写。',
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

/** MCP 未连接时注入 systemPrompt 的警告块 */
const MCP_NOT_CONNECTED_WARNING =
  '\n> ⚠️ **注意：MCP 未连接**。当前不可用 Playwright 浏览器工具，无法执行自动化网页搜索。\n'

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
- 与用户进行自然语言交互，持续保持对话。
- 直接使用 Playwright MCP 工具访问招聘网站，搜索并发现职位。
- 发现新职位后，**必须**使用 \`upsert_job\` 工具写入 \`data/jobs.md\`。
- 通过 \`run_delivery_agent\` 工具委托 DeliveryAgent 执行简历投递。

## 核心 SOP (执行优先级最高)
${skills}

## 可用工具概览
- **upsert_job**: 更新或插入职位信息（推荐方式，内置文件锁与查重）。
- **run_delivery_agent**: 启动 DeliveryAgent 执行投递。
- **Playwright MCP 工具**: 浏览器操作。
- **文件工具**: read_file, list_directory 等。

## 数据文件
- **data/targets.md**: 监测目标列表。
- **data/jobs.md**: 职位列表（由 upsert_job 维护）。
- **data/userinfo.md**: 用户简历信息（只读）。
`
  }

  protected async getAvailableTools(): Promise<ChatCompletionTool[]> {
    const baseTools = await super.getAvailableTools()
    if (baseTools.some((t) => t.function.name === 'run_delivery_agent')) {
      return baseTools
    }
    return [...baseTools, runDeliveryAgentTool]
  }

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
   * 移除正则通知钩子
   * 现在通知由 Daily Digest 或外部逻辑处理，Agent 仅负责精准写入。
   */
  protected async onToolResult(_toolName: string, _result: ToolResult): Promise<void> {
    // 静默处理，不再在此处嗅探正则
  }

  protected extractContext(): Record<string, unknown> {
    return {
      lastCronAt: this.lastCronAt ?? null,
    }
  }

  protected restoreContext(context: Record<string, unknown>): void {
    this.lastCronAt = (context.lastCronAt as string) ?? null
  }
}

export { BaseAgent } from '../base'
export type { BaseAgentConfig } from '../base/types'
