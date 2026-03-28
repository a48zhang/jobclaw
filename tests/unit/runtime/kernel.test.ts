import { describe, expect, test, vi } from 'vitest'
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

  test('runProfileTask emits tracked delegation lifecycle and resolves result', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-runtime-kernel-run-'))
    const kernel = new RuntimeKernel({ workspaceRoot: workspace })
    const run = vi.fn(async (instruction: string) => `done: ${instruction}`)
    const savedRuns = new Map<string, any>()

    ;(kernel as any).factory = {
      createAgent: () => ({
        agentName: 'search-agent-test',
        run,
      }),
    }
    ;(kernel as any).delegationStore = {
      save: vi.fn(async (record: any) => {
        savedRuns.set(record.id, record)
      }),
      get: vi.fn(async (id: string) => savedRuns.get(id)),
    }
    ;(kernel as any).installRuntimeObservers()

    try {
      const result = await kernel.runProfileTask('search', 'search jobs')
      await Promise.resolve()
      const stored = savedRuns.get(result.runId)
      const events = kernel.getEventStream().getHistory().filter((event) => event.delegatedRunId === result.runId)

      expect(result.result).toBe('done: search jobs')
      expect(run).toHaveBeenCalledWith('search jobs')
      expect(events.map((event) => event.type)).toEqual([
        'delegation.created',
        'delegation.state_changed',
        'delegation.completed',
      ])
      expect(stored).toMatchObject({
        id: result.runId,
        profile: 'search',
        state: 'completed',
        instruction: 'search jobs',
        resultSummary: 'done: search jobs',
      })
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
