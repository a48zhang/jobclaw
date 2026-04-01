import type OpenAI from 'openai'
import type { MCPClient } from './base/types.js'
import type { Channel } from '../channel/base.js'
import type { BaseAgent } from './base/agent.js'
import { MainAgent } from './main/index.js'
import { ProfileAgent } from './profile-agent.js'
import type { ProfileName } from './profiles.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  profileName?: ProfileName
  skillName?: string
  sessionId?: string
  /** Parent session ID for delegated runs - enables intervention identity chain */
  parentSessionId?: string
  /** Delegated run ID for sub-agents - enables intervention identity chain */
  delegatedRunId?: string
}

export class AgentFactory {
  constructor(private config: AgentFactoryConfig) { }

  createAgent(options: CreateAgentOptions = {}): BaseAgent {
    const profileName = options.profileName ?? 'main'
    const agentName = options.agentName ?? this.generateAgentName(profileName)
    const baseConfig = {
      openai: this.config.openai,
      mcpClient: this.config.mcpClient,
      workspaceRoot: this.config.workspaceRoot,
      model: this.config.model,
      lightModel: this.config.lightModel,
      agentName,
      channel: options.channel,
      persistent: options.persistent ?? false,
      factory: this,
      sessionId: options.sessionId,
      parentSessionId: options.parentSessionId,
      delegatedRunId: options.delegatedRunId,
    }

    if (profileName === 'main') {
      return new MainAgent(baseConfig)
    }

    return new ProfileAgent({
      ...baseConfig,
      profileName,
      skillSections: this.loadSkillSections(options.skillName),
    })
  }

  private generateAgentName(profileName: ProfileName): string {
    const timestamp = Date.now().toString(36)
    return `${profileName}-agent-${timestamp}`
  }

  private loadSkillSections(skillName?: string): string[] {
    if (!skillName) return []

    const candidatePaths = [
      path.resolve(this.config.workspaceRoot, 'skills', `${skillName}.md`),
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'skills', `${skillName}.md`),
    ]

    for (const candidatePath of candidatePaths) {
      if (!fs.existsSync(candidatePath)) continue
      return [fs.readFileSync(candidatePath, 'utf-8')]
    }

    return []
  }
}
