import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { WebSocketServer, WebSocket } from 'ws'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus } from '../eventBus.js'
import type { EventBusMap } from '../eventBus.js'
import { parseJobsMd } from './tui.js'
import { lockFile, unlockFile } from '../tools/lockFile.js'
import type { BaseAgent } from '../agents/base/agent.js'
import type { AgentFactory } from '../agents/factory.js'
import type { Config, ConfigStatus } from '../config.js'
import { getConfigStatus as readConfigStatus, readConfigFile, saveConfigFile } from '../config.js'

const agentRegistry = new Map<string, BaseAgent>()

export interface ServerRuntime {
  getMainAgent(): BaseAgent | undefined
  getFactory(): AgentFactory | undefined
  getConfigStatus(): ConfigStatus
  reloadFromConfig(): Promise<void>
}

export function registerAgent(agent: BaseAgent): void {
  agentRegistry.set(agent.agentName, agent)
}

export function clearAgentRegistry(): void {
  agentRegistry.clear()
}

export function clearAgentRegistryForTests(): void {
  clearAgentRegistry()
}

const wsClients = new Set<WebSocket>()
const JOBS_HEADER = '| 公司 | 职位 | 链接 | 状态 | 时间 |'
const JOBS_SEPARATOR = '| --- | --- | --- | --- | --- |'

interface JobMutationRow {
  company: string
  title: string
  url: string
  status: string
  time: string
}

function broadcast(type: string, data: unknown): void {
  const msg = JSON.stringify({ event: type, data })
  for (const ws of wsClients) {
    try {
      if (ws.readyState === 1) {
        ws.send(msg)
      }
    } catch {
      wsClients.delete(ws)
    }
  }
}

function ensureFileExists(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, '', 'utf-8')
  }
}

function ensureJobsFileExists(workspaceRoot: string): string {
  const jobsPath = path.resolve(workspaceRoot, 'data/jobs.md')
  const dir = path.dirname(jobsPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  if (!fs.existsSync(jobsPath)) {
    fs.writeFileSync(jobsPath, `${JOBS_HEADER}\n${JOBS_SEPARATOR}\n`, 'utf-8')
  }
  return jobsPath
}

function serializeJobsMd(rows: JobMutationRow[]): string {
  const lines = rows.map((row) => `| ${row.company} | ${row.title} | ${row.url} | ${row.status} | ${row.time} |`)
  return [JOBS_HEADER, JOBS_SEPARATOR, ...lines, ''].join('\n')
}

function readJobsRows(workspaceRoot: string): JobMutationRow[] {
  const jobsPath = ensureJobsFileExists(workspaceRoot)
  const content = fs.readFileSync(jobsPath, 'utf-8')
  return parseJobsMd(content)
}

const BUS_EVENTS: (keyof EventBusMap)[] = [
  'agent:state',
  'agent:log',
  'agent:stream',
  'agent:tool',
  'job:updated',
  'intervention:required',
  'intervention:resolved',
  'context:usage',
]
for (const event of BUS_EVENTS) {
  eventBus.on(event, (payload) => broadcast(event, payload))
}

function buildConfigPayload(workspaceRoot: string, status: ConfigStatus) {
  const stored = readConfigFile(workspaceRoot)
  return {
    ok: true,
    settings: {
      API_KEY: String(stored.API_KEY ?? ''),
      MODEL_ID: String(stored.MODEL_ID ?? ''),
      LIGHT_MODEL_ID: String(stored.LIGHT_MODEL_ID ?? ''),
      BASE_URL: String(stored.BASE_URL ?? ''),
      SERVER_PORT: status.config.SERVER_PORT,
    },
    status: {
      ready: status.ready,
      missingFields: status.missingFields,
    },
  }
}

function getUnavailableResponse(status: ConfigStatus) {
  return {
    ok: false,
    error: `基础配置未完成：缺少 ${status.missingFields.join(', ')}`,
    missingFields: status.missingFields,
  }
}

function isServerRuntime(value: unknown): value is ServerRuntime {
  return Boolean(value) && typeof (value as ServerRuntime).getConfigStatus === 'function'
}

export function createApp(workspaceRoot: string, runtimeOrFactory?: ServerRuntime | AgentFactory): Hono {
  const runtime: ServerRuntime = isServerRuntime(runtimeOrFactory)
    ? runtimeOrFactory
    : {
        getMainAgent: () => agentRegistry.get('main'),
        getFactory: () => runtimeOrFactory as AgentFactory | undefined,
        getConfigStatus: () => readConfigStatus(workspaceRoot),
        reloadFromConfig: async () => {},
      }

  const app = new Hono()
  const uploadedResumeRelPath = 'data/uploads/resume-upload.pdf'
  const uploadedResumeAbsPath = path.resolve(workspaceRoot, uploadedResumeRelPath)

  app.get('/api/settings', (c) => {
    const status = runtime.getConfigStatus()
    return c.json(buildConfigPayload(workspaceRoot, status))
  })

  app.post('/api/settings', async (c) => {
    try {
      const body = await c.req.json<Partial<Config>>()
      const updates: Partial<Config> = {
        API_KEY: typeof body.API_KEY === 'string' ? body.API_KEY.trim() : undefined,
        MODEL_ID: typeof body.MODEL_ID === 'string' ? body.MODEL_ID.trim() : undefined,
        LIGHT_MODEL_ID: typeof body.LIGHT_MODEL_ID === 'string' ? body.LIGHT_MODEL_ID.trim() : undefined,
        BASE_URL: typeof body.BASE_URL === 'string' ? body.BASE_URL.trim() : undefined,
        SERVER_PORT: body.SERVER_PORT,
      }

      saveConfigFile(workspaceRoot, updates)
      await runtime.reloadFromConfig()
      return c.json(buildConfigPayload(workspaceRoot, runtime.getConfigStatus()))
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/jobs', (c) => {
    try {
      const jobsPath = path.resolve(workspaceRoot, 'data/jobs.md')
      const content = fs.existsSync(jobsPath) ? fs.readFileSync(jobsPath, 'utf-8') : ''
      return c.json(parseJobsMd(content))
    } catch {
      return c.json([], 500)
    }
  })

  app.get('/api/stats', (c) => {
    try {
      const jobsPath = path.resolve(workspaceRoot, 'data/jobs.md')
      const content = fs.existsSync(jobsPath) ? fs.readFileSync(jobsPath, 'utf-8') : ''
      const jobs = parseJobsMd(content)
      const stats: Record<string, number> = {}
      for (const job of jobs) {
        const status = job.status || 'unknown'
        stats[status] = (stats[status] ?? 0) + 1
      }
      return c.json({ total: jobs.length, byStatus: stats })
    } catch {
      return c.json({ total: 0, byStatus: {} })
    }
  })

  app.post('/api/intervention', async (c) => {
    try {
      const body = await c.req.json<{ input?: string; agentName?: string; requestId?: string }>()
      const input = typeof body.input === 'string' ? body.input : ''
      const agentName = typeof body.agentName === 'string' ? body.agentName : ([...agentRegistry.keys()][0] ?? 'main')
      const requestId = typeof body.requestId === 'string' ? body.requestId : undefined
      eventBus.emit('intervention:resolved', { agentName, input, requestId })
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false, error: 'Invalid request' }, 400)
    }
  })

  app.get('/api/session/:agentName', (c) => {
    const agentName = c.req.param('agentName')
    const agent = agentRegistry.get(agentName)
    if (!agent) {
      return c.json({ ok: false, error: 'Agent not found' }, 404)
    }

    const history = agent.getMessages()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : '',
        toolCalls: (m as any).tool_calls?.map((tc: any) => ({
          name: tc.function?.name,
          args: tc.function?.arguments,
        })),
      }))

    return c.json({ ok: true, messages: history })
  })

  app.post('/api/chat', async (c) => {
    try {
      const status = runtime.getConfigStatus()
      if (!status.ready) {
        return c.json(getUnavailableResponse(status), 409)
      }

      const body = await c.req.json<{ message?: string }>()
      const message = typeof body.message === 'string' ? body.message : ''
      if (!message.trim()) return c.json({ ok: false, error: 'Empty message' }, 400)

      const mainAgent = runtime.getMainAgent()
      if (!mainAgent) return c.json({ ok: false, error: 'Main agent not found' }, 500)

      const result = mainAgent.submit(message)
      if (result.queued) {
        return c.json({ ok: true, queued: true, queueLength: result.queueLength })
      }
      return c.json({ ok: true, queued: false, message: result.message })
    } catch {
      return c.json({ ok: false, error: 'Invalid request' }, 400)
    }
  })

  app.post('/api/resume/build', async (c) => {
    const status = runtime.getConfigStatus()
    if (!status.ready) {
      return c.json(getUnavailableResponse(status), 409)
    }

    const mainAgent = runtime.getMainAgent()
    if (mainAgent) {
      mainAgent.submit('生成简历')
      return c.json({ ok: true })
    }

    const factory = runtime.getFactory()
    if (!factory) return c.json({ ok: false, error: 'Main agent not found' }, 500)

    const taskAgent = factory.createAgent({ persistent: false })
    taskAgent.run('生成简历').catch((err) => console.error('[Server] Resume build failed:', err))
    return c.json({ ok: true })
  })

  app.get('/api/resume/status', (c) => {
    try {
      const exists = fs.existsSync(path.resolve(workspaceRoot, 'output/resume.pdf'))
      const absolutePath = path.resolve(workspaceRoot, 'output/resume.pdf')
      const stats = exists ? fs.statSync(absolutePath) : null
      return c.json({
        ok: true,
        exists,
        path: '/workspace/output/resume.pdf',
        mtime: stats?.mtime.toISOString() ?? null,
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/resume/review', async (c) => {
    if (!fs.existsSync(uploadedResumeAbsPath)) {
      return c.json({ ok: false, error: 'Uploaded resume not found' }, 400)
    }

    const status = runtime.getConfigStatus()
    if (!status.ready) {
      return c.json(getUnavailableResponse(status), 409)
    }

    const prompt =
      '评价刚上传的简历。若 data/uploads/resume-upload.pdf 存在，请优先使用 read_pdf 读取内容，并严格按 resume-clinic skill 输出评价、问题分析、改写建议和可直接替换的表达。'

    const mainAgent = runtime.getMainAgent()
    if (mainAgent) {
      mainAgent.submit(prompt)
      return c.json({ ok: true, path: uploadedResumeRelPath })
    }

    const factory = runtime.getFactory()
    if (!factory) return c.json({ ok: false, error: 'Main agent not found' }, 500)

    const taskAgent = factory.createAgent({ persistent: false })
    taskAgent.run(prompt).catch((err) => console.error('[Server] Resume review failed:', err))
    return c.json({ ok: true, path: uploadedResumeRelPath })
  })

  app.post('/api/resume/upload', async (c) => {
    try {
      const formData = await c.req.formData()
      const file = formData.get('file')
      if (!(file instanceof File)) {
        return c.json({ ok: false, error: 'Missing file' }, 400)
      }
      if (file.size <= 0) {
        return c.json({ ok: false, error: 'Empty file' }, 400)
      }

      const fileName = file.name.toLowerCase()
      const isPdf = file.type === 'application/pdf' || fileName.endsWith('.pdf')
      if (!isPdf) {
        return c.json({ ok: false, error: 'Only PDF files are supported' }, 400)
      }

      const uploadDir = path.resolve(workspaceRoot, 'data/uploads')
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true })
      }
      if (!fs.existsSync(uploadedResumeAbsPath)) {
        fs.writeFileSync(uploadedResumeAbsPath, new Uint8Array())
      }

      await lockFile(uploadedResumeRelPath, 'web-server', workspaceRoot)
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        fs.writeFileSync(uploadedResumeAbsPath, bytes)
      } finally {
        await unlockFile(uploadedResumeRelPath, 'web-server', workspaceRoot)
      }

      return c.json({
        ok: true,
        path: uploadedResumeRelPath,
        name: file.name,
        size: file.size,
        type: file.type || 'application/pdf',
      })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/jobs/status', async (c) => {
    try {
      const body = await c.req.json<{ updates?: Array<{ url?: string; status?: string }> }>()
      const updates = Array.isArray(body.updates) ? body.updates : []
      const normalizedUpdates = updates
        .map((item) => ({
          url: typeof item.url === 'string' ? item.url.trim() : '',
          status: typeof item.status === 'string' ? item.status.trim() : '',
        }))
        .filter((item) => item.url && item.status)

      if (normalizedUpdates.length === 0) {
        return c.json({ ok: false, error: 'No valid updates provided' }, 400)
      }

      ensureJobsFileExists(workspaceRoot)
      await lockFile('data/jobs.md', 'web-server', workspaceRoot)
      try {
        const rows = readJobsRows(workspaceRoot)
        const statusByUrl = new Map(normalizedUpdates.map((item) => [item.url, item.status]))
        let changed = 0
        const nextRows = rows.map((row) => {
          const nextStatus = statusByUrl.get(row.url)
          if (!nextStatus || nextStatus === row.status) {
            return row
          }
          changed += 1
          return { ...row, status: nextStatus }
        })
        fs.writeFileSync(path.resolve(workspaceRoot, 'data/jobs.md'), serializeJobsMd(nextRows), 'utf-8')
        eventBus.emit('job:updated', { company: 'system', title: 'jobs', status: 'updated' })
        return c.json({ ok: true, changed, requested: normalizedUpdates.length, total: nextRows.length })
      } finally {
        await unlockFile('data/jobs.md', 'web-server', workspaceRoot)
      }
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/jobs/delete', async (c) => {
    try {
      const body = await c.req.json<{ urls?: string[] }>()
      const urls = Array.isArray(body.urls)
        ? body.urls.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
        : []

      if (urls.length === 0) {
        return c.json({ ok: false, error: 'No valid urls provided' }, 400)
      }

      ensureJobsFileExists(workspaceRoot)
      await lockFile('data/jobs.md', 'web-server', workspaceRoot)
      try {
        const rows = readJobsRows(workspaceRoot)
        const urlSet = new Set(urls)
        const nextRows = rows.filter((row) => !urlSet.has(row.url))
        const deleted = rows.length - nextRows.length
        fs.writeFileSync(path.resolve(workspaceRoot, 'data/jobs.md'), serializeJobsMd(nextRows), 'utf-8')
        eventBus.emit('job:updated', { company: 'system', title: 'jobs', status: 'updated' })
        return c.json({ ok: true, deleted, requested: urls.length, total: nextRows.length })
      } finally {
        await unlockFile('data/jobs.md', 'web-server', workspaceRoot)
      }
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/api/config/:name', (c) => {
    let name = c.req.param('name')
    if (!name.endsWith('.md')) name += '.md'
    if (name !== 'targets.md' && name !== 'userinfo.md' && name !== 'jobs.md') {
      return c.json({ ok: false, error: 'Unknown config name' }, 400)
    }
    const filePath = path.resolve(workspaceRoot, 'data', name)
    try {
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
      return c.json({ ok: true, content })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.post('/api/config/:name', async (c) => {
    let name = c.req.param('name')
    if (!name.endsWith('.md')) name += '.md'
    if (name !== 'targets.md' && name !== 'userinfo.md' && name !== 'jobs.md') {
      return c.json({ ok: false, error: 'Unknown config name' }, 400)
    }
    const relPath = `data/${name}`
    try {
      const body = await c.req.json<{ content?: string }>()
      const content = typeof body.content === 'string' ? body.content : ''
      const filePath = path.resolve(workspaceRoot, relPath)
      ensureFileExists(filePath)
      await lockFile(relPath, 'web-server', workspaceRoot)
      try {
        fs.writeFileSync(filePath, content, 'utf-8')
      } finally {
        await unlockFile(relPath, 'web-server', workspaceRoot)
      }
      if (name === 'jobs.md') {
        eventBus.emit('job:updated', { company: 'system', title: 'jobs', status: 'updated' })
      }
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  app.get('/workspace/output/*', async (c) => {
    const relativePath = c.req.path.replace(/^\/workspace\/output\//, '')
    const outputRoot = path.resolve(workspaceRoot, 'output')
    const filePath = path.resolve(outputRoot, relativePath)

    if (filePath !== outputRoot && !filePath.startsWith(`${outputRoot}${path.sep}`)) {
      return c.text('Forbidden', 403)
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return c.text('404 Not Found', 404)
    }

    return c.body(fs.readFileSync(filePath))
  })

  app.use('/*', serveStatic({ root: './public' }))

  return app
}

const DEFAULT_PORT = 3000

export function startServer(workspaceRoot: string, port: number | undefined, runtime: ServerRuntime): void {
  const listenPort = port ?? parseInt(process.env['SERVER_PORT'] ?? String(DEFAULT_PORT), 10)
  const app = createApp(workspaceRoot, runtime)
  const server = serve({ fetch: app.fetch, port: listenPort })

  const wss = new WebSocketServer({ noServer: true })
  wss.on('connection', (ws: WebSocket) => {
    wsClients.add(ws)
    const snapshots = [...agentRegistry.values()].map((a) => a.getState())
    ws.send(JSON.stringify({ event: 'snapshot', data: snapshots }))
    ws.on('close', () => {
      wsClients.delete(ws)
    })
  })

  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, req)
    })
  })

  console.log(`[JobClaw] API server listening on port ${listenPort}`)
}
