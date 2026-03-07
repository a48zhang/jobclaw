/**
 * src/cron.ts — 单次任务脚本，由外部调度器触发
 *
 * 调度示例（由用户在系统层面配置）:
 *   # 系统 crontab — 每天早上 9 点
 *   0 9 * * * /usr/bin/bun /path/to/jobclaw/src/cron.ts
 *
 *   # PM2 ecosystem.config.js
 *   { cron_restart: '0 9 * * *', script: 'src/cron.ts' }
 */
import OpenAI from 'openai'
import { MainAgent } from './agents/main'
import { DeliveryAgent } from './agents/delivery'
import { EmailChannel } from './channel/email'
import { validateEnv } from './env'
import { createMCPClient } from './mcp'

async function main() {
  validateEnv(['smtp'])

  const channel = new EmailChannel({
    smtpHost: process.env.SMTP_HOST!,
    smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
    from: process.env.SMTP_USER!,
    to: process.env.NOTIFY_EMAIL!,
    user: process.env.SMTP_USER!,
    password: process.env.SMTP_PASSWORD!,
  })

  const mcpClient = await createMCPClient()

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

    const deliveryAgent = new DeliveryAgent({
      openai,
      model: process.env.MODEL ?? 'gpt-4o',
      workspaceRoot: './workspace',
      mcpClient,
      channel,
    })

    const mainAgent = new MainAgent({
      openai,
      model: process.env.MODEL ?? 'gpt-4o',
      workspaceRoot: './workspace',
      deliveryAgent,
      mcpClient,
      channel,
    })

    const result = await mainAgent.runEphemeral(
      '搜索 targets.md 中所有公司的最新职位，将发现的新职位写入 jobs.md'
    )

    // 解析 result 中的 newJobs 数量（约定 LLM 回复结尾包含 "发现 N 个新职位"）
    const countMatch = result.match(/发现\s*(\d+)\s*个新职位/)
    const newJobs = countMatch ? parseInt(countMatch[1], 10) : 0

    if (newJobs > 0) {
      await channel.send({
        type: 'cron_complete',
        payload: { newJobs, summary: result },
        timestamp: new Date(),
      })
    }
  } finally {
    await mcpClient.close()
  }
}

main().catch((err) => {
  console.error('[cron] 任务失败:', err)
  process.exit(1)
})
