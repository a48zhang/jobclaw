/**
 * src/cron.ts — 定时任务脚本
 * 支持两种模式：
 * 1. search: 搜索新职位 (默认)
 * 2. digest: 发送日报汇总
 */
import { EmailChannel } from './channel/email.js'
import { validateEnv } from './env.js'
import type { Channel } from './channel/base.js'
import { RuntimeKernel } from './runtime/index.js'

export async function runCron(workspaceRoot: string, mode: 'search' | 'digest' = 'search') {
  validateEnv(workspaceRoot, mode === 'digest' ? ['smtp'] : [])

  const channel: Channel =
    mode === 'digest'
      ? new EmailChannel({
          smtpHost: process.env.SMTP_HOST!,
          smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
          from: process.env.SMTP_USER!,
          to: process.env.NOTIFY_EMAIL!,
          user: process.env.SMTP_USER!,
          password: process.env.SMTP_PASSWORD!,
        })
      : { send: async () => {} }

  const runtime = new RuntimeKernel({
    workspaceRoot,
    mainChannel: channel,
    mainAgentPersistent: false,
  })

  await runtime.start()
  const mainAgent = runtime.getMainAgent()
  if (!mainAgent) {
    await runtime.shutdown()
    throw new Error('Main agent not available after runtime startup')
  }

  try {
    if (mode === 'search') {
      console.log('[cron] 正在启动搜索任务...')
      await mainAgent.run(
        '搜索 targets.md 中所有公司的最新职位，使用 upsert_job 将发现的新职位写入 jobs.md。此过程无需发送邮件通知。'
      )
      console.log('[cron] 搜索任务完成。')
    } else {
      console.log('[cron] 正在生成日报汇总...')
      await mainAgent.run(
        '分析 jobs.md 中的新增岗位并发送日报汇总。如果没有新岗位，请直接回复"今日无新增"。'
      )
      console.log('[cron] 日报任务完成。')
    }
  } finally {
    await runtime.shutdown()
  }
}
