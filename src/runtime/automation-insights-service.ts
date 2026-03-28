import type { ConfigStatus } from '../config.js'
import { ApplicationService } from '../domain/application-service.js'
import { RecommendationService } from '../domain/recommendation-service.js'
import type { MCPClientStatus } from '../mcp.js'
import { buildSetupCapabilitySummary } from './setup-summary.js'
import { RuntimeTaskResultsService } from './task-results-service.js'
import { nowIso } from './utils.js'

export interface AutomationInsightsServiceOptions {
  workspaceRoot: string
  configStatus?: ConfigStatus
  runtimeStatus?: {
    mcp?: MCPClientStatus | null
  }
  taskResultsService?: Pick<RuntimeTaskResultsService, 'aggregate'>
  applicationService?: Pick<ApplicationService, 'getSummary'>
  recommendationService?: Pick<RecommendationService, 'list'>
}

export class AutomationInsightsService {
  private readonly workspaceRoot: string
  private readonly configStatus?: ConfigStatus
  private readonly runtimeStatus?: {
    mcp?: MCPClientStatus | null
  }
  private readonly taskResultsService: Pick<RuntimeTaskResultsService, 'aggregate'>
  private readonly applicationService: Pick<ApplicationService, 'getSummary'>
  private readonly recommendationService: Pick<RecommendationService, 'list'>

  constructor(options: AutomationInsightsServiceOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.configStatus = options.configStatus
    this.runtimeStatus = options.runtimeStatus
    this.taskResultsService = options.taskResultsService ?? new RuntimeTaskResultsService(options.workspaceRoot)
    this.applicationService = options.applicationService ?? new ApplicationService(options.workspaceRoot)
    this.recommendationService = options.recommendationService ?? new RecommendationService(options.workspaceRoot)
  }

  async getInsights(options: { sessionId?: string } = {}) {
    const generatedAt = nowIso()
    const [setup, tasksSnapshot, applicationSummary, recommendations] = await Promise.all([
      buildSetupCapabilitySummary({
        workspaceRoot: this.workspaceRoot,
        configStatus: this.configStatus,
        runtimeStatus: this.runtimeStatus,
      }),
      this.taskResultsService.aggregate({ sessionId: options.sessionId, taskLimit: 20, failureLimit: 10, artifactLimit: 10 }),
      this.applicationService.getSummary(),
      this.recommendationService.list({ limit: 5 }),
    ])

    const activeTasks = tasksSnapshot.tasks.filter((task) => task.lifecycle === 'running' || task.lifecycle === 'waiting')
    const pendingAuthorizations = tasksSnapshot.tasks
      .filter((task) => task.pendingIntervention)
      .map((task) => ({
        taskId: `${task.kind}:${task.id}`,
        title: task.title,
        prompt: task.pendingIntervention?.prompt ?? '',
        profile: task.profile,
        updatedAt: task.pendingIntervention?.updatedAt ?? task.updatedAt,
      }))

    const nextSteps = [
      ...setup.recoverySuggestions.slice(0, 2),
      ...(pendingAuthorizations.length > 0 ? ['Resolve pending interventions so blocked agent work can continue.'] : []),
      ...(applicationSummary.overdueReminders > 0 ? [`${applicationSummary.overdueReminders} application reminders are overdue.`] : []),
      ...(recommendations[0] ? [`Review top recommendation: ${recommendations[0].summary}`] : []),
    ].filter(Boolean)

    return {
      ok: true,
      generatedAt,
      currentFocus: activeTasks[0]
        ? {
            taskId: `${activeTasks[0].kind}:${activeTasks[0].id}`,
            title: activeTasks[0].title,
            state: activeTasks[0].lifecycle,
            summary: activeTasks[0].summary,
          }
        : null,
      pendingAuthorizations,
      attentionRequired: tasksSnapshot.recentFailures.slice(0, 5),
      nextSteps,
      pipeline: {
        applications: applicationSummary,
        recommendations: recommendations.map((item) => ({
          jobId: item.jobId,
          score: item.score,
          band: item.band,
          summary: item.summary,
        })),
      },
    }
  }
}
