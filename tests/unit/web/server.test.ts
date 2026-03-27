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
    const json = await res.json() as { ok: boolean; path: string }
    expect(json.ok).toBe(true)
    expect(json.path).toBe('data/uploads/resume-upload.pdf')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(submit.mock.calls[0]?.[0]).toContain('resume-upload.pdf')
    expect(submit.mock.calls[0]?.[0]).toContain('resume-clinic')
    expect(submit.mock.calls[0]?.[0]).toContain('read_pdf')
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
