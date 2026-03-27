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

  it('returns success when child agent finishes in time', async () => {
    const run = vi.fn(() => Promise.resolve('done fast'))
    const subAgent = { run, abort: vi.fn() }

    const factory = { createAgent: vi.fn(() => subAgent) }

    const context: ToolContext = {
      workspaceRoot: '/tmp',
      agentName: 'main',
      logger: () => {},
      factory: factory as any,
    }

    const result = await executeRunAgent({ instruction: 'quick' }, context)

    expect(result.success).toBe(true)
    expect(result.content).toBe('done fast')
    expect(factory.createAgent).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalled()
  })

  it('creates the child agent with delegated profile and run id when provided', async () => {
    const run = vi.fn(() => Promise.resolve('delegated'))
    const subAgent = { run, abort: vi.fn() }
    const factory = { createAgent: vi.fn(() => subAgent) }

    const context: ToolContext = {
      workspaceRoot: '/tmp',
      agentName: 'main',
      logger: () => {},
      factory: factory as any,
    }

    await executeRunAgent(
      {
        instruction: 'search jobs',
        skill: 'delivery',
        profile: 'delivery',
        delegated_run_id: 'run-123',
      },
      context
    )

    expect(factory.createAgent).toHaveBeenCalledWith({
      profileName: 'delivery',
      skillName: 'delivery',
      sessionId: 'run-123',
    })
  })
})
