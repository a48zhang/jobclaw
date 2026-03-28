import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ApplicationService } from '../../../src/domain/application-service.js'

describe('ApplicationService', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jobclaw-application-service-'))
  })

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  })

  it('creates applications, adds timeline/reminders, and exposes summary counts', async () => {
    const service = new ApplicationService(workspaceRoot)
    const created = await service.upsert(
      {
        company: 'Acme',
        jobTitle: 'Backend Engineer',
        jobUrl: 'https://example.com/jobs/acme',
        status: 'applied',
        nextAction: {
          summary: 'Send recruiter follow-up',
          dueAt: '2026-04-01T00:00:00.000Z',
        },
        note: {
          body: 'Initial application submitted.',
        },
      },
      { source: 'manual', actor: 'web-server' }
    )

    expect(created.status).toBe('applied')
    expect(created.notes).toHaveLength(1)
    expect(created.timeline[0]?.type).toBe('created')

    const withReminder = await service.addReminder(
      created.id,
      { title: 'Follow up in one week', dueAt: '2026-04-02T00:00:00.000Z' },
      { source: 'manual', actor: 'web-server' }
    )
    expect(withReminder.reminders).toHaveLength(1)

    const completed = await service.completeReminder(
      created.id,
      withReminder.reminders[0].id,
      'completed',
      { source: 'manual', actor: 'web-server' }
    )
    expect(completed.reminders[0].status).toBe('completed')

    const summary = await service.getSummary()
    expect(summary.total).toBe(1)
    expect(summary.byStatus.applied).toBe(1)
    expect(summary.byCompany[0]).toEqual({ company: 'Acme', total: 1, active: 1 })
  })

  it('records rejection details through status updates', async () => {
    const service = new ApplicationService(workspaceRoot)
    const created = await service.upsert(
      {
        company: 'Beta',
        jobTitle: 'Platform Engineer',
      },
      { source: 'agent', actor: 'delivery-agent' }
    )

    const rejected = await service.updateStatus(
      created.id,
      'rejected',
      { source: 'manual', actor: 'web-server' },
      { rejectionReason: 'Position closed', rejectionNotes: 'Recruiter confirmed headcount freeze.' }
    )

    expect(rejected.rejection?.reason).toBe('Position closed')
    expect(rejected.timeline.at(-1)?.type).toBe('rejection_recorded')

    const recovered = await service.updateStatus(
      created.id,
      'interview',
      { source: 'manual', actor: 'web-server' }
    )

    expect(recovered.rejection).toBeUndefined()
    expect(recovered.status).toBe('interview')
  })

  it('fails when completing a reminder that does not exist', async () => {
    const service = new ApplicationService(workspaceRoot)
    const created = await service.upsert(
      {
        company: 'Gamma',
        jobTitle: 'Site Reliability Engineer',
      },
      { source: 'manual', actor: 'web-server' }
    )

    await expect(
      service.completeReminder(
        created.id,
        'missing-reminder',
        'completed',
        { source: 'manual', actor: 'web-server' }
      )
    ).rejects.toThrow('Reminder not found: missing-reminder')
  })

  it('links runtime tasks to applications and allows task-based lookup', async () => {
    const service = new ApplicationService(workspaceRoot)
    const created = await service.upsert(
      {
        company: 'Delta',
        jobTitle: 'Backend Engineer',
      },
      { source: 'manual', actor: 'web-server' }
    )

    const linked = await service.linkTask(
      created.id,
      {
        taskId: 'run-delivery-1',
        taskKind: 'delegation',
        role: 'delivery',
        note: 'Initial auto-apply run',
      },
      { source: 'agent', actor: 'delivery-agent' }
    )

    expect(linked.linkedTasks).toHaveLength(1)
    expect(linked.linkedTasks[0]).toMatchObject({
      taskId: 'run-delivery-1',
      taskKind: 'delegation',
      role: 'delivery',
    })
    expect(linked.timeline.at(-1)?.type).toBe('task_linked')

    const matches = await service.findByTaskId('run-delivery-1')
    expect(matches.map((item) => item.id)).toEqual([created.id])
  })

  it('rejects empty task ids when linking runtime tasks', async () => {
    const service = new ApplicationService(workspaceRoot)
    const created = await service.upsert(
      {
        company: 'Echo',
        jobTitle: 'Platform Engineer',
      },
      { source: 'manual', actor: 'web-server' }
    )

    await expect(
      service.linkTask(
        created.id,
        {
          taskId: '   ',
          taskKind: 'delegation',
        },
        { source: 'manual', actor: 'web-server' }
      )
    ).rejects.toThrow('taskId is required')
  })
})
