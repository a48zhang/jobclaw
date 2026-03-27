import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { eventBus, AgentStatePayload } from '../../../src/eventBus.js'

describe('Runtime event stream contract', () => {
  let captured: AgentStatePayload[]

  beforeEach(() => {
    captured = []
  })

  afterEach(() => {
    eventBus.removeAllListeners('agent:state')
  })

  test('agent:state includes agentName and state fields', () => {
    const payload: AgentStatePayload = { agentName: 'main', state: 'running' }
    eventBus.once('agent:state', (p) => {
      captured.push(p)
    })
    const emitted = eventBus.emit('agent:state', payload)
    expect(emitted).toBe(true)
    expect(captured).toEqual([payload])
  })

  test('subscribers can collect events for replay semantics', () => {
    const listener = (payload: AgentStatePayload) => captured.push(payload)
    eventBus.on('agent:state', listener)

    eventBus.emit('agent:state', { agentName: 'main', state: 'idle' })
    eventBus.emit('agent:state', { agentName: 'worker', state: 'waiting' })

    expect(captured).toHaveLength(2)
    eventBus.off('agent:state', listener)
  })

  test('unsubscribed listeners no longer receive events', () => {
    const listener = vi.fn()
    eventBus.on('agent:state', listener)
    eventBus.off('agent:state', listener)
    eventBus.emit('agent:state', { agentName: 'main', state: 'idle' })
    expect(listener).not.toHaveBeenCalled()
  })

  test.todo('RuntimeKernel exposes start/shutdown lifecycle per contract')
})
