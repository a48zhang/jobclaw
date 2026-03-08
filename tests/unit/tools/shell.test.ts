import { describe, test, expect, mock } from 'bun:test'
import { executeShellCommand, detectShell, detectOS } from '../../../src/tools/shell'
import type { ToolContext } from '../../../src/tools/index'

describe('Shell Tool', () => {
  const mockContext: ToolContext = {
    workspaceRoot: '/mock',
    agentName: 'test-agent',
    logger: mock(() => {}),
  }

  test('detectOS should return a valid OS name', () => {
    const osName = detectOS()
    expect(['windows', 'linux', 'macos', 'unknown']).toContain(osName)
  })

  test('detectShell should return a valid shell name', () => {
    const shell = detectShell()
    expect(['bash', 'pwsh', 'cmd', 'unknown']).toContain(shell)
  })

  test('executeShellCommand should run a simple command', async () => {
    const result = await executeShellCommand({ command: 'echo hello' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.content).toContain('hello')
  })

  test('executeShellCommand should handle errors', async () => {
    // 运行一个不存在的命令
    const result = await executeShellCommand({ command: 'non_existent_command_12345' }, mockContext)
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  test('executeShellCommand should return output from stderr', async () => {
    // 在 bash 中，可以使用 >&2 产生 stderr 输出
    const result = await executeShellCommand({ command: 'echo error_msg >&2' }, mockContext)
    expect(result.success).toBe(true)
    expect(result.content).toContain('[STDERR]')
    expect(result.content).toContain('error_msg')
  })
})
