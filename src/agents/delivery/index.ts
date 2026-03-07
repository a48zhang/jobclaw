// src/agents/delivery/index.ts

import { BaseAgent } from '../base'
import type { BaseAgentConfig } from '../base/types'
import type { ToolResult } from '../../tools/index'
import type { Channel, ChannelMessageType } from '../../channel/base'

export interface DeliveryAgentConfig extends BaseAgentConfig {
  channel: Channel
}

export class DeliveryAgent extends BaseAgent {
  private channel: Channel
  /** 当前正在处理的招聘链接，由 browser_navigate 结果设置 */
  private currentJobUrl: string | null = null

  constructor(config: DeliveryAgentConfig) {
    super({ ...config, agentName: 'delivery' })
    this.channel = config.channel
  }

  protected get systemPrompt(): string {
    return this.loadSkill('jobclaw-skills')
  }

  protected async onToolResult(toolName: string, result: ToolResult): Promise<void> {
    try {
      if (!result.success) return

      if (toolName === 'browser_navigate') {
        const urlMatch = result.content.match(/https?:\/\/\S+/)
        if (urlMatch) {
          this.currentJobUrl = urlMatch[0]
          await this.channel.send({
            type: 'delivery_start',
            payload: { url: this.currentJobUrl },
            timestamp: new Date(),
          })
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
    } catch (error) {
      console.error('[DeliveryAgent] channel.send 失败:', error)
    }
  }
}
