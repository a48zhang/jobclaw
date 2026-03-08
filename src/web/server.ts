/**
 * Web Server - Phase 5 Integration
 * Hono HTTP server + Bun WebSocket at /ws + REST APIs
 *
 * Combines Team A's logic (Typed EventBus, Agent Registry)
 * with Team C's architecture (Hono Middleware, Static Files).
 */
import { Hono } from 'hono'
import { upgradeWebSocket, websocket, serveStatic } from 'hono/bun'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus } from '../eventBus'
import type { EventBusMap } from '../eventBus'
import { parseJobsMd } from './tui'
import { lockFile, unlockFile } from '../tools/lockFile'
import type { BaseAgent } from '../agents/base/agent'

// ─── Agent registry ───────────────────────────────────────────────────────────

const agentRegistry = new Map<string, BaseAgent>()

/**
 * Register an agent so its snapshot is included in the WS on-connect payload.
 * Call this from index.ts for each agent before starting the server.
 */
export function registerAgent(agent: BaseAgent): void {
  agentRegistry.set(agent.agentName, agent)
}

// ─── WebSocket client registry ───────────────────────────────────────────────

/** WebSocket OPEN ready state */
const WS_OPEN = 1

/** Active WebSocket connections */
const wsClients = new Set<any>()

/** Broadcast a JSON message to all connected WebSocket clients */
function broadcast(type: string, data: unknown): void {
  const msg = JSON.stringify({ event: type, data })
  for (const ws of wsClients) {
    try {
      if (ws.readyState === WS_OPEN) {
        ws.send(msg)
      }
    } catch {
      wsClients.delete(ws)
    }
  }
}

/** Forward all eventBus events to WebSocket clients */
const BUS_EVENTS: (keyof EventBusMap)[] = [
  'agent:state',
  'agent:log',
  'job:updated',
  'intervention:required',
  'intervention:resolved',
]
for (const event of BUS_EVENTS) {
  eventBus.on(event, (payload) => broadcast(event, payload))
}

// ─── Hono app factory ─────────────────────────────────────────────────────────

export function createApp(workspaceRoot: string): Hono {
  const app = new Hono()

  // ── WebSocket endpoint (/ws) ──────────────────────────────────────────────
  app.get(
    '/ws',
    upgradeWebSocket((_c) => ({
      onOpen: (_event, ws) => {
        wsClients.add(ws)
        // Send a snapshot of all registered agents immediately on connect
        const snapshots = [...agentRegistry.values()].map((a) => a.getState())
        ws.send(JSON.stringify({ event: 'snapshot', data: snapshots }))
      },
      onClose: (_event, ws) => {
        wsClients.delete(ws)
      },
    }))
  )

  // ── REST: GET /api/jobs ───────────────────────────────────────────────────
  app.get('/api/jobs', (c) => {
    try {
      const jobsPath = path.resolve(workspaceRoot, 'data/jobs.md')
      const content = fs.existsSync(jobsPath) ? fs.readFileSync(jobsPath, 'utf-8') : ''
      return c.json(parseJobsMd(content))
    } catch {
      return c.json([], 500)
    }
  })

  // ── REST: GET /api/stats ──────────────────────────────────────────────────
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

  // ── REST: POST /api/intervention ─────────────────────────────────────────
  app.post('/api/intervention', async (c) => {
    try {
      const body = await c.req.json<{ input?: string; agentName?: string }>()
      const input = typeof body.input === 'string' ? body.input : ''
      const agentName = typeof body.agentName === 'string' ? body.agentName : ([...agentRegistry.keys()][0] ?? 'main')
      eventBus.emit('intervention:resolved', { agentName, input })
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false, error: 'Invalid request' }, 400)
    }
  })

  // ── REST: POST /api/chat ─────────────────────────────────────────────────
  app.post('/api/chat', async (c) => {
    try {
      const body = await c.req.json<{ message?: string }>()
      const message = typeof body.message === 'string' ? body.message : ''
      if (!message.trim()) return c.json({ ok: false, error: 'Empty message' }, 400)
      
      const mainAgent = agentRegistry.get('main')
      if (!mainAgent) return c.json({ ok: false, error: 'Main agent not found' }, 500)
      
      mainAgent.runEphemeral(message).catch(err => console.error('[Server] Chat task failed:', err))
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false, error: 'Invalid request' }, 400)
    }
  })

  // ── REST: POST /api/resume/build ─────────────────────────────────────────
  app.post('/api/resume/build', async (c) => {
    const mainAgent = agentRegistry.get('main')
    if (!mainAgent) return c.json({ ok: false, error: 'Main agent not found' }, 500)
    // Trigger resume build via ephemeral run
    mainAgent.runEphemeral('生成简历').catch(err => console.error('[Server] Resume build failed:', err))
    return c.json({ ok: true })
  })

  // ── REST: GET /api/config/:name ───────────────────────────────────────────
  app.get('/api/config/:name', (c) => {
    let name = c.req.param('name')
    if (!name.endsWith('.md')) name += '.md'
    if (name !== 'targets.md' && name !== 'userinfo.md') {
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

  // ── REST: POST /api/config/:name ─────────────────────────────────────────
  app.post('/api/config/:name', async (c) => {
    let name = c.req.param('name')
    if (!name.endsWith('.md')) name += '.md'
    if (name !== 'targets.md' && name !== 'userinfo.md') {
      return c.json({ ok: false, error: 'Unknown config name' }, 400)
    }
    const relPath = `data/${name}`
    try {
      const body = await c.req.json<{ content?: string }>()
      const content = typeof body.content === 'string' ? body.content : ''
      await lockFile(relPath, 'web-server', workspaceRoot)
      try {
        const filePath = path.resolve(workspaceRoot, relPath)
        fs.writeFileSync(filePath, content, 'utf-8')
      } finally {
        await unlockFile(relPath, 'web-server', workspaceRoot)
      }
      return c.json({ ok: true })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  // ── Serve static files from public/ ──────────────────────────────────────
  app.use('/*', serveStatic({ root: './public' }))
  
  // ── Serve workspace/output/ for resume PDFs ─────────────────────────────
  app.use('/workspace/output/*', serveStatic({
    root: './',
    rewriteRequestPath: (path) => path.replace(/^\/workspace/, '/workspace')
  }))

  return app
}

// ─── Server startup ────────────────────────────────────────────────────────

const DEFAULT_PORT = 3000

export function startServer(workspaceRoot: string, port?: number): void {
  const listenPort = port ?? parseInt(process.env['SERVER_PORT'] ?? String(DEFAULT_PORT), 10)
  const app = createApp(workspaceRoot)

  Bun.serve({
    port: listenPort,
    fetch: app.fetch,
    websocket,
  })

  console.log(`[JobClaw] API server listening on port ${listenPort}`)
}
