import { spawn } from 'node:child_process'
import * as os from 'node:os'
import type { ToolContext, ToolResult } from './index.js'

/** 默认命令执行超时（30秒） */
const DEFAULT_SHELL_TIMEOUT = 30000

interface ShellExecutionError extends Error {
  stdout?: string
  stderr?: string
  killed?: boolean
}

/**
 * 检测当前操作系统
 */
export function detectOS(): 'windows' | 'linux' | 'macos' | 'unknown' {
  const platform = os.platform()
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return 'linux'
  if (platform === 'darwin') return 'macos'
  return 'unknown'
}

/**
 * 检测当前系统环境下的默认 Shell
 */
export function detectShell(): 'bash' | 'pwsh' | 'cmd' | 'unknown' {
  const normalizedShell = resolveShellProgram().toLowerCase()
  if (normalizedShell.includes('pwsh') || normalizedShell.includes('powershell')) return 'pwsh'
  if (normalizedShell.includes('cmd')) return 'cmd'
  if (normalizedShell.includes('bash')) return 'bash'
  return 'unknown'
}

/**
 * run_shell_command 工具实现
 * 执行系统 shell 命令，支持自定义超时
 */
function resolveShellProgram(): string {
  if (os.platform() === 'win32') {
    return process.env['ComSpec'] || process.env['COMSPEC'] || 'cmd.exe'
  }
  return '/bin/bash'
}

function resolveShellInvocation(command: string): { file: string; args: string[] } {
  const file = resolveShellProgram()
  if (os.platform() === 'win32') {
    return {
      file,
      args: ['/d', '/s', '/c', command],
    }
  }
  return {
    file,
    args: ['-lc', command],
  }
}

function terminateChildProcess(pid: number | undefined): void {
  if (!pid) return

  if (os.platform() === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => {})
    return
  }

  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // ignore
    }
  }
}

function executeShellProcess(
  command: string,
  options: {
    cwd: string
    timeout: number
    signal?: AbortSignal
  }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let aborted = Boolean(options.signal?.aborted)
    let timedOut = false

    if (aborted) {
      const abortError = new Error('工具调用已取消') as ShellExecutionError
      abortError.name = 'AbortError'
      reject(abortError)
      return
    }

    const { file, args } = resolveShellInvocation(command)
    const child = spawn(file, args, {
      cwd: options.cwd,
      detached: os.platform() !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      signal: options.signal,
    })

    let stdout = ''
    let stderr = ''

    child.stdout?.on('data', (chunk: string | Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: string | Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error: Error) => {
      cleanup()
      const shellError = error as ShellExecutionError
      shellError.stdout = stdout
      shellError.stderr = stderr
      reject(shellError)
    })

    child.on('close', (code: number | null) => {
      cleanup()
      if (aborted) {
        const abortError = new Error('工具调用已取消') as ShellExecutionError
        abortError.name = 'AbortError'
        abortError.stdout = stdout
        abortError.stderr = stderr
        reject(abortError)
        return
      }

      if (timedOut) {
        const timeoutError = new Error('命令执行超时') as ShellExecutionError
        timeoutError.killed = true
        timeoutError.stdout = stdout
        timeoutError.stderr = stderr
        reject(timeoutError)
        return
      }

      if (code !== 0) {
        const shellError = new Error(`Shell exited with code ${code ?? 'unknown'}`) as ShellExecutionError
        shellError.stdout = stdout
        shellError.stderr = stderr
        reject(shellError)
        return
      }

      resolve({ stdout, stderr })
    })

    const timeoutId = setTimeout(() => {
      timedOut = true
      terminateChildProcess(child.pid)
    }, options.timeout)

    const onAbort = () => {
      aborted = true
      terminateChildProcess(child.pid)
    }

    const cleanup = () => {
      clearTimeout(timeoutId)
      options.signal?.removeEventListener('abort', onAbort)
    }

    options.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export async function executeShellCommand(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { command, timeout } = args as { command: unknown; timeout?: unknown }

  if (typeof command !== 'string') {
    return { success: false, content: '', error: 'command 参数必须是字符串' }
  }

  // 校验并设置超时时间
  const shellTimeout = typeof timeout === 'number' ? timeout : DEFAULT_SHELL_TIMEOUT

  try {
    const { stdout, stderr } = await executeShellProcess(command, {
      cwd: context.workspaceRoot,
      timeout: shellTimeout,
      signal: context.signal,
    })
    const output = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')
    return {
      success: true,
      content: output || '(无输出)',
    }
  } catch (err) {
    const error = err as ShellExecutionError

    if (error.name === 'AbortError') {
      return {
        success: false,
        content: '',
        error: '工具调用已取消',
      }
    }

    if (error.killed) {
      return {
        success: false,
        content: '',
        error: `命令执行超时（限制: ${shellTimeout}ms）。如果是在安装大容量依赖，请尝试增加 timeout 参数。`,
      }
    }

    const detail = (error.stdout || '') + (error.stderr || '') + (error.message || '')
    return {
      success: false,
      content: '',
      error: `命令执行失败: ${detail}`,
    }
  }
}
