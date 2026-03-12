import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as os from 'node:os'
import type { ToolContext, ToolResult } from './index.js'

const execAsync = promisify(exec)

/** 默认命令执行超时（30秒） */
const DEFAULT_SHELL_TIMEOUT = 30000

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
  const platform = os.platform()
  if (platform === 'win32') {
    return 'pwsh' 
  }
  return 'bash'
}

/**
 * run_shell_command 工具实现
 * 执行系统 shell 命令，支持自定义超时
 */
export async function executeShellCommand(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const { command, timeout } = args as { command: unknown; timeout?: unknown }

  if (typeof command !== 'string') {
    return { success: false, content: '', error: 'command 参数必须是字符串' }
  }

  // 校验并设置超时时间
  const shellTimeout = typeof timeout === 'number' ? timeout : DEFAULT_SHELL_TIMEOUT

  try {
    const { stdout, stderr } = await execAsync(command, { timeout: shellTimeout })
    const output = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')
    return {
      success: true,
      content: output || '(无输出)',
    }
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string; killed?: boolean }
    
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
