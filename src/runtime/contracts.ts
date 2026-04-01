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

export type JobRecommendationBand = 'strong_match' | 'good_match' | 'possible_match' | 'weak_match' | 'avoid'
export type RecommendationReasonPolarity = 'positive' | 'negative' | 'neutral'
export type RecommendationReasonCode =
  | 'preferred_company'
  | 'excluded_company'
  | 'target_role_match'
  | 'preferred_role_match'
  | 'preferred_location_match'
  | 'excluded_keyword'
  | 'preferred_keyword'
  | 'skill_signal'
  | 'constraint_signal'
  | 'status_penalty'
  | 'favorite_signal'
  | 'recency_signal'
  | 'fit_summary_signal'
  | 'notes_signal'

export interface JobStrategyScoringWeights {
  roleMatch: number
  locationMatch: number
  skillSignal: number
  companyPreference: number
  keywordPreference: number
  constraintPenalty: number
  statusPenalty: number
  recency: number
  fitSummary: number
}

export interface JobStrategyPreferences {
  version: number
  preferredRoles: string[]
  preferredLocations: string[]
  preferredCompanies: string[]
  excludedCompanies: string[]
  preferredKeywords: string[]
  excludedKeywords: string[]
  workModes: string[]
  scoringWeights: JobStrategyScoringWeights
  updatedAt: string
  sourceRefs: string[]
}

export interface JobRecommendationReason {
  code: RecommendationReasonCode
  polarity: RecommendationReasonPolarity
  weight: number
  message: string
  evidence?: string[]
}

export interface JobRecommendationBreakdown {
  positiveScore: number
  negativeScore: number
  rawScore: number
  normalizedScore: number
  maxScore: number
}

export interface JobRecommendationSignals {
  matchedRoles: string[]
  matchedLocations: string[]
  matchedSkills: string[]
  matchedPreferredKeywords: string[]
  matchedConstraints: string[]
  matchedExcludedKeywords: string[]
}

export interface JobRecommendation {
  jobId: string
  jobUrl: string
  score: number
  band: JobRecommendationBand
  summary: string
  generatedAt: string
  breakdown: JobRecommendationBreakdown
  signals: JobRecommendationSignals
  reasons: JobRecommendationReason[]
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

export type ApplicationWriteSource = 'agent' | 'manual' | 'system'
export type ApplicationStatus =
  | 'draft'
  | 'applied'
  | 'follow_up'
  | 'screening'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'
  | 'ghosted'

export type ApplicationTimelineEntryType =
  | 'created'
  | 'status_changed'
  | 'note_added'
  | 'next_action_set'
  | 'task_linked'
  | 'reminder_added'
  | 'reminder_completed'
  | 'reminder_cancelled'
  | 'rejection_recorded'

export type ApplicationReminderStatus = 'pending' | 'completed' | 'cancelled'
export type ApplicationNoteCategory = 'general' | 'follow_up' | 'interview' | 'rejection'
export type ApplicationActionOwner = 'user' | 'agent' | 'system'

export interface ApplicationTimelineEntry {
  id: string
  type: ApplicationTimelineEntryType
  at: string
  source: ApplicationWriteSource
  actor: string
  summary: string
  fromStatus?: ApplicationStatus
  toStatus?: ApplicationStatus
  reminderId?: string
  noteId?: string
  meta?: Record<string, unknown>
}

export interface ApplicationReminder {
  id: string
  title: string
  dueAt: string
  status: ApplicationReminderStatus
  note?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
  source: ApplicationWriteSource
  actor: string
}

export interface ApplicationNextAction {
  summary: string
  dueAt?: string
  owner: ApplicationActionOwner
  note?: string
  updatedAt: string
  source: ApplicationWriteSource
  actor: string
}

export interface ApplicationNote {
  id: string
  body: string
  category: ApplicationNoteCategory
  createdAt: string
  updatedAt: string
  source: ApplicationWriteSource
  actor: string
}

export interface ApplicationRejection {
  recordedAt: string
  reason?: string
  notes?: string
  source: ApplicationWriteSource
  actor: string
}

export interface ApplicationTaskLink {
  taskId: string
  taskKind: 'session' | 'delegation'
  role: 'delivery' | 'follow_up' | 'supporting'
  linkedAt: string
  note?: string
  source: ApplicationWriteSource
  actor: string
}

export interface ApplicationRecord {
  id: string
  company: string
  jobTitle: string
  jobUrl?: string
  jobId?: string
  status: ApplicationStatus
  createdAt: string
  updatedAt: string
  appliedAt?: string
  notes: ApplicationNote[]
  timeline: ApplicationTimelineEntry[]
  reminders: ApplicationReminder[]
  linkedTasks: ApplicationTaskLink[]
  nextAction?: ApplicationNextAction
  rejection?: ApplicationRejection
}

export type LearningRecordKind =
  | 'resume_review'
  | 'jd_gap_analysis'
  | 'interview_session'
  | 'failure_analysis'
  | 'hit_rate_snapshot'
  | 'improvement_plan'

export type LearningRecordStatus = 'open' | 'in_progress' | 'completed' | 'archived'
export type LearningFindingSeverity = 'info' | 'warning' | 'critical'
export type LearningActionItemStatus = 'pending' | 'done' | 'dismissed'

export interface LearningRecordLinks {
  applicationId?: string
  jobId?: string
  taskId?: string
  artifactPaths: string[]
}

export interface LearningFinding {
  id: string
  title: string
  summary: string
  severity: LearningFindingSeverity
  evidence: string[]
}

export interface LearningActionItem {
  id: string
  summary: string
  owner: ApplicationActionOwner
  status: LearningActionItemStatus
  linkedTaskId?: string
  dueAt?: string
  note?: string
  updatedAt: string
  source: ApplicationWriteSource
  actor: string
}

export interface LearningRecordMetrics {
  interviewScore?: number
  hitRate?: number
  gapCount?: number
  failureCount?: number
}

export interface LearningRecord {
  id: string
  kind: LearningRecordKind
  status: LearningRecordStatus
  title: string
  summary: string
  createdAt: string
  updatedAt: string
  source: ApplicationWriteSource
  actor: string
  tags: string[]
  links: LearningRecordLinks
  findings: LearningFinding[]
  actionItems: LearningActionItem[]
  metrics?: LearningRecordMetrics
}

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
  publish(event: RuntimeEventInput, meta?: RuntimeEventMeta): Promise<RuntimeEvent>
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
