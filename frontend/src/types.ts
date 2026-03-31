export type TabId = 'tab-chat' | 'tab-jobs' | 'tab-config' | 'tab-resume'
export type ConfigDocName = 'targets' | 'userinfo'
export type JobStatus = 'all' | 'discovered' | 'favorite' | 'applied' | 'failed' | 'login_required'
export type ChatMessageTone = 'user' | 'assistant' | 'system' | 'warning' | 'error'
export type ChatTaskTone = 'idle' | 'info' | 'success' | 'warn' | 'error'

export interface SettingsFormValue {
  API_KEY: string
  MODEL_ID: string
  LIGHT_MODEL_ID: string
  BASE_URL: string
  SERVER_PORT: string
}

export interface SettingsPayload {
  ok: boolean
  settings: {
    API_KEY: string
    MODEL_ID: string
    LIGHT_MODEL_ID: string
    BASE_URL: string
    SERVER_PORT: number
  }
  secrets: {
    API_KEY: {
      configured: boolean
      maskedValue: string
    }
  }
  status: {
    ready: boolean
    missingFields: string[]
  }
}

export interface ConfigDocPayload {
  ok: boolean
  content: string
  error?: string
}

export interface SessionPayload {
  ok: boolean
  messages: Array<{
    role: 'user' | 'assistant'
    content: string
  }>
}

export interface ChatApiResponse {
  ok: boolean
  queued?: boolean
  queueLength?: number
  message?: string
  error?: string
  missingFields?: string[]
}

export interface ChatMessage {
  id: string
  tone: ChatMessageTone
  actor: string
  text: string
  timestamp: string
  streaming?: boolean
}

export interface ChatEntry {
  id: string
  role: 'user' | 'assistant' | 'system'
  author: string
  content: string
  timestamp?: string
  streaming?: boolean
}

export interface ChatTaskState {
  tone: ChatTaskTone
  text: string
}

export interface JobItem {
  id: string
  company: string
  title: string
  url: string
  status: string
  discoveredAt: string
  updatedAt: string
  fitSummary?: string | null
  notes?: string | null
  trace?: {
    firstSeenAt?: string
    lastChangedAt?: string
    hasPostDiscoveryUpdate?: boolean
    changeKind?: 'updated' | 'discovered'
  }
}

export interface JobRow {
  id?: string
  company?: string
  title?: string
  url?: string
  status?: string
  time?: string
  description?: string | null
  notes?: string | null
}

export interface JobsQueryPayload {
  ok: boolean
  total: number
  items: JobItem[]
}

export interface ResumeStatusPayload {
  ok: boolean
  exists: boolean
  path: string
  mtime: string | null
  error?: string
}

export type ResumeStatus = ResumeStatusPayload

export interface ConfigDocState {
  saved: string
  draft: string
  loading: boolean
  saving: boolean
}

export interface ResumeWorkflowArtifact {
  id: string
  path: string
  name: string
  type: 'uploaded' | 'generated'
  createdAt: string
}

export interface ResumeWorkflowTask {
  id: string
  profile: string
  title: string
  statusLabel: string
  lifecycle: string
  summary?: string | null
  resultSummary?: string | null
  updatedAt: string
}

export interface ResumeWorkflowFailure {
  id: string
  profile: string
  summary?: string | null
  error?: string | null
  updatedAt: string
}

export interface ResumeWorkflowPayload {
  ok: boolean
  overview: {
    setup: {
      ready: boolean
      configReady: boolean
      userinfoReady: boolean
      typstAvailable: boolean
    }
    uploadedResume: {
      exists: boolean
      artifact: ResumeWorkflowArtifact | null
    }
    generatedResume: {
      exists: boolean
      artifact: ResumeWorkflowArtifact | null
    }
    recentArtifacts: ResumeWorkflowArtifact[]
    recentTasks: ResumeWorkflowTask[]
    recentFailures: ResumeWorkflowFailure[]
    actions: {
      upload: { enabled: boolean; reason: string | null }
      review: { enabled: boolean; reason: string | null }
      build: { enabled: boolean; reason: string | null }
      download: { enabled: boolean; reason: string | null }
    }
  }
  error?: string
}

export interface ToastItem {
  id: string
  tone: 'info' | 'success' | 'warning' | 'error'
  title: string
  detail?: string
}

export interface ConfirmationRequest {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

export interface InterventionPayload {
  agentName?: string
  ownerId?: string
  requestId?: string
  prompt: string
  kind?: 'text' | 'single_select' | 'confirm'
  options?: string[]
  allowEmpty?: boolean
}

export interface InterventionModalState {
  open: boolean
  agentName: string
  ownerId: string
  requestId: string
  prompt: string
  kind: 'text' | 'single_select' | 'confirm'
  options: string[]
  input: string
  submitting: boolean
  error: string
}

export interface WebSocketEventEnvelope {
  event: string
  data: unknown
}

declare global {
  interface Window {
    handleWsEvent?: (event: string, data: unknown) => void
    showModal?: (payload: InterventionPayload) => void
    hideModal?: () => void
    showTab?: (tabId: TabId) => void
    marked?: {
      parse: (value: string) => string
    }
    DOMPurify?: {
      sanitize: (value: string) => string
    }
  }
}
