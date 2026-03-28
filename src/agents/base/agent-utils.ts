import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import type { Session } from '../../types.js'
import type { Channel, ChannelMessage } from '../../channel/base.js'
import { eventBus } from '../../eventBus.js'
import { resolveWorkspaceRoot } from '../../infra/workspace/paths.js'

/** Channel 消息类型 → 日志级别映射 */
export const CHANNEL_LOG_TYPE_MAP: Record<string, 'info' | 'warn' | 'error'> = {
  tool_error: 'error',
  tool_warn: 'warn',
}

/**
 * 将 Channel 包装为同步 emit agent:log 的版本
 */
export function wrapChannel(channel: Channel, agentName: string): Channel {
  return {
    send: async (message: ChannelMessage): Promise<void> => {
      const logType: 'info' | 'warn' | 'error' = CHANNEL_LOG_TYPE_MAP[message.type] ?? 'info'

      // 处理 agent_response 类型（流式和非流式）
      if (message.type === 'agent_response') {
        if (message.streaming) {
          // 聊天回答的唯一用户可见事实源是 agent:stream；
          // 不要在流结束时再镜像成 agent:log，否则前端会把同一回复显示两次。
        } else {
          // 非流式：直接发送
          const msg = typeof message.payload['message'] === 'string' ? message.payload['message'] : ''
          if (msg) {
            eventBus.emit('agent:log', {
              agentName,
              type: logType,
              message: msg,
              timestamp: new Date().toISOString(),
            })
          }
        }
      } else {
        // 其他类型消息
        const text =
          typeof message.payload['message'] === 'string'
            ? `[${message.type}] ${message.payload['message']}`
            : `[${message.type}]`

        eventBus.emit('agent:log', {
          agentName,
          type: logType,
          message: text,
          timestamp: new Date().toISOString(),
        })
      }

      return channel.send(message)
    },
  }
}

/**
 * 获取会话路径
 */
export function getSessionPath(workspaceRoot: string, agentName: string): string {
  return path.resolve(resolveWorkspaceRoot(workspaceRoot), 'agents', agentName, 'session.json')
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
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2), 'utf-8')
  } catch (error) {
    console.error(`[Critical Error] Failed to save session to ${sessionPath}:`, (error as Error).message)
  }
}

/**
 * 归档会话：将 session.json 移动到 ${uuid}.json
 * @returns 归档后的文件路径，如果不存在则返回 null
 */
export function archiveSession(sessionPath: string): string | null {
  if (!fs.existsSync(sessionPath)) {
    return null
  }
  const dir = path.dirname(sessionPath)
  const archiveId = randomUUID()
  const archivePath = path.join(dir, `${archiveId}.json`)
  try {
    fs.renameSync(sessionPath, archivePath)
    return archivePath
  } catch (error) {
    console.error(`[Error] Failed to archive session:`, (error as Error).message)
    return null
  }
}

/**
 * 加载 Skill 文件（SOP）
 */
export function loadSkill(workspaceRoot: string, name: string): string {
  const userPath = path.join(resolveWorkspaceRoot(workspaceRoot), 'skills', `${name}.md`)
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
