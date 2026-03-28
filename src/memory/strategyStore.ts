import { JsonFileStore } from '../infra/store/json-store.js'
import { getStrategyPath } from '../infra/workspace/paths.js'
import type { JobStrategyPreferences } from '../runtime/contracts.js'
import { nowIso } from '../runtime/utils.js'

const DEFAULT_PREFERENCES: JobStrategyPreferences = {
  version: 1,
  preferredRoles: [],
  preferredLocations: [],
  preferredCompanies: [],
  excludedCompanies: [],
  preferredKeywords: [],
  excludedKeywords: [],
  workModes: [],
  scoringWeights: {
    roleMatch: 18,
    locationMatch: 10,
    skillSignal: 12,
    companyPreference: 12,
    keywordPreference: 8,
    constraintPenalty: 14,
    statusPenalty: 16,
    recency: 6,
    fitSummary: 10,
  },
  updatedAt: nowIso(),
  sourceRefs: [],
}

export class StrategyStore {
  private readonly store: JsonFileStore<JobStrategyPreferences>

  constructor(workspaceRoot: string) {
    this.store = new JsonFileStore(getStrategyPath(workspaceRoot), DEFAULT_PREFERENCES)
  }

  async get(): Promise<JobStrategyPreferences> {
    return this.store.read()
  }

  async update(
    updater: (current: JobStrategyPreferences) => JobStrategyPreferences | Promise<JobStrategyPreferences>
  ): Promise<JobStrategyPreferences> {
    return this.store.mutate(updater)
  }
}
