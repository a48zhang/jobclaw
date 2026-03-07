import { BaseAgent } from '../base/agent'
import type { BaseAgentConfig } from '../base/types'
import type { Channel } from '../../channel/base'

/** DeliveryAgent 对外暴露的最小接口 */
export interface IDeliveryAgent {
  run(input: string): Promise<string>
}

/** MainAgent 配置 */
export interface MainAgentConfig extends Omit<BaseAgentConfig, 'agentName'> {
  agentName?: string
  deliveryAgent: IDeliveryAgent
  /** 交互模式可选；CronJob/Ephemeral 模式时建议提供 */
  channel?: Channel
}

export class MainAgent extends BaseAgent {
  constructor(config: MainAgentConfig) {
    super({ ...config, agentName: config.agentName ?? 'main' })
  }

  protected get systemPrompt(): string {
    return `你是 JobClaw 的主 Agent，负责搜索职位并协调投递任务。
工作区目录:
- workspace/data/targets.md — 目标公司列表
- workspace/data/jobs.md — 发现的职位
- workspace/data/userinfo.md — 用户信息`
  }
}
