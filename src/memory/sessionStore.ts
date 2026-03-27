import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { AgentSession } from '../runtime/contracts.js'
import { getSessionPath, ensureStateSubdir } from '../infra/workspace/paths.js'
import { JsonFileStore } from '../infra/store/json-store.js'

export class SessionStore {
  constructor(private workspaceRoot: string) {}

  private createStore(sessionId: string): JsonFileStore<AgentSession> {
    const filePath = getSessionPath(this.workspaceRoot, sessionId)
    return new JsonFileStore(filePath, this.defaultSession(sessionId))
  }

  private defaultSession(sessionId: string): AgentSession {
    const now = new Date().toISOString()
    return {
      id: sessionId,
      agentName: 'main',
      profile: 'main',
      createdAt: now,
      updatedAt: now,
      state: 'idle',
    }
  }

  async save(session: AgentSession): Promise<void> {
    await ensureStateSubdir(this.workspaceRoot, 'session')
    await this.createStore(session.id).write(session)
  }

  async get(sessionId: string): Promise<AgentSession | undefined> {
    const filePath = getSessionPath(this.workspaceRoot, sessionId)
    try {
      const data = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(data) as AgentSession
    } catch {
      return undefined
    }
  }

  async list(): Promise<AgentSession[]> {
    const dir = await ensureStateSubdir(this.workspaceRoot, 'session')
    const entries = await fs.readdir(dir)
    const sessions: AgentSession[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const raw = await fs.readFile(path.join(dir, entry), 'utf-8')
      try {
        sessions.push(JSON.parse(raw) as AgentSession)
      } catch {
        // skip invalid files
      }
    }
    return sessions
  }

  async update(sessionId: string, patch: Partial<AgentSession>): Promise<AgentSession> {
    const current = await this.get(sessionId)
    if (!current) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const next: AgentSession = {
      ...current,
      ...patch,
      id: current.id,
      updatedAt: patch.updatedAt ?? new Date().toISOString(),
    }
    await this.save(next)
    return next
  }
}
