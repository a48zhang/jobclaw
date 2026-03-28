import { afterEach, describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { LearningService } from '../../../src/domain/learning-service'

const workspaces: string[] = []

afterEach(() => {
  while (workspaces.length > 0) {
    const workspace = workspaces.pop()
    if (workspace) {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  }
})

describe('LearningService', () => {
  test('creates, links, updates, and aggregates learning records', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-learning-service-'))
    workspaces.push(workspace)
    const service = new LearningService(workspace)

    const record = await service.upsert({
      kind: 'jd_gap_analysis',
      title: 'Platform JD gap review',
      summary: 'Need stronger distributed systems evidence.',
      tags: ['backend', 'platform'],
      links: {
        applicationId: 'application-1',
        jobId: 'job-1',
        taskId: 'run-gap-1',
        artifactPaths: ['output/resume.pdf'],
      },
      findings: [{
        title: 'Distributed systems gap',
        summary: 'Resume lacks recent production examples.',
        severity: 'critical',
        evidence: ['JD requires large-scale systems experience'],
      }],
      actionItems: [{
        summary: 'Add one distributed systems bullet',
        owner: 'user',
        linkedTaskId: 'run-gap-1',
      }],
      metrics: {
        gapCount: 3,
        hitRate: 42,
      },
    }, { source: 'agent', actor: 'review-agent' })

    expect(record.links).toMatchObject({
      applicationId: 'application-1',
      jobId: 'job-1',
      taskId: 'run-gap-1',
    })
    expect(record.findings[0]?.severity).toBe('critical')
    expect(record.actionItems[0]?.status).toBe('pending')

    const linked = await service.findLinked({ applicationId: 'application-1' })
    expect(linked.map((item) => item.id)).toEqual([record.id])

    const updated = await service.updateActionItem(
      record.id,
      record.actionItems[0]!.id,
      {
        status: 'done',
        note: 'Updated resume project section',
      },
      { source: 'manual', actor: 'web-server' }
    )
    expect(updated.actionItems[0]).toMatchObject({
      status: 'done',
      note: 'Updated resume project section',
    })

    await service.upsert({
      kind: 'improvement_plan',
      status: 'in_progress',
      title: 'Interview improvement plan',
      summary: 'Turn interview findings into concrete practice tasks.',
      tags: ['interview'],
      links: {
        taskId: 'run-interview-1',
      },
      actionItems: [{
        summary: 'Schedule one mock interview',
        owner: 'user',
        dueAt: '2026-03-30T00:00:00.000Z',
      }],
      metrics: {
        interviewScore: 68,
      },
    }, { source: 'agent', actor: 'review-agent' })

    const insights = await service.getInsights()
    expect(insights.ok).toBe(true)
    expect(insights.totals.records).toBe(2)
    expect(insights.totals.criticalFindings).toBe(1)
    expect(insights.byKind.jd_gap_analysis).toBe(1)
    expect(insights.byKind.improvement_plan).toBe(1)
    expect(insights.byStatus.in_progress).toBe(1)
    expect(insights.topTags).toEqual(expect.arrayContaining([
      expect.objectContaining({ tag: 'backend', count: 1 }),
    ]))
  })

  test('rejects blank record fields', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-learning-service-validation-'))
    workspaces.push(workspace)
    const service = new LearningService(workspace)

    await expect(
      service.upsert({
        kind: 'resume_review',
        title: '  ',
        summary: 'Missing title',
      }, { source: 'manual', actor: 'web-server' })
    ).rejects.toThrow('title is required')
  })
})
