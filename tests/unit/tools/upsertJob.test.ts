import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { upsertJob } from '../../../src/tools/upsertJob'
import type { ToolContext } from '../../../src/tools/index'

describe('upsertJob', () => {
  let tempDir: string
  let context: ToolContext

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobclaw-test-'))
    context = {
      workspaceRoot: tempDir,
      agentName: 'test-agent',
      logger: () => {},
    }
    // Create data directory
    await fs.mkdir(path.join(tempDir, 'data'), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('should create jobs.md if it does not exist', async () => {
    const args = {
      company: 'Google',
      title: 'Software Engineer',
      url: 'https://google.com/jobs/1',
      status: 'discovered' as const,
    }

    const result = await upsertJob(args, context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('added')

    const content = await fs.readFile(path.join(tempDir, 'data/jobs.md'), 'utf-8')
    expect(content).toContain('| 公司 | 职位 | 链接 | 状态 | 时间 |')
    expect(content).toContain('Google')
    expect(content).toContain('https://google.com/jobs/1')
  })

  it('should update an existing job if URL matches', async () => {
    const jobsPath = path.join(tempDir, 'data/jobs.md')
    const initialContent = 
`| 公司 | 职位 | 链接 | 状态 | 时间 |
| --- | --- | --- | --- | --- |
| Google | SE | https://google.com/jobs/1 | discovered | 2023-01-01 |
`
    await fs.writeFile(jobsPath, initialContent)

    const args = {
      company: 'Google',
      title: 'Senior Software Engineer',
      url: 'https://google.com/jobs/1',
      status: 'applied' as const,
    }

    const result = await upsertJob(args, context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('updated')

    const content = await fs.readFile(jobsPath, 'utf-8')
    expect(content).toContain('Senior Software Engineer')
    expect(content).toContain('applied')
    expect(content.split('\n').filter(l => l.trim()).length).toBe(3) // Header + Separator + 1 Data Row
  })

  it('should skip update if new status is "discovered" but current is "applied"', async () => {
    const jobsPath = path.join(tempDir, 'data/jobs.md')
    const initialContent = 
`| 公司 | 职位 | 链接 | 状态 | 时间 |
| --- | --- | --- | --- | --- |
| Google | SE | https://google.com/jobs/1 | applied | 2023-01-01 |
`
    await fs.writeFile(jobsPath, initialContent)

    const args = {
      company: 'Google',
      title: 'Software Engineer',
      url: 'https://google.com/jobs/1',
      status: 'discovered' as const,
    }

    const result = await upsertJob(args, context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('skipped')

    const content = await fs.readFile(jobsPath, 'utf-8')
    expect(content).toContain('applied')
    expect(content).not.toContain('discovered')
  })

  it('should handle broken rows in jobs.md gracefully', async () => {
    const jobsPath = path.join(tempDir, 'data/jobs.md')
    const initialContent = 
`| 公司 | 职位 | 链接 | 状态 | 时间 |
| --- | --- | --- | --- | --- |
| Broken | Row |
| Google | SE | https://google.com/jobs/1 | discovered | 2023-01-01 |
`
    await fs.writeFile(jobsPath, initialContent)

    const args = {
      company: 'Google',
      title: 'Software Engineer',
      url: 'https://google.com/jobs/1',
      status: 'applied' as const,
    }

    const result = await upsertJob(args, context)
    expect(result.success).toBe(true)
    expect(result.action).toBe('updated')

    const content = await fs.readFile(jobsPath, 'utf-8')
    expect(content).toContain('applied')
    expect(content).toContain('Broken | Row') // Broken row should be preserved
  })
})
