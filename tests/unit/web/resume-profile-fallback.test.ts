import { afterEach, describe, expect, test, vi } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createApp } from '../../../src/web/server.js'

const workspaceRoot = '/tmp/jobclaw-resume-profile-fallback'

describe('resume endpoints fallback agent', () => {
  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.promises.rm('/tmp/jobclaw-resume-profile-fallback', { recursive: true, force: true })
  })

  test('/api/resume/build uses factory when main agent missing', async () => {
    const factory = { createAgent: vi.fn(() => ({ run: vi.fn(() => Promise.resolve('ok')) })) }
    const runtime = {
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: { API_KEY: 'key', MODEL_ID: 'model', LIGHT_MODEL_ID: 'light', BASE_URL: '', SERVER_PORT: 3000 },
      }),
      getMainAgent: () => undefined,
      getFactory: () => factory,
      reloadFromConfig: async () => {},
    }

    const app = createApp(workspaceRoot, runtime as any)
    await app.request('/api/resume/build', { method: 'POST' })
    expect(factory.createAgent).toHaveBeenCalledWith({ persistent: false, profileName: 'resume' })
  })

  test('/api/resume/review uses factory when main agent missing and upload exists', async () => {
    const factory = { createAgent: vi.fn(() => ({ run: vi.fn(() => Promise.resolve('ok')) })) }
    const runtime = {
      getConfigStatus: () => ({
        ready: true,
        missingFields: [],
        config: { API_KEY: 'key', MODEL_ID: 'model', LIGHT_MODEL_ID: 'light', BASE_URL: '', SERVER_PORT: 3000 },
      }),
      getMainAgent: () => undefined,
      getFactory: () => factory,
      reloadFromConfig: async () => {},
    }

    const app = createApp(workspaceRoot, runtime as any)
    const uploadDir = '/tmp/jobclaw-resume-profile-fallback/data/uploads'
    await fs.promises.mkdir(uploadDir, { recursive: true })
    await fs.promises.writeFile(path.join(uploadDir, 'resume-upload.pdf'), 'dummy')
    const res = await app.request('/api/resume/review', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(factory.createAgent).toHaveBeenCalledWith({ persistent: false, profileName: 'review' })
    expect(res.ok).toBe(true)
  })
})
