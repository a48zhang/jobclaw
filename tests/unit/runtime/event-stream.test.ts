import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { bindRuntimeEventStream, eventBus, AgentStatePayload } from '../../../src/eventBus.js'
import { InMemoryEventStream } from '../../../src/runtime/event-stream.js'

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

  test('context usage and info logs round-trip through the runtime event stream', () => {
    const stream = new InMemoryEventStream()
    bindRuntimeEventStream(stream)

    const usageListener = vi.fn()
    const logListener = vi.fn()
    eventBus.on('context:usage', usageListener)
    eventBus.on('agent:log', logListener)

    try {
      eventBus.emit('context:usage', { agentName: 'main', tokenCount: 1234 })
      eventBus.emit('agent:log', {
        agentName: 'main',
        type: 'info',
        message: 'runtime log',
        timestamp: '2026-03-27T00:00:00.000Z',
      })

      const eventTypes = stream.getHistory().map((event) => event.type)
      expect(eventTypes).toContain('context.usage')
      expect(eventTypes).toContain('runtime.log')

      usageListener.mockClear()
      logListener.mockClear()

      stream.publish({
        type: 'context.usage',
        sessionId: 'main',
        agentName: 'main',
        payload: { tokenCount: 5678 },
      })
      stream.publish({
        type: 'runtime.log',
        sessionId: 'main',
        agentName: 'main',
        payload: {
          message: 'hello from runtime',
          level: 'info',
          timestamp: '2026-03-27T00:00:01.000Z',
        },
      })

      expect(usageListener).toHaveBeenCalledWith({ agentName: 'main', tokenCount: 5678 })
      expect(logListener).toHaveBeenCalledWith({
        agentName: 'main',
        type: 'info',
        level: 'info',
        message: 'hello from runtime',
        timestamp: '2026-03-27T00:00:01.000Z',
      })
    } finally {
      bindRuntimeEventStream(undefined)
      eventBus.off('context:usage', usageListener)
      eventBus.off('agent:log', logListener)
    }
  })

  test.todo('RuntimeKernel exposes start/shutdown lifecycle per contract')
})
