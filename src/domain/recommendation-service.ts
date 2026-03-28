import { JobStore } from '../memory/jobStore.js'
import { StrategyStore } from '../memory/strategyStore.js'
import { UserFactsStore } from '../memory/userFactsStore.js'
import type {
  JobRecommendation,
  JobRecommendationBand,
  JobRecommendationReason,
  JobRecord,
  JobStatus,
  JobStrategyPreferences,
  RecommendationReasonCode,
  UserFacts,
} from '../runtime/contracts.js'
import { nowIso } from '../runtime/utils.js'

export interface RecommendationQueryOptions {
  statuses?: JobStatus[]
  limit?: number
  minScore?: number
  includeAvoid?: boolean
}

export class RecommendationService {
  private readonly jobStore: JobStore
  private readonly strategyStore: StrategyStore
  private readonly userFactsStore: UserFactsStore

  constructor(workspaceRoot: string) {
    this.jobStore = new JobStore(workspaceRoot)
    this.strategyStore = new StrategyStore(workspaceRoot)
    this.userFactsStore = new UserFactsStore(workspaceRoot)
  }

  async list(options: RecommendationQueryOptions = {}): Promise<JobRecommendation[]> {
    const [jobs, strategy, userFacts] = await Promise.all([
      this.jobStore.list(),
      this.strategyStore.get(),
      this.userFactsStore.get(),
    ])
    const recommendations = jobs
      .filter((job) => !options.statuses?.length || options.statuses.includes(job.status))
      .map((job) => buildRecommendation(job, strategy, userFacts))
      .filter((item) => options.includeAvoid || item.band !== 'avoid')
      .filter((item) => typeof options.minScore !== 'number' || item.score >= options.minScore)
      .sort((left, right) => right.score - left.score || left.jobId.localeCompare(right.jobId))

    if (typeof options.limit === 'number' && options.limit > 0) {
      return recommendations.slice(0, options.limit)
    }
    return recommendations
  }

  async get(jobId: string): Promise<JobRecommendation | undefined> {
    const recommendations = await this.list({ includeAvoid: true })
    return recommendations.find((item) => item.jobId === jobId)
  }
}

function buildRecommendation(
  job: JobRecord,
  strategy: JobStrategyPreferences,
  userFacts: UserFacts
): JobRecommendation {
  const generatedAt = nowIso()
  const reasons: JobRecommendationReason[] = []
  const text = [job.company, job.title, job.url, job.fitSummary ?? '', job.notes ?? ''].join(' ').toLowerCase()
  let positiveScore = 0
  let negativeScore = 0

  const matchedRoles = findMatches(text, uniqueMerge(strategy.preferredRoles, userFacts.targetRoles))
  if (matchedRoles.length > 0) {
    positiveScore += strategy.scoringWeights.roleMatch
    reasons.push(reason('target_role_match', 'positive', strategy.scoringWeights.roleMatch, `Matched target roles: ${matchedRoles.join(', ')}`, matchedRoles))
  }

  const preferredRoleMatches = findMatches(text, strategy.preferredRoles)
  if (preferredRoleMatches.length > 0) {
    positiveScore += Math.round(strategy.scoringWeights.roleMatch / 2)
    reasons.push(reason('preferred_role_match', 'positive', Math.round(strategy.scoringWeights.roleMatch / 2), `Matched preferred roles: ${preferredRoleMatches.join(', ')}`, preferredRoleMatches))
  }

  const matchedLocations = findMatches(text, uniqueMerge(strategy.preferredLocations, userFacts.targetLocations))
  if (matchedLocations.length > 0) {
    positiveScore += strategy.scoringWeights.locationMatch
    reasons.push(reason('preferred_location_match', 'positive', strategy.scoringWeights.locationMatch, `Matched locations: ${matchedLocations.join(', ')}`, matchedLocations))
  }

  if (strategy.preferredCompanies.some((item) => job.company.toLowerCase().includes(item.toLowerCase()))) {
    positiveScore += strategy.scoringWeights.companyPreference
    reasons.push(reason('preferred_company', 'positive', strategy.scoringWeights.companyPreference, 'Company is in preferred companies', [job.company]))
  }

  if (strategy.excludedCompanies.some((item) => job.company.toLowerCase().includes(item.toLowerCase()))) {
    negativeScore += strategy.scoringWeights.companyPreference
    reasons.push(reason('excluded_company', 'negative', strategy.scoringWeights.companyPreference, 'Company is in excluded companies', [job.company]))
  }

  const matchedPreferredKeywords = findMatches(text, strategy.preferredKeywords)
  if (matchedPreferredKeywords.length > 0) {
    positiveScore += strategy.scoringWeights.keywordPreference
    reasons.push(reason('preferred_keyword', 'positive', strategy.scoringWeights.keywordPreference, `Matched preferred keywords: ${matchedPreferredKeywords.join(', ')}`, matchedPreferredKeywords))
  }

  const matchedExcludedKeywords = findMatches(text, strategy.excludedKeywords)
  if (matchedExcludedKeywords.length > 0) {
    negativeScore += strategy.scoringWeights.constraintPenalty
    reasons.push(reason('excluded_keyword', 'negative', strategy.scoringWeights.constraintPenalty, `Matched excluded keywords: ${matchedExcludedKeywords.join(', ')}`, matchedExcludedKeywords))
  }

  const matchedSkills = findMatches(text, userFacts.skills)
  if (matchedSkills.length > 0) {
    positiveScore += strategy.scoringWeights.skillSignal
    reasons.push(reason('skill_signal', 'positive', strategy.scoringWeights.skillSignal, `Matched user skills: ${matchedSkills.join(', ')}`, matchedSkills))
  }

  const matchedConstraints = findMatches(text, userFacts.constraints)
  if (matchedConstraints.length > 0) {
    positiveScore += Math.round(strategy.scoringWeights.keywordPreference / 2)
    reasons.push(reason('constraint_signal', 'positive', Math.round(strategy.scoringWeights.keywordPreference / 2), `Matched user constraints/keywords: ${matchedConstraints.join(', ')}`, matchedConstraints))
  }

  if (job.status === 'favorite') {
    positiveScore += Math.round(strategy.scoringWeights.companyPreference / 2)
    reasons.push(reason('favorite_signal', 'positive', Math.round(strategy.scoringWeights.companyPreference / 2), 'Job already marked favorite'))
  }

  if (job.status === 'applied' || job.status === 'failed' || job.status === 'login_required') {
    negativeScore += strategy.scoringWeights.statusPenalty
    reasons.push(reason('status_penalty', 'negative', strategy.scoringWeights.statusPenalty, `Status ${job.status} reduces recommendation priority`))
  }

  const ageDays = Math.max(0, (Date.now() - Date.parse(job.updatedAt)) / (24 * 60 * 60 * 1000))
  if (ageDays <= 7) {
    positiveScore += strategy.scoringWeights.recency
    reasons.push(reason('recency_signal', 'positive', strategy.scoringWeights.recency, 'Recently updated job'))
  }

  if (job.fitSummary?.trim()) {
    positiveScore += strategy.scoringWeights.fitSummary
    reasons.push(reason('fit_summary_signal', 'positive', strategy.scoringWeights.fitSummary, 'Job has fit summary signal', [job.fitSummary]))
  }

  if (job.notes?.trim()) {
    positiveScore += Math.round(strategy.scoringWeights.fitSummary / 2)
    reasons.push(reason('notes_signal', 'neutral', Math.round(strategy.scoringWeights.fitSummary / 2), 'Job has notes context', [job.notes]))
  }

  const rawScore = positiveScore - negativeScore
  const maxScore = Math.max(40, positiveScore + negativeScore, totalWeight(strategy))
  const normalizedScore = Math.max(0, Math.min(100, Math.round((rawScore / maxScore) * 100 + 50)))
  const band = toBand(normalizedScore)

  return {
    jobId: job.id,
    jobUrl: job.url,
    score: normalizedScore,
    band,
    summary: summarizeRecommendation(job, band, reasons),
    generatedAt,
    breakdown: {
      positiveScore,
      negativeScore,
      rawScore,
      normalizedScore,
      maxScore,
    },
    signals: {
      matchedRoles,
      matchedLocations,
      matchedSkills,
      matchedPreferredKeywords,
      matchedConstraints,
      matchedExcludedKeywords,
    },
    reasons: reasons.sort((left, right) => right.weight - left.weight),
  }
}

function reason(
  code: RecommendationReasonCode,
  polarity: JobRecommendationReason['polarity'],
  weight: number,
  message: string,
  evidence?: string[]
): JobRecommendationReason {
  return { code, polarity, weight, message, evidence }
}

function findMatches(text: string, candidates: string[]): string[] {
  const normalized = candidates.map((item) => item.trim()).filter(Boolean)
  return normalized.filter((item) => text.includes(item.toLowerCase()))
}

function uniqueMerge(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right]))
}

function totalWeight(strategy: JobStrategyPreferences): number {
  const weights = strategy.scoringWeights
  return weights.roleMatch + weights.locationMatch + weights.skillSignal + weights.companyPreference + weights.keywordPreference + weights.constraintPenalty + weights.statusPenalty + weights.recency + weights.fitSummary
}

function toBand(score: number): JobRecommendationBand {
  if (score >= 80) return 'strong_match'
  if (score >= 65) return 'good_match'
  if (score >= 50) return 'possible_match'
  if (score >= 35) return 'weak_match'
  return 'avoid'
}

function summarizeRecommendation(
  job: JobRecord,
  band: JobRecommendationBand,
  reasons: JobRecommendationReason[]
): string {
  const topReasons = reasons.slice(0, 2).map((item) => item.message)
  if (topReasons.length === 0) {
    return `${job.title} at ${job.company} is currently ${band.replace('_', ' ')}`
  }
  return `${job.title} at ${job.company} is ${band.replace('_', ' ')} because ${topReasons.join('; ')}`
}
