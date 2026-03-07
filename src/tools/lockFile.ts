// lock_file / unlock_file 工具实现
import * as fs from 'node:fs'
import type { ToolContext, ToolResult } from './index'
import { normalizeAndValidatePath, getLocksDir, ensureLocksDirExists, getLockFilePath, LOCK_TIMEOUT_MS, type LockFileContent } from './utils'

/**
 * 底层加锁函数 (Core)
 */
export async function lockFile(inputPath: string, holder: string, workspaceRoot: string): Promise<void> {
  const locksDir = getLocksDir(workspaceRoot)
  ensureLocksDirExists(locksDir)

  const lockFilePath = getLockFilePath(inputPath, workspaceRoot)
  const now = Date.now()

  if (fs.existsSync(lockFilePath)) {
    const content = fs.readFileSync(lockFilePath, 'utf-8')
    let lock: LockFileContent
    try {
      lock = JSON.parse(content)
    } catch {
      lock = { holder: '', timestamp: 0 }
    }

    // 重入检查
    if (lock.holder === holder) {
      const newLock: LockFileContent = { holder, timestamp: now }
      fs.writeFileSync(lockFilePath, JSON.stringify(newLock), 'utf-8')
      return
    }

    // 超时检查
    if (now - lock.timestamp < LOCK_TIMEOUT_MS) {
      const remaining = Math.ceil((LOCK_TIMEOUT_MS - (now - lock.timestamp)) / 1000)
      throw new Error(`文件已被 ${lock.holder} 锁定，剩余 ${remaining} 秒`)
    }
  }

  const newLock: LockFileContent = { holder, timestamp: now }
  fs.writeFileSync(lockFilePath, JSON.stringify(newLock), 'utf-8')
}

/**
 * 底层解锁函数 (Core)
 */
export async function unlockFile(inputPath: string, holder: string, workspaceRoot: string): Promise<void> {
  const lockFilePath = getLockFilePath(inputPath, workspaceRoot)

  if (!fs.existsSync(lockFilePath)) return

  const content = fs.readFileSync(lockFilePath, 'utf-8')
  let lock: LockFileContent
  try {
    lock = JSON.parse(content)
  } catch {
    fs.unlinkSync(lockFilePath)
    return
  }

  if (lock.holder !== holder) {
    throw new Error(`锁由 ${lock.holder} 持有，无法释放`)
  }

  fs.unlinkSync(lockFilePath)
}

/**
 * 锁定文件工具包装器 (Tool Wrapper)
 */
export async function executeLockFile(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const { path: inputPath, holder } = args as { path: unknown; holder: unknown }

  if (typeof inputPath !== 'string' || typeof holder !== 'string') {
    return { success: false, content: '', error: '参数必须是字符串' }
  }

  const normalizedPath = normalizeAndValidatePath(inputPath, context.workspaceRoot)
  if (!normalizedPath) {
    return { success: false, content: '', error: '路径不安全' }
  }

  try {
    await lockFile(inputPath, holder, context.workspaceRoot)
    return { success: true, content: '获取锁成功' }
  } catch (err: any) {
    return { success: false, content: '', error: err.message }
  }
}

/**
 * 解锁文件工具包装器 (Tool Wrapper)
 */
export async function executeUnlockFile(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const { path: inputPath, holder } = args as { path: unknown; holder: unknown }

  if (typeof inputPath !== 'string' || typeof holder !== 'string') {
    return { success: false, content: '', error: '参数必须是字符串' }
  }

  const normalizedPath = normalizeAndValidatePath(inputPath, context.workspaceRoot)
  if (!normalizedPath) {
    return { success: false, content: '', error: '路径不安全' }
  }

  try {
    await unlockFile(inputPath, holder, context.workspaceRoot)
    return { success: true, content: '释放锁成功' }
  } catch (err: any) {
    return { success: false, content: '', error: err.message }
  }
}
