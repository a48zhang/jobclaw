import { BaseAgent } from './base/index.js'
import type { BaseAgentConfig } from './base/types.js'
import type { AgentProfile, ProfileName } from './profiles.js'
import { getProfileByName } from './profiles.js'
import { composeSystemPrompt } from './prompt-composer.js'

export interface ProfileAgentConfig extends BaseAgentConfig {
  profileName: ProfileName
  skillSections?: string[]
  additionalSections?: string[]
}

export class ProfileAgent extends BaseAgent {
  protected readonly profileName: ProfileName
  protected readonly profile: AgentProfile
  private readonly skillSections: string[]
  private readonly additionalSections: string[]

  constructor(config: ProfileAgentConfig) {
    const profile = getProfileByName(config.profileName)
    super({ ...config, profile })
    this.profile = profile
    this.profileName = config.profileName
    this.skillSections = config.skillSections ?? []
    this.additionalSections = config.additionalSections ?? []
  }

  protected getSkillSections(): string[] {
    return this.skillSections
  }

  protected getAdditionalSections(): string[] {
    return this.additionalSections
  }

  protected get systemPrompt(): string {
    return composeSystemPrompt(this.profile, {
      skillSections: this.getSkillSections(),
      additionalSections: this.getAdditionalSections(),
    })
  }
}
