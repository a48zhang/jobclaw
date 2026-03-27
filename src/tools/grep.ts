// grep 工具实现 - 在文件中搜索正则表达式
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ToolContext, ToolResult } from './index.js'
import { normalizeAndValidatePath, checkPathPermission } from './utils.js'

interface GrepOptions {
  pattern: string
  path?: string
  include?: string
  case_sensitive?: boolean
  context?: number
  max_results?: number
}

interface GrepMatch {
  file: string
  line: number
  content: string
  contextBefore?: string[]
  contextAfter?: string[]
}

/**
 * 检查路径是否应该被忽略
 */
function shouldIgnore(name: string): boolean {
  const ignorePatterns = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '__pycache__',
    '.pytest_cache',
    'dist',
    'build',
    'out',
    '.next',
    '.nuxt',
    'coverage',
    '.vite',
    '.cache',
  ]
  return ignorePatterns.includes(name) || name.startsWith('.')
}

/**
 * 匹配 glob 模式
 */
function matchGlob(filename: string, pattern: string): boolean {
  // 简单的 glob 匹配实现
  // 支持 * 和 ? 通配符
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${regex}$`, 'i').test(filename)
}

/**
 * 递归搜索文件
 */
function findFiles(dir: string, includePattern: string | undefined, results: string[]): void {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue

      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        findFiles(fullPath, includePattern, results)
      } else if (entry.isFile()) {
        if (!includePattern || matchGlob(entry.name, includePattern)) {
          results.push(fullPath)
        }
      }
    }
  } catch {
    // 忽略无法访问的目录
  }
}

/**
 * 在单个文件中搜索
 */
function grepFile(
  filePath: string,
  pattern: RegExp,
  contextLines: number,
  maxResults: number,
  currentResults: GrepMatch[]
): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length && currentResults.length < maxResults; i++) {
      const line = lines[i]
      if (pattern.test(line)) {
        // 重置正则表达式的 lastIndex（对于全局标志）
        pattern.lastIndex = 0

        const match: GrepMatch = {
          file: filePath,
          line: i + 1,
          content: line,
        }

        if (contextLines > 0) {
          match.contextBefore = lines.slice(Math.max(0, i - contextLines), i)
          match.contextAfter = lines.slice(i + 1, i + 1 + contextLines)
        }

        currentResults.push(match)
      }
    }
  } catch {
    // 忽略无法读取的文件（如二进制文件）
  }
}

/**
 * grep 工具实现
 */
export async function executeGrep(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const options: GrepOptions = {
    pattern: args.pattern as string,
    path: args.path as string | undefined,
    include: args.include as string | undefined,
    case_sensitive: args.case_sensitive as boolean | undefined,
    context: args.context as number | undefined,
    max_results: args.max_results as number | undefined,
  }

  if (typeof options.pattern !== 'string' || !options.pattern.trim()) {
    return { success: false, content: '', error: 'pattern 参数必须是非空字符串' }
  }

  // 验证路径
  const searchPath = options.path
    ? normalizeAndValidatePath(options.path, context.workspaceRoot)
    : context.workspaceRoot

  if (!searchPath) {
    return { success: false, content: '', error: '路径不安全，拒绝访问' }
  }

  // 权限检查
  const permission = checkPathPermission(searchPath, context.agentName, 'read', context.workspaceRoot, context)
  if (!permission.allowed) {
    return { success: false, content: '', error: permission.reason }
  }

  // 检查路径存在性
  if (!fs.existsSync(searchPath)) {
    return { success: false, content: '', error: `路径不存在：${options.path || 'workspace'}` }
  }

  // 编译正则表达式
  let pattern: RegExp
  try {
    const flags = options.case_sensitive ? 'g' : 'gi'
    pattern = new RegExp(options.pattern, flags)
  } catch (err) {
    return { success: false, content: '', error: `无效的正则表达式：${(err as Error).message}` }
  }

  const maxResults = options.max_results ?? 100
  const contextLines = options.context ?? 0
  const matches: GrepMatch[] = []

  // 确定搜索目标
  let files: string[]
  if (fs.statSync(searchPath).isFile()) {
    files = [searchPath]
  } else {
    files = []
    findFiles(searchPath, options.include, files)
  }

  // 执行搜索
  for (const file of files) {
    if (matches.length >= maxResults) break
    grepFile(file, pattern, contextLines, maxResults, matches)
  }

  // 格式化输出
  if (matches.length === 0) {
    return { success: true, content: '未找到匹配结果' }
  }

  const output: string[] = []
  for (const match of matches) {
    // 相对路径
    const relativePath = path.relative(context.workspaceRoot, match.file)

    if (contextLines > 0 && match.contextBefore) {
      for (let i = 0; i < match.contextBefore.length; i++) {
        const lineNum = match.line - match.contextBefore.length + i
        output.push(`${relativePath}:${lineNum}-${match.contextBefore[i]}`)
      }
    }

    output.push(`${relativePath}:${match.line}:${match.content}`)

    if (contextLines > 0 && match.contextAfter) {
      for (let i = 0; i < match.contextAfter.length; i++) {
        const lineNum = match.line + i + 1
        output.push(`${relativePath}:${lineNum}-${match.contextAfter[i]}`)
      }
    }
  }

  const truncated = matches.length >= maxResults
  const summary = `找到 ${matches.length} 个匹配${truncated ? '（已截断）' : ''}`

  return {
    success: true,
    content: `${summary}\n\n${output.join('\n')}`,
  }
}
