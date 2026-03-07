// lock_file / unlock_file 工具实现
import * as fs from 'node:fs'
import type { ToolContext, ToolResult } from './index'
import { normalizeAndValidatePath, getLocksDir, ensureLocksDirExists, getLockFilePath, LOCK_TIMEOUT_MS, type LockFileContent } from './utils'

/**
 * 锁定文件工具实现
 */
export async function executeLockFile(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const { path: inputPath, holder } = args as { path: unknown; holder: unknown }

  if (typeof inputPath !== 'string') {
    return { success: false, content: '', error: 'path 参数必须是字符串' }
  }
  if (typeof holder !== 'string') {
    return { success: false, content: '', error: 'holder 参数必须是字符串' }
  }

  const normalizedPath = normalizeAndValidatePath(inputPath, context.workspaceRoot)
  if (!normalizedPath) {
    return { success: false, content: '', error: '路径不安全，拒绝访问' }
  }

  try {
    const locksDir = getLocksDir(context.workspaceRoot)
    ensureLocksDirExists(locksDir)

    const lockFilePath = getLockFilePath(inputPath, context.workspaceRoot)
    const now = Date.now()

    // 检查锁是否存在
    if (fs.existsSync(lockFilePath)) {
      const content = fs.readFileSync(lockFilePath, 'utf-8')
      let lock: LockFileContent
      try {
        lock = JSON.parse(content)
      } catch {
        // 无效的锁文件，覆盖
        lock = { holder: '', timestamp: 0 }
      }

      // 检查是否是同一 holder（重入）
      if (lock.holder === holder) {
        // 更新时间戳
        const newLock: LockFileContent = { holder, timestamp: now }
        fs.writeFileSync(lockFilePath, JSON.stringify(newLock), 'utf-8')
        return { success: true, content: '锁已续期' }
      }

      // 检查是否超时
      if (now - lock.timestamp < LOCK_TIMEOUT_MS) {
        const remaining = Math.ceil((LOCK_TIMEOUT_MS - (now - lock.timestamp)) / 1000)
        return { success: false, content: '', error: `文件已被 ${lock.holder} 锁定，剩余 ${remaining} 秒` }
      }

      // 超时，覆盖旧锁
    }

    // 创建新锁
    const newLock: LockFileContent = { holder, timestamp: now }
    fs.writeFileSync(lockFilePath, JSON.stringify(newLock), 'utf-8')

    return { success: true, content: '获取锁成功' }
  } catch (err) {
    return { success: false, content: '', error: `获取锁失败：${(err as Error).message}` }
  }
}

/**
 * 解锁文件工具实现
 */
export async function executeUnlockFile(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
  const { path: inputPath, holder } = args as { path: unknown; holder: unknown }

  if (typeof inputPath !== 'string') {
    return { success: false, content: '', error: 'path 参数必须是字符串' }
  }
  if (typeof holder !== 'string') {
    return { success: false, content: '', error: 'holder 参数必须是字符串' }
  }

  const normalizedPath = normalizeAndValidatePath(inputPath, context.workspaceRoot)
  if (!normalizedPath) {
    return { success: false, content: '', error: '路径不安全，拒绝访问' }
  }

  try {
    const lockFilePath = getLockFilePath(inputPath, context.workspaceRoot)

    // 锁文件不存在，认为已解锁（幂等）
    if (!fs.existsSync(lockFilePath)) {
      return { success: true, content: '文件未锁定' }
    }

    const content = fs.readFileSync(lockFilePath, 'utf-8')
    let lock: LockFileContent
    try {
      lock = JSON.parse(content)
    } catch {
      // 无效的锁文件，直接删除
      fs.unlinkSync(lockFilePath)
      return { success: true, content: '清理了无效的锁文件' }
    }

    // 验证 holder
    if (lock.holder !== holder) {
      return { success: false, content: '', error: `锁由 ${lock.holder} 持有，无法释放` }
    }

    // 删除锁文件
    fs.unlinkSync(lockFilePath)

    return { success: true, content: '释放锁成功' }
  } catch (err) {
    return { success: false, content: '', error: `释放锁失败：${(err as Error).message}` }
  }
}
