import { afterEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eventBus } from '../../../src/eventBus'
import {
  clearAgentRegistryForTests,
  createApp,
  getPendingInterventionMessages,
  getWebSocketSnapshots,
  mapRuntimeEventToWebSocketMessages,
  registerAgent,
} from '../../../src/web/server'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TEST_WORKSPACE = path.resolve(__dirname, '../../../workspace')
const UPLOAD_PATH = path.resolve(TEST_WORKSPACE, 'data/uploads/resume-upload.pdf')

afterEach(() => {
  clearAgentRegistryForTests()
  if (fs.existsSync(UPLOAD_PATH)) {
    fs.unlinkSync(UPLOAD_PATH)
  }
})

function writeJobsState(
  workspace: string,
  records: Array<{
    id: string
    company: string
    title: string
    url: string
    status: string
    discoveredAt: string
    updatedAt: string
    fitSummary?: string
    notes?: string
  }>
): void {
  fs.mkdirSync(path.join(workspace, 'state', 'jobs'), { recursive: true })
  fs.writeFileSync(path.join(workspace, 'state', 'jobs', 'jobs.json'), JSON.stringify(records, null, 2), 'utf-8')
}

describe('/api/intervention', () => {
  test('forwards requestId to the event bus payload', async () => {
    const app = createApp(TEST_WORKSPACE)
    const payloadPromise = new Promise<{ agentName: string; input: string; requestId?: string }>((resolve) => {
      eventBus.once('intervention:resolved', resolve)
    })

    const res = await app.request('/api/intervention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'main',
        input: 'backend',
        requestId: 'req-123',
      }),
    })

    expect(res.status).toBe(200)
    await expect(payloadPromise).resolves.toEqual({
      agentName: 'main',
      input: 'backend',
      requestId: 'req-123',
    })
  })

  test('prefers runtime intervention manager when available', async () => {
    const resolve = vi.fn(async () => ({
      id: 'req-1',
      ownerType: 'session',
      ownerId: 'main',
      kind: 'text',
      prompt: 'need input',
      status: 'resolved',
      createdAt: '2026-03-27T00:00:00.000Z',
      updatedAt: '2026-03-27T00:00:01.000Z',
      input: 'backend',
    }))
    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
      getInterventionManager: () => ({ resolve }),
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/intervention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'main',
        ownerId: 'main',
        input: 'backend',
        requestId: 'req-1',
      }),
    })

    expect(res.status).toBe(200)
    expect(resolve).toHaveBeenCalledWith(
      { ownerId: 'main', input: 'backend', requestId: 'req-1' },
      { sessionId: 'main', agentName: 'main' }
    )
  })
})

describe('/api/session/:agentName', () => {
  test('reads session state and recent conversation from structured stores', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-session-'))
    fs.mkdirSync(path.join(workspace, 'state', 'session'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'conversation'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'session', 'main.json'),
      JSON.stringify({
        id: 'main',
        agentName: 'main',
        profile: 'main',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
        state: 'idle',
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'state', 'conversation', 'main.json'),
      JSON.stringify({
        sessionId: 'main',
        summary: 'SYSTEM_SUMMARY: 已完成阶段一。',
        recentMessages: [
          { role: 'user', content: '下一步做什么？', timestamp: '2026-03-27T00:00:00.000Z' },
          { role: 'assistant', content: '继续执行阶段二。', timestamp: '2026-03-27T00:00:01.000Z' },
        ],
        lastActivityAt: '2026-03-27T00:00:01.000Z',
      }),
      'utf-8'
    )

    const app = createApp(workspace)

    try {
      const res = await app.request('/api/session/main')
      expect(res.status).toBe(200)
      const json = await res.json() as {
        ok: boolean
        summary: string
        messages: Array<{ role: string; content: string }>
        session: { id: string; state: string }
      }
      expect(json.ok).toBe(true)
      expect(json.session.id).toBe('main')
      expect(json.summary).toContain('SYSTEM_SUMMARY')
      expect(json.messages).toHaveLength(2)
      expect(json.messages[1]?.content).toContain('阶段二')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('prefers runtime-provided session and conversation stores when available', async () => {
    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
      getSessionStore: () => ({
        list: async () => [],
        get: async () => ({
          id: 'main',
          agentName: 'main',
          profile: 'main',
          createdAt: '2026-03-27T00:00:00.000Z',
          updatedAt: '2026-03-27T00:00:01.000Z',
          state: 'running',
        }),
      }),
      getConversationStore: () => ({
        get: async () => ({
          sessionId: 'main',
          summary: 'SYSTEM_SUMMARY: runtime store',
          recentMessages: [
            { role: 'user', content: 'hello', timestamp: '2026-03-27T00:00:00.000Z' },
            { role: 'assistant', content: 'world', timestamp: '2026-03-27T00:00:01.000Z' },
          ],
          lastActivityAt: '2026-03-27T00:00:01.000Z',
        }),
      }),
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/session/main')

    expect(res.status).toBe(200)
    const json = await res.json() as {
      ok: boolean
      summary: string
      session: { state: string }
      messages: Array<{ content: string }>
    }
    expect(json.ok).toBe(true)
    expect(json.summary).toContain('runtime store')
    expect(json.session.state).toBe('running')
    expect(json.messages[1]?.content).toBe('world')
  })

  test('falls back to the live registered agent when structured stores are empty', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-live-session-'))
    registerAgent({
      agentName: 'main',
      getState: () => ({
        agentName: 'main',
        state: 'running',
        iterations: 1,
        tokenCount: 10,
        lastAction: 'streaming',
        currentTask: null,
      }),
      getMessages: () => ([
        { role: 'system', content: 'system' },
        { role: 'user', content: 'SYSTEM_SUMMARY: 已完成阶段一。' },
        { role: 'user', content: '下一步做什么？' },
        { role: 'assistant', content: '继续执行阶段二。' },
      ]),
    } as any)

    const app = createApp(workspace)

    try {
      const res = await app.request('/api/session/main')

      expect(res.status).toBe(200)
      const json = await res.json() as {
        ok: boolean
        summary: string
        session: { state: string }
        messages: Array<{ role: string; content: string }>
      }
      expect(json.ok).toBe(true)
      expect(json.summary).toContain('SYSTEM_SUMMARY')
      expect(json.session.state).toBe('running')
      expect(json.messages.map((message) => message.content)).toEqual([
        '下一步做什么？',
        '继续执行阶段二。',
      ])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/settings', () => {
  test('includes MCP runtime status in the settings payload', async () => {
    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
      getRuntimeStatus: () => ({
        mcp: {
          enabled: true,
          connected: false,
          message: 'MCP 连接失败: timeout',
        },
      }),
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/settings')
    expect(res.status).toBe(200)
    const json = await res.json() as {
      status: {
        ready: boolean
        mcp: {
          enabled: boolean
          connected: boolean
          message: string
        }
      }
    }
    expect(json.status.ready).toBe(true)
    expect(json.status.mcp).toEqual({
      enabled: true,
      connected: false,
      message: 'MCP 连接失败: timeout',
    })
    expect((json as any).status.setup).toBeTruthy()
    expect((json as any).status.capabilities.mcp).toBeTruthy()
  })
})

describe('/api/runtime/*', () => {
  test('returns runtime sessions when the store is available', async () => {
    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
      getSessionStore: () => ({
        list: async () => [
          {
            id: 'main',
            agentName: 'main',
            profile: 'main',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:01.000Z',
            state: 'idle',
          },
        ],
      }),
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/runtime/sessions')
    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; sessions: Array<{ id: string }> }
    expect(json.ok).toBe(true)
    expect(json.sessions.map((session) => session.id)).toEqual(['main'])
  })

  test('returns delegation runs and pending interventions from runtime stores', async () => {
    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
      getDelegationStore: () => ({
        listByParent: async () => [
          {
            id: 'run-1',
            parentSessionId: 'main',
            profile: 'search',
            state: 'running',
            instruction: 'search jobs',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:01.000Z',
          },
        ],
      }),
      getInterventionManager: () => ({
        listPending: async () => [
          {
            id: 'ivr-1',
            ownerType: 'session',
            ownerId: 'main',
            kind: 'text',
            prompt: 'need confirmation',
            status: 'pending',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:01.000Z',
          },
        ],
      }),
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)

    const delegationRes = await app.request('/api/delegations/main')
    expect(delegationRes.status).toBe(200)
    const delegationJson = await delegationRes.json() as { ok: boolean; runs: Array<{ id: string }> }
    expect(delegationJson.ok).toBe(true)
    expect(delegationJson.runs.map((run) => run.id)).toEqual(['run-1'])

    const interventionRes = await app.request('/api/interventions/main')
    expect(interventionRes.status).toBe(200)
    const interventionJson = await interventionRes.json() as { ok: boolean; interventions: Array<{ id: string }> }
    expect(interventionJson.ok).toBe(true)
    expect(interventionJson.interventions.map((record) => record.id)).toEqual(['ivr-1'])
  })

  test('returns unified runtime tasks and results from structured stores', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-runtime-tasks-'))
    fs.mkdirSync(path.join(workspace, 'state', 'session'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'conversation'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'delegation'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'output'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'data', 'uploads'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'session', 'main.json'),
      JSON.stringify({
        id: 'main',
        agentName: 'main',
        profile: 'main',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:10.000Z',
        state: 'running',
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'state', 'conversation', 'main.json'),
      JSON.stringify({
        sessionId: 'main',
        summary: 'SYSTEM_SUMMARY: 正在处理搜索。',
        recentMessages: [
          { role: 'user', content: '帮我找工作', timestamp: '2026-03-27T00:00:00.000Z' },
          { role: 'assistant', content: '开始搜索。', timestamp: '2026-03-27T00:00:05.000Z' },
        ],
        lastActivityAt: '2026-03-27T00:00:05.000Z',
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'state', 'delegation', 'run-1.json'),
      JSON.stringify({
        id: 'run-1',
        parentSessionId: 'main',
        profile: 'search',
        state: 'failed',
        instruction: 'search jobs',
        createdAt: '2026-03-27T00:00:01.000Z',
        updatedAt: '2026-03-27T00:00:11.000Z',
        error: 'network timeout',
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'state', 'interventions', 'ivr-1.json'),
      JSON.stringify({
        id: 'ivr-1',
        ownerType: 'session',
        ownerId: 'main',
        kind: 'text',
        prompt: 'Need confirmation',
        status: 'pending',
        createdAt: '2026-03-27T00:00:02.000Z',
        updatedAt: '2026-03-27T00:00:12.000Z',
      }),
      'utf-8'
    )
    fs.writeFileSync(path.join(workspace, 'output', 'resume.pdf'), 'pdf')
    fs.writeFileSync(path.join(workspace, 'data', 'uploads', 'resume-upload.pdf'), 'upload')

    const app = createApp(workspace)

    try {
      const [tasksRes, resultsRes] = await Promise.all([
        app.request('/api/runtime/tasks?sessionId=main'),
        app.request('/api/runtime/results?sessionId=main'),
      ])
      expect(tasksRes.status).toBe(200)
      expect(resultsRes.status).toBe(200)

      const tasksJson = await tasksRes.json() as {
        ok: boolean
        tasks: Array<{ id: string; kind: string; state: string }>
      }
      const resultsJson = await resultsRes.json() as {
        ok: boolean
        resultSummary: { totalTasks: number }
        recentFailures: Array<{ id: string }>
        recentArtifacts: Array<{ path: string }>
      }

      expect(tasksJson.ok).toBe(true)
      expect(tasksJson.tasks.map((task) => task.id)).toEqual([
        'delegation:run-1',
        'session:main',
      ])
      expect(tasksJson.tasks.map((task) => task.state)).toEqual([
        'failed',
        'waiting',
      ])

      expect(resultsJson.ok).toBe(true)
      expect(resultsJson.resultSummary.totalTasks).toBe(2)
      expect(resultsJson.recentFailures.map((task) => task.id)).toContain('delegation:run-1')
      expect(resultsJson.recentArtifacts.map((item) => item.path)).toEqual([
        'data/uploads/resume-upload.pdf',
        'output/resume.pdf',
      ])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/settings', () => {
  test('returns runtime MCP degradation status when available', async () => {
    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      getRuntimeStatus: () => ({
        mcp: {
          enabled: false,
          connected: false,
          message: 'MCP disabled by environment',
        },
      }),
      reloadFromConfig: async () => {},
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/settings')

    expect(res.status).toBe(200)
    const json = await res.json() as {
      ok: boolean
      status: {
        ready: boolean
        mcp: {
          enabled: boolean
          connected: boolean
          message?: string
        }
      }
    }
    expect(json.ok).toBe(true)
    expect(json.status.ready).toBe(true)
    expect(json.status.mcp.enabled).toBe(false)
    expect(json.status.mcp.connected).toBe(false)
    expect(json.status.mcp.message).toContain('MCP disabled')
  })

  test('returns setup summary and capability hints for frontend onboarding', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-settings-summary-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'data', 'targets.md'), '# 监测目标\n', 'utf-8')
    fs.writeFileSync(path.join(workspace, 'data', 'userinfo.md'), '# 个人信息\n- 姓名：\n', 'utf-8')

    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: false,
        missingFields: ['API_KEY', 'MODEL_ID', 'BASE_URL'],
        config: {
          API_KEY: '',
          MODEL_ID: '',
          LIGHT_MODEL_ID: '',
          BASE_URL: '',
          SERVER_PORT: 3000,
        },
      }),
      getRuntimeStatus: () => ({
        mcp: {
          enabled: true,
          connected: false,
          message: 'MCP unavailable',
        },
      }),
      reloadFromConfig: async () => {},
    }

    try {
      const app = createApp(workspace, runtime as any)
      const res = await app.request('/api/runtime/capabilities')

      expect(res.status).toBe(200)
      const json = await res.json() as {
        ok: boolean
        summary: {
          ready: boolean
          mode: string
          missingFields: string[]
          nextSteps: string[]
          config: { ready: boolean }
          workspace: {
            targets: { area: string; ready: boolean }
            userinfo: { area: string; ready: boolean }
          }
          capabilities: {
            mcp: { available: boolean }
            browser: { available: boolean }
          }
        }
      }

      expect(json.ok).toBe(true)
      expect(json.summary.ready).toBe(false)
      expect(json.summary.mode).toBe('setup_required')
      expect(json.summary.missingFields).toEqual(['API_KEY', 'MODEL_ID', 'BASE_URL'])
      expect(json.summary.workspace.targets.ready).toBe(false)
      expect(json.summary.workspace.userinfo.ready).toBe(false)
      expect(json.summary.capabilities.browser.available).toBe(false)
      expect(json.summary.nextSteps.length).toBeGreaterThan(0)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/resume/upload', () => {
  test('accepts a PDF upload and writes it into the workspace', async () => {
    const app = createApp(TEST_WORKSPACE)
    const form = new FormData()
    form.set('file', new File(['dummy pdf bytes'], 'resume.pdf', { type: 'application/pdf' }))

    const res = await app.request('/api/resume/upload', {
      method: 'POST',
      body: form,
    })

    expect(res.status).toBe(200)
    const json = await res.json() as {
      ok: boolean
      path: string
      name: string
      workflow: string
    }
    expect(json.ok).toBe(true)
    expect(json.path).toBe('data/uploads/resume-upload.pdf')
    expect(json.name).toBe('resume.pdf')
    expect(json.workflow).toBe('/api/resume/workflow')
    expect(fs.existsSync(UPLOAD_PATH)).toBe(true)
  })

  test('rejects non-PDF files', async () => {
    const app = createApp(TEST_WORKSPACE)
    const form = new FormData()
    form.set('file', new File(['plain text'], 'resume.txt', { type: 'text/plain' }))

    const res = await app.request('/api/resume/upload', {
      method: 'POST',
      body: form,
    })

    expect(res.status).toBe(400)
    const json = await res.json() as { ok: boolean; error: string }
    expect(json.ok).toBe(false)
    expect(json.error).toContain('PDF')
  })
})

describe('/api/resume/review', () => {
  test('returns 400 when no uploaded resume exists', async () => {
    const run = vi.fn(() => Promise.resolve('unused'))
    const factory = {
      createAgent: vi.fn(() => ({ run })),
    }

    const app = createApp(TEST_WORKSPACE, factory as any)
    const res = await app.request('/api/resume/review', { method: 'POST' })

    expect(res.status).toBe(400)
    const json = await res.json() as { ok: boolean; error: string }
    expect(json.ok).toBe(false)
    expect(json.error).toContain('Uploaded resume')
    expect(factory.createAgent).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  test('dispatches a review task to the main agent when uploaded resume exists', async () => {
    fs.mkdirSync(path.dirname(UPLOAD_PATH), { recursive: true })
    fs.writeFileSync(UPLOAD_PATH, 'dummy pdf bytes')

    const submit = vi.fn(() => ({ queued: true, queueLength: 1 }))
    const runtime = {
      getMainAgent: () => ({ submit }),
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/resume/review', { method: 'POST' })

    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; path: string; workflow: string; dispatch: string }
    expect(json.ok).toBe(true)
    expect(json.path).toBe('data/uploads/resume-upload.pdf')
    expect(json.workflow).toBe('/api/resume/workflow')
    expect(json.dispatch).toBe('main_agent')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]?.[0]).toContain('resume-upload.pdf')
    expect(submit.mock.calls[0]?.[0]).toContain('resume-clinic')
    expect(submit.mock.calls[0]?.[0]).toContain('read_pdf')
  })
})

describe('/api/resume/build', () => {
  test('dispatches a tracked profile task when factory is available', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-resume-build-'))
    const run = vi.fn(async () => 'Resume generated successfully')
    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => ({
        createAgent: vi.fn(() => ({
          agentName: 'resume-agent-1',
          run,
        })),
      }),
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
    }

    try {
      const app = createApp(workspace, runtime as any)
      const res = await app.request('/api/resume/build', { method: 'POST' })
      expect(res.status).toBe(200)
      const json = await res.json() as { ok: boolean; dispatch: string; runId: string }
      expect(json.ok).toBe(true)
      expect(json.dispatch).toBe('profile_agent')
      expect(json.runId).toBeTruthy()

      await new Promise((resolve) => setTimeout(resolve, 20))

      const tasksRes = await app.request('/api/runtime/tasks?sessionId=main')
      expect(tasksRes.status).toBe(200)
      const tasksJson = await tasksRes.json() as {
        ok: boolean
        tasks: Array<{ id: string; kind: string; state: string; profile: string }>
      }
      expect(tasksJson.ok).toBe(true)
      expect(tasksJson.tasks).toContainEqual(
        expect.objectContaining({
          id: `delegation:${json.runId}`,
          kind: 'delegation',
          state: 'completed',
          profile: 'resume',
        })
      )

      const workflowRes = await app.request('/api/resume/workflow')
      expect(workflowRes.status).toBe(200)
      const workflowJson = await workflowRes.json() as {
        ok: boolean
        overview: { recentTasks: Array<{ profile: string; state: string }> }
      }
      expect(workflowJson.ok).toBe(true)
      expect(workflowJson.overview.recentTasks).toContainEqual(
        expect.objectContaining({
          profile: 'resume',
          state: 'completed',
        })
      )
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/resume/workflow', () => {
  test('returns a unified resume workflow overview with artifacts and action gates', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-resume-workflow-'))
    fs.mkdirSync(path.join(workspace, 'data', 'uploads'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'output'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'data', 'targets.md'), '# 目标\n- Example | https://example.com\n', 'utf-8')
    fs.writeFileSync(
      path.join(workspace, 'data', 'userinfo.md'),
      '# 个人信息\n- 姓名：Ada\n- 邮箱：ada@example.com\n- 手机：13800000000\n- 方向：Backend\n- 城市：Shanghai\n- 学历/年限：5年\n- 关键词：Node.js\n',
      'utf-8'
    )
    fs.writeFileSync(path.join(workspace, 'data', 'uploads', 'resume-upload.pdf'), 'upload')
    fs.writeFileSync(path.join(workspace, 'output', 'resume.pdf'), 'pdf')
    fs.mkdirSync(path.join(workspace, 'state', 'delegation'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'delegation', 'resume-run.json'),
      JSON.stringify({
        id: 'resume-run',
        parentSessionId: 'main',
        profile: 'resume',
        state: 'completed',
        instruction: '生成简历',
        createdAt: '2026-03-28T03:00:00.000Z',
        updatedAt: '2026-03-28T03:01:00.000Z',
        resultSummary: 'Resume generated',
      }),
      'utf-8'
    )

    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      getRuntimeStatus: () => ({
        mcp: {
          enabled: true,
          connected: true,
          message: 'connected',
        },
      }),
      reloadFromConfig: async () => {},
    }

    try {
      const app = createApp(workspace, runtime as any)
      const [workflowRes, artifactsRes] = await Promise.all([
        app.request('/api/resume/workflow'),
        app.request('/api/resume/artifacts'),
      ])

      expect(workflowRes.status).toBe(200)
      const workflowJson = await workflowRes.json() as {
        ok: boolean
        overview: {
          uploadedResume: { exists: boolean }
          generatedResume: { exists: boolean }
          actions: {
            review: { enabled: boolean }
            build: { enabled: boolean }
            download: { enabled: boolean }
          }
          recentArtifacts: Array<{ path: string }>
          recentTasks: Array<{ profile: string }>
        }
      }
      expect(workflowJson.ok).toBe(true)
      expect(workflowJson.overview.uploadedResume.exists).toBe(true)
      expect(workflowJson.overview.generatedResume.exists).toBe(true)
      expect(workflowJson.overview.actions.review.enabled).toBe(true)
      expect(typeof workflowJson.overview.actions.build.enabled).toBe('boolean')
      expect(workflowJson.overview.actions.download.enabled).toBe(true)
      expect(workflowJson.overview.recentArtifacts.map((item) => item.path).sort()).toEqual([
        'data/uploads/resume-upload.pdf',
        'output/resume.pdf',
      ])
      expect(workflowJson.overview.recentTasks.map((item) => item.profile)).toEqual(['resume'])

      expect(artifactsRes.status).toBe(200)
      const artifactsJson = await artifactsRes.json() as {
        ok: boolean
        total: number
        artifacts: Array<{ path: string }>
      }
      expect(artifactsJson.ok).toBe(true)
      expect(artifactsJson.total).toBe(2)
      expect(artifactsJson.artifacts.map((item) => item.path).sort()).toEqual([
        'data/uploads/resume-upload.pdf',
        'output/resume.pdf',
      ])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/resume/status', () => {
  test('returns exists=false when resume output does not exist', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-resume-status-'))
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/resume/status')
      expect(res.status).toBe(200)
      const json = await res.json() as { ok: boolean; exists: boolean; path: string; mtime: string | null }
      expect(json.ok).toBe(true)
      expect(json.exists).toBe(false)
      expect(json.path).toBe('/workspace/output/resume.pdf')
      expect(json.mtime).toBeNull()
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('returns exists=true when resume output exists', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-resume-status-'))
    fs.mkdirSync(path.join(workspace, 'output'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'output/resume.pdf'), 'pdf')
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/resume/status')
      expect(res.status).toBe(200)
      const json = await res.json() as { ok: boolean; exists: boolean; path: string; mtime: string | null }
      expect(json.ok).toBe(true)
      expect(json.exists).toBe(true)
      expect(json.path).toBe('/workspace/output/resume.pdf')
      expect(typeof json.mtime).toBe('string')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/jobs/*', () => {
  test('keeps /api/jobs compatible while supporting filtered row queries', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-jobs-query-'))
    writeJobsState(workspace, [
      {
        id: 'job-1',
        company: 'A Corp',
        title: 'Platform Engineer',
        url: 'https://example.com/a',
        status: 'favorite',
        discoveredAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-27T12:00:00.000Z',
        fitSummary: 'Strong backend match',
      },
      {
        id: 'job-2',
        company: 'B Corp',
        title: 'Frontend Engineer',
        url: 'https://example.com/b',
        status: 'discovered',
        discoveredAt: '2026-03-21T00:00:00.000Z',
        updatedAt: '2026-03-21T00:00:00.000Z',
      },
    ])
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/jobs?status=favorite&q=platform')
      expect(res.status).toBe(200)
      const json = await res.json() as Array<{ company: string; title: string; status: string; time: string; updatedAt?: string }>
      expect(Array.isArray(json)).toBe(true)
      expect(json).toEqual([
        {
          company: 'A Corp',
          title: 'Platform Engineer',
          url: 'https://example.com/a',
          status: 'favorite',
          time: '2026-03-20T00:00:00.000Z',
        },
      ])
      expect(json[0]).not.toHaveProperty('updatedAt')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('returns structured jobs query results and per-job detail with trace metadata', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-jobs-detail-'))
    writeJobsState(workspace, [
      {
        id: 'job-1',
        company: 'A Corp',
        title: 'Platform Engineer',
        url: 'https://example.com/a',
        status: 'favorite',
        discoveredAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-27T12:00:00.000Z',
        fitSummary: 'Strong backend match',
        notes: 'User shortlisted this company',
      },
      {
        id: 'job-2',
        company: 'B Corp',
        title: 'Frontend Engineer',
        url: 'https://example.com/b',
        status: 'discovered',
        discoveredAt: '2026-03-21T00:00:00.000Z',
        updatedAt: '2026-03-21T00:00:00.000Z',
      },
    ])
    const app = createApp(workspace)

    try {
      const queryRes = await app.request('/api/jobs/query?status=favorite&sortBy=updatedAt&order=desc')
      expect(queryRes.status).toBe(200)
      const queryJson = await queryRes.json() as {
        ok: boolean
        total: number
        items: Array<{
          id: string
          company: string
          fitSummary: string | null
          notes: string | null
          trace: { changeKind: string; hasPostDiscoveryUpdate: boolean }
        }>
      }
      expect(queryJson.ok).toBe(true)
      expect(queryJson.total).toBe(1)
      expect(queryJson.items[0]).toMatchObject({
        id: 'job-1',
        company: 'A Corp',
        fitSummary: 'Strong backend match',
        notes: 'User shortlisted this company',
        trace: {
          changeKind: 'updated',
          hasPostDiscoveryUpdate: true,
        },
      })

      const detailRes = await app.request('/api/jobs/detail?id=job-1')
      expect(detailRes.status).toBe(200)
      const detailJson = await detailRes.json() as {
        ok: boolean
        job: {
          id: string
          updatedAt: string
          trace: { firstSeenAt: string; lastChangedAt: string }
        }
      }
      expect(detailJson.ok).toBe(true)
      expect(detailJson.job.id).toBe('job-1')
      expect(detailJson.job.trace.firstSeenAt).toBe('2026-03-20T00:00:00.000Z')
      expect(detailJson.job.trace.lastChangedAt).toBe('2026-03-27T12:00:00.000Z')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('exposes enriched jobs stats and recent changes while keeping /api/stats legacy fields', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-jobs-stats-'))
    writeJobsState(workspace, [
      {
        id: 'job-1',
        company: 'A Corp',
        title: 'Platform Engineer',
        url: 'https://example.com/a',
        status: 'favorite',
        discoveredAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-27T12:00:00.000Z',
      },
      {
        id: 'job-2',
        company: 'B Corp',
        title: 'Frontend Engineer',
        url: 'https://example.com/b',
        status: 'discovered',
        discoveredAt: '2026-03-21T00:00:00.000Z',
        updatedAt: '2026-03-21T00:00:00.000Z',
      },
      {
        id: 'job-3',
        company: 'A Corp',
        title: 'Backend Engineer',
        url: 'https://example.com/c',
        status: 'applied',
        discoveredAt: '2026-03-22T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
      },
    ])
    const app = createApp(workspace)

    try {
      const [statsRes, jobsStatsRes, changesRes] = await Promise.all([
        app.request('/api/stats'),
        app.request('/api/jobs/stats'),
        app.request('/api/jobs/changes?limit=2'),
      ])

      expect(statsRes.status).toBe(200)
      const statsJson = await statsRes.json() as {
        total: number
        byStatus: Record<string, number>
        lastUpdatedAt: string | null
        byCompany: Array<{ company: string; total: number }>
      }
      expect(statsJson.total).toBe(3)
      expect(statsJson.byStatus).toEqual({
        favorite: 1,
        discovered: 1,
        applied: 1,
      })
      expect(statsJson.lastUpdatedAt).toBe('2026-03-28T00:00:00.000Z')
      expect(statsJson.byCompany[0]).toEqual({ company: 'A Corp', total: 2 })

      expect(jobsStatsRes.status).toBe(200)
      const jobsStatsJson = await jobsStatsRes.json() as {
        ok: boolean
        stats: {
          traceability: { changedAfterDiscovery: number; neverUpdatedSinceDiscovery: number }
        }
      }
      expect(jobsStatsJson.ok).toBe(true)
      expect(jobsStatsJson.stats.traceability).toEqual({
        changedAfterDiscovery: 2,
        neverUpdatedSinceDiscovery: 1,
      })

      expect(changesRes.status).toBe(200)
      const changesJson = await changesRes.json() as {
        ok: boolean
        total: number
        items: Array<{ id: string; changedAt: string; trace: { changeKind: string } }>
      }
      expect(changesJson.ok).toBe(true)
      expect(changesJson.total).toBe(2)
      expect(changesJson.items.map((item) => item.id)).toEqual(['job-3', 'job-1'])
      expect(changesJson.items[0]?.changedAt).toBe('2026-03-28T00:00:00.000Z')
      expect(changesJson.items[0]?.trace.changeKind).toBe('updated')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('updates selected job statuses without rewriting unrelated rows', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-jobs-status-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'data/jobs.md'),
      [
        '| 公司 | 职位 | 链接 | 状态 | 时间 |',
        '| --- | --- | --- | --- | --- |',
        '| A | Frontend | https://example.com/a | discovered | 2026-03-20 |',
        '| B | Backend | https://example.com/b | discovered | 2026-03-21 |',
        '',
      ].join('\n'),
      'utf-8'
    )
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/jobs/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          updates: [{ url: 'https://example.com/a', status: 'applied' }],
        }),
      })

      expect(res.status).toBe(200)
      const json = await res.json() as { ok: boolean; changed: number; total: number }
      expect(json.ok).toBe(true)
      expect(json.changed).toBe(1)
      expect(json.total).toBe(2)

      const content = fs.readFileSync(path.join(workspace, 'data/jobs.md'), 'utf-8')
      expect(content).toContain('| A | Frontend | https://example.com/a | applied | 2026-03-20 |')
      expect(content).toContain('| B | Backend | https://example.com/b | discovered | 2026-03-21 |')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('deletes selected jobs by url and keeps other rows intact', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-jobs-delete-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'data/jobs.md'),
      [
        '| 公司 | 职位 | 链接 | 状态 | 时间 |',
        '| --- | --- | --- | --- | --- |',
        '| A | Frontend | https://example.com/a | discovered | 2026-03-20 |',
        '| B | Backend | https://example.com/b | discovered | 2026-03-21 |',
        '',
      ].join('\n'),
      'utf-8'
    )
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/jobs/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: ['https://example.com/a'],
        }),
      })

      expect(res.status).toBe(200)
      const json = await res.json() as { ok: boolean; deleted: number; total: number }
      expect(json.ok).toBe(true)
      expect(json.deleted).toBe(1)
      expect(json.total).toBe(1)

      const content = fs.readFileSync(path.join(workspace, 'data/jobs.md'), 'utf-8')
      expect(content).not.toContain('https://example.com/a')
      expect(content).toContain('https://example.com/b')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/config/:name', () => {
  test('creates the target file on first save', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-config-'))
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/config/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# targets' }),
      })

      expect(res.status).toBe(200)
      const json = await res.json() as { ok: boolean }
      expect(json.ok).toBe(true)
      expect(fs.readFileSync(path.join(workspace, 'data/targets.md'), 'utf-8')).toBe('# targets')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/runtime adapters', () => {
  test('lists structured delegations and interventions', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-runtime-'))
    fs.mkdirSync(path.join(workspace, 'state', 'delegation'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'delegation', 'run-1.json'),
      JSON.stringify({
        id: 'run-1',
        parentSessionId: 'main',
        profile: 'search',
        state: 'running',
        instruction: 'search jobs',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'state', 'interventions', 'ivr-1.json'),
      JSON.stringify({
        id: 'ivr-1',
        ownerType: 'session',
        ownerId: 'main',
        kind: 'text',
        prompt: 'Need input',
        status: 'pending',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'state', 'interventions', 'ivr-2.json'),
      JSON.stringify({
        id: 'ivr-2',
        ownerType: 'session',
        ownerId: 'main',
        kind: 'text',
        prompt: 'Already handled',
        status: 'resolved',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
      }),
      'utf-8'
    )

    const app = createApp(workspace)

    try {
      const [delegationsRes, allDelegationsRes, interventionsRes] = await Promise.all([
        app.request('/api/delegations?parentSessionId=main'),
        app.request('/api/delegations'),
        app.request('/api/interventions?ownerId=main&status=pending'),
      ])
      expect(delegationsRes.status).toBe(200)
      expect(allDelegationsRes.status).toBe(200)
      expect(interventionsRes.status).toBe(200)

      const delegationsJson = await delegationsRes.json() as { ok: boolean; delegations: Array<{ id: string }> }
      const allDelegationsJson = await allDelegationsRes.json() as { ok: boolean; delegations: Array<{ id: string }> }
      const interventionsJson = await interventionsRes.json() as { ok: boolean; interventions: Array<{ id: string }> }

      expect(delegationsJson.ok).toBe(true)
      expect(delegationsJson.delegations.map((item) => item.id)).toEqual(['run-1'])
      expect(allDelegationsJson.ok).toBe(true)
      expect(allDelegationsJson.delegations.map((item) => item.id)).toEqual(['run-1'])
      expect(interventionsJson.ok).toBe(true)
      expect(interventionsJson.interventions.map((item) => item.id)).toEqual(['ivr-1'])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('websocket runtime adapters', () => {
  test('builds initial snapshots from the runtime session store', async () => {
    const snapshots = await getWebSocketSnapshots({
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
      getSessionStore: () => ({
        list: async () => [
          {
            id: 'main',
            agentName: 'main',
            profile: 'main',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:01.000Z',
            state: 'running',
          },
        ],
        get: async () => null,
      }),
    } as any)

    expect(snapshots).toEqual([{ agentName: 'main', state: 'running' }])
  })

  test('maps runtime timeout events into existing websocket messages', () => {
    const messages = mapRuntimeEventToWebSocketMessages({
      id: 'evt-1',
      type: 'intervention.timed_out',
      timestamp: '2026-03-27T00:00:01.000Z',
      sessionId: 'main',
      agentName: 'main',
      payload: {
        requestId: 'ivr-1',
      },
    })

    expect(messages).toEqual([
      {
        event: 'intervention:resolved',
        data: {
          agentName: 'main',
          input: '',
          requestId: 'ivr-1',
        },
      },
      {
        event: 'agent:log',
        data: expect.objectContaining({
          agentName: 'main',
          type: 'warn',
          message: '输入请求已超时，系统已自动继续。',
        }),
      },
    ])
  })

  test('replays pending interventions into existing websocket messages on reconnect', async () => {
    const messages = await getPendingInterventionMessages({
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'key',
          MODEL_ID: 'model',
          LIGHT_MODEL_ID: 'light-model',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
      getInterventionManager: () => ({
        list: async () => [],
        listPending: async () => [
          {
            id: 'ivr-1',
            ownerType: 'session',
            ownerId: 'main',
            kind: 'text',
            prompt: 'Need input',
            status: 'pending',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:01.000Z',
            allowEmpty: false,
            timeoutMs: 30_000,
          },
        ],
        resolve: async () => null,
      }),
    } as any)

    expect(messages).toEqual([
      {
        event: 'intervention:required',
        data: {
          agentName: 'main',
          prompt: 'Need input',
          requestId: 'ivr-1',
          kind: 'text',
          options: undefined,
          timeoutMs: 30_000,
          allowEmpty: false,
        },
      },
    ])
  })
})

describe('/workspace/output/*', () => {
  test('serves files from the provided workspace root', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-output-'))
    const outputDir = path.join(workspace, 'output')
    fs.mkdirSync(outputDir, { recursive: true })
    fs.writeFileSync(path.join(outputDir, 'resume.pdf'), 'hello')

    const app = createApp(workspace)

    try {
      const res = await app.request('/workspace/output/resume.pdf')

      expect(res.status).toBe(200)
      expect(await res.text()).toBe('hello')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
