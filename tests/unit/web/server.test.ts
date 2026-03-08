// Web Server API tests — Phase 5 Team C
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { createApp } from '../../../src/web/server'
import * as fs from 'node:fs'
import * as path from 'node:path'

const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../../workspace')

// Ensure test workspace data dir exists
beforeAll(() => {
  fs.mkdirSync(path.join(TEST_WORKSPACE, 'data'), { recursive: true })
})

// Cleanup test config files after tests
afterAll(() => {
  const targets = path.join(TEST_WORKSPACE, 'data/targets.md')
  const userinfo = path.join(TEST_WORKSPACE, 'data/userinfo.md')
  // Only remove files that were created by the tests (check if they have test content)
  for (const f of [targets, userinfo]) {
    if (fs.existsSync(f)) {
      const content = fs.readFileSync(f, 'utf-8')
      if (content.includes('Test Targets') || content.includes('张三')) {
        fs.unlinkSync(f)
      }
    }
  }
})

describe('Web Server API', () => {
  const app = createApp(TEST_WORKSPACE)

  // ── GET /api/jobs ───────────────────────────────────────────────────────────

  test('TC-C-01: GET /api/jobs 返回空数组（无 jobs.md）', async () => {
    const res = await app.fetch(new Request('http://localhost/api/jobs'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('TC-C-02: GET /api/jobs 解析 jobs.md 并返回结构化数组', async () => {
    const jobsPath = path.join(TEST_WORKSPACE, 'data/jobs.md')
    const originalContent = fs.existsSync(jobsPath) ? fs.readFileSync(jobsPath, 'utf-8') : null
    const md = [
      '| 公司 | 职位 | 链接 | 状态 | 时间 |',
      '| --- | --- | --- | --- | --- |',
      '| Acme | SWE | https://acme.com | applied | 2024-01-01 |',
    ].join('\n')
    fs.writeFileSync(jobsPath, md, 'utf-8')

    try {
      const res = await app.fetch(new Request('http://localhost/api/jobs'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toHaveLength(1)
      expect(body[0].company).toBe('Acme')
      expect(body[0].status).toBe('applied')
    } finally {
      // Restore original file content (or remove if it didn't exist)
      if (originalContent !== null) {
        fs.writeFileSync(jobsPath, originalContent, 'utf-8')
      } else {
        fs.unlinkSync(jobsPath)
      }
    }
  })

  // ── POST /api/intervention ──────────────────────────────────────────────────

  test('TC-C-03: POST /api/intervention 返回 ok:true', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/intervention', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: 'hello', agentName: 'test' }),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('TC-C-04: POST /api/intervention 请求体非 JSON 时返回 400', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/intervention', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'not-json',
      })
    )
    expect(res.status).toBe(400)
  })

  // ── GET /api/config/:name ───────────────────────────────────────────────────

  test('TC-C-05: GET /api/config/targets 文件不存在时返回空内容', async () => {
    const targets = path.join(TEST_WORKSPACE, 'data/targets.md')
    const backup = fs.existsSync(targets) ? fs.readFileSync(targets, 'utf-8') : null
    if (fs.existsSync(targets)) fs.unlinkSync(targets)

    try {
      const res = await app.fetch(new Request('http://localhost/api/config/targets'))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.ok).toBe(true)
      expect(body.content).toBe('')
    } finally {
      if (backup !== null) fs.writeFileSync(targets, backup, 'utf-8')
    }
  })

  test('TC-C-06: GET /api/config/unknown 返回 400', async () => {
    const res = await app.fetch(new Request('http://localhost/api/config/unknown'))
    expect(res.status).toBe(400)
  })

  // ── POST /api/config/:name ──────────────────────────────────────────────────

  test('TC-C-07: POST /api/config/targets 写入文件并返回 ok:true', async () => {
    const targetsPath = path.join(TEST_WORKSPACE, 'data/targets.md')
    const backup = fs.existsSync(targetsPath) ? fs.readFileSync(targetsPath, 'utf-8') : null

    const res = await app.fetch(
      new Request('http://localhost/api/config/targets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# Test Targets\n- 公司 A\n' }),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    const written = fs.readFileSync(targetsPath, 'utf-8')
    expect(written).toContain('公司 A')

    // Restore
    if (backup !== null) fs.writeFileSync(targetsPath, backup, 'utf-8')
    else fs.unlinkSync(targetsPath)
  })

  test('TC-C-08: POST /api/config/unknown 返回 400', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/config/unknown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: 'x' }),
      })
    )
    expect(res.status).toBe(400)
  })

  // ── POST /api/resume/build ──────────────────────────────────────────────────

  test('TC-C-10: POST /api/resume/build 返回 ok:true', async () => {
    const res = await app.fetch(
      new Request('http://localhost/api/resume/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })

  test('TC-C-09: POST /api/config/userinfo 写入用户信息', async () => {
    const userinfoPath = path.join(TEST_WORKSPACE, 'data/userinfo.md')
    const backup = fs.existsSync(userinfoPath) ? fs.readFileSync(userinfoPath, 'utf-8') : null

    const res = await app.fetch(
      new Request('http://localhost/api/config/userinfo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: '# User Info\n姓名: 张三\n' }),
      })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)

    const written = fs.readFileSync(userinfoPath, 'utf-8')
    expect(written).toContain('张三')

    // Restore
    if (backup !== null) fs.writeFileSync(userinfoPath, backup, 'utf-8')
    else fs.unlinkSync(userinfoPath)
  })
})
