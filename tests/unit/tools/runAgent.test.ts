import { describe, expect, it, vi } from 'vitest'
import { executeRunAgent } from '../../../src/tools/runAgent'
import type { ToolContext } from '../../../src/tools'

describe('executeRunAgent', () => {
  it('aborts the child agent on timeout and prevents late side effects', async () => {
    let completed = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const subAgent = {
      run: vi.fn(
        () =>
          new Promise<string>((resolve) => {
            timer = setTimeout(() => {
              completed = true
              resolve('done')
            }, 50)
          })
      ),
      abort: vi.fn(() => {
        if (timer) clearTimeout(timer)
      }),
    }

    const context: ToolContext = {
      workspaceRoot: '/tmp',
      agentName: 'main',
      logger: () => {},
      factory: {
        createAgent: () => subAgent,
      } as any,
    }

    const result = await executeRunAgent({ instruction: 'test', timeout_ms: 10 }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Agent timeout')
    expect(subAgent.abort).toHaveBeenCalledWith('Agent timeout')

    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(completed).toBe(false)
  })
})
