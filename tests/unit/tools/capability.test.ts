import { describe, expect, it } from 'vitest'
import { executeTool, TOOL_NAMES } from '../../../src/tools/index.js'

describe('Tool runtime capability guard (existing scaffold)', () => {
  const context = {
    workspaceRoot: '/tmp',
    agentName: 'main',
    logger: () => {},
  }

  it('rejects unknown tool names with an explicit error', async () => {
    const result = await executeTool('tool_does_not_exist', {}, context)
    expect(result.success).toBe(false)
    expect(result.error).toContain('未知工具')
  })

  it('allows known tools returned by capability list', async () => {
    const result = await executeTool(TOOL_NAMES.GET_TIME, {}, context)
    expect(result.success).toBe(true)
    expect(result.content).toContain('当前时间')
  })
})
