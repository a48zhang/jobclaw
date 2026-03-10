import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { initMessages, getSessionPath, loadSession, saveSession } from '../../../src/agents/base/agent-utils'

describe('agent-utils', () => {
  describe('initMessages', () => {
    it('should initialize messages with system and user prompt when empty', () => {
      const messages: any[] = []
      const result = initMessages(messages, 'system-p', 'user-i')
      expect(result).toHaveLength(2)
      expect(result[0].role).toBe('system')
      expect(result[0].content).toBe('system-p')
      expect(result[1].role).toBe('user')
      expect(result[1].content).toBe('user-i')
    })

    it('should add system prompt if missing at start', () => {
      const messages: any[] = [{ role: 'user', content: 'existing' }]
      const result = initMessages(messages, 'system-p', 'new-user-i')
      expect(result[0].role).toBe('system')
      expect(result[result.length - 1].content).toBe('new-user-i')
    })

    it('should not add system prompt if already present', () => {
      const messages: any[] = [{ role: 'system', content: 'old-system' }]
      const result = initMessages(messages, 'system-p', 'user-i')
      expect(result[0].content).toBe('old-system')
      expect(result).toHaveLength(2)
    })
  })

  describe('Session persistence', () => {
    let tempDir: string
    let sessionPath: string

    beforeEach(async () => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-utils-test-'))
      sessionPath = getSessionPath(tempDir, 'test-agent')
    })

    afterEach(async () => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('should save and load session correctly', () => {
      const session = {
        agentName: 'test-agent',
        messages: [{ role: 'user' as const, content: 'test' }],
        iterations: 5,
        tokenCount: 100,
        lastAction: 'test',
        currentTask: null
      }

      saveSession(sessionPath, session)
      expect(fs.existsSync(sessionPath)).toBe(true)

      const loaded = loadSession(sessionPath)
      expect(loaded).toEqual(session)
    })

    it('should return null if session file does not exist', () => {
      const loaded = loadSession(path.join(tempDir, 'non-existent.json'))
      expect(loaded).toBeNull()
    })
  })
})
