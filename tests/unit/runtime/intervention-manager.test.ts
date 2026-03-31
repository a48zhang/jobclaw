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

  test('resolve enforces confirm and single-select constraints', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-intervention-manager-'))
    const stream = new InMemoryEventStream()
    const manager = new InterventionManager(workspace, stream)

    try {
      const confirmRecord = await manager.request({
        ownerType: 'session',
        ownerId: 'main',
        prompt: 'Need yes or no',
        kind: 'confirm',
        allowEmpty: false,
      })
      await expect(
        manager.resolve({ ownerId: 'main', requestId: confirmRecord.id, input: 'maybe' })
      ).rejects.toThrow(/must be yes or no/)

      await expect(
        manager.resolve({ ownerId: 'main', requestId: confirmRecord.id, input: 'yes' })
      ).resolves.toHaveProperty('status', 'resolved')

      const selectRecord = await manager.request({
        ownerType: 'session',
        ownerId: 'main',
        prompt: 'Pick one',
        kind: 'single_select',
        options: ['foo', 'bar'],
      })
      await expect(
        manager.resolve({ ownerId: 'main', requestId: selectRecord.id, input: 'baz' })
      ).rejects.toThrow(/must match one of the provided options/)

      await expect(
        manager.resolve({ ownerId: 'main', requestId: selectRecord.id, input: 'bar' })
      ).resolves.toHaveProperty('status', 'resolved')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
