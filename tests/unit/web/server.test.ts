// Web Server & EventBus unit tests — Phase 5 Team A
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { eventBus } from '../../../src/eventBus'
import type {
  AgentStatePayload,
  AgentLogPayload,
  InterventionRequiredPayload,
  InterventionResolvedPayload,
  JobUpdatedPayload,
} from '../../../src/eventBus'

// ─── EventBus tests ───────────────────────────────────────────────────────────

describe('EventBus', () => {
  test('TC-B-01: emit + on for agent:state', () => {
    const received: AgentStatePayload[] = []
    const handler = (p: AgentStatePayload) => received.push(p)
    eventBus.on('agent:state', handler)

    eventBus.emit('agent:state', { agentName: 'test', state: 'running' })

    expect(received).toHaveLength(1)
    expect(received[0]).toEqual({ agentName: 'test', state: 'running' })

    eventBus.off('agent:state', handler)
  })

  test('TC-B-02: emit + on for agent:log', () => {
    const received: AgentLogPayload[] = []
    const handler = (p: AgentLogPayload) => received.push(p)
    eventBus.on('agent:log', handler)

    const ts = new Date().toISOString()
    eventBus.emit('agent:log', { agentName: 'main', type: 'info', message: 'hello', timestamp: ts })

    expect(received).toHaveLength(1)
    expect(received[0].message).toBe('hello')
    expect(received[0].type).toBe('info')

    eventBus.off('agent:log', handler)
  })

  test('TC-B-03: emit + on for job:updated', () => {
    const received: JobUpdatedPayload[] = []
    const handler = (p: JobUpdatedPayload) => received.push(p)
    eventBus.on('job:updated', handler)

    eventBus.emit('job:updated', { company: 'Acme', title: 'SWE', status: 'applied' })

    expect(received).toHaveLength(1)
    expect(received[0].company).toBe('Acme')

    eventBus.off('job:updated', handler)
  })

  test('TC-B-04: emit + on for intervention:required', () => {
    const received: InterventionRequiredPayload[] = []
    const handler = (p: InterventionRequiredPayload) => received.push(p)
    eventBus.on('intervention:required', handler)

    eventBus.emit('intervention:required', { agentName: 'main', prompt: 'need help' })

    expect(received).toHaveLength(1)
    expect(received[0].prompt).toBe('need help')

    eventBus.off('intervention:required', handler)
  })

  test('TC-B-05: emit + on for intervention:resolved', () => {
    const received: InterventionResolvedPayload[] = []
    const handler = (p: InterventionResolvedPayload) => received.push(p)
    eventBus.on('intervention:resolved', handler)

    eventBus.emit('intervention:resolved', { agentName: 'main', input: 'user response' })

    expect(received).toHaveLength(1)
    expect(received[0].input).toBe('user response')

    eventBus.off('intervention:resolved', handler)
  })

  test('TC-B-06: off removes listener correctly', () => {
    const received: AgentStatePayload[] = []
    const handler = (p: AgentStatePayload) => received.push(p)
    eventBus.on('agent:state', handler)
    eventBus.off('agent:state', handler)

    eventBus.emit('agent:state', { agentName: 'x', state: 'idle' })

    expect(received).toHaveLength(0)
  })

  test('TC-B-07: multiple listeners all receive the event', () => {
    const c1: AgentStatePayload[] = []
    const c2: AgentStatePayload[] = []
    const h1 = (p: AgentStatePayload) => c1.push(p)
    const h2 = (p: AgentStatePayload) => c2.push(p)
    eventBus.on('agent:state', h1)
    eventBus.on('agent:state', h2)

    eventBus.emit('agent:state', { agentName: 'y', state: 'waiting' })

    expect(c1).toHaveLength(1)
    expect(c2).toHaveLength(1)

    eventBus.off('agent:state', h1)
    eventBus.off('agent:state', h2)
  })
})

// ─── BaseAgent eventBus integration tests ────────────────────────────────────

import { BaseAgent } from '../../../src/agents/base/agent'
import type { BaseAgentConfig } from '../../../src/agents/base/types'
import OpenAI from 'openai'
import { mock } from 'bun:test'
import type { Channel, ChannelMessage } from '../../../src/channel/base'

class TestAgent extends BaseAgent {
  protected get systemPrompt(): string {
    return 'test'
  }
}

const createMockOpenAI = () =>
  ({
    chat: {
      completions: {
        create: mock(() =>
          Promise.resolve({ choices: [{ message: { content: '回答', tool_calls: null } }] })
        ),
      },
    },
  }) as unknown as OpenAI

const TEST_WORKSPACE = path.resolve(import.meta.dir, '../../../workspace')

describe('BaseAgent eventBus integration', () => {
  test('TC-B-08: setState emits agent:state on eventBus', () => {
    const agent = new TestAgent({
      openai: createMockOpenAI(),
      agentName: 'test-state',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    const received: AgentStatePayload[] = []
    const handler = (p: AgentStatePayload) => received.push(p)
    eventBus.on('agent:state', handler)

    // Trigger setState via run() startup — we test it directly via the protected method
    // by casting to access it (TypeScript protected ≠ runtime private)
    ;(agent as unknown as { setState(s: string): void }).setState('running')

    expect(received.some((p) => p.agentName === 'test-state' && p.state === 'running')).toBe(true)

    eventBus.off('agent:state', handler)
  })

  test('TC-B-09: channel.send wrapped to emit agent:log', async () => {
    const logEvents: AgentLogPayload[] = []
    const handler = (p: AgentLogPayload) => logEvents.push(p)
    eventBus.on('agent:log', handler)

    const sentMessages: ChannelMessage[] = []
    const mockChannel: Channel = {
      send: async (m: ChannelMessage) => {
        sentMessages.push(m)
      },
    }

    const agent = new TestAgent({
      openai: createMockOpenAI(),
      agentName: 'test-channel',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
      channel: mockChannel,
    })

    // Access the wrapped channel via agent internals
    const wrappedChannel = (agent as unknown as { channel: Channel }).channel!
    await wrappedChannel.send({
      type: 'delivery_success',
      payload: { message: 'sent ok' },
      timestamp: new Date(),
    })

    // Original channel still received the message
    expect(sentMessages).toHaveLength(1)
    // eventBus received the log event
    const matchingLogs = logEvents.filter((l) => l.agentName === 'test-channel')
    expect(matchingLogs).toHaveLength(1)
    expect(matchingLogs[0].message).toContain('[delivery_success]')
    expect(matchingLogs[0].type).toBe('info')

    eventBus.off('agent:log', handler)
  })

  test('TC-B-10: channel error types mapped correctly', async () => {
    const logEvents: AgentLogPayload[] = []
    const handler = (p: AgentLogPayload) => logEvents.push(p)
    eventBus.on('agent:log', handler)

    const mockChannel: Channel = { send: async () => {} }
    const agent = new TestAgent({
      openai: createMockOpenAI(),
      agentName: 'test-types',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
      channel: mockChannel,
    })

    const wrappedChannel = (agent as unknown as { channel: Channel }).channel!

    await wrappedChannel.send({
      type: 'tool_error',
      payload: { message: 'oops' },
      timestamp: new Date(),
    })
    await wrappedChannel.send({
      type: 'tool_warn',
      payload: { message: 'watch out' },
      timestamp: new Date(),
    })

    const logs = logEvents.filter((l) => l.agentName === 'test-types')
    expect(logs[0].type).toBe('error')
    expect(logs[1].type).toBe('warn')

    eventBus.off('agent:log', handler)
  })

  test('TC-B-11: requestIntervention emits intervention:required', async () => {
    const required: InterventionRequiredPayload[] = []
    const handler = (p: InterventionRequiredPayload) => required.push(p)
    eventBus.on('intervention:required', handler)

    const agent = new TestAgent({
      openai: createMockOpenAI(),
      agentName: 'test-intervention',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    const interventionPromise = agent.requestIntervention('please help')

    expect(required.some((p) => p.agentName === 'test-intervention' && p.prompt === 'please help')).toBe(true)

    // Resolve via agent method to unblock
    agent.resolveIntervention('done')
    await interventionPromise

    eventBus.off('intervention:required', handler)
  })

  test('TC-B-12: requestIntervention resolves via intervention:resolved eventBus', async () => {
    const agent = new TestAgent({
      openai: createMockOpenAI(),
      agentName: 'test-bus-resolve',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    const interventionPromise = agent.requestIntervention('help needed')

    // Resolve via eventBus (simulating REST API)
    eventBus.emit('intervention:resolved', { agentName: 'test-bus-resolve', input: 'api-answer' })

    const result = await interventionPromise
    expect(result).toBe('api-answer')
  })

  test('TC-B-13: intervention:resolved with wrong agentName does not resolve', async () => {
    const agent = new TestAgent({
      openai: createMockOpenAI(),
      agentName: 'test-mismatch',
      model: 'gpt-4o',
      workspaceRoot: TEST_WORKSPACE,
    })

    const interventionPromise = agent.requestIntervention('help', 500 /* 500ms timeout */)

    // Emit for a different agent — should NOT resolve this agent
    eventBus.emit('intervention:resolved', { agentName: 'other-agent', input: 'wrong answer' })

    // Wait for timeout (100ms)
    const result = await interventionPromise
    // Should resolve with '' (timeout fallback)
    expect(result).toBe('')
  })
})

// ─── buildHonoApp (REST API) tests ────────────────────────────────────────────
// We test the Hono app in isolation by importing the internal builder if we can,
// or by testing the observable side effects (eventBus, file system).

describe('REST API route logic', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-test-'))
    fs.mkdirSync(path.join(tmpDir, 'data'), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test('TC-B-14: /api/jobs returns empty array when jobs.md is missing', async () => {
    // We test the parseJobsMd dependency directly (used in the route)
    const { parseJobsMd } = await import('../../../src/web/tui')
    const jobs = parseJobsMd('')
    expect(jobs).toEqual([])
  })

  test('TC-B-15: /api/jobs returns structured data from jobs.md', async () => {
    const { parseJobsMd } = await import('../../../src/web/tui')
    const md = [
      '| 公司 | 职位 | 链接 | 状态 | 时间 |',
      '| --- | --- | --- | --- | --- |',
      '| Acme | SWE | https://acme.com | applied | 2024-01-01 |',
    ].join('\n')

    const jobs = parseJobsMd(md)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].company).toBe('Acme')
    expect(jobs[0].status).toBe('applied')
  })

  test('TC-B-16: /api/config saves targets.md with lock/unlock', async () => {
    const { lockFile, unlockFile } = await import('../../../src/tools/lockFile')
    const filePath = 'data/targets.md'
    const holder = 'api-server'

    await lockFile(filePath, holder, tmpDir)
    fs.writeFileSync(path.join(tmpDir, filePath), '# test content', 'utf-8')
    await unlockFile(filePath, holder, tmpDir)

    const written = fs.readFileSync(path.join(tmpDir, filePath), 'utf-8')
    expect(written).toBe('# test content')

    // Lock should be released
    const lockPath = path.join(tmpDir, '.locks', 'data__targets.md.lock')
    expect(fs.existsSync(lockPath)).toBe(false)
  })

  test('TC-B-17: intervention:resolved is emitted by /api/intervention logic', () => {
    const resolved: InterventionResolvedPayload[] = []
    const handler = (p: InterventionResolvedPayload) => resolved.push(p)
    eventBus.on('intervention:resolved', handler)

    // Simulate what the route does
    const agentName = 'main'
    const input = 'test-input'
    eventBus.emit('intervention:resolved', { agentName, input })

    expect(resolved).toHaveLength(1)
    expect(resolved[0]).toEqual({ agentName, input })

    eventBus.off('intervention:resolved', handler)
  })

  test('TC-B-18: GET /api/stats returns zero counts when jobs.md is missing', async () => {
    const { buildHonoApp } = await import('../../../src/web/server')
    const app = buildHonoApp(tmpDir)
    const res = await app.fetch(new Request('http://localhost/api/stats'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ total: 0, byStatus: {} })
  })

  test('TC-B-19: GET /api/stats aggregates status counts from jobs.md', async () => {
    const { buildHonoApp } = await import('../../../src/web/server')
    const md = [
      '| 公司 | 职位 | 链接 | 状态 | 时间 |',
      '| --- | --- | --- | --- | --- |',
      '| Acme | SWE | https://acme.com | applied | 2024-01-01 |',
      '| Foo | PM | https://foo.com | applied | 2024-01-02 |',
      '| Bar | QA | https://bar.com | failed | 2024-01-03 |',
      '| Baz | Dev | https://baz.com | discovered | 2024-01-04 |',
    ].join('\n')
    fs.writeFileSync(path.join(tmpDir, 'data', 'jobs.md'), md, 'utf-8')

    const app = buildHonoApp(tmpDir)
    const res = await app.fetch(new Request('http://localhost/api/stats'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(4)
    expect(body.byStatus['applied']).toBe(2)
    expect(body.byStatus['failed']).toBe(1)
    expect(body.byStatus['discovered']).toBe(1)
  })

  test('TC-B-20: GET /api/config/targets.md returns file content', async () => {
    const { buildHonoApp } = await import('../../../src/web/server')
    fs.writeFileSync(path.join(tmpDir, 'data', 'targets.md'), '# targets', 'utf-8')

    const app = buildHonoApp(tmpDir)
    const res = await app.fetch(new Request('http://localhost/api/config/targets.md'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ content: '# targets' })
  })

  test('TC-B-21: GET /api/config/userinfo.md returns empty string when file is missing', async () => {
    const { buildHonoApp } = await import('../../../src/web/server')
    const app = buildHonoApp(tmpDir)
    const res = await app.fetch(new Request('http://localhost/api/config/userinfo.md'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ content: '' })
  })

  test('TC-B-22: GET /api/config/:name rejects disallowed filenames with 400', async () => {
    const { buildHonoApp } = await import('../../../src/web/server')
    const app = buildHonoApp(tmpDir)
    const res = await app.fetch(new Request('http://localhost/api/config/invalid.md'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBeDefined()
  })
})
