import { eventBus } from '../eventBus.js'
import { JobsService } from '../domain/jobs-service.js'
import type { ToolContext } from './index.js'

export interface UpsertJobArgs {
  company: string
  title: string
  url: string
  status: 'discovered' | 'applied' | 'failed' | 'login_required' | 'favorite'
  time?: string
}

/**
 * upsertJob 工具：结构化更新职位数据，并同步导出 jobs.md 视图。
 */
export async function upsertJob(
  args: UpsertJobArgs,
  context: ToolContext
): Promise<{ success: boolean; action: 'added' | 'updated' | 'skipped'; message: string }> {
  const { workspaceRoot, agentName } = context

  try {
    const jobs = new JobsService(workspaceRoot, agentName)
    const result = await jobs.upsert(args, {
      lockHolder: agentName,
      mutation: {
        source: 'agent',
        actor: agentName,
      },
    })

    if (result.action !== 'skipped' && result.record) {
      eventBus.emit('job:updated', {
        company: result.record.company,
        title: result.record.title,
        status: result.record.status,
      })
    }

    return { success: true, action: result.action, message: `Job ${result.action}` }
  } catch (error: any) {
    return { success: false, action: 'skipped', message: error.message }
  }
}
