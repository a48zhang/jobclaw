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
    const workspaceListener = vi.fn()
    eventBus.on('context:usage', usageListener)
    eventBus.on('agent:log', logListener)
    eventBus.on('workspace:context_updated', workspaceListener)

    try {
      eventBus.emit('context:usage', { agentName: 'main', tokenCount: 1234 })
      eventBus.emit('agent:log', {
        agentName: 'main',
        type: 'info',
        message: 'runtime log',
        timestamp: '2026-03-27T00:00:00.000Z',
      })
      eventBus.emit('workspace:context_updated', {
        agentName: 'main',
        updatedFiles: ['data/targets.md'],
        summary: '已同步 workspace context：targets.md 新增 1 条。',
        requiresReview: false,
        timestamp: '2026-03-27T00:00:00.000Z',
      })

      const eventTypes = stream.getHistory().map((event) => event.type)
      expect(eventTypes).toContain('context.usage')
      expect(eventTypes).toContain('runtime.log')
      expect(eventTypes).toContain('workspace.context_updated')

      usageListener.mockClear()
      logListener.mockClear()
      workspaceListener.mockClear()

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
      stream.publish({
        type: 'workspace.context_updated',
        sessionId: 'main',
        agentName: 'main',
        payload: {
          updatedFiles: ['data/userinfo.md'],
          summary: '已同步 workspace context：userinfo.md 更新 2 个字段。',
          requiresReview: true,
          timestamp: '2026-03-27T00:00:02.000Z',
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
      expect(workspaceListener).toHaveBeenCalledWith({
        agentName: 'main',
        updatedFiles: ['data/userinfo.md'],
        summary: '已同步 workspace context：userinfo.md 更新 2 个字段。',
        requiresReview: true,
        timestamp: '2026-03-27T00:00:02.000Z',
      })
    } finally {
      bindRuntimeEventStream(undefined)
      eventBus.off('context:usage', usageListener)
      eventBus.off('agent:log', logListener)
      eventBus.off('workspace:context_updated', workspaceListener)
    }
  })

  test.todo('RuntimeKernel exposes start/shutdown lifecycle per contract')

  test('async handlers are awaited in order to prevent race conditions', async () => {
    const stream = new InMemoryEventStream()
    const executionOrder: string[] = []

    // Add async handlers that take different amounts of time
    stream.subscribe(async (event) => {
      executionOrder.push(`handler1-start:${event.payload.order}`)
      await new Promise((resolve) => setTimeout(resolve, 30))
      executionOrder.push(`handler1-end:${event.payload.order}`)
    })

    stream.subscribe(async (event) => {
      executionOrder.push(`handler2-start:${event.payload.order}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
      executionOrder.push(`handler2-end:${event.payload.order}`)
    })

    // Publish events sequentially - each should complete before the next starts
    await stream.publish({ type: 'test.event', payload: { order: 1 } })
    await stream.publish({ type: 'test.event', payload: { order: 2 } })
    await stream.publish({ type: 'test.event', payload: { order: 3 } })

    // Verify the critical ordering guarantee:
    // All handlers for event N must complete before handlers for event N+1 start
    // The order within handlers of the same event doesn't matter (they run in parallel)

    // Event 1 handlers start before event 2
    const event1Start = executionOrder.findIndex((e) => e.includes(':1'))
    const event2Start = executionOrder.findIndex((e) => e.includes(':2'))
    expect(event1Start).toBeLessThan(event2Start)

    // All event 1 handlers complete before event 2 starts
    const event1Ends = executionOrder.filter((e) => e.endsWith(':1'))
    const event2Starts = executionOrder.filter((e) => e.includes('-start:2'))
    const lastEvent1Index = Math.max(...event1Ends.map((e) => executionOrder.indexOf(e)))
    const firstEvent2Index = executionOrder.findIndex((e) => e.includes(':2'))
    expect(lastEvent1Index).toBeLessThan(firstEvent2Index)

    // All event 2 handlers complete before event 3 starts
    const event2Ends = executionOrder.filter((e) => e.endsWith(':2'))
    const lastEvent2Index = Math.max(...event2Ends.map((e) => executionOrder.indexOf(e)))
    const firstEvent3Index = executionOrder.findIndex((e) => e.includes(':3'))
    expect(lastEvent2Index).toBeLessThan(firstEvent3Index)

    // Verify all handlers ran
    expect(executionOrder).toHaveLength(12) // 3 events × 2 handlers × 2 phases (start/end)
  })

  test('mixed sync and async handlers all complete before publish returns', async () => {
    const stream = new InMemoryEventStream()
    const executionOrder: string[] = []

    // Sync handler
    stream.subscribe((event) => {
      executionOrder.push(`sync:${event.payload.id}`)
    })

    // Async handler
    stream.subscribe(async (event) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      executionOrder.push(`async:${event.payload.id}`)
    })

    // Another sync handler
    stream.subscribe((event) => {
      executionOrder.push(`sync2:${event.payload.id}`)
    })

    await stream.publish({ type: 'test.event', payload: { id: 'a' } })

    // All handlers (sync and async) should have completed
    expect(executionOrder).toContain('sync:a')
    expect(executionOrder).toContain('async:a')
    expect(executionOrder).toContain('sync2:a')
  })
})
