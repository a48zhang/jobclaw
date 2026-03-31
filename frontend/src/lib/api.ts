import type {
  ChatApiResponse,
  ConfigDocName,
  ConfigDocPayload,
  JobsQueryPayload,
  ResumeStatusPayload,
  ResumeWorkflowPayload,
  SessionPayload,
  SettingsFormValue,
  SettingsPayload,
} from '@/types'

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text()
  const payload = text ? JSON.parse(text) : {}
  if (!response.ok && typeof payload?.error === 'string') {
    throw new Error(payload.error)
  }
  return payload as T
}

export async function getSettings() {
  return parseResponse<SettingsPayload>(await fetch('/api/settings'))
}

export async function saveSettings(
  form: SettingsFormValue,
  options: { preserveExistingApiKey: boolean },
) {
  const body: Record<string, string | number> = {
    MODEL_ID: form.MODEL_ID.trim(),
    LIGHT_MODEL_ID: form.LIGHT_MODEL_ID.trim(),
    BASE_URL: form.BASE_URL.trim(),
    SERVER_PORT: Number.parseInt(form.SERVER_PORT || '3000', 10) || 3000,
  }
  if (!options.preserveExistingApiKey || form.API_KEY.trim()) {
    body.API_KEY = form.API_KEY.trim()
  }

  return parseResponse<SettingsPayload>(
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

export async function getConfigDoc(name: ConfigDocName) {
  return parseResponse<ConfigDocPayload>(await fetch(`/api/config/${name}`))
}

export async function saveConfigDoc(name: ConfigDocName, content: string) {
  return parseResponse<ConfigDocPayload>(
    await fetch(`/api/config/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    }),
  )
}

export async function getSessionHistory() {
  return parseResponse<SessionPayload>(await fetch('/api/session/main'))
}

export async function sendChat(message: string) {
  return parseResponse<ChatApiResponse>(
    await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    }),
  )
}

export async function getJobsQuery(query: {
  status?: string
  q?: string
  sortBy?: string
  order?: 'asc' | 'desc'
  limit?: number
}) {
  const params = new URLSearchParams()
  if (query.status && query.status !== 'all') params.set('status', query.status)
  if (query.q) params.set('q', query.q)
  if (query.sortBy) params.set('sortBy', query.sortBy)
  if (query.order) params.set('order', query.order)
  if (query.limit) params.set('limit', String(query.limit))
  return parseResponse<JobsQueryPayload>(await fetch(`/api/jobs/query?${params.toString()}`))
}

export async function updateJobStatuses(updates: Array<{ url: string; status: string }>) {
  return parseResponse<{ ok: boolean }>(
    await fetch('/api/jobs/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates }),
    }),
  )
}

export async function deleteJobs(urls: string[]) {
  return parseResponse<{ ok: boolean }>(
    await fetch('/api/jobs/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls }),
    }),
  )
}

export async function getResumeStatus() {
  return parseResponse<ResumeStatusPayload>(await fetch('/api/resume/status'))
}

export async function getResumeWorkflow() {
  return parseResponse<ResumeWorkflowPayload>(await fetch('/api/resume/workflow'))
}

export async function buildResume() {
  return parseResponse<{ ok: boolean; error?: string }>(
    await fetch('/api/resume/build', { method: 'POST' }),
  )
}

export async function reviewUploadedResume() {
  return parseResponse<{ ok: boolean; error?: string }>(
    await fetch('/api/resume/review', { method: 'POST' }),
  )
}

export async function uploadResume(file: File) {
  const form = new FormData()
  form.set('file', file)
  return parseResponse<{ ok: boolean; name?: string; error?: string }>(
    await fetch('/api/resume/upload', {
      method: 'POST',
      body: form,
    }),
  )
}

export async function resolveIntervention(input: {
  input: string
  agentName?: string
  ownerId?: string
  requestId?: string
}) {
  return parseResponse<{ ok: boolean; resolved: boolean }>(
    await fetch('/api/intervention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  )
}
