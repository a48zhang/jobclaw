import { upsertJob, type UpsertJobArgs } from './upsertJob.js';
import type { ToolContext, ToolResult } from './index.js';

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

    // 传递 context
    const result = await upsertJob(upsertArgs, context);
    
    if (result.success) {
      return {
        success: true,
        content: JSON.stringify(
          {
            action: result.action,
            message: result.message,
            company: upsertArgs.company,
            title: upsertArgs.title,
            url: upsertArgs.url,
            status: upsertArgs.status,
          },
          null,
          2
        ),
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
