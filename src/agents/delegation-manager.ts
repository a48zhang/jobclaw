import * as crypto from 'node:crypto'
import { eventBus } from '../eventBus.js'
import type { DelegatedRun as RuntimeDelegatedRun, DelegatedRunState as RuntimeDelegatedRunState } from '../runtime/contracts.js'

export type DelegatedRunState = RuntimeDelegatedRunState
export type DelegatedRun = RuntimeDelegatedRun

export class DelegationManager {
  private runs = new Map<string, DelegatedRun>()

  constructor(private parentSessionId: string, private agentName: string) {}

  createDelegatedRun(profile: DelegatedRun['profile'], instruction: string): DelegatedRun {
    const now = new Date().toISOString()
    const run: DelegatedRun = {
      id: crypto.randomUUID(),
      parentSessionId: this.parentSessionId,
      profile,
      state: 'queued',
      instruction,
      createdAt: now,
      updatedAt: now,
    }
    this.runs.set(run.id, run)
    this.emit('delegation.created', run)
    return run
  }

  updateState(runId: string, state: DelegatedRunState, updates: Partial<DelegatedRun> = {}): DelegatedRun | undefined {
    const existing = this.runs.get(runId)
    if (!existing) return undefined
    existing.state = state
    existing.updatedAt = new Date().toISOString()
    if (updates.resultSummary !== undefined) existing.resultSummary = updates.resultSummary
    if (updates.error !== undefined) existing.error = updates.error
    if (updates.instruction !== undefined) existing.instruction = updates.instruction
    const eventType =
      state === 'completed'
        ? 'delegation.completed'
        : state === 'failed'
          ? 'delegation.failed'
          : 'delegation.state_changed'
    this.emit(eventType, existing)
    return existing
  }

  completeRun(runId: string, summary?: string): DelegatedRun | undefined {
    return this.updateState(runId, 'completed', { resultSummary: summary })
  }

  failRun(runId: string, error: string): DelegatedRun | undefined {
    return this.updateState(runId, 'failed', { error })
  }

  private emit(
    eventType: 'delegation.created' | 'delegation.state_changed' | 'delegation.completed' | 'delegation.failed',
    payload: DelegatedRun
  ): void {
    eventBus.emit(eventType, { ...payload, agentName: this.agentName })
  }
}
