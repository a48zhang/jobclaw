/** BaseAgent 类型定义 */
import type OpenAI from 'openai'
import type { Task } from '../../types'

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
  maxIterations?: number
  keepRecentMessages?: number
  summaryModel?: string
}

/** ContextCompressor 配置 */
export interface ContextCompressorConfig {
  openai: OpenAI
  summaryModel: string
  keepRecentMessages: number
}