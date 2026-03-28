import type { ConfigStatus } from '../config.js'
import type { MCPClientStatus } from '../mcp.js'

export type SetupSummaryMode = 'ready' | 'degraded' | 'setup_required'
export type SetupArea = 'config' | 'targets' | 'userinfo' | 'mcp' | 'browser' | 'typst'
export type SetupSeverity = 'blocking' | 'degraded' | 'info'
export type CapabilityState = 'ready' | 'degraded' | 'unavailable' | 'unknown'

export interface SetupDocumentStatus {
  area: Extract<SetupArea, 'targets' | 'userinfo'>
  path: string
  exists: boolean
  ready: boolean
  completion: number
  message: string
  requiredMissing: string[]
  recoverySuggestions: string[]
  alternativePaths: string[]
  details: Record<string, unknown>
}

export interface SetupCapabilityStatus {
  area: Extract<SetupArea, 'mcp' | 'browser' | 'typst'>
  state: CapabilityState
  available: boolean
  message: string
  reasonCode?: string
  reasons: string[]
  recoverySuggestions: string[]
  alternativePaths: string[]
  affectedFeatures: string[]
  details: Record<string, unknown>
}

export interface SetupConfigSummary {
  ready: boolean
  message: string
  missingFields: ConfigStatus['missingFields']
  config: Pick<ConfigStatus['config'], 'MODEL_ID' | 'LIGHT_MODEL_ID' | 'BASE_URL' | 'SERVER_PORT'>
  apiKeyConfigured: boolean
  recoverySuggestions: string[]
  alternativePaths: string[]
}

export interface SetupIssue {
  code: string
  area: SetupArea
  severity: SetupSeverity
  message: string
  affectedFeatures: string[]
  recoverySuggestions: string[]
  alternativePaths: string[]
}

export interface SetupOverallSummary {
  mode: SetupSummaryMode
  ready: boolean
  setupReady: boolean
  blockers: SetupArea[]
  degraded: SetupArea[]
  message: string
}

export interface SetupCapabilitySummary {
  generatedAt: string
  overall: SetupOverallSummary
  config: SetupConfigSummary
  workspace: {
    targets: SetupDocumentStatus
    userinfo: SetupDocumentStatus
  }
  capabilities: {
    mcp: SetupCapabilityStatus
    browser: SetupCapabilityStatus
    typst: SetupCapabilityStatus
  }
  runtimeStatus?: {
    mcp?: MCPClientStatus | null
  }
  issues: SetupIssue[]
  recoverySuggestions: string[]
  alternativePaths: string[]
}

export interface SetupSummaryBuildOptions {
  workspaceRoot: string
  configStatus?: ConfigStatus
  runtimeStatus?: {
    mcp?: MCPClientStatus | null
  }
  generatedAt?: string
}
