export type AgentProfileName = 'main' | 'search' | 'delivery' | 'resume' | 'review'

export interface AgentProfile {
  name: AgentProfileName
  systemPromptSections: string[]
  allowedTools: string[]
  readableRoots: string[]
  writableRoots: string[]
  allowBrowser: boolean
  allowNotifications: boolean
  allowAdminTools: boolean
  allowDelegationTo: AgentProfileName[]
}

export interface CapabilityDecision {
  allowed: boolean
  reason?: string
}

export interface CapabilityPolicy {
  canUseTool(profile: AgentProfile, toolName: string): CapabilityDecision
  canReadPath(profile: AgentProfile, relativePath: string): CapabilityDecision
  canWritePath(profile: AgentProfile, relativePath: string): CapabilityDecision
  canDelegate(profile: AgentProfile, targetProfile: AgentProfileName): CapabilityDecision
}
