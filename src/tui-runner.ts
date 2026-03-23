import OpenAI from 'openai'
import * as fs from 'node:fs'

import { MainAgent } from './agents/main/index.js'
import { AgentFactory } from './agents/factory.js'
import { validateEnv } from './env.js'
import { createMCPClient } from './mcp.js'
import { registerAgent, startServer } from './web/server.js'
import { loadConfig } from './config.js'
import { eventBus } from './eventBus.js'

/**
 * 服务端模式的空 Channel
 * 只负责将 agent_response 转发到 eventBus
 */
class ServerChannel {
  async send(message: any): Promise<void> {
    if (message.type === 'agent_response') {
      const msg = message.payload?.message
      if (msg) {
        eventBus.emit('agent:log', {
          agentName: 'main',
          type: 'info',
          message: msg,
          timestamp: new Date().toISOString(),
        })
      }
    } else if (message.type === 'tool_call' || message.type === 'tool_output') {
      eventBus.emit('agent:log', {
        agentName: 'main',
        type: 'info',
        message: message.payload?.message || `[${message.type}]`,
        timestamp: new Date().toISOString(),
      })
    }
  }
}

export async function runServer(workspaceRoot: string) {
  // Ensure workspace directory exists
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true })
  }

  validateEnv(workspaceRoot)

  const config = loadConfig(workspaceRoot)
  const mcpClient = await createMCPClient()

  try {
    const openai = new OpenAI({
      apiKey: config.API_KEY,
      baseURL: config.BASE_URL
    })

    const factory = new AgentFactory({
      openai,
      mcpClient,
      workspaceRoot,
      model: config.MODEL_ID,
      lightModel: config.LIGHT_MODEL_ID,
    })

    const mainAgent = new MainAgent({
      openai,
      agentName: 'main',
      model: config.MODEL_ID,
      lightModel: config.LIGHT_MODEL_ID,
      workspaceRoot: workspaceRoot,
      mcpClient,
      channel: new ServerChannel() as any,
      factory,
      persistent: true,
    })

    // 加载历史会话
    await mainAgent.loadSession()

    registerAgent(mainAgent)

    // 启动 Web 服务器
    startServer(workspaceRoot, config.SERVER_PORT, factory)

    console.log(`[JobClaw] 服务端模式已启动，请访问 http://localhost:${config.SERVER_PORT ?? 3000}`)
  } catch (err) {
    await mcpClient.close()
    throw err
  }
}
