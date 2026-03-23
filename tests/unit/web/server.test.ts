import { afterEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
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

    const run = vi.fn(() => Promise.resolve('review started'))
    const factory = {
      createAgent: vi.fn(() => ({ run })),
    }

    const app = createApp(TEST_WORKSPACE, factory as any)
    const res = await app.request('/api/resume/review', { method: 'POST' })

    expect(res.status).toBe(200)
    const json = await res.json() as { ok: boolean; path: string }
    expect(json.ok).toBe(true)
    expect(json.path).toBe('data/uploads/resume-upload.pdf')
    expect(factory.createAgent).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0]?.[0]).toContain('resume-upload.pdf')
    expect(run.mock.calls[0]?.[0]).toContain('resume-clinic')
    expect(run.mock.calls[0]?.[0]).toContain('read_pdf')
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
