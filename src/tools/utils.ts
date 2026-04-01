// 工具层共享工具函数
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { ToolContext } from './types.js'

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
export interface PermissionResult {
  allowed: boolean
  reason: string
}

export interface PathPermissionOptions {
  requireSharedWriteLock?: boolean
}

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

  // 解析符号链接并验证目标仍在工作区内（Issue 3: symlink escape prevention）
  let realPath: string
  try {
    realPath = fs.realpathSync(absolutePath)
  } catch (err: any) {
    // ENOENT = file does not exist yet; allow the path and let the operation decide
    if (err.code === 'ENOENT') {
      return absolutePath // treat missing files as valid (operation will fail with its own error)
    }
    return null // ELOOP (symlink loop) or other errors = path unsafe
  }
  const normalizedRealPath = realPath.endsWith(path.sep) ? realPath : realPath + path.sep
  const normalizedAbsoluteWorkspace = absoluteWorkspace.endsWith(path.sep) ? absoluteWorkspace : absoluteWorkspace + path.sep
  if (!normalizedRealPath.startsWith(normalizedAbsoluteWorkspace) && realPath !== absoluteWorkspace) {
    return null
  }

  return realPath
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
  workspaceRoot: string,
  context?: Pick<ToolContext, 'profile' | 'capabilityPolicy'>,
  options: PathPermissionOptions = {}
): PermissionResult {
  const { requireSharedWriteLock = true } = options
  const absoluteWorkspace = path.resolve(workspaceRoot)
  const relativePath = path.relative(absoluteWorkspace, normalizedPath).replace(/\\/g, '/')

  // Issue 5: Block non-main profiles from writing to protected system paths
  if (operation === 'write' && context?.profile && context.profile.name !== 'main') {
    // Block control-plane state subdirectories
    const CONTROL_PLANE_STATE_SUBDIRS = [
      'state/session', 'state/conversation', 'state/delegation',
      'state/interventions', 'state/jobs', 'state/applications',
      'state/learning', 'state/strategy', 'state/user',
    ]
    for (const cp of CONTROL_PLANE_STATE_SUBDIRS) {
      if (relativePath === cp || relativePath.startsWith(cp + '/')) {
        return { allowed: false, reason: `控制平面路径禁止写入：${relativePath}` }
      }
    }

    // Block root state/, logs/, and .locks/ directories (unless explicitly allowed via writableRoots)
    const PROTECTED_ROOTS = ['state', 'logs', '.locks']
    for (const protectedRoot of PROTECTED_ROOTS) {
      if (relativePath === protectedRoot || relativePath.startsWith(protectedRoot + '/')) {
        // Only allow if explicitly listed in profile's writableRoots
        const writableRoots = context.profile.writableRoots || []
        const isExplicitlyAllowed = writableRoots.some(root => {
          const normalizedRoot = root.replace(/\\/g, '/').replace(/\/$/, '')
          return relativePath === normalizedRoot || relativePath.startsWith(normalizedRoot + '/')
        })
        if (!isExplicitlyAllowed) {
          return { allowed: false, reason: `系统路径禁止写入：${protectedRoot}/` }
        }
      }
    }
  }

  if (context?.profile && context.capabilityPolicy) {
    const capabilityDecision =
      operation === 'read'
        ? context.capabilityPolicy.canReadPath(context.profile, relativePath)
        : context.capabilityPolicy.canWritePath(context.profile, relativePath)

    if (!capabilityDecision.allowed) {
      return { allowed: false, reason: capabilityDecision.reason ?? `Profile 不允许${operation} ${relativePath}` }
    }
  }

  if (relativePath.startsWith('.locks/') || relativePath === '.locks') {
    return { allowed: false, reason: '系统路径禁止直接访问' }
  }

  const agentsMatch = relativePath.match(/^agents\/([^/]+)(\/|$)/)
  if (agentsMatch) {
    const ownerAgent = agentsMatch[1]
    if (ownerAgent !== agentName) {
      return { allowed: false, reason: `私有路径禁止访问：agents/${ownerAgent}/` }
    }
    return { allowed: true, reason: '' }
  }

  const dataMatch = relativePath === 'data' || relativePath.startsWith('data/')
  if (dataMatch) {
    if (operation === 'write' && requireSharedWriteLock && !hasValidLock(relativePath, agentName, workspaceRoot)) {
      return { allowed: false, reason: '共享路径写入需要文件锁' }
    }
    return { allowed: true, reason: '' }
  }

  return { allowed: true, reason: '' }
}
