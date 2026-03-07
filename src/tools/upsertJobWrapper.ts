import { upsertJob, type UpsertJobArgs } from './upsertJob';
import type { ToolContext, ToolResult } from './index';

/**
 * upsert_job 工具执行器包装函数
 */
export async function executeUpsertJob(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  try {
    const upsertArgs = args as unknown as UpsertJobArgs;
    
    // 校验必填参数
    if (!upsertArgs.company || !upsertArgs.title || !upsertArgs.url || !upsertArgs.status) {
      return {
        success: false,
        content: '',
        error: 'Missing required parameters: company, title, url, or status.'
      };
    }

    // 传递 context.workspaceRoot
    const result = await upsertJob(upsertArgs, context.workspaceRoot);
    
    if (result.success) {
      return {
        success: true,
        content: JSON.stringify({
          action: result.action,
          message: result.message
        }, null, 2)
      };
    } else {
      return {
        success: false,
        content: '',
        error: result.message
      };
    }
  } catch (error: any) {
    return {
      success: false,
      content: '',
      error: error.message
    };
  }
}
