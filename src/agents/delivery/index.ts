import { BaseAgent } from '../base/agent'
import type { BaseAgentConfig } from '../base/types'
import type { Channel } from '../../channel/base'

/** DeliveryAgent 配置 */
export interface DeliveryAgentConfig extends Omit<BaseAgentConfig, 'agentName'> {
  agentName?: string
  /** 通知渠道（可选） */
  channel?: Channel
}

export class DeliveryAgent extends BaseAgent {
  constructor(config: DeliveryAgentConfig) {
    super({ ...config, agentName: config.agentName ?? 'delivery' })
  }

  protected get systemPrompt(): string {
    return `你是 JobClaw 的投递 Agent，负责自动填写并提交求职申请。
工作区目录:
- workspace/data/jobs.md — 待投递的职位列表
- workspace/data/userinfo.md — 用户信息与简历`
  }
}
