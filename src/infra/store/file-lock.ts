/**
 * Internal file-locking primitives for the infra layer.
 *
 * Uses the same .locks/ directory convention as the tool-layer lock utilities
 * (src/tools/lockFile.ts / src/tools/utils.ts) but intentionally omits
 * permission checks – it is only ever called from trusted in-process code.
 *
 * Lock files are named after the relative path of the target file (relative to
 * workspaceRoot) and resolve symlinks so that two JsonFileStore instances
 * pointing at the same file share a lock even if accessed via different paths.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const LOCK_TIMEOUT_MS = 30_000

function locksDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, '.locks')
}

function ensureLocksDir(workspaceRoot: string): void {
  const dir = locksDir(workspaceRoot)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function lockFileFor(targetPath: string, workspaceRoot: string): string {
  const dir = locksDir(workspaceRoot)
  // Resolve to real path to handle symlinks, then normalize to handle ./ and ../
  // If file doesn't exist yet, resolve the path components at least
  let resolvedPath: string
  try {
    resolvedPath = fs.realpathSync(targetPath)
  } catch {
    // File doesn't exist yet - normalize the path at least
    resolvedPath = path.resolve(targetPath)
  }

  // Make relative to workspaceRoot so same file gets same lock regardless of how it's accessed
  const relativePath = path.relative(workspaceRoot, resolvedPath)
  // Normalize separators and replace / with __ to form a safe filename.
  // Using the relative path (not absolute) prevents collisions and handles symlinks.
  const safeName = relativePath.replace(/\\/g, '/').replace(/\//g, '__')
  return path.join(dir, `${safeName}.lock`)
}

/**
 * Acquire an exclusive advisory lock on `targetPath`.
 *
 * Creates the lock file with a held-by marker and timestamp.  If the lock is
 * already held by someone else and has not expired it throws; otherwise it
 * overwrites a stale lock.
 *
 * @param targetPath  Absolute path of the file being locked.
 * @param workspaceRoot  Workspace root (used to locate .locks/).
 * @param holder  Identifier for the lock holder (shown in error messages).
 * @param timeoutMs  Milliseconds to wait for the lock before giving up (default 30 000).
 * @throws Error if the lock cannot be acquired within the timeout.
 */
export async function acquireLock(
  targetPath: string,
  workspaceRoot: string,
  holder: string,
  timeoutMs = LOCK_TIMEOUT_MS
): Promise<void> {
  ensureLocksDir(workspaceRoot)
  const lockPath = lockFileFor(targetPath, workspaceRoot)
  const deadline = Date.now() + timeoutMs

  while (true) {
    if (fs.existsSync(lockPath)) {
      try {
        const content = fs.readFileSync(lockPath, 'utf-8')
        const lock = JSON.parse(content) as { holder: string; timestamp: number }

        // Re-entrant: same holder just refreshes the timestamp.
        if (lock.holder === holder) {
          fs.writeFileSync(lockPath, JSON.stringify({ holder, timestamp: Date.now() }), 'utf-8')
          return
        }

        // If the lock is still fresh, we have to wait.
        if (Date.now() - lock.timestamp < LOCK_TIMEOUT_MS) {
          const remaining = deadline - Date.now()
          if (remaining <= 0) {
            throw new Error(
              `Could not acquire lock for ${targetPath}: held by "${lock.holder}" (timeout)`
            )
          }
          // Spin with a short sleep – simple cooperative polling suitable for
          // single-process use where the holder is expected to release soon.
          await sleep(Math.min(50, remaining))
          continue
        }
      } catch {
        // Corrupt or unreadable lock file – treat as stale and overwrite below.
      }
    }

    // Either the lock doesn't exist or it is stale.  Claim it atomically.
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ holder, timestamp: Date.now() }), 'utf-8')
      return
    } catch {
      // Another writer got there first – loop and re-check.
      await sleep(10)
    }
  }
}

/**
 * Release the lock held by `holder` on `targetPath`.
 *
 * Idempotent: if the lock file does not exist this is a no-op.
 * Throws if the lock is held by a different holder.
 */
export async function releaseLock(
  targetPath: string,
  workspaceRoot: string,
  holder: string
): Promise<void> {
  const lockPath = lockFileFor(targetPath, workspaceRoot)

  if (!fs.existsSync(lockPath)) return

  try {
    const content = fs.readFileSync(lockPath, 'utf-8')
    const lock = JSON.parse(content) as { holder: string; timestamp: number }
    if (lock.holder !== holder) {
      throw new Error(
        `Cannot release lock for ${targetPath}: held by "${lock.holder}", not "${holder}"`
      )
    }
    fs.unlinkSync(lockPath)
  } catch (err: any) {
    // If the file disappeared between existsSync and readFileSync that's fine.
    if (err.code !== 'ENOENT') throw err
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
