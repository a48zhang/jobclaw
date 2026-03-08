/**
 * Web Server - Phase 5 Team A
 * Hono HTTP server + Bun WebSocket at /ws + REST APIs
 */
import { Hono } from 'hono'
import { upgradeWebSocket, websocket, serveStatic } from 'hono/bun'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { eventBus } from '../eventBus'
import type {
  AgentStateEvent,
  AgentLogEvent,
  JobUpdatedEvent,
  InterventionRequiredEvent,
  InterventionResolvedEvent,
} from '../eventBus'
import { parseJobsMd } from './tui'
import { lockFile, unlockFile } from '../tools/lockFile'
import type { WSContext } from 'hono/ws'

// ─── WebSocket client registry ───────────────────────────────────────────────

/** WebSocket OPEN ready state */
const WS_OPEN = 1

/** Active WebSocket connections */
const wsClients = new Set<WSContext>()

/** Most recent state per agent (used for snapshot on connect) */
const agentStateSnapshot = new Map<string, AgentStateEvent>()

/** Broadcast a JSON message to all connected WebSocket clients */
function broadcast(event: string, data: unknown): void {
  const msg = JSON.stringify({ event, data })
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

/** Forward all eventBus events to WebSocket clients (called once) */
let eventBusWired = false
function wireEventBus(): void {
  if (eventBusWired) return
  eventBusWired = true

  eventBus.on('agent:state', (payload: AgentStateEvent) => {
    agentStateSnapshot.set(payload.agentName, payload)
    broadcast('agent:state', payload)
  })
  eventBus.on('agent:log', (payload: AgentLogEvent) => {
    broadcast('agent:log', payload)
  })
  eventBus.on('job:updated', (payload: JobUpdatedEvent) => {
    broadcast('job:updated', payload)
  })
  eventBus.on('intervention:required', (payload: InterventionRequiredEvent) => {
    broadcast('intervention:required', payload)
  })
  eventBus.on('intervention:resolved', (payload: InterventionResolvedEvent) => {
    broadcast('intervention:resolved', payload)
  })
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
        // Send current agent state snapshot to newly connected client
        const snapshot = Array.from(agentStateSnapshot.values())
        ws.send(JSON.stringify({ event: 'snapshot', data: snapshot }))
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

  // ── REST: POST /api/intervention ─────────────────────────────────────────
  app.post('/api/intervention', async (c) => {
    try {
      const body = await c.req.json<{ input?: string; agentName?: string }>()
      const input = typeof body.input === 'string' ? body.input : ''
      const agentName = typeof body.agentName === 'string' ? body.agentName : 'main'
      eventBus.emit('intervention:resolved', { agentName, input })
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false, error: 'Invalid request' }, 400)
    }
  })

  // ── REST: GET /api/config/:name ───────────────────────────────────────────
  app.get('/api/config/:name', (c) => {
    const { name } = c.req.param()
    if (name !== 'targets' && name !== 'userinfo') {
      return c.json({ ok: false, error: 'Unknown config name' }, 400)
    }
    const filePath = path.resolve(workspaceRoot, `${name}.md`)
    try {
      const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''
      return c.json({ ok: true, content })
    } catch (err) {
      return c.json({ ok: false, error: (err as Error).message }, 500)
    }
  })

  // ── REST: POST /api/config/:name ─────────────────────────────────────────
  app.post('/api/config/:name', async (c) => {
    const { name } = c.req.param()
    if (name !== 'targets' && name !== 'userinfo') {
      return c.json({ ok: false, error: 'Unknown config name' }, 400)
    }
    const relPath = `${name}.md`
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

  return app
}

// ─── Server startup ────────────────────────────────────────────────────────

const DEFAULT_PORT = 3000

export function startServer(workspaceRoot: string, port = DEFAULT_PORT): Bun.Server {
  wireEventBus()
  const app = createApp(workspaceRoot)

  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket,
  })

  return server
}
