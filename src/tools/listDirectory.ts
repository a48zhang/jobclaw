// list_directory 工具实现
import * as fs from 'node:fs'
import type { ToolContext, ToolResult } from './index.js'
import { normalizeAndValidatePath, checkPathPermission } from './utils.js'

/**
 * 列出目录工具实现
 */
export async function executeListDirectory(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const { path: inputPath } = args as { path: unknown }

  if (typeof inputPath !== 'string') {
    return { success: false, content: '', error: 'path 参数必须是字符串' }
  }

  const normalizedPath = normalizeAndValidatePath(inputPath, context.workspaceRoot)
  if (!normalizedPath) {
    return { success: false, content: '', error: '路径不安全，拒绝访问' }
  }

  // 权限检查
  const permission = checkPathPermission(normalizedPath, context.agentName, 'read', context.workspaceRoot, context)
  if (!permission.allowed) {
    return { success: false, content: '', error: permission.reason }
  }

  // 检查目录存在性
  if (!fs.existsSync(normalizedPath)) {
    return { success: false, content: '', error: `目录不存在：${inputPath}` }
  }

  // 检查是否是目录
  const stat = fs.statSync(normalizedPath)
  if (!stat.isDirectory()) {
    return { success: false, content: '', error: `路径不是目录：${inputPath}` }
  }

  try {
    const entries = fs.readdirSync(normalizedPath, { withFileTypes: true })
    const result: string[] = []

    for (const entry of entries) {
      if (entry.isDirectory()) {
        result.push(`[DIR] ${entry.name}/`)
      } else {
        result.push(`[FILE] ${entry.name}`)
      }
    }

    return { success: true, content: result.join('\n') }
  } catch (err) {
    return { success: false, content: '', error: `列出目录失败：${(err as Error).message}` }
  }
}
