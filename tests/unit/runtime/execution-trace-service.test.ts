import { describe, expect, test } from 'vitest'
import { ExecutionTraceService } from '../../../src/runtime/execution-trace-service'
import type { LearningRecord } from '../../../src/runtime/contracts'
import type { UnifiedTaskDetail } from '../../../src/runtime/task-results-service'

describe('ExecutionTraceService', () => {
  test('enriches traces with recommendation, learning records, and explanation fields', async () => {
    const learningRecord: LearningRecord = {
      id: 'learning-1',
      kind: 'improvement_plan',
      status: 'open',
      title: 'Improve application follow-up',
      summary: 'Turn blocked application into actionable steps.',
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
      source: 'agent',
      actor: 'review-agent',
      tags: ['follow-up'],
      links: {
        applicationId: 'application-1',
        jobId: 'job-1',
        taskId: 'run-1',
        artifactPaths: [],
      },
      findings: [],
      actionItems: [{
        id: 'learning-action-1',
        summary: 'Provide the verification code',
        owner: 'user',
        status: 'pending',
        linkedTaskId: 'run-1',
        updatedAt: '2026-03-28T00:00:00.000Z',
        source: 'agent',
        actor: 'review-agent',
      }],
    }

    const taskDetail: UnifiedTaskDetail = {
      task: {
        id: 'run-1',
        kind: 'delegation',
        profile: 'delivery',
        sessionId: 'main',
        agentName: 'delivery-agent',
        title: 'Apply to Acme',
        state: 'waiting_input',
        lifecycle: 'waiting',
        status: 'requires_input',
        statusLabel: 'Needs Input',
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:05:00.000Z',
        activityAt: '2026-03-28T00:05:00.000Z',
        summary: 'Waiting for input: Need verification code',
        pendingIntervention: {
          id: 'ivr-1',
          kind: 'text',
          prompt: 'Need verification code',
          status: 'pending',
          createdAt: '2026-03-28T00:01:00.000Z',
          updatedAt: '2026-03-28T00:05:00.000Z',
        },
        interventionCounts: {
          pending: 1,
          resolved: 0,
          timeout: 0,
          cancelled: 0,
        },
        artifactCount: 1,
        nextAction: {
          code: 'provide_input',
          label: 'Provide input',
          reason: 'Need verification code',
        },
        retryHint: {
          supported: false,
          mode: 'none',
          reason: 'No structured retry path is available for this task state.',
        },
        detail: {
          rawState: 'waiting_input',
          instruction: 'Apply to Acme',
          pendingIntervention: {
            id: 'ivr-1',
            kind: 'text',
            prompt: 'Need verification code',
            status: 'pending',
            createdAt: '2026-03-28T00:01:00.000Z',
            updatedAt: '2026-03-28T00:05:00.000Z',
          },
          interventionCounts: {
            pending: 1,
            resolved: 0,
            timeout: 0,
            cancelled: 0,
          },
          artifactCount: 1,
        },
      },
      interventions: [{
        id: 'ivr-1',
        ownerType: 'delegated_run',
        ownerId: 'run-1',
        kind: 'text',
        prompt: 'Need verification code',
        status: 'pending',
        createdAt: '2026-03-28T00:01:00.000Z',
        updatedAt: '2026-03-28T00:05:00.000Z',
      }],
      artifacts: [{
        id: 'art-1',
        name: 'apply-log.txt',
        type: 'generated',
        path: 'output/apply-log.txt',
        createdAt: '2026-03-28T00:04:00.000Z',
        relatedTaskIds: ['run-1'],
        meta: {},
        ownerHints: {
          delegatedRunId: 'run-1',
        },
      }],
      failures: [],
      nextActions: [{
        code: 'provide_input',
        label: 'Provide input',
        reason: 'Need verification code',
      }],
    }

    const service = new ExecutionTraceService({
      workspaceRoot: '/tmp/unused',
      applicationService: {
        get: async () => ({
          id: 'application-1',
          company: 'Acme',
          jobTitle: 'Platform Engineer',
          jobId: 'job-1',
          status: 'applied',
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:00.000Z',
          notes: [],
          timeline: [],
          reminders: [],
          linkedTasks: [{
            taskId: 'run-1',
            taskKind: 'delegation',
            role: 'delivery',
            linkedAt: '2026-03-28T00:00:00.000Z',
            source: 'manual',
            actor: 'web-server',
          }],
        }),
        findByTaskId: async () => [],
      },
      learningService: {
        findLinked: async () => [learningRecord],
      },
      recommendationService: {
        get: async () => ({
          jobId: 'job-1',
          jobUrl: 'https://example.com/job-1',
          score: 81,
          band: 'strong_match',
          summary: 'Platform Engineer at Acme is strong match because matched target roles',
          generatedAt: '2026-03-28T00:00:00.000Z',
          breakdown: {
            positiveScore: 20,
            negativeScore: 0,
            rawScore: 20,
            normalizedScore: 81,
            maxScore: 25,
          },
          signals: {
            matchedRoles: ['platform engineer'],
            matchedLocations: [],
            matchedSkills: [],
            matchedPreferredKeywords: [],
            matchedConstraints: [],
            matchedExcludedKeywords: [],
          },
          reasons: [],
        }),
      },
      taskResultsService: {
        getTaskDetail: async () => taskDetail,
      },
    })

    const trace = await service.getByApplicationId('application-1')
    expect(trace?.recommendation?.jobId).toBe('job-1')
    expect(trace?.learningRecords.map((item) => item.id)).toEqual(['learning-1'])
    expect(trace?.explanation.whyThisWork).toEqual(expect.arrayContaining([
      expect.stringContaining('strong match'),
      expect.stringContaining('delivery delegation task'),
    ]))
    expect(trace?.explanation.pendingAuthorizations).toEqual([
      expect.objectContaining({
        ownerId: 'run-1',
        interventionId: 'ivr-1',
        prompt: 'Need verification code',
      }),
    ])
    expect(trace?.explanation.nextPlannedSteps).toEqual(expect.arrayContaining([
      'Need verification code',
      'Provide the verification code',
    ]))
    expect(trace?.explanation.auditTrail).toMatchObject({
      taskCount: 1,
      applicationCount: 1,
      learningRecordCount: 1,
      artifactCount: 1,
    })
  })
})
