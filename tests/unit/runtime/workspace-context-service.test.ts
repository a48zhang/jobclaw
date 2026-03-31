import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { WorkspaceContextService } from '../../../src/runtime/workspace-context-service.js'
import type { CapabilityPolicy, AgentProfile } from '../../../src/runtime/capability-types.js'

describe('WorkspaceContextService', () => {
  test('creates missing workspace files and writes canonical sections', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-runtime-context-create-'))
    const service = new WorkspaceContextService({
      workspaceRoot: workspace,
      agentName: 'main',
    })

    try {
      const result = await service.update({
        targets: [{ company: 'Acme', url: 'https://acme.com/jobs', notes: 'backend' }],
        userinfo: { 姓名: '张三', 方向: '后端开发' },
      })

      expect(result.changed).toBe(true)
      expect(result.updatedFiles).toEqual(expect.arrayContaining(['data/targets.md', 'data/userinfo.md']))
      expect(result.targets.added).toBe(1)
      expect(result.userinfo.added).toBe(2)

      const targetsContent = fs.readFileSync(path.join(workspace, 'data', 'targets.md'), 'utf-8')
      expect(targetsContent).toContain('# 监测目标')
      expect(targetsContent).toContain('- Acme | https://acme.com/jobs | backend')

      const userinfoContent = fs.readFileSync(path.join(workspace, 'data', 'userinfo.md'), 'utf-8')
      expect(userinfoContent).toContain('# 用户信息')
      expect(userinfoContent).toContain('- 姓名：张三')
      expect(userinfoContent).toContain('- 方向：后端开发')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('preserves existing non-empty userinfo and skips empty updates', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-runtime-context-merge-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'data', 'userinfo.md'),
      '# 用户信息\n- 邮箱：old@example.com\n- 城市：上海',
      'utf-8'
    )

    const service = new WorkspaceContextService({
      workspaceRoot: workspace,
      agentName: 'main',
    })

    try {
      const result = await service.update({
        userinfo: {
          邮箱: '',
          城市: '北京',
          手机: '13800000000',
        },
      })

      expect(result.changed).toBe(true)
      expect(result.userinfo.skippedEmpty).toBe(1)
      expect(result.userinfo.skippedConflicts).toBe(1)
      expect(result.userinfo.added).toBe(1)

      const content = fs.readFileSync(path.join(workspace, 'data', 'userinfo.md'), 'utf-8')
      expect(content).toContain('- 邮箱：old@example.com')
      expect(content).toContain('- 城市：上海')
      expect(content).toContain('- 手机：13800000000')
      expect(content).not.toContain('- 城市：北京')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('throws when capability policy denies write to targets.md', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-runtime-context-policy-'))
    const profile: AgentProfile = {
      name: 'main',
      systemPromptSections: [],
      allowedTools: [],
      readableRoots: ['workspace'],
      writableRoots: ['workspace'],
      allowBrowser: false,
      allowNotifications: false,
      allowAdminTools: false,
      allowDelegationTo: [],
    }
    const denyingPolicy: CapabilityPolicy = {
      canUseTool: () => ({ allowed: true }),
      canReadPath: () => ({ allowed: true }),
      canWritePath: (_profile: AgentProfile, relPath: string) =>
        relPath !== 'data/targets.md'
          ? { allowed: true }
          : { allowed: false, reason: 'Policy denies write to data/targets.md' },
      canDelegate: () => ({ allowed: false }),
    }
    const service = new WorkspaceContextService({
      workspaceRoot: workspace,
      agentName: 'main',
      profile,
      capabilityPolicy: denyingPolicy,
    })

    try {
      await expect(
        service.update({ targets: [{ company: 'Acme', url: 'https://acme.com' }] })
      ).rejects.toThrow('Policy denies write to data/targets.md')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
