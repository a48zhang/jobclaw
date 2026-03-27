import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { executeTool } from '../../../src/tools/index.js'
import { defaultCapabilityPolicy } from '../../../src/tools/capability-policy.js'
import { getProfileByName } from '../../../src/agents/profiles.js'

describe('tool path capability enforcement', () => {
  test('read_file denies paths outside readable roots for review profile', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-cap-read-'))
    fs.mkdirSync(path.join(workspace, 'agents', 'other'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'agents', 'other', 'session.json'), '{}', 'utf-8')

    try {
      const result = await executeTool(
        'read_file',
        { path: 'agents/other/session.json' },
        {
          workspaceRoot: workspace,
          agentName: 'review-agent',
          profile: getProfileByName('review') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Profile')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('write_file denies writes outside writable roots for review profile before lock checks', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-cap-write-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'data', 'jobs.md'), 'hello world', 'utf-8')

    try {
      const result = await executeTool(
        'write_file',
        { path: 'data/jobs.md', old_string: 'hello', new_string: 'bye' },
        {
          workspaceRoot: workspace,
          agentName: 'review-agent',
          profile: getProfileByName('review') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Profile')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('executeTool rejects admin tool for delivery profile', async () => {
    const result = await executeTool(
      'run_shell_command',
      { command: 'echo hi' },
      {
        workspaceRoot: '/tmp',
        agentName: 'delivery-agent',
        profile: getProfileByName('delivery') as any,
        capabilityPolicy: defaultCapabilityPolicy as any,
        logger: () => {},
      }
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('管理员权限')
  })

  test('delivery profile can acquire and release shared data lock without pre-existing lock', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-cap-lock-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'data', 'jobs.md'), '# Jobs', 'utf-8')

    try {
      const context = {
        workspaceRoot: workspace,
        agentName: 'delivery-agent',
        profile: getProfileByName('delivery') as any,
        capabilityPolicy: defaultCapabilityPolicy as any,
        logger: () => {},
      }

      const lockResult = await executeTool('lock_file', { path: 'data/jobs.md' }, context)
      expect(lockResult.success).toBe(true)

      const unlockResult = await executeTool('unlock_file', { path: 'data/jobs.md' }, context)
      expect(unlockResult.success).toBe(true)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('review profile cannot call lock_file on shared data', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-cap-lock-deny-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'data', 'jobs.md'), '# Jobs', 'utf-8')

    try {
      const result = await executeTool(
        'lock_file',
        { path: 'data/jobs.md' },
        {
          workspaceRoot: workspace,
          agentName: 'review-agent',
          profile: getProfileByName('review') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Profile')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
