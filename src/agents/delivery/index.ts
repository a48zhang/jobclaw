// src/agents/delivery/index.ts

import { BaseAgent } from '../base'
import type { BaseAgentConfig } from '../base/types'
import type { ToolResult } from '../../tools/index'
import type { Channel, ChannelMessageType } from '../../channel/base'

export interface DeliveryAgentConfig extends BaseAgentConfig {
  channel: Channel
}

export class DeliveryAgent extends BaseAgent {
  /** 当前正在处理的招聘链接，由 browser_navigate 结果设置 */
  private currentJobUrl: string | null = null

  constructor(config: DeliveryAgentConfig) {
    super({ ...config, agentName: 'delivery' })
  }

  protected get systemPrompt(): string {
    const skillsIndex = this.loadSkill('index')
    return `你是 JobClaw 的投递 Agent (DeliveryAgent)。
你的核心职责是自动投递职位。你可以使用 mcpClient (Playwright) 访问页面并提交表单。

## 可用技能索引
${skillsIndex}

请在需要投递时，使用 read_file 工具读取对应的投递 SOP (skills/delivery.md)。
`
  }

  protected async onToolResult(toolName: string, result: ToolResult): Promise<void> {
    try {
      if (!result.success) return

      if (toolName === 'browser_navigate') {
        const urlMatch = result.content.match(/https?:\/\/\S+/)
        if (urlMatch) {
          this.currentJobUrl = urlMatch[0]
          if (this.channel) {
            await this.channel.send({
              type: 'delivery_start',
              payload: { url: this.currentJobUrl },
              timestamp: new Date(),
            })
          }
        }
        return
      }

      if (toolName !== 'write_file') return
      if (!this.currentJobUrl) return

      // 仅匹配当前正在处理的职位行，避免误触发其他 write_file 调用
      const escapedUrl = this.currentJobUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rowPattern = new RegExp(
        `\\|\\s*(.+?)\\s*\\|\\s*(.+?)\\s*\\|\\s*${escapedUrl}\\s*\\|\\s*(applied|failed|login_required)\\s*\\|\\s*(.+?)\\s*\\|`
      )
      const rowMatch = result.content.match(rowPattern)
      if (!rowMatch) return

      const [, company, title, status, time] = rowMatch

      const typeMap: Record<string, ChannelMessageType> = {
        applied: 'delivery_success',
        failed: 'delivery_failed',
        login_required: 'delivery_blocked',
      }

      if (this.channel) {
        await this.channel.send({
          type: typeMap[status] ?? 'delivery_failed',
          payload: {
            company: company.trim(),
            title: title.trim(),
            url: this.currentJobUrl,
            status: status.trim(),
            time: time.trim(),
          },
          timestamp: new Date(),
        })
      }
    } catch (error) {
      console.error('[DeliveryAgent] channel.send 失败:', error)
    }
  }
}
