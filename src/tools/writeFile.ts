// write_file 工具实现
import * as fs from 'node:fs'
import type { ToolContext, ToolResult } from './index'
import { normalizeAndValidatePath, checkPathPermission } from './utils'

/**
 * 写入文件工具实现
 */
export async function executeWriteFile(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const { path: inputPath, old_string: oldString, new_string: newString } = args as {
    path: unknown
    old_string: unknown
    new_string: unknown
  }

  if (typeof inputPath !== 'string') {
    return { success: false, content: '', error: 'path 参数必须是字符串' }
  }
  if (typeof oldString !== 'string') {
    return { success: false, content: '', error: 'old_string 参数必须是字符串' }
  }
  if (typeof newString !== 'string') {
    return { success: false, content: '', error: 'new_string 参数必须是字符串' }
  }
  if (oldString === '') {
    return { success: false, content: '', error: 'old_string 不能为空字符串' }
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
    const content = fs.readFileSync(normalizedPath, 'utf-8')

    // 统计 old_string 出现次数
    let count = 0
    let lastIndex = -1
    while ((lastIndex = content.indexOf(oldString, lastIndex + 1)) !== -1) {
      count++
    }

    if (count === 0) {
      return { success: false, content: '', error: '未找到匹配文本' }
    }
    if (count > 1) {
      return { success: false, content: '', error: '找到多个匹配，请提供更具体的上下文' }
    }

    // 执行替换
    const newContent = content.replace(oldString, newString)
    fs.writeFileSync(normalizedPath, newContent, 'utf-8')

    return { success: true, content: newString }
  } catch (err) {
    return { success: false, content: '', error: `写入文件失败：${(err as Error).message}` }
  }
}
