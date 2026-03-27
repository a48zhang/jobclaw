import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { InMemoryEventStream } from '../../../src/runtime/event-stream.js'
import { InterventionManager } from '../../../src/runtime/intervention-manager.js'

describe('InterventionManager', () => {
  test('syncTimeouts marks expired interventions as timeout and emits a runtime event', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-intervention-manager-'))
    const stream = new InMemoryEventStream()
    const manager = new InterventionManager(workspace, stream)

    try {
      const record = await manager.request({
        ownerType: 'session',
        ownerId: 'main',
        prompt: 'Need confirmation',
        timeoutMs: 20,
      })

      const timedOut = await manager.syncTimeouts(Date.parse(record.createdAt) + 25)
      const stored = await manager.get(record.id)
      const events = stream.getHistory((event) => event.type === 'intervention.timed_out')

      expect(timedOut.map((item) => item.id)).toEqual([record.id])
      expect(stored?.status).toBe('timeout')
      expect(events).toHaveLength(1)
      expect(events[0]?.payload.requestId).toBe(record.id)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('syncTimeouts is serialized so one intervention only emits one timeout event', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-intervention-manager-'))
    const stream = new InMemoryEventStream()
    const manager = new InterventionManager(workspace, stream)

    try {
      const record = await manager.request({
        ownerType: 'session',
        ownerId: 'main',
        prompt: 'Need confirmation',
        timeoutMs: 20,
      })

      const [first, second] = await Promise.all([
        manager.syncTimeouts(Date.parse(record.createdAt) + 25),
        manager.syncTimeouts(Date.parse(record.createdAt) + 25),
      ])

      const events = stream.getHistory((event) => event.type === 'intervention.timed_out')
      expect(first.map((item) => item.id)).toEqual([record.id])
      expect(second.map((item) => item.id)).toEqual([record.id])
      expect(events).toHaveLength(1)
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
