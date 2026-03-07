import OpenAI from 'openai'
import { MainAgent } from './agents/main'
import { DeliveryAgent } from './agents/delivery'
import { needsBootstrap, BOOTSTRAP_PROMPT } from './bootstrap'
import * as readline from 'node:readline'

const WORKSPACE_ROOT = './workspace'

async function main() {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  const deliveryAgent = new DeliveryAgent({
    openai,
    model: process.env.MODEL ?? 'gpt-4o',
    workspaceRoot: WORKSPACE_ROOT,
  })

  const mainAgent = new MainAgent({
    openai,
    model: process.env.MODEL ?? 'gpt-4o',
    workspaceRoot: WORKSPACE_ROOT,
    deliveryAgent,
  })

  if (needsBootstrap(WORKSPACE_ROOT)) {
    console.log('[JobClaw] 首次启动，进入初始化引导流程...')
    const result = await mainAgent.run(BOOTSTRAP_PROMPT)
    console.log('\n[JobClaw] 引导完成:', result)
    return
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
}

main().catch((err) => {
  console.error('[JobClaw] 启动失败:', err)
  process.exit(1)
})

