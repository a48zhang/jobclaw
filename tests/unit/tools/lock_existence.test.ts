import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { executeLockFile } from '../../../src/tools/lockFile'
import type { ToolContext } from '../../../src/tools'

describe('lockFile Existence Check', () => {
  const workspaceRoot = path.resolve(process.cwd(), 'temp_test_workspace_lock')
  const dataDir = path.join(workspaceRoot, 'data')

  beforeEach(() => {
    if (!fs.existsSync(workspaceRoot)) {
      fs.mkdirSync(workspaceRoot, { recursive: true })
    }
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
  })

  afterEach(() => {
    if (fs.existsSync(workspaceRoot)) {
      fs.rmSync(workspaceRoot, { recursive: true, force: true })
    }
  })

  it('should fail to lock a non-existent file', async () => {
    const context: ToolContext = {
      workspaceRoot,
      agentName: 'test-agent'
    }

    const result = await executeLockFile({ path: 'data/missing.md' }, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('无法锁定不存在的文件')
  })

  it('should succeed to lock an existing file', async () => {
    const filePath = path.join(dataDir, 'exists.md')
    fs.writeFileSync(filePath, 'content', 'utf-8')

    const context: ToolContext = {
      workspaceRoot,
      agentName: 'test-agent'
    }

    const result = await executeLockFile({ path: 'data/exists.md' }, context)
    expect(result.success).toBe(true)
    expect(result.content).toBe('获取锁成功')
  })
})
