/** BaseAgent 类型定义 */
import type OpenAI from 'openai'
import type { Task } from '../../types.js'
import type { Channel } from '../../channel/base.js'
import type { AgentFactory } from '../factory.js'
import type { AgentProfile } from '../profiles.js'

/** MCP Client 接口 */
export interface MCPClient {
  listTools(): Promise<Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>>
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>
}

/** Agent 状态快照 */
export interface AgentSnapshot {
  agentName: string
  state: string
  iterations: number
  tokenCount: number
  lastAction: string
  currentTask: Task | null
}

/** BaseAgent 配置 */
export interface BaseAgentConfig {
  openai: OpenAI
  agentName: string
  model: string
  workspaceRoot: string
  mcpClient?: MCPClient
  channel?: Channel
  maxIterations?: number
  keepRecentMessages?: number
  lightModel?: string
  persistent?: boolean
  factory?: AgentFactory
  profile?: AgentProfile
  sessionId?: string
}

/** ContextCompressor 配置 */
export interface ContextCompressorConfig {
  openai: OpenAI
  lightModel: string
  keepRecentMessages: number
}
