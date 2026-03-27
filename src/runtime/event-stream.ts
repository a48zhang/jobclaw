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

  publish(event: RuntimeEventInput, meta: RuntimeEventMeta = {}): RuntimeEvent {
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

    for (const subscription of this.subscriptions) {
      if (!matchesFilter(runtimeEvent, subscription.filter)) continue
      subscription.listener(runtimeEvent, meta)
    }

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
