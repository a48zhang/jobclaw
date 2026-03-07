/** 上下文压缩模块 */
import type OpenAI from 'openai'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import { encode } from 'gpt-tokenizer'
import { COMPRESS_THRESHOLD, DEFAULT_KEEP_RECENT_MESSAGES } from './constants'
import type { ContextCompressorConfig } from './types'

/** 上下文压缩器 - 计算 token 数并在超过阈值时压缩消息历史 */
export class ContextCompressor {
  protected openai: OpenAI
  protected summaryModel: string
  protected keepRecentMessages: number

  constructor(config: ContextCompressorConfig) {
    this.openai = config.openai
    this.summaryModel = config.summaryModel
    this.keepRecentMessages = config.keepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES
  }

  /** 计算消息列表的 token 数 */
  calculateTokens(messages: ChatCompletionMessageParam[]): number {
    let total = 0

    for (const msg of messages) {
      total += 4 // role + content 格式开销

      if (typeof msg.content === 'string') {
        total += encode(msg.content).length
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            total += encode(part.text).length
          }
        }
      }

      if ('tool_calls' in msg && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          total += encode(tc.function.name).length
          total += encode(tc.function.arguments).length
        }
      }

      if ('tool_call_id' in msg && msg.tool_call_id) {
        total += encode(msg.tool_call_id).length
      }
    }

    return total
  }

  /** 检查并执行压缩，超过阈值时压缩消息历史 */
  async checkAndCompress(messages: ChatCompletionMessageParam[]): Promise<ChatCompletionMessageParam[]> {
    const tokenCount = this.calculateTokens(messages)

    if (tokenCount < COMPRESS_THRESHOLD) {
      return messages
    }

    console.log(
      `[ContextCompressor] Token 数 (${tokenCount}) 超过阈值 (${COMPRESS_THRESHOLD})，触发压缩`
    )

    return this.compressMessages(messages)
  }

  async compressMessages(messages: ChatCompletionMessageParam[]): Promise<ChatCompletionMessageParam[]> {
    if (messages.length <= this.keepRecentMessages + 1) {
      return messages
    }

    const systemMessage = messages.find((m) => m.role === 'system')
    if (!systemMessage) {
      return messages
    }

    const endIndex = messages.length - this.keepRecentMessages
    const middleMessages = messages.slice(1, endIndex)

    if (middleMessages.length === 0) {
      return messages
    }

    const summary = await this.generateSummary(middleMessages)
    const recentMessages = messages.slice(-this.keepRecentMessages)

    const compressedMessages: ChatCompletionMessageParam[] = [
      systemMessage,
      { role: 'user', content: `SYSTEM_SUMMARY: ${summary}` },
      ...recentMessages,
    ]

    console.log(
      `[ContextCompressor] 压缩完成，消息数: ${compressedMessages.length}, tokens: ${this.calculateTokens(compressedMessages)}`
    )

    return compressedMessages
  }

  protected async generateSummary(messages: ChatCompletionMessageParam[]): Promise<string> {
    const summaryPrompt = `请对以下对话历史生成一个简洁的摘要，包含：
1. 已完成的主要任务
2. 当前已知的重要事实和信息
3. 未完成或待办的事项

对话历史：
${this.formatMessagesForSummary(messages)}

请生成摘要（不超过 500 字）：`

    try {
      const response = await this.openai.chat.completions.create({
        model: this.summaryModel,
        messages: [{ role: 'user', content: summaryPrompt }],
        temperature: 0.3,
        max_tokens: 1000,
      })

      return response.choices[0]?.message?.content ?? '无法生成摘要'
    } catch (error) {
      console.error('生成摘要失败:', error)
      return '摘要生成失败，已丢弃部分历史消息。'
    }
  }

  protected formatMessagesForSummary(messages: ChatCompletionMessageParam[]): string {
    const lines: string[] = []

    for (const msg of messages) {
      const role = msg.role.toUpperCase()
      let content = ''

      if (typeof msg.content === 'string') {
        content = msg.content
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((p) => p.type === 'text')
          .map((p) => (p as { type: 'text'; text: string }).text)
          .join('\n')
      }

      if (content.length > 500) {
        content = content.slice(0, 500) + '...'
      }

      lines.push(`[${role}] ${content}`)

      if ('tool_calls' in msg && msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          lines.push(`  [TOOL_CALL] ${tc.function.name}(${tc.function.arguments.slice(0, 100)}...)`)
        }
      }
    }

    return lines.join('\n')
  }
}