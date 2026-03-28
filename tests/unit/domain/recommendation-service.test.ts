import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { JobsService } from '../../../src/domain/jobs-service.js'
import { RecommendationService } from '../../../src/domain/recommendation-service.js'
import { StrategyStore } from '../../../src/memory/strategyStore.js'
import { UserFactsStore } from '../../../src/memory/userFactsStore.js'

describe('RecommendationService', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jobclaw-recommendation-service-'))
  })

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  })

  it('scores jobs using user facts and strategy preferences with explainable reasons', async () => {
    const jobs = new JobsService(workspaceRoot, 'jobs-service-test')
    await jobs.upsert(
      {
        company: 'Acme Cloud',
        title: 'Senior Backend Engineer',
        url: 'https://example.com/acme-backend',
        status: 'favorite',
        time: '2026-03-28T00:00:00.000Z',
      },
      { lockHolder: 'search-agent', mutation: { source: 'agent', actor: 'search-agent' } }
    )
    await jobs.upsert(
      {
        company: 'Noise Corp',
        title: 'Frontend Engineer',
        url: 'https://example.com/noise-frontend',
        status: 'failed',
        time: '2026-03-20T00:00:00.000Z',
      },
      { lockHolder: 'search-agent', mutation: { source: 'agent', actor: 'search-agent' } }
    )

    const facts = new UserFactsStore(workspaceRoot)
    await facts.update((current) => ({
      ...current,
      targetRoles: ['backend engineer'],
      skills: ['node', 'typescript'],
      constraints: ['remote'],
    }))

    const strategy = new StrategyStore(workspaceRoot)
    await strategy.update((current) => ({
      ...current,
      preferredCompanies: ['Acme'],
      preferredKeywords: ['backend', 'remote'],
      excludedCompanies: ['Noise'],
    }))

    const service = new RecommendationService(workspaceRoot)
    const recommendations = await service.list({ includeAvoid: true })

    expect(recommendations).toHaveLength(2)
    expect(recommendations[0].jobUrl).toBe('https://example.com/acme-backend')
    expect(recommendations[0].score).toBeGreaterThan(recommendations[1].score)
    expect(recommendations[0].reasons.some((item) => item.code === 'preferred_company')).toBe(true)
    expect(recommendations[0].reasons.some((item) => item.code === 'target_role_match')).toBe(true)
    expect(recommendations[1].reasons.some((item) => item.code === 'excluded_company')).toBe(true)
    expect(recommendations[1].reasons.some((item) => item.code === 'status_penalty')).toBe(true)
  })
})
