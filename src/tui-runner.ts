import OpenAI from 'openai'
import * as fs from 'node:fs'

import { MainAgent } from './agents/main/index.js'
import { AgentFactory } from './agents/factory.js'
import { validateEnv } from './env.js'
import { createMCPClient } from './mcp.js'
import { clearAgentRegistry, registerAgent, startServer, type ServerRuntime } from './web/server.js'
import { getConfigStatus, loadConfig } from './config.js'
import { eventBus } from './eventBus.js'

class ServerChannel {
  async send(message: any): Promise<void> {
    if (message.type === 'agent_response') {
      const payload = message.payload ?? {}
      const streaming = message.streaming ?? {}
      const chunk = typeof payload.message === 'string' ? payload.message : ''

      if (chunk || streaming.isFinal || streaming.isFirst) {
        eventBus.emit('agent:stream', {
          agentName: 'main',
          chunk,
          isFirst: Boolean(streaming.isFirst),
          isFinal: Boolean(streaming.isFinal),
        })
      }
      return
    }

    if (message.type === 'tool_call' || message.type === 'tool_output') {
      eventBus.emit('agent:tool', {
        agentName: 'main',
        toolType: message.type,
        message: message.payload?.message || `[${message.type}]`,
        timestamp: new Date().toISOString(),
      })
    }
  }
}

export async function runServer(workspaceRoot: string) {
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true })
  }

  validateEnv(workspaceRoot, [], { allowMissingBase: true })

  const mcpClient = (await createMCPClient()) ?? undefined
  const serverChannel = new ServerChannel() as any
  let mainAgent: MainAgent | undefined
  let factory: AgentFactory | undefined

  const runtime: ServerRuntime = {
    getMainAgent() {
      return mainAgent
    },
    getFactory() {
      return factory
    },
    getConfigStatus() {
      return getConfigStatus(workspaceRoot)
    },
    async reloadFromConfig() {
      clearAgentRegistry()
      mainAgent = undefined
      factory = undefined

      const status = getConfigStatus(workspaceRoot)
      if (!status.ready) {
        eventBus.emit('agent:log', {
          agentName: 'system',
          type: 'warn',
          message: `基础配置未完成：缺少 ${status.missingFields.join(', ')}。请先在设置面板中完成配置。`,
          timestamp: new Date().toISOString(),
        })
        return
      }

      const config = loadConfig(workspaceRoot)
      const openai = new OpenAI({
        apiKey: config.API_KEY,
        baseURL: config.BASE_URL,
      })

      factory = new AgentFactory({
        openai,
        mcpClient,
        workspaceRoot,
        model: config.MODEL_ID,
        lightModel: config.LIGHT_MODEL_ID,
      })

      mainAgent = new MainAgent({
        openai,
        agentName: 'main',
        model: config.MODEL_ID,
        lightModel: config.LIGHT_MODEL_ID,
        workspaceRoot,
        mcpClient,
        channel: serverChannel,
        factory,
        persistent: true,
      })

      await mainAgent.loadSession()
      registerAgent(mainAgent)
      eventBus.emit('agent:state', { agentName: 'main', state: mainAgent.getState().state })

      if (!mcpClient) {
        eventBus.emit('agent:log', {
          agentName: 'system',
          type: 'warn',
          message: 'MCP 未连接：浏览器自动化能力不可用。请检查 Playwright MCP 安装或网络环境。',
          timestamp: new Date().toISOString(),
        })
      }
    },
  }

  try {
    await runtime.reloadFromConfig()
    const config = loadConfig(workspaceRoot)
    startServer(workspaceRoot, config.SERVER_PORT, runtime)

    const status = runtime.getConfigStatus()
    if (status.ready) {
      console.log(`[JobClaw] 服务端模式已启动，请访问 http://localhost:${config.SERVER_PORT ?? 3000}`)
    } else {
      console.log(`[JobClaw] 设置向导已启动，请访问 http://localhost:${config.SERVER_PORT ?? 3000} 完成基础配置`)
    }
  } catch (err) {
    if (mcpClient) await mcpClient.close()
    throw err
  }
}
