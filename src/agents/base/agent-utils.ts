import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Session } from '../../types'
import type { Channel, ChannelMessage } from '../../channel/base'
import { eventBus } from '../../eventBus'

/** Channel 消息类型 → 日志级别映射 */
export const CHANNEL_LOG_TYPE_MAP: Record<string, 'info' | 'warn' | 'error'> = {
  delivery_failed: 'error',
  tool_error: 'error',
  delivery_blocked: 'warn',
  tool_warn: 'warn',
}

/**
 * 将 Channel 包装为同步 emit agent:log 的版本
 */
export function wrapChannel(channel: Channel, agentName: string): Channel {
  return {
    send: async (message: ChannelMessage): Promise<void> => {
      const type: 'info' | 'warn' | 'error' = CHANNEL_LOG_TYPE_MAP[message.type] ?? 'info'
      const text =
        typeof message.payload['message'] === 'string'
          ? `[${message.type}] ${message.payload['message']}`
          : `[${message.type}]`
      eventBus.emit('agent:log', {
        agentName,
        type,
        message: text,
        timestamp: new Date().toISOString(),
      })
      return channel.send(message)
    },
  }
}

/**
 * 获取会话路径
 */
export function getSessionPath(workspaceRoot: string, agentName: string): string {
  return path.resolve(workspaceRoot, 'agents', agentName, 'session.json')
}

/**
 * 加载会话
 */
export function loadSession(sessionPath: string): Session | null {
  if (fs.existsSync(sessionPath)) {
    try {
      const content = fs.readFileSync(sessionPath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      console.error('加载会话失败:', error)
    }
  }
  return null
}

/**
 * 保存会话
 */
export function saveSession(sessionPath: string, session: Session): void {
  const dir = path.dirname(sessionPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
}

/**
 * 加载 Skill 文件（SOP）
 */
export function loadSkill(workspaceRoot: string, name: string): string {
  const userPath = path.join(workspaceRoot, 'skills', `${name}.md`)
  const codePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../skills',
    `${name}.md`
  )
  if (fs.existsSync(userPath)) return fs.readFileSync(userPath, 'utf-8')
  if (fs.existsSync(codePath)) return fs.readFileSync(codePath, 'utf-8')
  return ''
}

/**
 * 初始化消息列表
 */
export function initMessages(
  messages: ChatCompletionMessageParam[],
  systemPrompt: string,
  input: string
): ChatCompletionMessageParam[] {
  if (messages.length === 0) {
    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: input },
    ]
  } else {
    const hasSystem = messages.length > 0 && messages[0].role === 'system'
    const newMessages = [...messages]
    if (!hasSystem) {
      newMessages.unshift({ role: 'system', content: systemPrompt })
    }
    newMessages.push({ role: 'user', content: input })
    return newMessages
  }
}
