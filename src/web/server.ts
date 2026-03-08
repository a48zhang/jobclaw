/**
 * Web API Server — Phase 5 Team A
 *
 * Exposes:
 *   WS  /ws                     — real-time event stream + agent snapshots
 *   GET  /api/jobs               — parsed jobs.md as JSON array
 *   GET  /api/stats              — aggregated job status counts
 *   GET  /api/config/:name       — read targets.md or userinfo.md
 *   POST /api/intervention       — resolve a pending HITL intervention
 *   POST /api/config/:name       — save targets.md or userinfo.md (with file lock)
 */
import { Hono } from 'hono'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus } from '../eventBus'
import type { EventBusMap } from '../eventBus'
import { parseJobsMd } from './tui'
import { lockFile, unlockFile } from '../tools/lockFile'
import type { BaseAgent } from '../agents/base/agent'

// ─── Minimal Bun runtime type stubs ──────────────────────────────────────────
// Bun is a global at runtime; declare only what we use here so tsc is happy.
declare const Bun: {
  serve(options: {
    port?: number
    fetch(
      req: Request,
      server: BunServerInstance
    ): Promise<Response | undefined> | Response | undefined
    websocket?: BunWebSocketHandlerDef
  }): BunServerInstance
}

interface BunServerInstance {
  port: number
  upgrade(req: Request, opts?: { data?: unknown }): boolean
}

interface BunWS {
  send(data: string | Uint8Array | ArrayBuffer): void
  close(code?: number, reason?: string): void
  readyState: 0 | 1 | 2 | 3
}

interface BunWebSocketHandlerDef {
  open?(ws: BunWS): void
  message?(ws: BunWS, message: string | ArrayBuffer): void
  close?(ws: BunWS, code: number, reason: string): void
}

// ─── Agent registry ───────────────────────────────────────────────────────────

const agentRegistry = new Map<string, BaseAgent>()

/**
 * Register an agent so its snapshot is included in the WS on-connect payload.
 * Call this from index.ts for each agent before starting the server.
 */
export function registerAgent(agent: BaseAgent): void {
  agentRegistry.set(agent.agentName, agent)
}

// ─── WebSocket client set ─────────────────────────────────────────────────────

const wsClients = new Set<BunWS>()

function broadcastEvent(type: string, payload: unknown): void {
  const msg = JSON.stringify({ type, data: payload })
  for (const ws of wsClients) {
    if (ws.readyState === 1 /* OPEN */) {
      ws.send(msg)
    }
  }
}

// Forward every eventBus event to all connected WebSocket clients
const BUS_EVENTS: (keyof EventBusMap)[] = [
  'agent:state',
  'agent:log',
  'job:updated',
  'intervention:required',
  'intervention:resolved',
]
for (const event of BUS_EVENTS) {
  eventBus.on(event, (payload) => broadcastEvent(event, payload))
}

// ─── Hono REST app ────────────────────────────────────────────────────────────

export function buildHonoApp(workspaceRoot: string): Hono {
  const app = new Hono()

  // ── GET /api/jobs ─────────────────────────────────────────────────────────
  app.get('/api/jobs', (c) => {
    const jobsPath = path.resolve(workspaceRoot, 'data/jobs.md')
    try {
      const content = fs.readFileSync(jobsPath, 'utf-8')
      return c.json(parseJobsMd(content))
    } catch {
      return c.json([])
    }
  })

  // ── GET /api/stats ────────────────────────────────────────────────────────
  app.get('/api/stats', (c) => {
    const jobsPath = path.resolve(workspaceRoot, 'data/jobs.md')
    try {
      const content = fs.readFileSync(jobsPath, 'utf-8')
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

  // ── GET /api/config/:name ─────────────────────────────────────────────────
  app.get('/api/config/:name', (c) => {
    const name = c.req.param('name')
    if (name !== 'targets.md' && name !== 'userinfo.md') {
      return c.json({ error: 'Only targets.md and userinfo.md are allowed' }, 400)
    }
    const filePath = path.resolve(workspaceRoot, `data/${name}`)
    try {
      const content = fs.readFileSync(filePath, 'utf-8')
      return c.json({ content })
    } catch {
      return c.json({ content: '' })
    }
  })

  // ── POST /api/intervention ────────────────────────────────────────────────
  app.post('/api/intervention', async (c) => {
    let body: { agentName?: string; input?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (typeof body.input !== 'string') {
      return c.json({ error: '"input" (string) is required' }, 400)
    }

    // Use the explicitly provided agentName, or fall back to the first registered agent
    const agentName =
      typeof body.agentName === 'string'
        ? body.agentName
        : ([...agentRegistry.keys()][0] ?? '')

    eventBus.emit('intervention:resolved', { agentName, input: body.input })
    return c.json({ ok: true })
  })

  // ── POST /api/config/:name ────────────────────────────────────────────────
  app.post('/api/config/:name', async (c) => {
    const name = c.req.param('name')
    if (name !== 'targets.md' && name !== 'userinfo.md') {
      return c.json({ error: 'Only targets.md and userinfo.md are allowed' }, 400)
    }

    let body: { content?: unknown }
    try {
      body = await c.req.json()
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400)
    }

    if (typeof body.content !== 'string') {
      return c.json({ error: '"content" (string) is required' }, 400)
    }

    const relPath = `data/${name}`
    const holder = 'api-server'

    try {
      await lockFile(relPath, holder, workspaceRoot)
      try {
        fs.writeFileSync(path.resolve(workspaceRoot, relPath), body.content, 'utf-8')
      } finally {
        await unlockFile(relPath, holder, workspaceRoot)
      }
      return c.json({ ok: true })
    } catch (err: unknown) {
      return c.json({ error: (err as Error).message }, 500)
    }
  })

  return app
}

// ─── Server startup ───────────────────────────────────────────────────────────

const DEFAULT_PORT = 3000

/**
 * Start the HTTP + WebSocket server.
 *
 * @param workspaceRoot  Absolute path to the workspace directory.
 * @param port           TCP port to listen on (default: 3000, or SERVER_PORT env var).
 */
export function startServer(workspaceRoot: string, port?: number): void {
  const listenPort = port ?? parseInt(process.env['SERVER_PORT'] ?? String(DEFAULT_PORT), 10)
  const app = buildHonoApp(workspaceRoot)

  Bun.serve({
    port: listenPort,
    fetch(req, server) {
      const url = new URL(req.url)
      if (url.pathname === '/ws') {
        // Let Bun handle the WebSocket upgrade; return undefined on success
        if (server.upgrade(req)) return undefined
        return new Response('WebSocket upgrade failed', { status: 426 })
      }
      return app.fetch(req)
    },
    websocket: {
      open(ws) {
        wsClients.add(ws)
        // Send a snapshot of all registered agents immediately on connect
        const snapshots = [...agentRegistry.values()].map((a) => a.getState())
        ws.send(JSON.stringify({ type: 'snapshot', data: snapshots }))
      },
      message(_ws, _msg) {
        // No client→server messages needed at this stage
      },
      close(ws) {
        wsClients.delete(ws)
      },
    },
  })

  console.log(`[JobClaw] API server listening on port ${listenPort}`)
}
