import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import { eventBus, bindRuntimeEventStream } from '../../../src/eventBus.js'
import { InMemoryEventStream } from '../../../src/runtime/event-stream.js'

describe('Tool event session context propagation', () => {
  let stream: InMemoryEventStream

  beforeEach(() => {
    stream = new InMemoryEventStream({ maxHistory: 100 })
    bindRuntimeEventStream(stream)
  })

  afterEach(() => {
    bindRuntimeEventStream(undefined)
  })

  test('agent:tool events with session and delegation context convert to runtime events correctly', () => {
    // Simulate an agent emitting a tool event with session and delegation context
    eventBus.emit('agent:tool', {
      agentName: 'delivery-agent-123',
      toolType: 'tool_call',
      message: 'Executing tool: write_file',
      timestamp: '2026-04-01T12:00:00.000Z',
      sessionId: 'main-session',
      delegatedRunId: 'delegation-run-456',
    })

    // Check that it was converted to a runtime event with proper context
    const runtimeEvents = stream.getHistory()
    const toolEvent = runtimeEvents.find((e) => e.type === 'tool.started')
    expect(toolEvent).toBeDefined()
    expect(toolEvent).toMatchObject({
      type: 'tool.started',
      sessionId: 'main-session',
      delegatedRunId: 'delegation-run-456',
      agentName: 'delivery-agent-123',
    })
  })

  test('agent:tool events without delegation context default to session-only', () => {
    // Simulate a main agent emitting a tool event (no delegation)
    eventBus.emit('agent:tool', {
      agentName: 'main',
      toolType: 'tool_output',
      message: 'Tool completed successfully',
      timestamp: '2026-04-01T12:01:00.000Z',
      sessionId: 'main',
    })

    // Check that it was converted to a runtime event with session context
    const runtimeEvents = stream.getHistory()
    const toolEvent = runtimeEvents.find((e) => e.type === 'tool.finished')
    expect(toolEvent).toBeDefined()
    expect(toolEvent).toMatchObject({
      type: 'tool.finished',
      sessionId: 'main',
      agentName: 'main',
    })
    expect(toolEvent!.delegatedRunId).toBeUndefined()
  })

  test('runtime tool events round-trip back to legacy format', async () => {
    const legacyListener = vi.fn()
    eventBus.on('agent:tool', legacyListener)

    // Publish a runtime event with session and delegation context
    await stream.publish({
      type: 'tool.started',
      sessionId: 'session-789',
      delegatedRunId: 'delegation-abc',
      agentName: 'search-agent-xyz',
      payload: {
        message: 'Starting grep tool',
        toolType: 'tool_call',
        timestamp: '2026-04-01T12:02:00.000Z',
      },
    })

    // Verify it round-trips back to legacy format
    expect(legacyListener).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: 'search-agent-xyz',
        toolType: 'tool_call',
        message: 'Starting grep tool',
        timestamp: '2026-04-01T12:02:00.000Z',
      })
    )

    eventBus.off('agent:tool', legacyListener)
  })
})
