import { LearningService } from '../domain/learning-service.js'
import { RecommendationService } from '../domain/recommendation-service.js'
import { ApplicationService } from '../domain/application-service.js'
import type { ApplicationRecord } from './contracts.js'
import { RuntimeTaskResultsService, type UnifiedTaskDetail } from './task-results-service.js'

export interface ExecutionTraceServiceOptions {
  workspaceRoot: string
  applicationService?: Pick<ApplicationService, 'get' | 'findByTaskId'>
  learningService?: Pick<LearningService, 'findLinked'>
  recommendationService?: Pick<RecommendationService, 'get'>
  taskResultsService?: Pick<RuntimeTaskResultsService, 'getTaskDetail'>
}

export class ExecutionTraceService {
  private readonly applicationService: Pick<ApplicationService, 'get' | 'findByTaskId'>
  private readonly learningService: Pick<LearningService, 'findLinked'>
  private readonly recommendationService: Pick<RecommendationService, 'get'>
  private readonly taskResultsService: Pick<RuntimeTaskResultsService, 'getTaskDetail'>

  constructor(options: ExecutionTraceServiceOptions) {
    this.applicationService = options.applicationService ?? new ApplicationService(options.workspaceRoot)
    this.learningService = options.learningService ?? new LearningService(options.workspaceRoot)
    this.recommendationService = options.recommendationService ?? new RecommendationService(options.workspaceRoot)
    this.taskResultsService = options.taskResultsService ?? new RuntimeTaskResultsService(options.workspaceRoot)
  }

  async getByApplicationId(applicationId: string) {
    const application = await this.applicationService.get(applicationId)
    if (!application) return null

    const [tasks, recommendation, learningRecords] = await Promise.all([
      Promise.all(application.linkedTasks.map((link) => this.taskResultsService.getTaskDetail(link.taskId))),
      application.jobId ? this.recommendationService.get(application.jobId) : Promise.resolve(undefined),
      this.learningService.findLinked({ applicationId: application.id, jobId: application.jobId }),
    ])

    return buildExecutionTrace({
      focus: {
        type: 'application',
        id: application.id,
      },
      application,
      learningRecords,
      recommendation: recommendation ?? null,
      tasks: tasks.filter((item): item is UnifiedTaskDetail => Boolean(item)),
    })
  }

  async getByTaskId(taskId: string) {
    const task = await this.taskResultsService.getTaskDetail(taskId)
    if (!task) return null

    const applications = await this.applicationService.findByTaskId(task.task.id)
    const primaryApplication = applications.find((application) => application.jobId) ?? applications[0]
    const [recommendation, learningRecords] = await Promise.all([
      primaryApplication?.jobId ? this.recommendationService.get(primaryApplication.jobId) : Promise.resolve(undefined),
      this.learningService.findLinked({
        taskId: task.task.id,
        applicationId: primaryApplication?.id,
        jobId: primaryApplication?.jobId,
      }),
    ])
    return buildExecutionTrace({
      focus: {
        type: 'task',
        id: task.task.id,
      },
      learningRecords,
      recommendation: recommendation ?? null,
      task,
      applications,
    })
  }
}

function buildExecutionTrace(input: {
  focus: { type: 'application' | 'task'; id: string }
  application?: ApplicationRecord
  applications?: ApplicationRecord[]
  learningRecords?: Awaited<ReturnType<LearningService['findLinked']>>
  recommendation?: Awaited<ReturnType<RecommendationService['get']>> | null
  task?: UnifiedTaskDetail
  tasks?: UnifiedTaskDetail[]
}) {
  const relatedTasks = input.tasks ?? (input.task ? [input.task] : [])
  const relatedApplications = input.applications ?? (input.application ? [input.application] : [])
  const pendingAuthorizations = relatedTasks
    .flatMap((task) => task.interventions)
    .filter((item) => item.status === 'pending')
    .map((item) => ({
      ownerId: item.ownerId,
      interventionId: item.id,
      prompt: item.prompt,
      kind: item.kind,
      status: item.status,
    }))
  const blockers = [
    ...relatedTasks
      .flatMap((task) => task.failures)
      .map((failure) => failure.reason),
    ...pendingAuthorizations.map((item) => item.prompt),
  ]
  const nextSteps = [
    ...relatedTasks.flatMap((task) => task.nextActions.map((action) => action.reason)),
    ...relatedApplications
      .map((application) => application.nextAction?.summary)
      .filter((item): item is string => Boolean(item)),
    ...(input.learningRecords ?? [])
      .flatMap((record) => record.actionItems)
      .filter((item) => item.status === 'pending')
      .map((item) => item.summary),
  ]
  const whyThisWork = [
    ...(input.recommendation ? [input.recommendation.summary] : []),
    ...relatedTasks.map((task) => `Agent is running a ${task.task.profile} ${task.task.kind} task: ${task.task.title}`),
    ...relatedApplications.map((application) => `Application ${application.company} / ${application.jobTitle} is currently ${application.status}`),
  ]

  return {
    ok: true,
    focus: input.focus,
    application: input.application ?? null,
    task: input.task ?? null,
    recommendation: input.recommendation ?? null,
    relatedApplications,
    learningRecords: input.learningRecords ?? [],
    relatedTasks,
    blockers: Array.from(new Set(blockers)),
    nextSteps: Array.from(new Set(nextSteps)),
    explanation: {
      whyThisWork: Array.from(new Set(whyThisWork)),
      nextPlannedSteps: Array.from(new Set(nextSteps)),
      pendingAuthorizations,
      auditTrail: {
        taskCount: relatedTasks.length,
        applicationCount: relatedApplications.length,
        learningRecordCount: (input.learningRecords ?? []).length,
        artifactCount: relatedTasks.reduce((total, task) => total + task.artifacts.length, 0),
        failureCount: relatedTasks.reduce((total, task) => total + task.failures.length, 0),
        timelineEventCount: relatedApplications.reduce((total, application) => total + application.timeline.length, 0),
      },
    },
  }
}
