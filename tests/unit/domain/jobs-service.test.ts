import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { JobsService } from '../../../src/domain/jobs-service.js'
import { getJobsStatePath, getJobsDataPath } from '../../../src/infra/workspace/paths.js'

describe('JobsService', () => {
  let workspaceRoot: string

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jobclaw-jobs-service-'))
  })

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true })
  })

  it('tracks agent writes and later manual status updates with traceability metadata', async () => {
    const service = new JobsService(workspaceRoot, 'jobs-service-test')

    const added = await service.upsert(
      {
        company: 'Acme',
        title: 'Backend Engineer',
        url: 'https://example.com/jobs/acme-backend',
        status: 'discovered',
      },
      {
        lockHolder: 'search-agent',
        mutation: {
          source: 'agent',
          actor: 'search-agent',
        },
      }
    )

    expect(added.action).toBe('added')
    expect(added.record?.trace?.revision).toBe(1)
    expect(added.record?.trace?.created.source).toBe('agent')
    expect(added.record?.trace?.created.actor).toBe('search-agent')
    expect(added.record?.trace?.lastUpdated.operation).toBe('created')

    const updated = await service.updateStatuses(
      [{ url: 'https://example.com/jobs/acme-backend', status: 'applied' }],
      {
        lockHolder: 'web-server',
        mutation: {
          source: 'manual',
          actor: 'web-server',
          reason: 'user-bulk-status',
        },
      }
    )

    expect(updated.changed).toBe(1)
    expect(updated.updatedRecords).toHaveLength(1)
    expect(updated.updatedRecords[0].trace?.revision).toBe(2)
    expect(updated.updatedRecords[0].trace?.created.source).toBe('agent')
    expect(updated.updatedRecords[0].trace?.lastUpdated.source).toBe('manual')
    expect(updated.updatedRecords[0].trace?.lastUpdated.actor).toBe('web-server')
    expect(updated.updatedRecords[0].trace?.lastUpdated.operation).toBe('status_updated')
    expect(updated.updatedRecords[0].trace?.lastUpdated.reason).toBe('user-bulk-status')

    const rows = await service.listRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].status).toBe('applied')
    expect(rows[0].updatedAt).toBe(updated.updatedRecords[0].updatedAt)
    expect(rows[0].trace?.lastUpdated.source).toBe('manual')

    const persisted = JSON.parse(await fs.readFile(getJobsStatePath(workspaceRoot), 'utf-8')) as Array<{
      trace?: { revision: number; lastUpdated: { source: string; actor: string } }
    }>
    expect(persisted[0].trace?.revision).toBe(2)
    expect(persisted[0].trace?.lastUpdated.source).toBe('manual')
    expect(persisted[0].trace?.lastUpdated.actor).toBe('web-server')
  })

  it('uses system traceability by default and preserves creator trace on manual markdown import', async () => {
    const service = new JobsService(workspaceRoot, 'jobs-service-test')

    const imported = await service.importMarkdown(
      [
        '| 公司 | 职位 | 链接 | 状态 | 时间 |',
        '| --- | --- | --- | --- | --- |',
        '| Acme | Platform Engineer | https://example.com/jobs/acme-platform | discovered | 2026-03-28 |',
        '',
      ].join('\n')
    )

    expect(imported.records).toHaveLength(1)
    expect(imported.records[0].trace?.created.source).toBe('system')
    expect(imported.records[0].trace?.created.actor).toBe('jobs-service-test')
    expect(imported.records[0].trace?.lastUpdated.operation).toBe('imported')

    const merged = await service.importMarkdown(
      [
        '| 公司 | 职位 | 链接 | 状态 | 时间 |',
        '| --- | --- | --- | --- | --- |',
        '| Acme | Senior Platform Engineer | https://example.com/jobs/acme-platform | favorite | 2026-03-29 |',
        '| Beta | Frontend Engineer | https://example.com/jobs/beta-frontend | discovered | 2026-03-29 |',
        '',
      ].join('\n'),
      {
        lockHolder: 'web-server',
        mode: 'merge',
        mutation: {
          source: 'manual',
          actor: 'web-server',
        },
      }
    )

    expect(merged.records).toHaveLength(2)

    const acme = merged.records.find((record) => record.url === 'https://example.com/jobs/acme-platform')
    const beta = merged.records.find((record) => record.url === 'https://example.com/jobs/beta-frontend')
    expect(acme?.trace?.revision).toBe(2)
    expect(acme?.trace?.created.source).toBe('system')
    expect(acme?.trace?.lastUpdated.source).toBe('manual')
    expect(acme?.trace?.lastUpdated.operation).toBe('imported')
    expect(beta?.trace?.created.source).toBe('manual')
    expect(beta?.trace?.lastUpdated.actor).toBe('web-server')
  })

  it('rolls back state and markdown when export fails after a mutation write', async () => {
    const service = new JobsService(workspaceRoot, 'jobs-service-test')

    await service.upsert(
      {
        company: 'Acme',
        title: 'Backend Engineer',
        url: 'https://example.com/jobs/acme-backend',
        status: 'discovered',
      },
      {
        lockHolder: 'search-agent',
        mutation: {
          source: 'agent',
          actor: 'search-agent',
        },
      }
    )

    const beforeState = await fs.readFile(getJobsStatePath(workspaceRoot), 'utf-8')
    const beforeMarkdown = await fs.readFile(getJobsDataPath(workspaceRoot), 'utf-8')
    const exportSpy = vi
      .spyOn((service as any).store, 'exportToMarkdown')
      .mockRejectedValueOnce(new Error('export failed'))

    await expect(
      service.upsert(
        {
          company: 'Beta',
          title: 'Frontend Engineer',
          url: 'https://example.com/jobs/beta-frontend',
          status: 'discovered',
        },
        {
          lockHolder: 'search-agent',
          mutation: {
            source: 'agent',
            actor: 'search-agent',
          },
        }
      )
    ).rejects.toThrow('export failed')

    exportSpy.mockRestore()

    const afterState = await fs.readFile(getJobsStatePath(workspaceRoot), 'utf-8')
    const afterMarkdown = await fs.readFile(getJobsDataPath(workspaceRoot), 'utf-8')

    expect(afterState).toBe(beforeState)
    expect(afterMarkdown).toBe(beforeMarkdown)

    const records = await service.listRows()
    expect(records).toHaveLength(1)
    expect(records[0].url).toBe('https://example.com/jobs/acme-backend')
  })
})
