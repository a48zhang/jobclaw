import type { AgentFactory } from '../agents/factory.js'
import type { AgentProfile, CapabilityPolicy } from '../runtime/capability-types.js'

export interface ToolContext {
  workspaceRoot: string
  agentName: string
  profile?: AgentProfile
  capabilityPolicy?: CapabilityPolicy
  logger: (line: string) => void
  factory?: AgentFactory
  signal?: AbortSignal
  /** Current session ID - passed to sub-agents for intervention identity chain */
  sessionId?: string
}

export interface ToolResult {
  success: boolean
  content: string
  error?: string
  ok?: boolean
  summary?: string
  data?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}
