import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { DelegationStore } from '../../../src/memory/delegationStore.js'
import { cancelActiveDelegations } from '../../../src/runtime/recovery.js'

describe('runtime recovery helpers', () => {
  test('cancelActiveDelegations closes non-terminal delegated runs on restart', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-runtime-recovery-'))
    const store = new DelegationStore(workspace)

    try {
      await store.save({
        id: 'run-queued',
        parentSessionId: 'main',
        profile: 'search',
        state: 'queued',
        instruction: 'search jobs',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
      })
      await store.save({
        id: 'run-done',
        parentSessionId: 'main',
        profile: 'review',
        state: 'completed',
        instruction: 'review resume',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
      })

      const recovered = await cancelActiveDelegations(store, {
        reason: 'restart',
        timestamp: '2026-03-27T00:01:00.000Z',
      })
      const allRuns = await store.list()

      expect(recovered.map((run) => run.id)).toEqual(['run-queued'])
      expect(allRuns.find((run) => run.id === 'run-queued')).toMatchObject({
        state: 'cancelled',
        error: 'restart',
        updatedAt: '2026-03-27T00:01:00.000Z',
      })
      expect(allRuns.find((run) => run.id === 'run-done')?.state).toBe('completed')
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
