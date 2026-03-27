import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { RuntimeKernel } from '../../../src/runtime/kernel.js'

describe('RuntimeKernel recovery', () => {
  test('recovery cancels active delegated runs with the provided reason', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-runtime-kernel-'))
    const kernel = new RuntimeKernel({ workspaceRoot: workspace })

    try {
      await kernel.getDelegationStore().save({
        id: 'run-1',
        parentSessionId: 'main',
        profile: 'search',
        state: 'running',
        instruction: 'search jobs',
        createdAt: '2026-03-27T00:00:00.000Z',
        updatedAt: '2026-03-27T00:00:00.000Z',
      })

      await (kernel as any).recoverRuntimeState('Runtime reloaded before delegated run completed')

      const recovered = await kernel.getDelegationStore().get('run-1')
      expect(recovered).toMatchObject({
        state: 'cancelled',
        error: 'Runtime reloaded before delegated run completed',
      })
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
