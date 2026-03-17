import type OpenAI from 'openai'
import type { MCPClient } from './base/types.js'
import type { Channel } from '../channel/base.js'
import { MainAgent } from './main/index.js'

export interface AgentFactoryConfig {
  openai: OpenAI
  mcpClient?: MCPClient
  workspaceRoot: string
  model: string
  lightModel: string
}

export interface CreateAgentOptions {
  agentName?: string
  persistent?: boolean
  channel?: Channel
}

export class AgentFactory {
  constructor(private config: AgentFactoryConfig) { }

  createAgent(options: CreateAgentOptions = {}): MainAgent {
    return new MainAgent({
      openai: this.config.openai,
      mcpClient: this.config.mcpClient,
      workspaceRoot: this.config.workspaceRoot,
      model: this.config.model,
      lightModel: this.config.lightModel,
      agentName: options.agentName ?? this.generateAgentName(),
      channel: options.channel,
      persistent: options.persistent ?? false,
      factory: this,
    })
  }

  private generateAgentName(): string {
    const timestamp = Date.now().toString(36)
    return `agent-${timestamp}`
  }
}
