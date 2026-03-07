// 工具层共享工具函数
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 最大 token 数（用于文件截断检测）
 */
export const MAX_TOKENS = 10000

/**
 * 锁超时时间（毫秒）
 */
export const LOCK_TIMEOUT_MS = 30000

/**
 * 锁文件内容
 */
export interface LockFileContent {
  /** 锁持有者 */
  holder: string
  /** 获取锁的时间戳（毫秒） */
  timestamp: number
}

/**
 * 权限检查结果
 */
export type PermissionResult =
  | { allowed: true }
  | { allowed: false; reason: string }

/**
 * 规范化并验证路径安全性
 * @param inputPath 输入路径
 * @param workspaceRoot 工作区根目录
 * @returns 规范化后的绝对路径，若路径不安全则返回 null
 */
export function normalizeAndValidatePath(inputPath: string, workspaceRoot: string): string | null {
  // 规范化路径分隔符
  let normalized = inputPath.replace(/\\/g, '/')

  // 检查路径穿越
  if (normalized.includes('../') || normalized.includes('..\\')) {
    return null
  }

  // 构建绝对路径
  const absolutePath = path.resolve(workspaceRoot, normalized)
  const absoluteWorkspace = path.resolve(workspaceRoot)

  // 确保路径在工作区内
  if (!absolutePath.startsWith(absoluteWorkspace + path.sep) && absolutePath !== absoluteWorkspace) {
    return null
  }

  return absolutePath
}

/**
 * 获取锁目录路径
 * @param workspaceRoot 工作区根目录
 * @returns 锁目录的绝对路径
 */
export function getLocksDir(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, '.locks')
}

/**
 * 确保锁目录存在
 * @param locksDir 锁目录路径
 */
export function ensureLocksDirExists(locksDir: string): void {
  if (!fs.existsSync(locksDir)) {
    fs.mkdirSync(locksDir, { recursive: true })
  }
}

/**
 * 计算锁文件路径
 * 使用完整路径（将 / 替换为 __）而非 basename，避免同名文件锁冲突
 * @param targetPath 目标文件路径（相对于 workspace）
 * @param workspaceRoot 工作区根目录
 * @returns 锁文件的绝对路径
 */
export function getLockFilePath(targetPath: string, workspaceRoot: string): string {
  const locksDir = getLocksDir(workspaceRoot)
  // 规范化路径，将路径分隔符替换为 __，保留完整路径信息
  const normalized = targetPath.replace(/\\/g, '/').replace(/\//g, '__')
  return path.resolve(locksDir, `${normalized}.lock`)
}

/**
 * 检查路径是否持有有效锁
 * @param targetPath 目标文件路径（相对于 workspace）
 * @param agentName Agent 名称
 * @param workspaceRoot 工作区根目录
 * @returns 是否持有有效锁
 */
export function hasValidLock(targetPath: string, agentName: string, workspaceRoot: string): boolean {
  const lockFilePath = getLockFilePath(targetPath, workspaceRoot)

  if (!fs.existsSync(lockFilePath)) {
    return false
  }

  try {
    const content = fs.readFileSync(lockFilePath, 'utf-8')
    const lock: LockFileContent = JSON.parse(content)
    const now = Date.now()

    return lock.holder === agentName && (now - lock.timestamp) < LOCK_TIMEOUT_MS
  } catch {
    return false
  }
}

/**
 * 权限检查函数
 * @param normalizedPath 规范化后的绝对路径
 * @param agentName Agent 名称
 * @param operation 操作类型
 * @param workspaceRoot 工作区根目录
 * @returns 权限检查结果
 */
export function checkPathPermission(
  normalizedPath: string,
  agentName: string,
  operation: 'read' | 'write',
  workspaceRoot: string
): PermissionResult {
  const absoluteWorkspace = path.resolve(workspaceRoot)
  const relativePath = path.relative(absoluteWorkspace, normalizedPath).replace(/\\/g, '/')

  // 检查系统路径 .locks/
  if (relativePath.startsWith('.locks/') || relativePath === '.locks') {
    return { allowed: false, reason: '系统路径禁止直接访问' }
  }

  // 检查私有路径 agents/{name}/
  const agentsMatch = relativePath.match(/^agents\/([^/]+)(\/|$)/)
  if (agentsMatch) {
    const ownerAgent = agentsMatch[1]
    if (ownerAgent !== agentName) {
      return { allowed: false, reason: `私有路径禁止访问：agents/${ownerAgent}/` }
    }
    // 私有路径的读写都允许
    return { allowed: true }
  }

  // 检查共享路径 data/
  if (relativePath.startsWith('data/') || relativePath === 'data') {
    if (operation === 'write') {
      // 写入操作需要持有锁
      if (!hasValidLock(relativePath, agentName, workspaceRoot)) {
        return { allowed: false, reason: '共享路径写入需要文件锁' }
      }
    }
    return { allowed: true }
  }

  // 其他路径允许访问
  return { allowed: true }
}
