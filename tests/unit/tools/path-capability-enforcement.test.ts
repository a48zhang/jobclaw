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

  test('search profile uses upsert_job (not write_file) for job writes', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-upsert-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'state', 'jobs'), { recursive: true })

    try {
      // search profile uses upsert_job to write to state/jobs/jobs.json
      const result = await executeTool(
        'upsert_job',
        { company: 'Test Corp', title: 'Engineer', url: 'https://example.com', status: 'discovered' },
        {
          workspaceRoot: workspace,
          agentName: 'search-agent',
          profile: getProfileByName('search') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      // upsert_job should succeed since search has upsert_job tool
      expect(result.success).toBe(true)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('review profile cannot write to state/ directory (no write tools)', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-state-review-'))
    fs.mkdirSync(path.join(workspace, 'state'), { recursive: true })

    try {
      // Review profile has no write tools - verify it cannot write
      const result = await executeTool(
        'append_file',
        { path: 'state/test.txt', content: 'test' },
        {
          workspaceRoot: workspace,
          agentName: 'review-agent',
          profile: getProfileByName('review') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      // Should fail because review has no append_file in allowedTools
      expect(result.success).toBe(false)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('delivery profile can write to state/artifacts/', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-state-artifacts-'))
    fs.mkdirSync(path.join(workspace, 'state', 'artifacts'), { recursive: true })

    try {
      // Use append_file instead of write_file (delivery has write_file but this is simpler)
      const result = await executeTool(
        'append_file',
        { path: 'state/artifacts/test.txt', content: 'test content' },
        {
          workspaceRoot: workspace,
          agentName: 'delivery-agent',
          profile: getProfileByName('delivery') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      expect(result.success).toBe(true)
      const content = fs.readFileSync(path.join(workspace, 'state', 'artifacts', 'test.txt'), 'utf-8')
      expect(content).toBe('test content')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('resume profile can write to state/artifacts/', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-state-artifacts-resume-'))
    fs.mkdirSync(path.join(workspace, 'state', 'artifacts'), { recursive: true })

    try {
      const result = await executeTool(
        'append_file',
        { path: 'state/artifacts/resume.txt', content: 'resume content' },
        {
          workspaceRoot: workspace,
          agentName: 'resume-agent',
          profile: getProfileByName('resume') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      expect(result.success).toBe(true)
      const content = fs.readFileSync(path.join(workspace, 'state', 'artifacts', 'resume.txt'), 'utf-8')
      expect(content).toBe('resume content')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('delivery profile cannot write to state/jobs/ (control plane)', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-state-jobs-'))
    fs.mkdirSync(path.join(workspace, 'state', 'jobs'), { recursive: true })

    try {
      const result = await executeTool(
        'append_file',
        { path: 'state/jobs/test.json', content: '{}' },
        {
          workspaceRoot: workspace,
          agentName: 'delivery-agent',
          profile: getProfileByName('delivery') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('控制平面路径禁止写入')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('main profile can write to state/ subdirectories', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-state-main-'))
    fs.mkdirSync(path.join(workspace, 'state', 'jobs'), { recursive: true })

    try {
      const result = await executeTool(
        'append_file',
        { path: 'state/jobs/test.json', content: '{"test": true}' },
        {
          workspaceRoot: workspace,
          agentName: 'main',
          profile: getProfileByName('main') as any,
          capabilityPolicy: defaultCapabilityPolicy as any,
          logger: () => {},
        }
      )

      expect(result.success).toBe(true)
      const content = fs.readFileSync(path.join(workspace, 'state', 'jobs', 'test.json'), 'utf-8')
      expect(content).toBe('{"test": true}')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
