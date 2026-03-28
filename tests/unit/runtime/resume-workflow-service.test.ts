import { afterEach, describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ConfigStatus } from '../../../src/config'
import { ArtifactStore } from '../../../src/memory/artifactStore'
import { ResumeWorkflowService } from '../../../src/runtime/resume-workflow-service'
import type { SetupCapabilitySummary } from '../../../src/runtime/setup-summary-types'
import type { TaskResultsAggregate } from '../../../src/runtime/task-results-service'

const tempWorkspaces: string[] = []

afterEach(() => {
  while (tempWorkspaces.length > 0) {
    const workspace = tempWorkspaces.pop()
    if (workspace) {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  }
})

describe('ResumeWorkflowService', () => {
  test('builds a resume workflow overview from setup state, artifacts, and runtime task results', async () => {
    const workspace = createWorkspace()
    fs.mkdirSync(path.join(workspace, 'data', 'uploads'), { recursive: true })
    fs.mkdirSync(path.join(workspace, 'output'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'data', 'targets.md'), '# targets\n- Example | https://example.com\n', 'utf-8')
    fs.writeFileSync(
      path.join(workspace, 'data', 'userinfo.md'),
      '# 用户信息\n- 姓名：Ada\n- 邮箱：ada@example.com\n- 手机：13800000000\n- 方向：Backend\n- 城市：Shanghai\n- 学历/年限：5年\n- 关键词：Node.js\n',
      'utf-8'
    )
    fs.writeFileSync(path.join(workspace, 'data', 'uploads', 'resume-upload.pdf'), 'upload')
    fs.writeFileSync(path.join(workspace, 'output', 'resume.pdf'), 'generated')

    const artifactStore = new ArtifactStore(workspace)
    await artifactStore.recordGenerated('resume-upload.pdf', 'uploaded', 'data/uploads/resume-upload.pdf', {
      ownerId: 'main',
      sessionId: 'main',
    })

    const service = new ResumeWorkflowService({
      workspaceRoot: workspace,
      configStatus: readyConfigStatus(),
      runtimeStatus: {
        mcp: {
          enabled: true,
          connected: true,
          message: 'connected',
        },
      },
      taskResultsService: {
        aggregate: async () => ({
          generatedAt: '2026-03-28T03:00:00.000Z',
          tasks: [
            {
              id: 'resume-1',
              kind: 'delegation',
              profile: 'resume',
              sessionId: 'main',
              agentName: 'resume-agent',
              title: '生成简历',
              state: 'completed',
              lifecycle: 'completed',
              createdAt: '2026-03-28T02:50:00.000Z',
              updatedAt: '2026-03-28T02:59:00.000Z',
              activityAt: '2026-03-28T02:59:00.000Z',
              summary: 'Resume build completed',
              interventionCounts: {
                pending: 0,
                resolved: 0,
                timeout: 0,
                cancelled: 0,
              },
              artifactCount: 1,
            },
          ],
          recentFailures: [
            {
              id: 'review-1',
              kind: 'delegation',
              ownerId: 'review-1',
              sessionId: 'main',
              profile: 'review',
              state: 'failed',
              title: '评价简历',
              reason: 'LLM timeout',
              createdAt: '2026-03-28T02:40:00.000Z',
              updatedAt: '2026-03-28T02:41:00.000Z',
            },
          ],
          recentArtifacts: [],
          resultSummary: {
            generatedAt: '2026-03-28T03:00:00.000Z',
            headline: '',
            totalTasks: 1,
            sessionTasks: 0,
            delegatedTasks: 1,
            idleTasks: 0,
            runningTasks: 0,
            waitingTasks: 0,
            failedTasks: 0,
            completedTasks: 1,
            cancelledTasks: 0,
            pendingInterventions: 0,
            recentFailures: 1,
            recentArtifacts: 0,
          },
        } satisfies TaskResultsAggregate),
      },
      setupSummary: readySetupSummary(),
    })

    const overview = await service.getOverview({ sessionId: 'main' })

    expect(overview.uploadedResume.exists).toBe(true)
    expect(overview.generatedResume.exists).toBe(true)
    expect(overview.actions.review).toEqual({ enabled: true, reason: null })
    expect(overview.actions.build).toEqual({ enabled: true, reason: null })
    expect(overview.actions.download).toEqual({ enabled: true, reason: null })
    expect(overview.recentTasks.map((task) => task.profile)).toEqual(['resume'])
    expect(overview.recentFailures.map((failure) => failure.profile)).toEqual(['review'])
    expect(overview.recentArtifacts.map((artifact) => artifact.path).sort()).toEqual([
      'data/uploads/resume-upload.pdf',
      'output/resume.pdf',
    ])
  })

  test('disables review/build actions when prerequisites are missing', async () => {
    const workspace = createWorkspace()
    fs.mkdirSync(path.join(workspace, 'data'), { recursive: true })
    fs.writeFileSync(path.join(workspace, 'data', 'userinfo.md'), '# 用户信息\n', 'utf-8')

    const service = new ResumeWorkflowService({
      workspaceRoot: workspace,
      configStatus: incompleteConfigStatus(),
      runtimeStatus: {
        mcp: {
          enabled: false,
          connected: false,
          message: 'disabled',
        },
      },
      taskResultsService: {
        aggregate: async () => emptyTaskAggregate(),
      },
      setupSummary: setupRequiredSummary(),
    })

    const overview = await service.getOverview()

    expect(overview.uploadedResume.exists).toBe(false)
    expect(overview.generatedResume.exists).toBe(false)
    expect(overview.actions.review.enabled).toBe(false)
    expect(overview.actions.review.reason).toContain('上传 PDF')
    expect(overview.actions.build.enabled).toBe(false)
    expect(overview.actions.build.reason).toContain('基础模型配置未完成')
    expect(overview.actions.download.enabled).toBe(false)
  })
})

function createWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-resume-workflow-'))
  tempWorkspaces.push(workspace)
  return workspace
}

function readyConfigStatus(): ConfigStatus {
  return {
    ready: true,
    missingFields: [],
    config: {
      API_KEY: 'key',
      MODEL_ID: 'model',
      LIGHT_MODEL_ID: 'light',
      BASE_URL: 'https://example.com/v1',
      SERVER_PORT: 3000,
    },
  }
}

function incompleteConfigStatus(): ConfigStatus {
  return {
    ready: false,
    missingFields: ['API_KEY', 'MODEL_ID', 'BASE_URL'],
    config: {
      API_KEY: '',
      MODEL_ID: '',
      LIGHT_MODEL_ID: '',
      BASE_URL: '',
      SERVER_PORT: 3000,
    },
  }
}

function emptyTaskAggregate(): TaskResultsAggregate {
  return {
    generatedAt: '2026-03-28T03:00:00.000Z',
    tasks: [],
    recentFailures: [],
    recentArtifacts: [],
    resultSummary: {
      generatedAt: '2026-03-28T03:00:00.000Z',
      headline: '',
      totalTasks: 0,
      sessionTasks: 0,
      delegatedTasks: 0,
      idleTasks: 0,
      runningTasks: 0,
      waitingTasks: 0,
      failedTasks: 0,
      completedTasks: 0,
      cancelledTasks: 0,
      pendingInterventions: 0,
      recentFailures: 0,
      recentArtifacts: 0,
    },
  }
}

function readySetupSummary(): SetupCapabilitySummary {
  return {
    generatedAt: '2026-03-28T03:00:00.000Z',
    overall: {
      mode: 'ready',
      ready: true,
      setupReady: true,
      blockers: [],
      degraded: [],
      message: 'ready',
    },
    config: {
      ready: true,
      message: 'ready',
      missingFields: [],
      config: {
        MODEL_ID: 'model',
        LIGHT_MODEL_ID: 'light',
        BASE_URL: 'https://example.com/v1',
        SERVER_PORT: 3000,
      },
      apiKeyConfigured: true,
      recoverySuggestions: [],
      alternativePaths: [],
    },
    workspace: {
      targets: {
        area: 'targets',
        path: 'data/targets.md',
        exists: true,
        ready: true,
        completion: 1,
        message: 'ready',
        requiredMissing: [],
        recoverySuggestions: [],
        alternativePaths: [],
        details: {},
      },
      userinfo: {
        area: 'userinfo',
        path: 'data/userinfo.md',
        exists: true,
        ready: true,
        completion: 1,
        message: 'ready',
        requiredMissing: [],
        recoverySuggestions: [],
        alternativePaths: [],
        details: {},
      },
    },
    capabilities: {
      mcp: {
        area: 'mcp',
        state: 'ready',
        available: true,
        message: 'ready',
        reasons: [],
        recoverySuggestions: [],
        alternativePaths: [],
        affectedFeatures: [],
        details: {},
      },
      browser: {
        area: 'browser',
        state: 'ready',
        available: true,
        message: 'ready',
        reasons: [],
        recoverySuggestions: [],
        alternativePaths: [],
        affectedFeatures: [],
        details: {},
      },
      typst: {
        area: 'typst',
        state: 'ready',
        available: true,
        message: 'ready',
        reasons: [],
        recoverySuggestions: [],
        alternativePaths: [],
        affectedFeatures: [],
        details: {},
      },
    },
    issues: [],
    recoverySuggestions: [],
    alternativePaths: [],
  }
}

function setupRequiredSummary(): SetupCapabilitySummary {
  return {
    ...readySetupSummary(),
    overall: {
      mode: 'setup_required',
      ready: false,
      setupReady: false,
      blockers: ['config', 'userinfo'],
      degraded: [],
      message: 'setup required',
    },
    config: {
      ...readySetupSummary().config,
      ready: false,
      missingFields: ['API_KEY', 'MODEL_ID', 'BASE_URL'],
      apiKeyConfigured: false,
    },
    workspace: {
      ...readySetupSummary().workspace,
      userinfo: {
        ...readySetupSummary().workspace.userinfo,
        ready: false,
        completion: 0,
        requiredMissing: ['姓名'],
      },
    },
    capabilities: {
      ...readySetupSummary().capabilities,
      typst: {
        ...readySetupSummary().capabilities.typst,
        available: false,
        state: 'unavailable',
      },
    },
  }
}
