import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as os from 'node:os'
import type { ToolContext, ToolResult } from './index'

const execAsync = promisify(exec)

/**
 * 检测当前系统环境下的默认 Shell
 */
export function detectShell(): 'bash' | 'pwsh' | 'cmd' | 'unknown' {
  const platform = os.platform()
  if (platform === 'win32') {
    // 检查是否在 Windows 下使用 pwsh
    try {
      return 'pwsh'
    } catch {
      return 'cmd'
    }
  }
  return 'bash'
}

/**
 * run_shell_command 工具实现
 * 执行系统 shell 命令
 */
export async function executeShellCommand(
  args: Record<string, unknown>,
  _context: ToolContext
): Promise<ToolResult> {
  const { command } = args as { command: unknown }

  if (typeof command !== 'string') {
    return { success: false, content: '', error: 'command 参数必须是字符串' }
  }

  try {
    const { stdout, stderr } = await execAsync(command, { timeout: 30000 })
    const output = stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')
    return {
      success: true,
      content: output || '(无输出)',
    }
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string }
    const detail = (error.stdout || '') + (error.stderr || '') + (error.message || '')
    return {
      success: false,
      content: '',
      error: `命令执行失败: ${detail}`,
    }
  }
}
