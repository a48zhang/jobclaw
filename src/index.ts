import OpenAI from 'openai'
import { MainAgent } from './agents/main'
import { DeliveryAgent } from './agents/delivery'
import { needsBootstrap, BOOTSTRAP_PROMPT } from './bootstrap'
import { validateEnv, validateWorkspace } from './env'
import { createMCPClient } from './mcp'
import { TUI } from './web/tui'
import { TUIChannel } from './channel/tui'
import { startServer, registerAgent } from './web/server'
import { loadConfig } from './config'

const WORKSPACE_ROOT = './workspace'

async function main() {
  validateEnv(WORKSPACE_ROOT)

  const config = loadConfig(WORKSPACE_ROOT)
  const mcpClient = await createMCPClient()

  try {
    const openai = new OpenAI({ 
      apiKey: config.API_KEY,
      baseURL: config.BASE_URL
    })

    // Bootstrap 引导循环
    if (needsBootstrap(WORKSPACE_ROOT)) {
      const bootstrapChannel = new TUIChannel((line) => process.stderr.write(line + '\n'))
      const bootstrapDelivery = new DeliveryAgent({
        openai,
        agentName: 'delivery',
        model: config.MODEL_ID,
        workspaceRoot: WORKSPACE_ROOT,
        mcpClient,
        channel: bootstrapChannel,
      })
      const bootstrapAgent = new MainAgent({
        openai,
        agentName: 'main',
        model: config.MODEL_ID,
        workspaceRoot: WORKSPACE_ROOT,
        deliveryAgent: bootstrapDelivery,
        mcpClient,
        channel: bootstrapChannel,
      })
      while (needsBootstrap(WORKSPACE_ROOT)) {
        await bootstrapAgent.run(BOOTSTRAP_PROMPT)
      }
    }

    // ── Pre-launch Workspace Validation ──────────────────────────────────────
    validateWorkspace(WORKSPACE_ROOT)

    // ── Launch TUI ──────────────────────────────────────────────────────────
    let mainAgent: MainAgent

    const tui = new TUI({
      workspaceRoot: WORKSPACE_ROOT,
      onCommand: async (input) => {
        const response = await mainAgent.run(input)
        tui.tuiChannel.send({
          type: 'cron_complete',
          payload: { message: response },
          timestamp: new Date(),
        })
      },
    })

    const deliveryAgent = new DeliveryAgent({
      openai,
      agentName: 'delivery',
      model: config.MODEL_ID,
      summaryModel: config.SUMMARY_MODEL_ID,
      workspaceRoot: WORKSPACE_ROOT,
      mcpClient,
      channel: tui.tuiChannel,
    })

    mainAgent = new MainAgent({
      openai,
      agentName: 'main',
      model: config.MODEL_ID,
      summaryModel: config.SUMMARY_MODEL_ID,
      workspaceRoot: WORKSPACE_ROOT,
      deliveryAgent,
      mcpClient,
      channel: tui.tuiChannel,
    })

    // Start server with config
    startServer(WORKSPACE_ROOT, config.SERVER_PORT)

    // Wire up HITL: intervention_required → TUI modal
    tui.attachAgent(mainAgent)
    tui.startWatching()
    tui.render()
  } catch (err) {
    await mcpClient.close()
    throw err
  }
}

main().catch((err) => {
  process.stderr.write(`[JobClaw] 启动失败: ${(err as Error).message}\n`)
  process.exit(1)
})


