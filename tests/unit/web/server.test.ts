import { afterEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { createApp } from '../../../src/web/server'

const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../../workspace')
const UPLOAD_PATH = path.resolve(TEST_WORKSPACE, 'data/uploads/resume-upload.pdf')

afterEach(() => {
  if (fs.existsSync(UPLOAD_PATH)) {
    fs.unlinkSync(UPLOAD_PATH)
  }
})

describe('/api/resume/upload', () => {
  test('接受 pdf 上传并写入工作区', async () => {
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

  test('拒绝非 pdf 文件', async () => {
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
