export type AgentSessionState = 'idle' | 'running' | 'waiting_input' | 'error'

export type {
  AgentProfile,
  AgentProfileName,
  CapabilityDecision,
  CapabilityPolicy,
} from './capability-types.js'

import type { AgentProfile } from './capability-types.js'
import type { AgentProfileName } from './capability-types.js'

export type DelegatedRunState =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type InterventionKind = 'text' | 'confirm' | 'single_select'
export type InterventionStatus = 'pending' | 'resolved' | 'timeout' | 'cancelled'

export interface AgentSession {
  id: string
  agentName: string
  profile: 'main'
  createdAt: string
  updatedAt: string
  state: AgentSessionState
  lastMessageAt?: string
}

export interface DelegatedRun {
  id: string
  parentSessionId: string
  profile: Exclude<AgentProfileName, 'main'>
  state: DelegatedRunState
  instruction: string
  createdAt: string
  updatedAt: string
  resultSummary?: string
  error?: string
  agentName?: string
}

export interface InterventionRecord {
  id: string
  ownerType: 'session' | 'delegated_run'
  ownerId: string
  kind: InterventionKind
  prompt: string
  options?: string[]
  status: InterventionStatus
  createdAt: string
  updatedAt: string
  input?: string
  allowEmpty?: boolean
  timeoutMs?: number
}

export interface ToolCallContext {
  sessionId: string
  delegatedRunId?: string
  profile: AgentProfile
  workspaceRoot: string
  signal?: AbortSignal
  emit: (event: RuntimeEventInput) => RuntimeEvent
}

export interface ToolResultPayload {
  ok: boolean
  summary: string
  data?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}

export interface ConversationMemory {
  sessionId: string
  summary: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>
  lastActivityAt?: string
}

export interface UserFacts {
  version: number
  targetRoles: string[]
  targetLocations: string[]
  seniority?: string
  skills: string[]
  constraints: string[]
  sourceRefs: string[]
}

export type JobWriteSource = 'agent' | 'manual' | 'system'
export type JobMutationOperation = 'created' | 'updated' | 'status_updated' | 'imported' | 'deleted'

export interface JobMutationTrace {
  source: JobWriteSource
  actor: string
  operation: JobMutationOperation
  at: string
  reason?: string
}

export interface JobTraceability {
  revision: number
  created: JobMutationTrace
  lastUpdated: JobMutationTrace
}

export interface JobRecord {
  id: string
  company: string
  title: string
  url: string
  status: 'discovered' | 'favorite' | 'applied' | 'failed' | 'login_required'
  discoveredAt: string
  updatedAt: string
  fitSummary?: string
  notes?: string
  trace?: JobTraceability
}

export type JobStatus = JobRecord['status']

export interface ArtifactRecord {
  id: string
  name: string
  type: 'uploaded' | 'generated'
  path: string
  createdAt: string
  meta: Record<string, unknown>
}

export interface RuntimeEvent {
  id: string
  type: string
  timestamp: string
  sessionId?: string
  delegatedRunId?: string
  agentName?: string
  payload: Record<string, unknown>
}

export interface RuntimeEventInput {
  type: string
  timestamp?: string
  id?: string
  sessionId?: string
  delegatedRunId?: string
  agentName?: string
  payload?: Record<string, unknown>
}

export interface RuntimeEventMeta {
  origin?: 'runtime' | 'legacy'
}

export type RuntimeEventListener = (event: RuntimeEvent, meta: RuntimeEventMeta) => void

export type RuntimeEventFilter =
  | string
  | string[]
  | ((event: RuntimeEvent) => boolean)
  | undefined

export interface ToolEventRecord {
  id: string
  type: 'tool.started' | 'tool.finished'
  agentName: string
  toolName: string
  sessionId?: string
  delegatedRunId?: string
  timestamp: string
  message?: string
  success?: boolean
  result?: string
  error?: string
}

export interface MemoryEventRecord {
  id: string
  type: string
  summary: string
  payload: Record<string, unknown>
  timestamp: string
}

export interface EventStream {
  publish(event: RuntimeEventInput, meta?: RuntimeEventMeta): RuntimeEvent
  subscribe(listener: RuntimeEventListener, filter?: RuntimeEventFilter): () => void
  replay(listener: RuntimeEventListener, filter?: RuntimeEventFilter): void
  getHistory(filter?: RuntimeEventFilter): RuntimeEvent[]
  clear(): void
}

export interface SessionStore {
  get(sessionId: string): Promise<AgentSession | null>
  save(session: AgentSession): Promise<AgentSession>
  update(sessionId: string, patch: Partial<AgentSession>): Promise<AgentSession>
  list(): Promise<AgentSession[]>
}
