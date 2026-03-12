import OpenAI from 'openai'
import * as fs from 'node:fs'
import * as path from 'node:path'

import { MainAgent } from './agents/main'
import { DeliveryAgent } from './agents/delivery'
import { needsBootstrap, BOOTSTRAP_PROMPT } from './bootstrap'
import { validateEnv } from './env'
import { createMCPClient } from './mcp'
import { TUI } from './web/tui'
import { TUIChannel } from './channel/tui'
import { registerAgent, startServer } from './web/server'
import { loadConfig } from './config'

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
      const bootstrapDelivery = new DeliveryAgent({
        openai,
        agentName: 'delivery',
        model: config.MODEL_ID,
        workspaceRoot: workspaceRoot,
        mcpClient,
        channel: bootstrapChannel,
      })
      const bootstrapAgent = new MainAgent({
        openai,
        agentName: 'main',
        model: config.MODEL_ID,
        workspaceRoot: workspaceRoot,
        deliveryAgent: bootstrapDelivery,
        mcpClient,
        channel: bootstrapChannel,
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
        // ── Command System ──────────────────────────────────────────────────
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
        }

        // ── Default: Send to Agent ──────────────────────────────────────────
        tui.tuiChannel.send({
          type: 'user_input' as any,
          payload: { message: `{cyan-fg}> ${input}{/}` },
          timestamp: new Date(),
        })
        await mainAgent.run(input)
      },
    })

    const deliveryAgent = new DeliveryAgent({
      openai,
      agentName: 'delivery',
      model: config.MODEL_ID,
      lightModel: config.LIGHT_MODEL_ID,
      workspaceRoot: workspaceRoot,
      mcpClient,
      channel: tui.tuiChannel,
    })

    mainAgent = new MainAgent({
      openai,
      agentName: 'main',
      model: config.MODEL_ID,
      lightModel: config.LIGHT_MODEL_ID,
      workspaceRoot: workspaceRoot,
      deliveryAgent,
      mcpClient,
      channel: tui.tuiChannel,
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

    registerAgent(mainAgent)
    registerAgent(deliveryAgent)

    // Start server with config
    startServer(workspaceRoot, config.SERVER_PORT)

    // Wire up HITL: intervention_required → TUI modal
    tui.attachAgent(mainAgent)
    tui.startWatching()
    tui.render()
  } catch (err) {
    await mcpClient.close()
    throw err
  }
}
