// read_file 工具实现
import * as fs from 'node:fs'
import { encode } from 'gpt-tokenizer'
import type { ToolContext, ToolResult } from './index.js'
import { normalizeAndValidatePath, checkPathPermission, MAX_TOKENS } from './utils.js'

/**
 * 读取文件工具实现
 */
export async function executeReadFile(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const { path: inputPath, offset = 0 } = args as { path: unknown; offset?: unknown }

  if (typeof inputPath !== 'string') {
    return { success: false, content: '', error: 'path 参数必须是字符串' }
  }
  if (typeof offset !== 'number' && offset !== undefined) {
    return { success: false, content: '', error: 'offset 参数必须是数字' }
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

  // 检查文件存在性
  if (!fs.existsSync(normalizedPath)) {
    return { success: false, content: '', error: `文件不存在：${inputPath}` }
  }

  // 检查是否是文件
  const stat = fs.statSync(normalizedPath)
  if (!stat.isFile()) {
    return { success: false, content: '', error: `路径不是文件：${inputPath}` }
  }

  try {
    const fullContent = fs.readFileSync(normalizedPath, 'utf-8')

    // 应用 offset（字符偏移）
    const startOffset = Math.max(0, offset as number)
    const content = fullContent.slice(startOffset)

    // 检查 token 数量
    const tokens = encode(content)
    if (tokens.length > MAX_TOKENS) {
      const contentLength = content.length
      return {
        success: false,
        content: '',
        error: `文件内容过大（约 ${tokens.length} tokens，${contentLength} 字符）。请使用字符偏移 offset 分页读取，当前 offset=${startOffset}。`,
      }
    }

    return { success: true, content }
  } catch (err) {
    return { success: false, content: '', error: `读取文件失败：${(err as Error).message}` }
  }
}
