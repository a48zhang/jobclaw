import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createApp, clearAgentRegistryForTests } from '../../../src/web/server.js'

describe('/api/chat endpoint', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-web-chat-'))

  afterEach(() => {
    clearAgentRegistryForTests()
  })

  afterAll(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('rejects chat requests when config is incomplete', async () => {
    const runtime = {
      getMainAgent: () => undefined,
      getFactory: () => undefined,
      getConfigStatus: () => ({ ready: false, missingFields: ['API_KEY'], config: { SERVER_PORT: 0 } }),
      reloadFromConfig: async () => {},
    }

    const app = createApp(workspace, runtime as any)
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'hi' }),
    })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toContain('基础配置未完成')
  })

  it('forwards messages to the main agent when config is ready', async () => {
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
          LIGHT_MODEL_ID: 'light',
          BASE_URL: 'https://example.com',
          SERVER_PORT: 3000,
        },
      }),
      reloadFromConfig: async () => {},
    }

    const app = createApp(workspace, runtime as any)
    const res = await app.request('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'search backend' }),
    })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(submit).toHaveBeenCalledWith('search backend')
    expect(body.queued).toBe(true)
  })
})
