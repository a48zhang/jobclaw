import { describe, expect, it } from 'vitest'
import * as fs from 'node:fs/promises'
import * as fsSync from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { executeUpsertJob } from '../../../src/tools/upsertJobWrapper.js'

describe('Memory workspace state scaffolding', () => {
  it('creates jobs.md with header and appends a new job', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jobclaw-memory-'))
    try {
      const context = {
        workspaceRoot: tmpDir,
        agentName: 'test-agent',
        logger: () => {},
      }

      const first = await executeUpsertJob(
        { company: 'C1', title: 'Engineer', url: 'https://example.com/a', status: 'discovered' },
        context as any
      )

      expect(first.success).toBe(true)
      const jobsPath = path.join(tmpDir, 'data/jobs.md')
      const content = await fs.readFile(jobsPath, 'utf-8')
      expect(content).toContain('| 公司 | 职位 | 链接 | 状态 | 时间 |')
      expect(content).toContain('C1')

      const second = await executeUpsertJob(
        { company: 'C2', title: 'Backend', url: 'https://example.com/b', status: 'applied' },
        context as any
      )
      expect(second.success).toBe(true)
      const updated = await fs.readFile(jobsPath, 'utf-8')
      expect(updated).toContain('C2')
      expect(updated).toContain('applied')
    } finally {
      fsSync.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
