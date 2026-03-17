import OpenAI from 'openai'
import * as fs from 'node:fs'

import { MainAgent } from './agents/main/index.js'
import { AgentFactory } from './agents/factory.js'
import { needsBootstrap, BOOTSTRAP_PROMPT } from './bootstrap.js'
import { validateEnv } from './env.js'
import { createMCPClient } from './mcp.js'
import { TUI } from './web/tui.js'
import { TUIChannel } from './channel/tui.js'
import { registerAgent, startServer } from './web/server.js'
import { loadConfig } from './config.js'
import { eventBus } from './eventBus.js'

export async function runTUI(workspaceRoot: string) {
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

    // Bootstrap 引导循环
    if (needsBootstrap(workspaceRoot)) {
      const bootstrapChannel = new TUIChannel((line) => process.stderr.write(line + '\n'))
      const bootstrapFactory = new AgentFactory({
        openai,
        mcpClient,
        workspaceRoot,
        model: config.MODEL_ID,
        lightModel: config.LIGHT_MODEL_ID || config.MODEL_ID,
      })
      const bootstrapAgent = new MainAgent({
        openai,
        agentName: 'main',
        model: config.MODEL_ID,
        workspaceRoot: workspaceRoot,
        mcpClient,
        channel: bootstrapChannel,
        factory: bootstrapFactory,
        persistent: false,
      })
      while (needsBootstrap(workspaceRoot)) {
        await bootstrapAgent.run(BOOTSTRAP_PROMPT)
      }
    }

    // ── Launch TUI ──────────────────────────────────────────────────────────
    let mainAgent: MainAgent

    const tui = new TUI({
      workspaceRoot: workspaceRoot,
      onCommand: async (input) => {
        // ── TUI 特有命令 ──────────────────────────────────────────────────
        if (input.startsWith('/')) {
          const cmd = input.slice(1).toLowerCase().trim()
          if (cmd === 'quit' || cmd === 'exit') {
            tui.destroy()
            process.exit(0)
          }
          if (cmd === 'jobs') {
            tui.toggleJobs()
            return
          }
          // /new 和 /clear 命令需要额外清理 UI
          if (cmd === 'new' || cmd === 'clear') {
            const result = mainAgent.submit(input)
            tui.clearLog()
            tui.updateContextUsage(0)
            tui.tuiChannel.send({
              type: 'agent_response' as any,
              payload: { message: result.message || '' },
              timestamp: new Date(),
            })
            return
          }
        }

        // ── 其他输入统一由 submit() 处理 ─────────────────────────────────────
        const result = mainAgent.submit(input)

        if (result.queued) {
          tui.tuiChannel.send({
            type: 'user_input' as any,
            payload: { message: `{cyan-fg}> ${input}{/}` },
            timestamp: new Date(),
          })
          if (result.queueLength && result.queueLength > 1) {
            tui.tuiChannel.send({
              type: 'agent_response' as any,
              payload: { message: `[排队中，前面还有 ${result.queueLength - 1} 条]` },
              timestamp: new Date(),
            })
          }
        } else {
          tui.tuiChannel.send({
            type: 'agent_response' as any,
            payload: { message: result.message || '' },
            timestamp: new Date(),
          })
        }
      },
    })

    const factory = new AgentFactory({
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
      workspaceRoot: workspaceRoot,
      mcpClient,
      channel: tui.tuiChannel,
      factory,
      persistent: true,
    })

    // ── Load History & Sync UI ──────────────────────────────────────────────
    await mainAgent.loadSession()
    const history = mainAgent.getMessages()
    for (const msg of history) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        tui.tuiChannel.send({
          type: 'user_input' as any,
          payload: { message: `{cyan-fg}> ${msg.content}{/}` },
          timestamp: new Date(),
        })
      } else if (msg.role === 'assistant' && typeof msg.content === 'string') {
        tui.tuiChannel.send({
          type: 'agent_response' as any,
          payload: { message: msg.content },
          timestamp: new Date(),
        })
      }
    }
    tui.render()

    // 更新初始上下文使用量
    const initialState = mainAgent.getState()
    tui.updateContextUsage(initialState.tokenCount)

    // 监听上下文使用量更新事件
    eventBus.on('context:usage', ({ tokenCount }) => {
      tui.updateContextUsage(tokenCount)
    })

    registerAgent(mainAgent)

    // Start server with config
    startServer(workspaceRoot, config.SERVER_PORT, factory)

    // Wire up HITL: intervention_required → TUI modal
    tui.attachAgent(mainAgent)
    tui.startWatching()
    tui.render()
  } catch (err) {
    await mcpClient.close()
    throw err
  }
}
