import { afterEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { eventBus } from '../../../src/eventBus'
import { clearAgentRegistryForTests, createApp, registerAgent } from '../../../src/web/server'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const TEST_WORKSPACE = path.resolve(__dirname, '../../../workspace')
const UPLOAD_PATH = path.resolve(TEST_WORKSPACE, 'data/uploads/resume-upload.pdf')

afterEach(() => {
  clearAgentRegistryForTests()
  if (fs.existsSync(UPLOAD_PATH)) {
    fs.unlinkSync(UPLOAD_PATH)
  }
})

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
    }
    expect(json.ok).toBe(true)
    expect(json.path).toBe('data/uploads/resume-upload.pdf')
    expect(json.name).toBe('resume.pdf')
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
    const runEphemeral = vi.fn(() => Promise.resolve('unused'))
    registerAgent({
      agentName: 'main',
      getState: () => ({
        agentName: 'main',
        state: 'idle',
        iterations: 0,
        tokenCount: 0,
        lastAction: '',
        currentTask: null,
      }),
      runEphemeral,
    } as any)

    const app = createApp(TEST_WORKSPACE)
    const res = await app.request('/api/resume/review', { method: 'POST' })

    expect(res.status).toBe(400)
    const json = await res.json() as { ok: boolean; error: string }
    expect(json.ok).toBe(false)
    expect(json.error).toContain('Uploaded resume')
    expect(runEphemeral).not.toHaveBeenCalled()
  })

  test('dispatches a review task to the main agent when uploaded resume exists', async () => {
    fs.mkdirSync(path.dirname(UPLOAD_PATH), { recursive: true })
    fs.writeFileSync(UPLOAD_PATH, 'dummy pdf bytes')

    const runEphemeral = vi.fn(() => Promise.resolve('review started'))
    registerAgent({
      agentName: 'main',
      getState: () => ({
        agentName: 'main',
        state: 'idle',
        iterations: 0,
        tokenCount: 0,
        lastAction: '',
        currentTask: null,
      }),
      runEphemeral,
    } as any)

    const app = createApp(TEST_WORKSPACE)
    const res = await app.request('/api/resume/review', { method: 'POST' })

    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; path: string }
    expect(json.ok).toBe(true)
    expect(json.path).toBe('data/uploads/resume-upload.pdf')
    expect(runEphemeral).toHaveBeenCalledTimes(1)
    expect(runEphemeral.mock.calls[0]?.[0]).toContain('resume-upload.pdf')
    expect(runEphemeral.mock.calls[0]?.[0]).toContain('resume-clinic')
    expect(runEphemeral.mock.calls[0]?.[0]).toContain('read_pdf')
  })
})
