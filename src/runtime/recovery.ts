import type { DelegatedRun } from './contracts.js'
import { nowIso } from './utils.js'
import { DelegationStore } from '../memory/delegationStore.js'

const ACTIVE_DELEGATION_STATES = new Set<DelegatedRun['state']>(['queued', 'running', 'waiting_input'])

export async function cancelActiveDelegations(
  store: DelegationStore,
  options: {
    reason?: string
    timestamp?: string
  } = {}
): Promise<DelegatedRun[]> {
  const reason = options.reason ?? 'Runtime restarted before delegated run completed'
  const timestamp = options.timestamp ?? nowIso()
  const recovered: DelegatedRun[] = []

  for (const run of await store.list()) {
    if (!ACTIVE_DELEGATION_STATES.has(run.state)) continue
    const nextRun: DelegatedRun = {
      ...run,
      state: 'cancelled',
      updatedAt: timestamp,
      error: run.error ?? reason,
    }
    await store.save(nextRun)
    recovered.push(nextRun)
  }

  return recovered
}
