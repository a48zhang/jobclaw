import { JsonFileStore } from '../infra/store/json-store.js'
import { getConversationPath } from '../infra/workspace/paths.js'
import type { ConversationMemory } from './types.js'

export class ConversationStore {
  constructor(private workspaceRoot: string) {}

  private createStore(sessionId: string): JsonFileStore<ConversationMemory> {
    const path = getConversationPath(this.workspaceRoot, sessionId)
    return new JsonFileStore(path, this.defaultMemory(sessionId))
  }

  private defaultMemory(sessionId: string): ConversationMemory {
    return {
      sessionId,
      summary: '',
      recentMessages: [],
      lastActivityAt: new Date().toISOString(),
    }
  }

  async get(sessionId: string): Promise<ConversationMemory> {
    return this.createStore(sessionId).read()
  }

  async appendMessage(
    sessionId: string,
    msg: { role: 'user' | 'assistant'; content: string; timestamp?: string }
  ): Promise<ConversationMemory> {
    const timestamp = msg.timestamp ?? new Date().toISOString()
    return this.createStore(sessionId).mutate((current) => {
      const recentMessages = [...current.recentMessages, { role: msg.role, content: msg.content, timestamp }]
      return { ...current, recentMessages, lastActivityAt: timestamp }
    })
  }

  async updateSummary(sessionId: string, summary: string): Promise<ConversationMemory> {
    return this.createStore(sessionId).mutate((current) => ({
      ...current,
      summary,
      lastActivityAt: new Date().toISOString(),
    }))
  }
}
