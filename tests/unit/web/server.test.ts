import { afterEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfigFile } from '../../../src/config'
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
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-intervention-forward-'))
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'interventions', 'req-123.json'),
      JSON.stringify({
        id: 'req-123',
        ownerType: 'session',
        ownerId: 'main',
        kind: 'text',
        prompt: 'need input',
        status: 'pending',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
      }),
      'utf-8'
    )

    const app = createApp(workspace)
    const payloadPromise = new Promise<{ agentName: string; input: string; requestId?: string }>((resolve) => {
      eventBus.once('intervention:resolved', resolve)
    })

    try {
      const res = await app.request('/api/intervention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'main',
          ownerId: 'main',
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
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
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

  test('returns validation error when intervention manager rejects bad input', async () => {
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
      getInterventionManager: () => ({
        resolve: async () => {
          throw new Error('Intervention confirm input must be yes or no')
        },
      }),
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/intervention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'main',
        ownerId: 'main',
        input: 'maybe',
        requestId: 'req-2',
      }),
    })

    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.ok).toBe(false)
    expect(json.error).toContain('yes or no')
  })

  test('validates fallback intervention input against stored pending record', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-intervention-fallback-'))
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'interventions', 'req-3.json'),
      JSON.stringify({
        id: 'req-3',
        ownerType: 'session',
        ownerId: 'main',
        kind: 'single_select',
        options: ['backend', 'frontend'],
        prompt: 'choose one',
        status: 'pending',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
        allowEmpty: false,
      }),
      'utf-8'
    )

    const recordPath = path.join(workspace, 'state', 'interventions', 'req-3.json')
    const beforeRecord = JSON.parse(fs.readFileSync(recordPath, 'utf-8')) as { updatedAt: string }
    const app = createApp(workspace)

    try {
      const badRes = await app.request('/api/intervention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'main',
          ownerId: 'main',
          input: 'mobile',
          requestId: 'req-3',
        }),
      })
      expect(badRes.status).toBe(400)
      const badJson = await badRes.json() as { ok: boolean; error: string }
      expect(badJson.ok).toBe(false)
      expect(badJson.error).toContain('provided options')

      const payloadPromise = new Promise<{ agentName: string; input: string; requestId?: string }>((resolve) => {
        eventBus.once('intervention:resolved', resolve)
      })
      const goodRes = await app.request('/api/intervention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'main',
          ownerId: 'main',
          input: 'backend',
          requestId: 'req-3',
        }),
      })

      expect(goodRes.status).toBe(200)
      await expect(goodRes.json()).resolves.toMatchObject({ ok: true, resolved: true })
      await expect(payloadPromise).resolves.toEqual({
        agentName: 'main',
        input: 'backend',
        requestId: 'req-3',
      })

      const resolvedRecord = JSON.parse(fs.readFileSync(recordPath, 'utf-8')) as {
        status: string
        input?: string
        updatedAt: string
      }
      expect(resolvedRecord.status).toBe('resolved')
      expect(resolvedRecord.input).toBe('backend')
      expect(resolvedRecord.updatedAt).not.toBe(beforeRecord.updatedAt)

      const repeatRes = await app.request('/api/intervention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'main',
          ownerId: 'main',
          input: 'frontend',
          requestId: 'req-3',
        }),
      })
      expect(repeatRes.status).toBe(404)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('fallback intervention returns 404 when requestId missing', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-intervention-fallback-'))
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'interventions', 'req-404.json'),
      JSON.stringify({
        id: 'req-404',
        ownerType: 'session',
        ownerId: 'main',
        kind: 'text',
        prompt: 'test fallback',
        status: 'pending',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
        allowEmpty: true,
      }),
      'utf-8'
    )

    const app = createApp(workspace)
    const emitSpy = vi.spyOn(eventBus, 'emit')

    try {
      const res = await app.request('/api/intervention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentName: 'main',
          ownerId: 'main',
          input: 'ignored',
          requestId: 'missing-req',
        }),
      })

      expect(res.status).toBe(404)
      const json = await res.json()
      expect(json.ok).toBe(false)
      expect(json.resolved).toBe(false)
      expect(
        emitSpy.mock.calls.filter(([eventName]) => eventName === 'intervention:resolved')
      ).toHaveLength(0)
    } finally {
      emitSpy.mockRestore()
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/settings', () => {
  test('masks stored API keys and preserves them when omitted from updates', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-settings-'))
    fs.writeFileSync(
      path.join(workspace, 'config.json'),
      JSON.stringify({
        API_KEY: 'sk-secret',
        MODEL_ID: 'gpt-test',
        LIGHT_MODEL_ID: 'gpt-test-mini',
        BASE_URL: 'https://example.com/v1',
        SERVER_PORT: 3000,
      }),
      'utf-8'
    )

    const app = createApp(workspace)

    try {
      const getRes = await app.request('/api/settings')
      expect(getRes.status).toBe(200)
      const getJson = await getRes.json() as {
        ok: boolean
        settings: { API_KEY: string; MODEL_ID: string }
        secrets: { API_KEY: { configured: boolean } }
      }
      expect(getJson.ok).toBe(true)
      expect(getJson.settings.API_KEY).toBe('')
      expect(getJson.secrets.API_KEY.configured).toBe(true)
      expect(getJson.settings.MODEL_ID).toBe('gpt-test')

      const postRes = await app.request('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          MODEL_ID: 'gpt-next',
          LIGHT_MODEL_ID: 'gpt-next-mini',
          BASE_URL: 'https://example.com/v1',
          SERVER_PORT: 3100,
        }),
      })
      expect(postRes.status).toBe(200)
      const postJson = await postRes.json() as {
        ok: boolean
        settings: { API_KEY: string; MODEL_ID: string; SERVER_PORT: number }
        secrets: { API_KEY: { configured: boolean } }
      }
      expect(postJson.ok).toBe(true)
      expect(postJson.settings.API_KEY).toBe('')
      expect(postJson.settings.MODEL_ID).toBe('gpt-next')
      expect(postJson.settings.SERVER_PORT).toBe(3100)
      expect(postJson.secrets.API_KEY.configured).toBe(true)
      expect(readConfigFile(workspace).API_KEY).toBe('sk-secret')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
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

  test('does not fall back to live agent when runtime-owned stores are available but empty', async () => {
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
        { role: 'assistant', content: 'live fallback should stay disabled' },
      ]),
    } as any)

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
        get: async () => null,
      }),
      getConversationStore: () => ({
        get: async () => ({
          sessionId: 'main',
          summary: '',
          recentMessages: [],
          lastActivityAt: '2026-03-27T00:00:01.000Z',
        }),
      }),
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/session/main')

    expect(res.status).toBe(404)
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
        tasks: Array<{
          id: string
          kind: string
          state: string
          status: string
          nextStep?: { code: string }
          retryHint: { supported: boolean; mode: string }
          detail: { rawState: string }
        }>
      }
      const resultsJson = await resultsRes.json() as {
        ok: boolean
        resultSummary: { totalTasks: number }
        recentFailures: Array<{ id: string }>
        recentArtifacts: Array<{ path: string; relatedTaskIds: string[] }>
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
      expect(tasksJson.tasks.map((task) => task.status)).toEqual([
        'failed',
        'requires_input',
      ])
      expect(tasksJson.tasks[0]?.retryHint).toMatchObject({
        supported: true,
        mode: 'rerun_delegation',
      })
      expect(tasksJson.tasks[1]?.nextStep?.code).toBe('provide_input')
      expect(tasksJson.tasks[1]?.detail.rawState).toBe('running')

      expect(resultsJson.ok).toBe(true)
      expect(resultsJson.resultSummary.totalTasks).toBe(2)
      expect(resultsJson.recentFailures.map((task) => task.id)).toContain('delegation:run-1')
      expect(resultsJson.recentArtifacts.map((item) => item.path)).toEqual([
        'data/uploads/resume-upload.pdf',
        'output/resume.pdf',
      ])
      expect(resultsJson.recentArtifacts[0]?.relatedTaskIds).toEqual(['session:main'])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('returns runtime task detail with next-action hints', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-runtime-task-detail-'))
    fs.mkdirSync(path.join(workspace, 'state', 'delegation'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'output'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'delegation', 'run-1.json'),
      JSON.stringify({
        id: 'run-1',
        parentSessionId: 'main',
        profile: 'review',
        state: 'waiting_input',
        instruction: 'Review resume',
        createdAt: '2026-03-27T00:00:01.000Z',
        updatedAt: '2026-03-27T00:00:11.000Z',
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'state', 'interventions', 'ivr-1.json'),
      JSON.stringify({
        id: 'ivr-1',
        ownerType: 'delegated_run',
        ownerId: 'run-1',
        kind: 'text',
        prompt: 'Need target JD URL',
        status: 'pending',
        createdAt: '2026-03-27T00:00:02.000Z',
        updatedAt: '2026-03-27T00:00:12.000Z',
      }),
      'utf-8'
    )
    fs.writeFileSync(path.join(workspace, 'output', 'resume-review.md'), '# review')

    const app = createApp(workspace)

    try {
      const res = await app.request('/api/runtime/tasks/detail?id=delegation:run-1')
      expect(res.status).toBe(200)
      const json = await res.json() as {
        ok: boolean
        detail: {
          task: {
            id: string
            status: string
            retryHint: { supported: boolean; mode: string }
            detail: { rawState: string; instruction?: string }
          }
          interventions: Array<{ id: string }>
          nextActions: Array<{ code: string }>
        }
      }
      expect(json.ok).toBe(true)
      expect(json.detail.task.id).toBe('delegation:run-1')
      expect(json.detail.task.status).toBe('requires_input')
      expect(json.detail.task.retryHint).toMatchObject({
        supported: false,
        mode: 'none',
      })
      expect(json.detail.task.detail).toMatchObject({
        rawState: 'waiting_input',
        instruction: 'Review resume',
      })
      expect(json.detail.interventions.map((item) => item.id)).toEqual(['ivr-1'])
      expect(json.detail.nextActions[0]?.code).toBe('provide_input')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('prefers runtime-owned task results service across tasks, detail, results, and automation insights', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-runtime-task-service-'))
    const aggregate = vi.fn(async () => ({
      generatedAt: '2026-03-28T00:00:00.000Z',
      tasks: [{
        id: 'runtime-run',
        kind: 'delegation' as const,
        profile: 'review' as const,
        sessionId: 'main',
        agentName: 'review-agent',
        title: 'Runtime review task',
        state: 'waiting_input' as const,
        lifecycle: 'waiting' as const,
        status: 'requires_input' as const,
        statusLabel: 'Needs Input',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:10.000Z',
        activityAt: '2026-03-28T00:00:10.000Z',
        summary: 'Waiting for runtime-owned input',
        pendingIntervention: {
          id: 'ivr-runtime',
          kind: 'text' as const,
          prompt: 'Need runtime confirmation',
          status: 'pending' as const,
          createdAt: '2026-03-28T00:00:01.000Z',
          updatedAt: '2026-03-28T00:00:10.000Z',
        },
        interventionCounts: {
          pending: 1,
          resolved: 0,
          timeout: 0,
          cancelled: 0,
        },
        artifactCount: 0,
        nextAction: {
          code: 'provide_input' as const,
          label: 'Provide input',
          reason: 'Need runtime confirmation',
        },
        retryHint: {
          supported: false,
          mode: 'none' as const,
          reason: 'No structured retry path is available for this task state.',
        },
        detail: {
          rawState: 'waiting_input' as const,
          instruction: 'Runtime review task',
          pendingIntervention: {
            id: 'ivr-runtime',
            kind: 'text' as const,
            prompt: 'Need runtime confirmation',
            status: 'pending' as const,
            createdAt: '2026-03-28T00:00:01.000Z',
            updatedAt: '2026-03-28T00:00:10.000Z',
          },
          interventionCounts: {
            pending: 1,
            resolved: 0,
            timeout: 0,
            cancelled: 0,
          },
          artifactCount: 0,
        },
      }],
      recentFailures: [],
      recentArtifacts: [],
      resultSummary: {
        generatedAt: '2026-03-28T00:00:00.000Z',
        headline: '1 tasks waiting on input, 1 interventions pending',
        totalTasks: 1,
        sessionTasks: 0,
        delegatedTasks: 1,
        idleTasks: 0,
        queuedTasks: 0,
        runningTasks: 0,
        waitingTasks: 1,
        requiresInputTasks: 1,
        failedTasks: 0,
        completedTasks: 0,
        cancelledTasks: 0,
        pendingInterventions: 1,
        recentFailures: 0,
        recentArtifacts: 0,
      },
    }))
    const getTaskDetail = vi.fn(async () => ({
      task: {
        id: 'runtime-run',
        kind: 'delegation' as const,
        profile: 'review' as const,
        sessionId: 'main',
        agentName: 'review-agent',
        title: 'Runtime review task',
        state: 'waiting_input' as const,
        lifecycle: 'waiting' as const,
        status: 'requires_input' as const,
        statusLabel: 'Needs Input',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:10.000Z',
        activityAt: '2026-03-28T00:00:10.000Z',
        summary: 'Waiting for runtime-owned input',
        pendingIntervention: {
          id: 'ivr-runtime',
          kind: 'text' as const,
          prompt: 'Need runtime confirmation',
          status: 'pending' as const,
          createdAt: '2026-03-28T00:00:01.000Z',
          updatedAt: '2026-03-28T00:00:10.000Z',
        },
        interventionCounts: {
          pending: 1,
          resolved: 0,
          timeout: 0,
          cancelled: 0,
        },
        artifactCount: 0,
        nextAction: {
          code: 'provide_input' as const,
          label: 'Provide input',
          reason: 'Need runtime confirmation',
        },
        retryHint: {
          supported: false,
          mode: 'none' as const,
          reason: 'No structured retry path is available for this task state.',
        },
        detail: {
          rawState: 'waiting_input' as const,
          instruction: 'Runtime review task',
          pendingIntervention: {
            id: 'ivr-runtime',
            kind: 'text' as const,
            prompt: 'Need runtime confirmation',
            status: 'pending' as const,
            createdAt: '2026-03-28T00:00:01.000Z',
            updatedAt: '2026-03-28T00:00:10.000Z',
          },
          interventionCounts: {
            pending: 1,
            resolved: 0,
            timeout: 0,
            cancelled: 0,
          },
          artifactCount: 0,
        },
      },
      interventions: [{
        id: 'ivr-runtime',
        ownerType: 'delegated_run' as const,
        ownerId: 'runtime-run',
        kind: 'text' as const,
        prompt: 'Need runtime confirmation',
        status: 'pending' as const,
        createdAt: '2026-03-28T00:00:01.000Z',
        updatedAt: '2026-03-28T00:00:10.000Z',
      }],
      artifacts: [],
      failures: [],
      nextActions: [{
        code: 'provide_input' as const,
        label: 'Provide input',
        reason: 'Need runtime confirmation',
      }],
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
      getRuntimeStatus: () => ({
        mcp: {
          enabled: false,
          connected: false,
          message: 'disabled',
        },
      }),
      reloadFromConfig: async () => {},
      getTaskResultsService: () => ({ aggregate, getTaskDetail }),
    }

    try {
      const app = createApp(workspace, runtime as any)
      const [tasksRes, detailRes, resultsRes, insightsRes] = await Promise.all([
        app.request('/api/runtime/tasks?sessionId=main'),
        app.request('/api/runtime/tasks/detail?id=delegation:runtime-run'),
        app.request('/api/runtime/results?sessionId=main'),
        app.request('/api/runtime/automation-insights?sessionId=main'),
      ])

      expect(tasksRes.status).toBe(200)
      expect(detailRes.status).toBe(200)
      expect(resultsRes.status).toBe(200)
      expect(insightsRes.status).toBe(200)

      const tasksJson = await tasksRes.json() as {
        ok: boolean
        tasks: Array<{ id: string; nextStep?: { code: string } }>
      }
      const detailJson = await detailRes.json() as {
        ok: boolean
        detail: { task: { id: string } }
      }
      const resultsJson = await resultsRes.json() as {
        ok: boolean
        resultSummary: { totalTasks: number }
      }
      const insightsJson = await insightsRes.json() as {
        ok: boolean
        pendingAuthorizations: Array<{ taskId: string; prompt: string }>
      }

      expect(tasksJson.ok).toBe(true)
      expect(tasksJson.tasks).toEqual([
        expect.objectContaining({
          id: 'delegation:runtime-run',
          nextStep: expect.objectContaining({ code: 'provide_input' }),
        }),
      ])
      expect(detailJson.ok).toBe(true)
      expect(detailJson.detail.task.id).toBe('delegation:runtime-run')
      expect(resultsJson.ok).toBe(true)
      expect(resultsJson.resultSummary.totalTasks).toBe(1)
      expect(insightsJson.ok).toBe(true)
      expect(insightsJson.pendingAuthorizations).toEqual([
        expect.objectContaining({
          taskId: 'delegation:runtime-run',
          prompt: 'Need runtime confirmation',
        }),
      ])
      expect(getTaskDetail).toHaveBeenCalledWith('delegation:runtime-run')
      expect(aggregate).toHaveBeenCalledWith({ sessionId: 'main' })
      expect(aggregate).toHaveBeenCalledWith({ sessionId: 'main', taskLimit: 20, failureLimit: 10, artifactLimit: 10 })
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
    expect((json as any).settings.API_KEY).toBe('')
    expect((json as any).secrets.API_KEY.configured).toBe(true)
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
      expect(json.summary.message).toContain('聊天入口仍处于 setup 阶段')
      expect(json.summary.missingFields).toEqual(['API_KEY', 'MODEL_ID', 'BASE_URL'])
      expect(json.summary.workspace.targets.ready).toBe(false)
      expect(json.summary.workspace.userinfo.ready).toBe(false)
      expect(json.summary.capabilities.browser.available).toBe(false)
      expect(json.summary.nextSteps.length).toBeGreaterThan(0)
      expect(json.summary.nextSteps.some((step) => step.includes('聊天入口的前置条件'))).toBe(true)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('keeps targets and userinfo as chat-draftable inputs in setup summary narrative', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-settings-summary-draftable-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'data', 'targets.md'), '# 监测目标\n', 'utf-8')
    fs.writeFileSync(path.join(workspace, 'data', 'userinfo.md'), '# 个人信息\n- 姓名：\n', 'utf-8')

    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: {
          API_KEY: 'sk-test',
          MODEL_ID: 'gpt-test',
          LIGHT_MODEL_ID: 'gpt-test-mini',
          BASE_URL: 'https://example.invalid/v1',
          SERVER_PORT: 3000,
        },
      }),
      getRuntimeStatus: () => ({
        mcp: {
          enabled: true,
          connected: true,
          message: 'MCP ready',
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
          message: string
          nextSteps: string[]
          workspace: {
            targets: { ready: boolean; message: string }
            userinfo: { ready: boolean; message: string }
          }
        }
      }

      expect(json.ok).toBe(true)
      expect(json.summary.ready).toBe(false)
      expect(json.summary.mode).toBe('setup_required')
      expect(json.summary.message).toContain('工作区资料仍可在聊天中逐步起草')
      expect(json.summary.workspace.targets.ready).toBe(false)
      expect(json.summary.workspace.targets.message).toContain('可在聊天中由 Agent 逐步起草')
      expect(json.summary.workspace.userinfo.ready).toBe(false)
      expect(json.summary.workspace.userinfo.message).toContain('可在聊天中逐步起草')
      expect(
        json.summary.nextSteps.some((step) => step.includes('聊天中让 Agent 生成 targets.md 草稿'))
      ).toBe(true)
      expect(
        json.summary.nextSteps.some((step) => step.includes('聊天中让 Agent 起草姓名、邮箱、手机'))
      ).toBe(true)
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
  test('prefers runtime task dispatch when available', async () => {
    const dispatchProfileTask = vi.fn(() => ({ runId: 'delegation-runtime', dispatch: 'profile_agent' as const }))
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
      dispatchProfileTask,
    }

    const app = createApp(TEST_WORKSPACE, runtime as any)
    const res = await app.request('/api/resume/build', { method: 'POST' })

    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; runId: string; dispatch: string }
    expect(json.ok).toBe(true)
    expect(json.runId).toBe('delegation-runtime')
    expect(json.dispatch).toBe('profile_agent')
    expect(dispatchProfileTask).toHaveBeenCalledWith('resume', '生成简历')
  })

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

  test('returns explainable job recommendations from strategy and user facts', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-job-recommendations-'))
    writeJobsState(workspace, [
      {
        id: 'job-1',
        company: 'Acme Cloud',
        title: 'Senior Backend Engineer',
        url: 'https://example.com/acme-backend',
        status: 'favorite',
        discoveredAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        fitSummary: 'Strong backend match',
      },
      {
        id: 'job-2',
        company: 'Noise Corp',
        title: 'Frontend Engineer',
        url: 'https://example.com/noise-frontend',
        status: 'failed',
        discoveredAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
      },
    ])
    fs.mkdirSync(path.join(workspace, 'state', 'user'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'user', 'facts.json'),
      JSON.stringify({
        version: 1,
        targetRoles: ['backend engineer'],
        targetLocations: [],
        skills: ['node'],
        constraints: ['remote'],
        sourceRefs: [],
      }, null, 2),
      'utf-8'
    )
    fs.mkdirSync(path.join(workspace, 'state', 'strategy'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'strategy', 'preferences.json'),
      JSON.stringify({
        version: 1,
        preferredRoles: ['backend engineer'],
        preferredLocations: [],
        preferredCompanies: ['Acme'],
        excludedCompanies: ['Noise'],
        preferredKeywords: ['backend', 'remote'],
        excludedKeywords: [],
        workModes: [],
        scoringWeights: {
          roleMatch: 18,
          locationMatch: 10,
          skillSignal: 12,
          companyPreference: 12,
          keywordPreference: 8,
          constraintPenalty: 14,
          statusPenalty: 16,
          recency: 6,
          fitSummary: 10,
        },
        updatedAt: '2026-03-28T00:00:00.000Z',
        sourceRefs: [],
      }, null, 2),
      'utf-8'
    )
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/jobs/recommendations?includeAvoid=1')
      expect(res.status).toBe(200)
      const json = await res.json() as {
        ok: boolean
        items: Array<{ jobId: string; score: number; reasons: Array<{ code: string }> }>
      }
      expect(json.ok).toBe(true)
      expect(json.items[0].jobId).toBe('job-1')
      expect(json.items[0].score).toBeGreaterThan(json.items[1].score)
      expect(json.items[0].reasons.some((item) => item.code === 'preferred_company')).toBe(true)
      expect(json.items[1].reasons.some((item) => item.code === 'excluded_company')).toBe(true)
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

describe('/api/strategy', () => {
  test('reads and updates strategy preferences', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-strategy-'))
    const app = createApp(workspace)

    try {
      const initialRes = await app.request('/api/strategy')
      expect(initialRes.status).toBe(200)
      const initialJson = await initialRes.json() as { ok: boolean; strategy: { version: number } }
      expect(initialJson.ok).toBe(true)
      expect(initialJson.strategy.version).toBe(1)

      const updateRes = await app.request('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredRoles: ['backend engineer'],
          preferredCompanies: ['Acme'],
        }),
      })
      expect(updateRes.status).toBe(200)
      const updateJson = await updateRes.json() as { ok: boolean; strategy: { version: number; preferredCompanies: string[] } }
      expect(updateJson.ok).toBe(true)
      expect(updateJson.strategy.version).toBe(2)
      expect(updateJson.strategy.preferredCompanies).toEqual(['Acme'])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('rejects invalid strategy payloads before persisting them', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-strategy-invalid-'))
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredCompanies: 'Acme',
          scoringWeights: {
            roleMatch: 'high',
          },
        }),
      })

      expect(res.status).toBe(400)
      const json = await res.json() as { ok: boolean; error: string }
      expect(json.ok).toBe(false)
      expect(json.error).toContain('must be')

      const current = await app.request('/api/strategy')
      const currentJson = await current.json() as { ok: boolean; strategy: { version: number; preferredCompanies: string[] } }
      expect(currentJson.ok).toBe(true)
      expect(currentJson.strategy.version).toBe(1)
      expect(currentJson.strategy.preferredCompanies).toEqual([])
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/applications*', () => {
  test('creates application records, updates status, and exposes summary/detail', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-applications-'))
    const app = createApp(workspace)

    try {
      const createRes = await app.request('/api/applications/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: 'Acme',
          jobTitle: 'Backend Engineer',
          status: 'applied',
          nextAction: {
            summary: 'Send follow-up email',
            dueAt: '2026-04-01T00:00:00.000Z',
          },
        }),
      })
      expect(createRes.status).toBe(200)
      const createJson = await createRes.json() as {
        ok: boolean
        application: { id: string; status: string }
      }
      expect(createJson.ok).toBe(true)
      expect(createJson.application.status).toBe('applied')

      const reminderRes = await app.request('/api/applications/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: createJson.application.id,
          title: 'Follow up reminder',
          dueAt: '2026-04-02T00:00:00.000Z',
        }),
      })
      expect(reminderRes.status).toBe(200)

      const statusRes = await app.request('/api/applications/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: createJson.application.id,
          status: 'interview',
        }),
      })
      expect(statusRes.status).toBe(200)

      const [listRes, detailRes, summaryRes] = await Promise.all([
        app.request('/api/applications?status=interview'),
        app.request(`/api/applications/detail?id=${createJson.application.id}`),
        app.request('/api/applications/summary'),
      ])
      expect(listRes.status).toBe(200)
      expect(detailRes.status).toBe(200)
      expect(summaryRes.status).toBe(200)

      const listJson = await listRes.json() as { ok: boolean; total: number; items: Array<{ status: string }> }
      const detailJson = await detailRes.json() as { ok: boolean; application: { status: string; reminders: unknown[]; timeline: unknown[] } }
      const summaryJson = await summaryRes.json() as { ok: boolean; summary: { total: number; byStatus: { interview: number } } }
      expect(listJson.ok).toBe(true)
      expect(listJson.total).toBe(1)
      expect(detailJson.application.status).toBe('interview')
      expect(detailJson.application.reminders.length).toBe(1)
      expect(detailJson.application.timeline.length).toBeGreaterThanOrEqual(3)
      expect(summaryJson.summary.total).toBe(1)
      expect(summaryJson.summary.byStatus.interview).toBe(1)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('returns 404 when mutating a missing application', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-applications-missing-'))
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/applications/reminders/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'missing-application',
          reminderId: 'missing-reminder',
          status: 'completed',
        }),
      })

      expect(res.status).toBe(404)
      const json = await res.json() as { ok: boolean; error: string }
      expect(json.ok).toBe(false)
      expect(json.error).toContain('Application not found')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('links runtime tasks to applications and exposes execution progress', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-applications-progress-'))
    fs.mkdirSync(path.join(workspace, 'state', 'delegation'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    const app = createApp(workspace)

    try {
      const createRes = await app.request('/api/applications/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: 'Acme',
          jobTitle: 'Platform Engineer',
          status: 'applied',
          nextAction: {
            summary: 'Wait for recruiter response',
          },
        }),
      })
      const createJson = await createRes.json() as { application: { id: string } }

      fs.writeFileSync(
        path.join(workspace, 'state', 'delegation', 'run-1.json'),
        JSON.stringify({
          id: 'run-1',
          parentSessionId: 'main',
          profile: 'delivery',
          state: 'waiting_input',
          instruction: 'Apply to Acme',
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:01:00.000Z',
        }),
        'utf-8'
      )
      fs.writeFileSync(
        path.join(workspace, 'state', 'interventions', 'ivr-1.json'),
        JSON.stringify({
          id: 'ivr-1',
          ownerType: 'delegated_run',
          ownerId: 'run-1',
          kind: 'text',
          prompt: 'Need email verification code',
          status: 'pending',
          createdAt: '2026-03-28T00:01:30.000Z',
          updatedAt: '2026-03-28T00:01:31.000Z',
        }),
        'utf-8'
      )

      const linkRes = await app.request('/api/applications/link-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: createJson.application.id,
          taskId: 'delegation:run-1',
          role: 'delivery',
        }),
      })
      expect(linkRes.status).toBe(200)

      const progressRes = await app.request(`/api/applications/progress?id=${createJson.application.id}`)
      expect(progressRes.status).toBe(200)
      const progressJson = await progressRes.json() as {
        ok: boolean
        focus: { type: string }
        relatedTasks: Array<{ task: { id: string; status: string } }>
        blockers: string[]
        nextSteps: string[]
      }
      expect(progressJson.ok).toBe(true)
      expect(progressJson.focus.type).toBe('application')
      expect(progressJson.relatedTasks[0]?.task.id).toBe('delegation:run-1')
      expect(progressJson.relatedTasks[0]?.task.status).toBe('requires_input')
      expect(progressJson.blockers.some((item) => item.includes('verification code'))).toBe(true)
      expect(progressJson.nextSteps.length).toBeGreaterThan(0)

      const traceRes = await app.request('/api/runtime/execution-trace?taskId=delegation:run-1')
      expect(traceRes.status).toBe(200)
      const traceJson = await traceRes.json() as {
        ok: boolean
        focus: { type: string }
        relatedApplications: Array<{ id: string }>
      }
      expect(traceJson.ok).toBe(true)
      expect(traceJson.focus.type).toBe('task')
      expect(traceJson.focus.id).toBe('delegation:run-1')
      expect(traceJson.relatedApplications.map((item) => item.id)).toContain(createJson.application.id)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('rejects empty prefixed task references when linking runtime tasks', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-applications-link-validation-'))
    const app = createApp(workspace)

    try {
      const createRes = await app.request('/api/applications/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: 'Bravo',
          jobTitle: 'Backend Engineer',
        }),
      })
      const createJson = await createRes.json() as { application: { id: string } }

      const linkRes = await app.request('/api/applications/link-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: createJson.application.id,
          taskId: 'delegation:',
        }),
      })

      expect(linkRes.status).toBe(400)
      const linkJson = await linkRes.json() as { ok: boolean; error: string }
      expect(linkJson.ok).toBe(false)
      expect(linkJson.error).toBe('taskId is required')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/learning*', () => {
  test('stores learning records, updates action items, and exposes insights', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-learning-'))
    const app = createApp(workspace)

    try {
      const createRes = await app.request('/api/learning/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'jd_gap_analysis',
          title: 'Gap review for Acme',
          summary: 'Need better systems evidence.',
          tags: ['backend', 'platform'],
          links: {
            applicationId: 'application-1',
            taskId: 'delegation:run-gap-1',
          },
          findings: [{
            title: 'Systems gap',
            summary: 'Resume lacks distributed systems examples.',
            severity: 'critical',
          }],
          actionItems: [{
            summary: 'Add one distributed systems bullet',
            owner: 'user',
          }],
          metrics: {
            gapCount: 2,
          },
        }),
      })
      expect(createRes.status).toBe(200)
      const createJson = await createRes.json() as {
        ok: boolean
        record: { id: string; links: { taskId?: string }; actionItems: Array<{ id: string; linkedTaskId?: string }> }
      }
      expect(createJson.ok).toBe(true)
      expect(createJson.record.links.taskId).toBe('run-gap-1')

      const [listRes, detailRes] = await Promise.all([
        app.request('/api/learning/records?applicationId=application-1&kinds=jd_gap_analysis'),
        app.request(`/api/learning/detail?id=${createJson.record.id}`),
      ])
      expect(listRes.status).toBe(200)
      expect(detailRes.status).toBe(200)

      const listJson = await listRes.json() as {
        ok: boolean
        items: Array<{ id: string }>
      }
      const detailJson = await detailRes.json() as {
        ok: boolean
        record: { findings: Array<{ severity: string }> }
      }
      expect(listJson.ok).toBe(true)
      expect(listJson.items.map((item) => item.id)).toEqual([createJson.record.id])
      expect(detailJson.record.findings[0]?.severity).toBe('critical')

      const updateActionRes = await app.request('/api/learning/action-items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: createJson.record.id,
          actionItemId: createJson.record.actionItems[0]!.id,
          status: 'done',
          note: 'Resume updated',
        }),
      })
      expect(updateActionRes.status).toBe(200)

      const insightsRes = await app.request('/api/learning/insights')
      expect(insightsRes.status).toBe(200)
      const insightsJson = await insightsRes.json() as {
        ok: boolean
        totals: { records: number; criticalFindings: number }
        byKind: { jd_gap_analysis: number }
        byStatus: { open: number }
      }
      expect(insightsJson.ok).toBe(true)
      expect(insightsJson.totals.records).toBe(1)
      expect(insightsJson.totals.criticalFindings).toBe(1)
      expect(insightsJson.byKind.jd_gap_analysis).toBe(1)
      expect(insightsJson.byStatus.open).toBe(1)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('returns 400 for invalid nested learning payloads', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-learning-validation-'))
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/learning/records', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'resume_review',
          title: 'Resume review',
          summary: 'Validate nested input handling.',
          findings: [{
            title: '',
            summary: 'Missing title should be treated as bad input.',
          }],
        }),
      })

      expect(res.status).toBe(400)
      const json = await res.json() as { ok: boolean; error: string }
      expect(json.ok).toBe(false)
      expect(json.error).toBe('finding.title is required')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('enriches execution traces with recommendation, learning records, and explanation data', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-learning-trace-'))
    fs.mkdirSync(path.join(workspace, 'state', 'delegation'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'jobs'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'jobs', 'jobs.json'),
      JSON.stringify([{
        id: 'job-1',
        company: 'Acme',
        title: 'Platform Engineer',
        url: 'https://example.com/jobs/1',
        status: 'favorite',
        discoveredAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:00.000Z',
        fitSummary: 'Strong platform fit',
      }]),
      'utf-8'
    )
    const app = createApp(workspace)

    try {
      const applicationRes = await app.request('/api/applications/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: 'Acme',
          jobTitle: 'Platform Engineer',
          jobId: 'job-1',
          status: 'applied',
          nextAction: {
            summary: 'Complete portal verification',
          },
        }),
      })
      const applicationJson = await applicationRes.json() as { application: { id: string } }

      fs.writeFileSync(
        path.join(workspace, 'state', 'delegation', 'run-2.json'),
        JSON.stringify({
          id: 'run-2',
          parentSessionId: 'main',
          profile: 'delivery',
          state: 'waiting_input',
          instruction: 'Apply to Acme via portal',
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:02:00.000Z',
        }),
        'utf-8'
      )
      fs.writeFileSync(
        path.join(workspace, 'state', 'interventions', 'ivr-2.json'),
        JSON.stringify({
          id: 'ivr-2',
          ownerType: 'delegated_run',
          ownerId: 'run-2',
          kind: 'text',
          prompt: 'Need verification code',
          status: 'pending',
          createdAt: '2026-03-28T00:02:10.000Z',
          updatedAt: '2026-03-28T00:02:11.000Z',
        }),
        'utf-8'
      )

      const [linkRes, learningRes] = await Promise.all([
        app.request('/api/applications/link-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: applicationJson.application.id,
            taskId: 'delegation:run-2',
          }),
        }),
        app.request('/api/learning/records', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kind: 'improvement_plan',
            title: 'Portal delivery follow-up',
            summary: 'Translate delivery blockage into a clear next action.',
            links: {
              applicationId: applicationJson.application.id,
              jobId: 'job-1',
              taskId: 'delegation:run-2',
            },
            actionItems: [{
              summary: 'Provide the verification code',
              owner: 'user',
            }],
          }),
        }),
      ])
      expect(linkRes.status).toBe(200)
      expect(learningRes.status).toBe(200)

      const traceRes = await app.request(`/api/applications/progress?id=${applicationJson.application.id}`)
      expect(traceRes.status).toBe(200)
      const traceJson = await traceRes.json() as {
        ok: boolean
        recommendation: { jobId: string; summary: string } | null
        learningRecords: Array<{ id: string }>
        explanation: {
          whyThisWork: string[]
          pendingAuthorizations: Array<{ prompt: string; ownerId: string }>
          nextPlannedSteps: string[]
        }
      }
      expect(traceJson.ok).toBe(true)
      expect(traceJson.recommendation?.jobId).toBe('job-1')
      expect(traceJson.recommendation?.summary).toContain('Acme')
      expect(traceJson.learningRecords).toHaveLength(1)
      expect(traceJson.explanation.pendingAuthorizations).toEqual([
        expect.objectContaining({ prompt: 'Need verification code', ownerId: 'delegation:run-2' }),
      ])
      expect(traceJson.explanation.whyThisWork.some((item) => item.includes('Application Acme / Platform Engineer'))).toBe(true)
      expect(traceJson.explanation.nextPlannedSteps).toEqual(expect.arrayContaining([
        'Need verification code',
        'Provide the verification code',
      ]))
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})

describe('/api/runtime/automation-insights', () => {
  test('returns pending authorization, failures, pipeline summary, and next steps', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-automation-insights-'))
    fs.mkdirSync(path.join(workspace, 'state', 'delegation'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'interventions'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'state', 'delegation', 'review-run.json'),
      JSON.stringify({
        id: 'review-run',
        parentSessionId: 'main',
        profile: 'review',
        state: 'waiting_input',
        instruction: 'Review resume',
        createdAt: '2026-03-28T03:00:00.000Z',
        updatedAt: '2026-03-28T03:01:00.000Z',
      }),
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'state', 'interventions', 'ivr-1.json'),
      JSON.stringify({
        id: 'ivr-1',
        ownerType: 'delegated_run',
        ownerId: 'review-run',
        kind: 'text',
        prompt: 'Need ATS code',
        status: 'pending',
        createdAt: '2026-03-28T03:02:00.000Z',
        updatedAt: '2026-03-28T03:03:00.000Z',
      }),
      'utf-8'
    )
    const app = createApp(workspace)

    try {
      const res = await app.request('/api/runtime/automation-insights')
      expect(res.status).toBe(200)
      const json = await res.json() as {
        ok: boolean
        pendingAuthorizations: Array<{ prompt: string }>
        pipeline: { applications: { total: number }; recommendations: unknown[] }
        nextSteps: string[]
      }
      expect(json.ok).toBe(true)
      expect(json.pendingAuthorizations[0]?.prompt).toContain('ATS code')
      expect(json.pipeline.applications.total).toBe(0)
      expect(Array.isArray(json.pipeline.recommendations)).toBe(true)
      expect(json.nextSteps.length).toBeGreaterThan(0)
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
      delegatedRunId: 'run-1',
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
          ownerId: 'run-1',
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

  test('maps runtime context usage events into websocket messages', () => {
    const messages = mapRuntimeEventToWebSocketMessages({
      id: 'evt-context-1',
      type: 'context.usage',
      timestamp: '2026-03-27T00:00:01.000Z',
      sessionId: 'main',
      agentName: 'main',
      payload: {
        tokenCount: 512,
      },
    } as any)

    expect(messages).toEqual([
      {
        event: 'context:usage',
        data: {
          agentName: 'main',
          tokenCount: 512,
        },
      },
    ])
  })

  test('maps workspace context update events into websocket messages', () => {
    const messages = mapRuntimeEventToWebSocketMessages({
      id: 'evt-context-2',
      type: 'workspace.context_updated',
      timestamp: '2026-03-27T00:00:02.000Z',
      sessionId: 'main',
      agentName: 'main',
      payload: {
        updatedFiles: ['data/targets.md', 'data/userinfo.md'],
        summary: '已同步 workspace context：targets.md 新增 1 条，userinfo.md 更新 2 个字段。',
        requiresReview: false,
        source: 'chat',
      },
    } as any)

    expect(messages).toEqual([
      {
        event: 'workspace:context_updated',
        data: {
          agentName: 'main',
          updatedFiles: ['data/targets.md', 'data/userinfo.md'],
          summary: '已同步 workspace context：targets.md 新增 1 条，userinfo.md 更新 2 个字段。',
          requiresReview: false,
          source: 'chat',
          timestamp: '2026-03-27T00:00:02.000Z',
        },
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
          ownerId: 'main',
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

  test('replays delegated-run interventions with explicit owner ids on reconnect', async () => {
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
            id: 'ivr-run-1',
            ownerType: 'delegated_run',
            ownerId: 'delegation-run-1',
            kind: 'confirm',
            prompt: 'Need verification code',
            status: 'pending',
            createdAt: '2026-03-27T00:00:00.000Z',
            updatedAt: '2026-03-27T00:00:01.000Z',
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
          ownerId: 'delegation-run-1',
          prompt: 'Need verification code',
          requestId: 'ivr-run-1',
          kind: 'confirm',
          options: undefined,
          timeoutMs: undefined,
          allowEmpty: undefined,
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
