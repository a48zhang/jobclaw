import { afterEach, describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArtifactStore } from '../../../src/memory/artifactStore'
import { ConversationStore } from '../../../src/memory/conversationStore'
import { DelegationStore } from '../../../src/memory/delegationStore'
import { InterventionStore } from '../../../src/memory/interventionStore'
import { SessionStore } from '../../../src/memory/sessionStore'
import type {
  AgentSession,
  ArtifactRecord,
  DelegatedRun,
  InterventionRecord,
} from '../../../src/runtime/contracts'
import { RuntimeTaskResultsService } from '../../../src/runtime/task-results-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const tempWorkspaces: string[] = []

afterEach(() => {
  while (tempWorkspaces.length > 0) {
    const workspace = tempWorkspaces.pop()
    if (workspace) {
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  }
})

describe('RuntimeTaskResultsService', () => {
  test('aggregates sessions, delegations, interventions, artifacts, and summary counts', async () => {
    const workspace = createWorkspace()
    const sessionStore = new SessionStore(workspace)
    const delegationStore = new DelegationStore(workspace)
    const interventionStore = new InterventionStore(workspace)
    const artifactStore = new ArtifactStore(workspace)
    const conversationStore = new ConversationStore(workspace)

    await sessionStore.save(session('main', {
      state: 'running',
      updatedAt: '2026-03-28T10:00:00.000Z',
      lastMessageAt: '2026-03-28T10:01:00.000Z',
    }))

    await delegationStore.save(delegation('run-failed', {
      profile: 'delivery',
      state: 'failed',
      instruction: 'Apply to Example Corp',
      updatedAt: '2026-03-28T10:02:00.000Z',
      error: 'Apply blocked by captcha',
    }))

    await delegationStore.save(delegation('run-done', {
      profile: 'resume',
      state: 'completed',
      instruction: 'Build tailored resume',
      updatedAt: '2026-03-28T10:03:00.000Z',
      resultSummary: 'Resume generated successfully',
    }))

    await interventionStore.save(intervention('ivr-main', {
      ownerType: 'session',
      ownerId: 'main',
      status: 'pending',
      prompt: 'Confirm target city',
      updatedAt: '2026-03-28T10:04:00.000Z',
    }))

    await interventionStore.save(intervention('ivr-timeout', {
      ownerType: 'delegated_run',
      ownerId: 'run-failed',
      status: 'timeout',
      prompt: 'Need ATS login code',
      updatedAt: '2026-03-28T10:05:00.000Z',
    }))

    await artifactStore.save(artifact('art-main', {
      name: 'resume.pdf',
      path: 'output/resume.pdf',
      createdAt: '2026-03-28T10:06:00.000Z',
      meta: { sessionId: 'main' },
    }))

    await artifactStore.save(artifact('art-run', {
      name: 'cover-letter.md',
      path: 'output/cover-letter.md',
      createdAt: '2026-03-28T10:07:00.000Z',
      meta: { delegatedRunId: 'run-failed' },
    }))

    await conversationStore.saveSnapshot('main', {
      summary: 'SYSTEM_SUMMARY: searched backend opportunities.',
      recentMessages: [
        { role: 'assistant', content: 'Waiting on city confirmation.', timestamp: '2026-03-28T10:01:00.000Z' },
      ],
      lastActivityAt: '2026-03-28T10:01:00.000Z',
    })

    await conversationStore.saveSnapshot('run-done', {
      summary: 'SYSTEM_SUMMARY: resume draft finalized.',
      recentMessages: [
        { role: 'assistant', content: 'Resume tailored for the JD.', timestamp: '2026-03-28T10:03:00.000Z' },
      ],
      lastActivityAt: '2026-03-28T10:03:00.000Z',
    })

    const service = new RuntimeTaskResultsService(workspace)
    const snapshot = await service.aggregate()

    expect(snapshot.tasks.map((task) => task.id)).toEqual(['run-failed', 'main', 'run-done'])

    const mainTask = snapshot.tasks.find((task) => task.id === 'main')
    expect(mainTask).toMatchObject({
      kind: 'session',
      lifecycle: 'waiting',
      status: 'requires_input',
      artifactCount: 1,
    })
    expect(mainTask?.summary).toContain('Waiting for input')
    expect(mainTask?.pendingIntervention?.prompt).toBe('Confirm target city')
    expect(mainTask?.latestArtifact?.id).toBe('art-main')

    const failedRun = snapshot.tasks.find((task) => task.id === 'run-failed')
    expect(failedRun).toMatchObject({
      kind: 'delegation',
      lifecycle: 'failed',
      status: 'failed',
      error: 'Apply blocked by captcha',
      artifactCount: 1,
    })
    expect(failedRun?.latestArtifact?.id).toBe('art-run')

    const completedRun = snapshot.tasks.find((task) => task.id === 'run-done')
    expect(completedRun).toMatchObject({
      kind: 'delegation',
      lifecycle: 'completed',
      resultSummary: 'Resume generated successfully',
    })

    expect(snapshot.resultSummary).toMatchObject({
      totalTasks: 3,
      sessionTasks: 1,
      delegatedTasks: 2,
      queuedTasks: 0,
      waitingTasks: 1,
      requiresInputTasks: 1,
      failedTasks: 1,
      completedTasks: 1,
      pendingInterventions: 1,
      recentFailures: 2,
      recentArtifacts: 2,
    })
  })

  test('builds recent failures from session, delegation, and intervention states', async () => {
    const workspace = createWorkspace()
    const sessionStore = new SessionStore(workspace)
    const delegationStore = new DelegationStore(workspace)
    const interventionStore = new InterventionStore(workspace)
    const conversationStore = new ConversationStore(workspace)

    await sessionStore.save(session('main', {
      state: 'error',
      updatedAt: '2026-03-28T09:00:00.000Z',
    }))
    await conversationStore.saveSnapshot('main', {
      summary: 'SYSTEM_SUMMARY: MCP call failed repeatedly.',
      recentMessages: [],
      lastActivityAt: '2026-03-28T09:00:00.000Z',
    })

    await delegationStore.save(delegation('run-cancelled', {
      state: 'cancelled',
      instruction: 'Retry employer portal',
      updatedAt: '2026-03-28T09:10:00.000Z',
      error: 'Runtime restarted before delegated run completed',
    }))

    await interventionStore.save(intervention('ivr-cancelled', {
      ownerType: 'delegated_run',
      ownerId: 'run-cancelled',
      status: 'cancelled',
      prompt: 'Need SMS code',
      updatedAt: '2026-03-28T09:15:00.000Z',
    }))

    const service = new RuntimeTaskResultsService(workspace)
    const failures = await service.listRecentFailures()

    expect(failures.map((failure) => failure.id)).toEqual(['ivr-cancelled', 'run-cancelled', 'main'])
    expect(failures[0]).toMatchObject({
      kind: 'intervention',
      ownerId: 'run-cancelled',
      state: 'cancelled',
    })
    expect(failures[1]).toMatchObject({
      kind: 'delegation',
      reason: 'Runtime restarted before delegated run completed',
    })
    expect(failures[2]).toMatchObject({
      kind: 'session',
      reason: 'SYSTEM_SUMMARY: MCP call failed repeatedly.',
    })
  })

  test('extracts artifact owner hints and supports result limits', async () => {
    const workspace = createWorkspace()
    const artifactStore = new ArtifactStore(workspace)

    await artifactStore.save(artifact('art-older', {
      name: 'jobs.csv',
      path: 'output/jobs.csv',
      createdAt: '2026-03-28T08:00:00.000Z',
      meta: { owner_id: 'main' },
    }))
    await artifactStore.save(artifact('art-newer', {
      name: 'resume.pdf',
      path: 'output/resume.pdf',
      createdAt: '2026-03-28T08:05:00.000Z',
      meta: { delegated_run_id: 'run-123', session_id: 'main' },
    }))

    const service = new RuntimeTaskResultsService(workspace)
    const artifacts = await service.listRecentArtifacts(1)

    expect(artifacts).toHaveLength(1)
    expect(artifacts[0]).toMatchObject({
      id: 'art-newer',
      relatedTaskIds: ['main', 'run-123'],
      ownerHints: {
        sessionId: 'main',
        delegatedRunId: 'run-123',
      },
    })
  })

  test('builds task detail with next actions, failures, interventions, and artifacts', async () => {
    const workspace = createWorkspace()
    const delegationStore = new DelegationStore(workspace)
    const interventionStore = new InterventionStore(workspace)
    const artifactStore = new ArtifactStore(workspace)

    await delegationStore.save(delegation('run-review', {
      profile: 'review',
      state: 'waiting_input',
      instruction: 'Review uploaded resume',
      updatedAt: '2026-03-28T11:00:00.000Z',
    }))

    await interventionStore.save(intervention('ivr-review', {
      ownerType: 'delegated_run',
      ownerId: 'run-review',
      status: 'pending',
      prompt: 'Need the target JD URL',
      updatedAt: '2026-03-28T11:01:00.000Z',
    }))

    await artifactStore.save(artifact('art-review', {
      name: 'resume-review.md',
      path: 'output/resume-review.md',
      createdAt: '2026-03-28T11:02:00.000Z',
      meta: { delegatedRunId: 'run-review' },
    }))

    const service = new RuntimeTaskResultsService(workspace)
    const detail = await service.getTaskDetail('delegation:run-review')

    expect(detail?.task).toMatchObject({
      id: 'run-review',
      status: 'requires_input',
    })
    expect(detail?.interventions.map((item) => item.id)).toEqual(['ivr-review'])
    expect(detail?.artifacts.map((item) => item.id)).toEqual(['art-review'])
    expect(detail?.nextActions[0]).toMatchObject({
      code: 'provide_input',
      label: 'Provide input',
    })
  })
})

function createWorkspace(): string {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `jobclaw-task-results-${path.basename(__dirname)}-`))
  tempWorkspaces.push(workspace)
  return workspace
}

function session(
  id: string,
  overrides: Partial<AgentSession> = {}
): AgentSession {
  return {
    id,
    agentName: id,
    profile: 'main',
    createdAt: '2026-03-28T09:00:00.000Z',
    updatedAt: '2026-03-28T09:00:00.000Z',
    state: 'idle',
    ...overrides,
  }
}

function delegation(
  id: string,
  overrides: Partial<DelegatedRun> = {}
): DelegatedRun {
  return {
    id,
    parentSessionId: 'main',
    profile: 'search',
    state: 'queued',
    instruction: `Instruction for ${id}`,
    createdAt: '2026-03-28T09:00:00.000Z',
    updatedAt: '2026-03-28T09:00:00.000Z',
    ...overrides,
  }
}

function intervention(
  id: string,
  overrides: Partial<InterventionRecord> = {}
): InterventionRecord {
  return {
    id,
    ownerType: 'session',
    ownerId: 'main',
    kind: 'text',
    prompt: `Prompt for ${id}`,
    status: 'pending',
    createdAt: '2026-03-28T09:00:00.000Z',
    updatedAt: '2026-03-28T09:00:00.000Z',
    ...overrides,
  }
}

function artifact(
  id: string,
  overrides: Partial<ArtifactRecord> = {}
): ArtifactRecord {
  return {
    id,
    name: `artifact-${id}`,
    type: 'generated',
    path: `output/${id}.txt`,
    createdAt: '2026-03-28T09:00:00.000Z',
    meta: {},
    ...overrides,
  }
}
