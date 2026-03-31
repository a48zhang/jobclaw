import { afterAll, describe, test, expect, vi } from 'vitest'
import { executeShellCommand, detectShell, detectOS } from '../../../src/tools/shell'
import type { ToolContext } from '../../../src/tools/index'

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

describe('Shell Tool', () => {
  const isWindows = detectOS() === 'windows'
  const mockWorkspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-shell-mock-'))
  const mockContext: ToolContext = {
    workspaceRoot: mockWorkspaceRoot,
    agentName: 'test-agent',
    logger: vi.fn(() => {}),
  }

  afterAll(() => {
    fs.rmSync(mockWorkspaceRoot, { recursive: true, force: true })
  })

  test('detectOS should return a valid OS name', () => {
    const osName = detectOS()
    expect(['windows', 'linux', 'macos', 'unknown']).toContain(osName)
  })

  test('detectShell should return a valid shell name', () => {
    const shell = detectShell()
    expect(['bash', 'pwsh', 'cmd', 'unknown']).toContain(shell)
  })

  test('executeShellCommand should run a simple command', async () => {
    const command = isWindows ? 'echo|set /p=hello' : 'printf hello'
    const result = await executeShellCommand({ command }, mockContext)
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
    const command = isWindows ? 'echo error_msg 1>&2' : 'printf error_msg >&2'
    const result = await executeShellCommand({ command }, mockContext)
    expect(result.success).toBe(true)
    expect(result.content).toContain('[STDERR]')
    expect(result.content).toContain('error_msg')
  })

  test('executeShellCommand runs command inside workspace root', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-shell-test-'))
    const context: ToolContext = {
      workspaceRoot: tmpDir,
      agentName: 'shell-agent',
      logger: vi.fn(() => {}),
    }
    const command = isWindows ? 'cd' : 'pwd'
    const result = await executeShellCommand({ command }, context)
    expect(result.success).toBe(true)
    expect(result.content.trim()).toBe(tmpDir)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('returns timeout error when command exceeds timeout', async () => {
    const result = await executeShellCommand(
      { command: 'sleep 10', timeout: 100, cwd: os.tmpdir() },
      { signal: new AbortController().signal } as any
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/超时/)
  })

  test('executeShellCommand cancels running process tree when aborted', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-shell-abort-'))
    const markerPath = path.join(tmpDir, 'aborted.txt')
    const controller = new AbortController()
    const context: ToolContext = {
      workspaceRoot: tmpDir,
      agentName: 'shell-agent',
      logger: vi.fn(() => {}),
      signal: controller.signal,
    }

    const command = `node -e "setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'done'), 5000)" "${markerPath}"`
    const resultPromise = executeShellCommand({ command, timeout: 10000 }, context)

    setTimeout(() => controller.abort(), 100)

    const result = await resultPromise
    await new Promise((resolve) => setTimeout(resolve, 400))

    expect(result.success).toBe(false)
    expect(result.error).toContain('已取消')
    expect(fs.existsSync(markerPath)).toBe(false)

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
