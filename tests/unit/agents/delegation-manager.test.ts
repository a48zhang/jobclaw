import { afterEach, describe, expect, test, vi } from 'vitest'
import { DelegationManager } from '../../../src/agents/delegation-manager'
import { eventBus } from '../../../src/eventBus'

describe('DelegationManager', () => {
  afterEach(() => {
    eventBus.removeAllListeners('delegation.created')
    eventBus.removeAllListeners('delegation.state_changed')
    eventBus.removeAllListeners('delegation.completed')
    eventBus.removeAllListeners('delegation.failed')
  })

  test('completeRun emits delegation.completed', () => {
    const manager = new DelegationManager('session-1', 'main')
    const completed = vi.fn()
    eventBus.on('delegation.completed', completed)

    const run = manager.createDelegatedRun('search', 'find jobs')
    manager.completeRun(run.id, 'done')

    expect(completed).toHaveBeenCalledTimes(1)
    expect(completed.mock.calls[0]?.[0].state).toBe('completed')
  })

  test('failRun emits delegation.failed', () => {
    const manager = new DelegationManager('session-1', 'main')
    const failed = vi.fn()
    eventBus.on('delegation.failed', failed)

    const run = manager.createDelegatedRun('delivery', 'apply')
    manager.failRun(run.id, 'boom')

    expect(failed).toHaveBeenCalledTimes(1)
    expect(failed.mock.calls[0]?.[0].state).toBe('failed')
    expect(failed.mock.calls[0]?.[0].error).toBe('boom')
  })
})
