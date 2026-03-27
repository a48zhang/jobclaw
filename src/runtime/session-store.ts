import type { AgentSession, SessionStore } from './contracts.js'
import { SessionStore as MemorySessionStore } from '../memory/sessionStore.js'
import { nowIso } from './utils.js'

export class JsonSessionStore implements SessionStore {
  private readonly store: MemorySessionStore

  constructor(workspaceRoot: string) {
    this.store = new MemorySessionStore(workspaceRoot)
  }

  async get(sessionId: string): Promise<AgentSession | null> {
    return (await this.store.get(sessionId)) ?? null
  }

  async save(session: AgentSession): Promise<AgentSession> {
    const nextSession: AgentSession = {
      ...session,
      updatedAt: session.updatedAt || nowIso(),
    }

    await this.store.save(nextSession)
    return nextSession
  }

  async update(sessionId: string, patch: Partial<AgentSession>): Promise<AgentSession> {
    return this.store.update(sessionId, patch)
  }

  async list(): Promise<AgentSession[]> {
    const sessions = await this.store.list()
    return sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
}
