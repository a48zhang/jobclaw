import OpenAI from 'openai'
import { MainAgent } from './agents/main'
import { DeliveryAgent } from './agents/delivery'
import { needsBootstrap, BOOTSTRAP_PROMPT } from './bootstrap'
import { validateEnv } from './env'
import { createMCPClient } from './mcp'
import * as readline from 'node:readline'

const WORKSPACE_ROOT = './workspace'

async function main() {
  validateEnv()

  const mcpClient = await createMCPClient()

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const deliveryAgent = new DeliveryAgent({
      openai,
      model: process.env.MODEL ?? 'gpt-4o',
      workspaceRoot: WORKSPACE_ROOT,
      mcpClient,
    })

    const mainAgent = new MainAgent({
      openai,
      model: process.env.MODEL ?? 'gpt-4o',
      workspaceRoot: WORKSPACE_ROOT,
      deliveryAgent,
      mcpClient,
    })

    // Bootstrap 引导循环：持续运行直到用户完成配置并生成 config.yaml
    while (needsBootstrap(WORKSPACE_ROOT)) {
      console.log('[JobClaw] 首次启动，进入初始化引导流程...')
      const result = await mainAgent.run(BOOTSTRAP_PROMPT)
      console.log('\n[JobClaw]', result)
    }

    // 正常交互模式
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    console.log('JobClaw 已启动。输入指令开始搜索职位（Ctrl+C 退出）。')

    const askQuestion = (prompt: string): Promise<string> =>
      new Promise((resolve) => rl.question(prompt, resolve))

    while (true) {
      const input = await askQuestion('> ')
      if (!input.trim()) continue
      const response = await mainAgent.run(input)
      console.log(response)
    }
  } finally {
    await mcpClient.close()
  }
}

main().catch((err) => {
  console.error('[JobClaw] 启动失败:', err)
  process.exit(1)
})
