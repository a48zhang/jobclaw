import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { executeTool, TOOL_NAMES } from '../../../src/tools/index.js'

describe('update_workspace_context tool', () => {
  test('merges targets and userinfo conservatively with dedupe', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-update-context-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'data', 'targets.md'),
      '# 监测目标\n- Acme | https://acme.com/careers\n- Acme | https://acme.com/careers | duplicate-note\n- Legacy text',
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'data', 'userinfo.md'),
      '# 用户信息\n- 姓名：\n- 城市：上海\n- 城市：\n- 邮箱：old@example.com',
      'utf-8'
    )

    try {
      const result = await executeTool(
        TOOL_NAMES.UPDATE_WORKSPACE_CONTEXT,
        {
          targets: [
            { company: 'Acme', url: 'https://acme.com/careers', notes: 'new-note' },
            { company: 'Gamma', url: 'https://gamma.com/jobs', notes: 'remote' },
            { company: '', url: 'not-a-url' },
          ],
          userinfo: {
            姓名: '张三',
            城市: '北京',
            邮箱: '',
            手机: '13800000000',
          },
          source: 'chat',
        },
        {
          workspaceRoot: workspace,
          agentName: 'main',
          logger: () => {},
        }
      )

      expect(result.success).toBe(true)
      const payload = JSON.parse(result.content) as {
        changed: boolean
        source: string
        updatedFiles: string[]
        targets: { added: number; deduplicated: number; ignoredInvalid: number }
        userinfo: { filled: number; added: number; deduplicated: number; skippedConflicts: number; skippedEmpty: number }
      }
      expect(payload.changed).toBe(true)
      expect(payload.source).toBe('chat')
      expect(payload.updatedFiles).toEqual(expect.arrayContaining(['data/targets.md', 'data/userinfo.md']))
      expect(payload.targets.added).toBe(1)
      expect(payload.targets.deduplicated).toBe(1)
      expect(payload.targets.ignoredInvalid).toBe(1)
      expect(payload.userinfo.filled).toBe(1)
      expect(payload.userinfo.added).toBe(1)
      expect(payload.userinfo.deduplicated).toBe(1)
      expect(payload.userinfo.skippedConflicts).toBe(1)
      expect(payload.requiresReview).toBe(true)
      expect(payload.userinfo.skippedEmpty).toBe(1)

      const targetsContent = fs.readFileSync(path.join(workspace, 'data', 'targets.md'), 'utf-8')
      expect((targetsContent.match(/Acme \| https:\/\/acme\.com\/careers/g) ?? []).length).toBe(1)
      expect(targetsContent).toContain('Gamma | https://gamma.com/jobs | remote')

      const userinfoContent = fs.readFileSync(path.join(workspace, 'data', 'userinfo.md'), 'utf-8')
      expect(userinfoContent).toContain('- 姓名：张三')
      expect(userinfoContent).toContain('- 城市：上海')
      expect(userinfoContent).toContain('- 邮箱：old@example.com')
      expect(userinfoContent).toContain('- 手机：13800000000')
      expect(userinfoContent).not.toContain('- 城市：北京')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('rejects invalid args shape', async () => {
    const result = await executeTool(
      TOOL_NAMES.UPDATE_WORKSPACE_CONTEXT,
      { targets: 'invalid' as unknown as string[] },
      {
        workspaceRoot: '/tmp',
        agentName: 'main',
        logger: () => {},
      }
    )
    expect(result.success).toBe(false)
    expect(result.error).toContain('targets 必须是数组')
  })

  test('requires at least one section payload', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-update-context-empty-'))
    try {
      const result = await executeTool(
        TOOL_NAMES.UPDATE_WORKSPACE_CONTEXT,
        {},
        {
          workspaceRoot: workspace,
          agentName: 'main',
          logger: () => {},
        }
      )
      expect(result.success).toBe(false)
      expect(result.error).toContain('至少提供 targets 或 userinfo')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('requiresReview is false when no conflicts exist', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-tool-update-context-no-conflict-'))
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(
      path.join(workspace, 'data', 'targets.md'),
      '# 监测目标\n- Acme | https://acme.com/careers\n',
      'utf-8'
    )
    fs.writeFileSync(
      path.join(workspace, 'data', 'userinfo.md'),
      '# 用户信息\n- 姓名：\n- 邮箱：old@example.com',
      'utf-8'
    )

    try {
      const result = await executeTool(
        TOOL_NAMES.UPDATE_WORKSPACE_CONTEXT,
        {
          targets: [
            { company: 'Beta', url: 'https://beta.com/jobs', notes: 'onsite' },
          ],
          userinfo: {
            姓名: '李四',
            手机: '13900000000',
          },
          source: 'chat',
        },
        {
          workspaceRoot: workspace,
          agentName: 'main',
          logger: () => {},
        }
      )

      expect(result.success).toBe(true)
      const payload = JSON.parse(result.content) as {
        requiresReview?: boolean
      }
      expect(payload.requiresReview).toBe(false)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
