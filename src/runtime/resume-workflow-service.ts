import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ConfigStatus } from '../config.js'
import { ArtifactStore } from '../memory/artifactStore.js'
import type { MCPClientStatus } from '../mcp.js'
import { buildSetupCapabilitySummary } from './setup-summary.js'
import type { SetupCapabilitySummary } from './setup-summary-types.js'
import { RuntimeTaskResultsService, type UnifiedArtifactRecord, type UnifiedFailureRecord, type UnifiedTaskRecord } from './task-results-service.js'
import { nowIso } from './utils.js'

const UPLOADED_RESUME_PATH = 'data/uploads/resume-upload.pdf'
const GENERATED_RESUME_PATH = 'output/resume.pdf'

export interface ResumeWorkflowArtifact {
  id: string
  path: string
  name: string
  type: 'uploaded' | 'generated'
  createdAt: string
  source: 'artifact_store' | 'filesystem'
  meta: Record<string, unknown>
}

export interface ResumeWorkflowAction {
  enabled: boolean
  reason: string | null
}

export interface ResumeWorkflowOverview {
  generatedAt: string
  setup: {
    mode: 'ready' | 'degraded' | 'setup_required'
    ready: boolean
    configReady: boolean
    userinfoReady: boolean
    typstAvailable: boolean
  }
  uploadedResume: {
    exists: boolean
    artifact: ResumeWorkflowArtifact | null
  }
  generatedResume: {
    exists: boolean
    artifact: ResumeWorkflowArtifact | null
  }
  recentArtifacts: ResumeWorkflowArtifact[]
  recentTasks: UnifiedTaskRecord[]
  recentFailures: UnifiedFailureRecord[]
  actions: {
    upload: ResumeWorkflowAction
    review: ResumeWorkflowAction
    build: ResumeWorkflowAction
    download: ResumeWorkflowAction
  }
}

export interface ResumeWorkflowServiceOptions {
  workspaceRoot: string
  configStatus?: ConfigStatus
  runtimeStatus?: {
    mcp?: MCPClientStatus | null
  }
  artifactStore?: Pick<ArtifactStore, 'list'>
  taskResultsService?: Pick<RuntimeTaskResultsService, 'aggregate'>
  setupSummary?: SetupCapabilitySummary
}

export class ResumeWorkflowService {
  private readonly workspaceRoot: string
  private readonly configStatus?: ConfigStatus
  private readonly runtimeStatus?: {
    mcp?: MCPClientStatus | null
  }
  private readonly artifactStore: Pick<ArtifactStore, 'list'>
  private readonly taskResultsService: Pick<RuntimeTaskResultsService, 'aggregate'>
  private readonly setupSummary?: SetupCapabilitySummary

  constructor(options: ResumeWorkflowServiceOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.configStatus = options.configStatus
    this.runtimeStatus = options.runtimeStatus
    this.artifactStore = options.artifactStore ?? new ArtifactStore(options.workspaceRoot)
    this.taskResultsService = options.taskResultsService ?? new RuntimeTaskResultsService(options.workspaceRoot)
    this.setupSummary = options.setupSummary
  }

  async getOverview(options: { sessionId?: string } = {}): Promise<ResumeWorkflowOverview> {
    const generatedAt = nowIso()
    const [setup, artifactRecords, taskSnapshot] = await Promise.all([
      this.setupSummary
        ? Promise.resolve(this.setupSummary)
        : buildSetupCapabilitySummary({
          workspaceRoot: this.workspaceRoot,
          configStatus: this.configStatus,
          runtimeStatus: this.runtimeStatus,
          generatedAt,
        }),
      this.listArtifacts(),
      this.taskResultsService.aggregate({ sessionId: options.sessionId }),
    ])

    const recentTasks = taskSnapshot.tasks
      .filter((task) => task.profile === 'resume' || task.profile === 'review')
      .slice(0, 10)
    const recentFailures = taskSnapshot.recentFailures
      .filter((failure) => failure.profile === 'resume' || failure.profile === 'review')
      .slice(0, 10)

    const uploadedResume = artifactRecords.find((artifact) => artifact.path === UPLOADED_RESUME_PATH) ?? null
    const generatedResume = artifactRecords.find((artifact) => artifact.path === GENERATED_RESUME_PATH) ?? null

    return {
      generatedAt,
      setup: {
        mode: setup.overall.mode,
        ready: setup.overall.ready,
        configReady: setup.config.ready,
        userinfoReady: setup.workspace.userinfo.ready,
        typstAvailable: setup.capabilities.typst.available,
      },
      uploadedResume: {
        exists: Boolean(uploadedResume),
        artifact: uploadedResume,
      },
      generatedResume: {
        exists: Boolean(generatedResume),
        artifact: generatedResume,
      },
      recentArtifacts: artifactRecords,
      recentTasks,
      recentFailures,
      actions: {
        upload: {
          enabled: true,
          reason: null,
        },
        review: {
          enabled: setup.config.ready && Boolean(uploadedResume),
          reason: !uploadedResume
            ? '需要先上传 PDF 简历。'
            : !setup.config.ready
              ? '基础模型配置未完成，暂时无法发起简历评价。'
              : null,
        },
        build: {
          enabled: setup.config.ready && setup.workspace.userinfo.ready && setup.capabilities.typst.available,
          reason: !setup.config.ready
            ? '基础模型配置未完成，暂时无法生成简历。'
            : !setup.workspace.userinfo.ready
              ? 'userinfo.md 关键字段未完成，暂时无法生成简历。'
              : !setup.capabilities.typst.available
                ? 'Typst 当前不可用，暂时无法生成 PDF 简历。'
                : null,
        },
        download: {
          enabled: Boolean(generatedResume),
          reason: generatedResume ? null : '尚未发现生成后的简历 PDF。',
        },
      },
    }
  }

  async listArtifacts(limit?: number): Promise<ResumeWorkflowArtifact[]> {
    const stored = await this.artifactStore.list()
    const artifacts = dedupeArtifacts([
      ...stored
        .filter((artifact) => artifact.path === UPLOADED_RESUME_PATH || artifact.path === GENERATED_RESUME_PATH)
        .map((artifact) => ({
          id: artifact.id,
          path: artifact.path,
          name: artifact.name,
          type: artifact.type,
          createdAt: artifact.createdAt,
          source: 'artifact_store' as const,
          meta: artifact.meta,
        })),
      ...(await this.readFallbackArtifact(UPLOADED_RESUME_PATH, '上传简历 PDF', 'uploaded')),
      ...(await this.readFallbackArtifact(GENERATED_RESUME_PATH, '生成简历 PDF', 'generated')),
    ])

    const sorted = artifacts.sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
      return sorted.slice(0, limit)
    }
    return sorted
  }

  private async readFallbackArtifact(
    relPath: string,
    name: string,
    type: 'uploaded' | 'generated'
  ): Promise<ResumeWorkflowArtifact[]> {
    const absolutePath = path.resolve(this.workspaceRoot, relPath)
    try {
      const stats = await fs.stat(absolutePath)
      if (!stats.isFile()) return []
      return [{
        id: `fs:${relPath}`,
        path: relPath,
        name,
        type,
        createdAt: stats.mtime.toISOString(),
        source: 'filesystem',
        meta: {
          size: stats.size,
        },
      }]
    } catch {
      return []
    }
  }
}

function dedupeArtifacts(artifacts: ResumeWorkflowArtifact[]): ResumeWorkflowArtifact[] {
  const byPath = new Map<string, ResumeWorkflowArtifact>()
  for (const artifact of artifacts) {
    const existing = byPath.get(artifact.path)
    if (!existing) {
      byPath.set(artifact.path, artifact)
      continue
    }
    if (Date.parse(artifact.createdAt) >= Date.parse(existing.createdAt)) {
      byPath.set(artifact.path, artifact)
    }
  }
  return Array.from(byPath.values())
}

export function isResumeArtifact(artifact: UnifiedArtifactRecord): boolean {
  return artifact.path === UPLOADED_RESUME_PATH || artifact.path === GENERATED_RESUME_PATH
}
