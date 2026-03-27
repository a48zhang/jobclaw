import * as fs from 'node:fs'
import type { MainAgent } from './agents/main/index.js'
import { validateEnv } from './env.js'
import { clearAgentRegistry, registerAgent, startServer } from './web/server.js'
import { loadConfig } from './config.js'
import { eventBus } from './eventBus.js'
import { RuntimeKernel } from './runtime/index.js'

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

async function syncLegacyAgentRegistry(agent?: MainAgent): Promise<void> {
  clearAgentRegistry()
  if (agent) {
    registerAgent(agent)
  }
}

export async function runServer(workspaceRoot: string) {
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true })
  }

  validateEnv(workspaceRoot, [], { allowMissingBase: true })

  const runtime = new RuntimeKernel({
    workspaceRoot,
    mainChannel: new ServerChannel() as any,
    mainAgentPersistent: true,
    onMainAgentChanged: syncLegacyAgentRegistry,
  })

  await runtime.start()

  const config = loadConfig(workspaceRoot)
  startServer(workspaceRoot, config.SERVER_PORT, runtime)

  const status = runtime.getConfigStatus()
  if (status.ready) {
    console.log(`[JobClaw] 服务端模式已启动，请访问 http://localhost:${config.SERVER_PORT ?? 3000}`)
  } else {
    console.log(`[JobClaw] 设置向导已启动，请访问 http://localhost:${config.SERVER_PORT ?? 3000} 完成基础配置`)
  }
}
