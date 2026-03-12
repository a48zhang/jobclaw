import { describe, expect, it, vi } from 'vitest'
import type OpenAI from 'openai'
import { ContextCompressor } from '../../../src/agents/base/context-compressor'
import { COMPRESS_THRESHOLD } from '../../../src/agents/base/constants'

describe('ContextCompressor', () => {
  const mockOpenAI = {
    chat: {
      completions: {
        create: vi.fn(async () => ({
          choices: [{ message: { content: 'Test summary' } }],
        })),
      },
    },
  } as unknown as OpenAI

  const config = {
    openai: mockOpenAI,
    lightModel: 'gpt-3.5-turbo',
    keepRecentMessages: 2,
  }

  const compressor = new ContextCompressor(config)

  describe('calculateTokens', () => {
    it('should calculate tokens for simple messages', () => {
      const messages = [
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Hello' },
      ]
      const tokenCount = compressor.calculateTokens(messages as any)
      // "You are a helper" -> ~4 tokens, "Hello" -> ~1 token, overhead -> 8 tokens
      expect(tokenCount).toBeGreaterThan(10)
    })

    it('should calculate tokens for tool calls', () => {
      const messages = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: 'get_weather', arguments: '{"location": "London"}' },
            },
          ],
        },
      ]
      const tokenCount = compressor.calculateTokens(messages as any)
      expect(tokenCount).toBeGreaterThan(10)
    })
  })

  describe('checkAndCompress', () => {
    it('should not compress if tokens are below threshold', async () => {
      const messages = [
        { role: 'system', content: 'You are a helper' },
        { role: 'user', content: 'Hello' },
      ]
      const result = await compressor.checkAndCompress(messages as any)
      expect(result).toEqual(messages as any)
    })

    it('should compress if tokens exceed threshold', async () => {
      const messages = [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'Long history 1' },
        { role: 'assistant', content: 'Long response 1' },
        { role: 'user', content: 'Long history 2' },
        { role: 'assistant', content: 'Long response 2' },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
      ]

      // Mock calculateTokens to return a value above threshold
      vi.spyOn(compressor, 'calculateTokens').mockReturnValue(COMPRESS_THRESHOLD + 100)

      const result = await compressor.checkAndCompress(messages as any)
      
      expect(result.length).toBeLessThan(messages.length)
      expect(result[0].role).toBe('system')
      expect(result[1].role).toBe('user')
      expect(result[1].content).toContain('SYSTEM_SUMMARY')
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalled()
    })
  })

  describe('compressMessages', () => {
    it('should keep system message and recent messages', async () => {
      const messages = [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'Message 1' },
        { role: 'assistant', content: 'Message 2' },
        { role: 'user', content: 'Recent 1' },
        { role: 'assistant', content: 'Recent 2' },
      ]
      
      // keepRecentMessages is set to 2 in config
      const result = await compressor.compressMessages(messages as any)
      
      expect(result.length).toBe(4) // System + Summary + Recent 1 + Recent 2
      expect(result[0].content).toBe('System message')
      expect(result[result.length - 1].content).toBe('Recent 2')
      expect(result[result.length - 2].content).toBe('Recent 1')
    })

    it('should return original messages if not enough messages to compress', async () => {
      const messages = [
        { role: 'system', content: 'System message' },
        { role: 'user', content: 'Recent 1' },
      ]
      
      const result = await compressor.compressMessages(messages as any)
      expect(result).toEqual(messages as any)
    })
  })
})
