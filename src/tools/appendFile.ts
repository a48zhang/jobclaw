// append_file 工具实现
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ToolContext, ToolResult } from './index'
import { normalizeAndValidatePath, checkPathPermission } from './utils'

/**
 * 追加文件工具实现
 */
export async function executeAppendFile(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const { path: inputPath, content: appendContent } = args as { path: unknown; content: unknown }

  if (typeof inputPath !== 'string') {
    return { success: false, content: '', error: 'path 参数必须是字符串' }
  }
  if (typeof appendContent !== 'string') {
    return { success: false, content: '', error: 'content 参数必须是字符串' }
  }

  const normalizedPath = normalizeAndValidatePath(inputPath, context.workspaceRoot)
  if (!normalizedPath) {
    return { success: false, content: '', error: '路径不安全，拒绝访问' }
  }

  // 权限检查
  const permission = checkPathPermission(normalizedPath, context.agentName, 'write', context.workspaceRoot)
  if (!permission.allowed) {
    return { success: false, content: '', error: permission.reason }
  }

  try {
    // 确保目录存在
    const dir = path.dirname(normalizedPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    // 追加内容
    fs.appendFileSync(normalizedPath, appendContent, 'utf-8')

    return { success: true, content: '追加完成' }
  } catch (err) {
    return { success: false, content: '', error: `追加文件失败：${(err as Error).message}` }
  }
}
