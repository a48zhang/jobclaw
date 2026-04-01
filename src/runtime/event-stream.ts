import { createRuntimeId, nowIso } from './utils.js'
import type {
  EventStream,
  RuntimeEvent,
  RuntimeEventFilter,
  RuntimeEventInput,
  RuntimeEventListener,
  RuntimeEventMeta,
} from './contracts.js'

interface Subscription {
  listener: RuntimeEventListener
  filter?: RuntimeEventFilter
}

function matchesFilter(event: RuntimeEvent, filter?: RuntimeEventFilter): boolean {
  if (!filter) return true
  if (typeof filter === 'string') return event.type === filter
  if (Array.isArray(filter)) return filter.includes(event.type)
  return filter(event)
}

export interface InMemoryEventStreamOptions {
  maxHistory?: number
}

export class InMemoryEventStream implements EventStream {
  private readonly maxHistory: number
  private readonly history: RuntimeEvent[] = []
  private readonly subscriptions = new Set<Subscription>()

  constructor(options: InMemoryEventStreamOptions = {}) {
    this.maxHistory = options.maxHistory ?? 1000
  }

  // Makes publish() async so all async subscription handlers are properly awaited
  // before returning. This ensures that rapid sequential events (e.g. queued →
  // running → completed) see their handlers complete in order rather than racing.
  // See Issue 6: fire-and-forget async subscription causes out-of-order event persistence.
  async publish(event: RuntimeEventInput, meta: RuntimeEventMeta = {}): Promise<RuntimeEvent> {
    const runtimeEvent: RuntimeEvent = {
      id: event.id ?? createRuntimeId('evt'),
      type: event.type,
      timestamp: event.timestamp ?? nowIso(),
      sessionId: event.sessionId,
      delegatedRunId: event.delegatedRunId,
      agentName: event.agentName,
      payload: event.payload ?? {},
    }

    this.history.push(runtimeEvent)
    if (this.history.length > this.maxHistory) {
      this.history.splice(0, this.history.length - this.maxHistory)
    }

    const promises: Promise<void>[] = []
    for (const subscription of this.subscriptions) {
      if (!matchesFilter(runtimeEvent, subscription.filter)) continue
      try {
        const result = subscription.listener(runtimeEvent, meta) as unknown as PromiseLike<void> | null | undefined
        if (result && typeof result.then === 'function') {
          promises.push(Promise.resolve(result).catch(err => {
            console.error('[EventStream] Subscription handler error:', err)
          }))
        }
      } catch (err) {
        console.error('[EventStream] Subscription handler error:', err)
      }
    }
    await Promise.all(promises)

    return runtimeEvent
  }

  subscribe(listener: RuntimeEventListener, filter?: RuntimeEventFilter): () => void {
    const subscription: Subscription = { listener, filter }
    this.subscriptions.add(subscription)
    return () => {
      this.subscriptions.delete(subscription)
    }
  }

  replay(listener: RuntimeEventListener, filter?: RuntimeEventFilter): void {
    for (const event of this.getHistory(filter)) {
      listener(event, { origin: 'runtime' })
    }
  }

  getHistory(filter?: RuntimeEventFilter): RuntimeEvent[] {
    return this.history.filter((event) => matchesFilter(event, filter))
  }

  clear(): void {
    this.history.length = 0
    this.subscriptions.clear()
  }
}
