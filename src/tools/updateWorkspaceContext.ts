import { WorkspaceContextService } from '../runtime/workspace-context-service.js'
import type { ToolContext, ToolResult } from './types.js'

export async function executeUpdateWorkspaceContext(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  try {
    const service = new WorkspaceContextService({
      workspaceRoot: context.workspaceRoot,
      agentName: context.agentName,
      profile: context.profile,
      capabilityPolicy: context.capabilityPolicy,
    })

    const result = await service.update({
      targets: args.targets as Array<Record<string, unknown>> | undefined,
      userinfo:
        args.userinfo && typeof args.userinfo === 'object' && !Array.isArray(args.userinfo)
          ? args.userinfo as Record<string, unknown>
          : args.userinfo as undefined,
      source: typeof args.source === 'string' ? args.source : undefined,
    })
    const requiresReview = result.userinfo.skippedConflicts > 0
    const payload = {
      ...result,
      requiresReview,
    }

    return {
      success: true,
      content: JSON.stringify(payload),
      summary: result.summary,
      data: {
        changed: result.changed,
        updatedFiles: result.updatedFiles,
        source: result.source,
        summary: result.summary,
        requiresReview,
        targets: result.targets as unknown as Record<string, unknown>,
        userinfo: result.userinfo as unknown as Record<string, unknown>,
      },
    }
  } catch (error) {
    return {
      success: false,
      content: '',
      error: (error as Error).message,
    }
  }
}
