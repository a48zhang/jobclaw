import { ApplicationService } from '../domain/application-service.js'
import type { ApplicationRecord } from './contracts.js'
import { RuntimeTaskResultsService, type UnifiedTaskDetail } from './task-results-service.js'

export interface ExecutionTraceServiceOptions {
  workspaceRoot: string
  applicationService?: Pick<ApplicationService, 'get' | 'findByTaskId'>
  taskResultsService?: Pick<RuntimeTaskResultsService, 'getTaskDetail'>
}

export class ExecutionTraceService {
  private readonly applicationService: Pick<ApplicationService, 'get' | 'findByTaskId'>
  private readonly taskResultsService: Pick<RuntimeTaskResultsService, 'getTaskDetail'>

  constructor(options: ExecutionTraceServiceOptions) {
    this.applicationService = options.applicationService ?? new ApplicationService(options.workspaceRoot)
    this.taskResultsService = options.taskResultsService ?? new RuntimeTaskResultsService(options.workspaceRoot)
  }

  async getByApplicationId(applicationId: string) {
    const application = await this.applicationService.get(applicationId)
    if (!application) return null

    const tasks = await Promise.all(
      application.linkedTasks.map((link) => this.taskResultsService.getTaskDetail(link.taskId))
    )

    return buildExecutionTrace({
      focus: {
        type: 'application',
        id: application.id,
      },
      application,
      tasks: tasks.filter((item): item is UnifiedTaskDetail => Boolean(item)),
    })
  }

  async getByTaskId(taskId: string) {
    const task = await this.taskResultsService.getTaskDetail(taskId)
    if (!task) return null

    const applications = await this.applicationService.findByTaskId(task.task.id)
    return buildExecutionTrace({
      focus: {
        type: 'task',
        id: task.task.id,
      },
      task,
      applications,
    })
  }
}

function buildExecutionTrace(input: {
  focus: { type: 'application' | 'task'; id: string }
  application?: ApplicationRecord
  applications?: ApplicationRecord[]
  task?: UnifiedTaskDetail
  tasks?: UnifiedTaskDetail[]
}) {
  const relatedTasks = input.tasks ?? (input.task ? [input.task] : [])
  const relatedApplications = input.applications ?? (input.application ? [input.application] : [])
  const blockers = [
    ...relatedTasks
      .flatMap((task) => task.failures)
      .map((failure) => failure.reason),
    ...relatedTasks
      .flatMap((task) => task.interventions)
      .filter((item) => item.status === 'pending')
      .map((item) => item.prompt),
  ]
  const nextSteps = [
    ...relatedTasks.flatMap((task) => task.nextActions.map((action) => action.reason)),
    ...relatedApplications
      .map((application) => application.nextAction?.summary)
      .filter((item): item is string => Boolean(item)),
  ]

  return {
    ok: true,
    focus: input.focus,
    application: input.application ?? null,
    task: input.task ?? null,
    relatedApplications,
    relatedTasks,
    blockers: Array.from(new Set(blockers)),
    nextSteps: Array.from(new Set(nextSteps)),
  }
}
