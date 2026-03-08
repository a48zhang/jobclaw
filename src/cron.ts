/**
 * src/cron.ts — 定时任务脚本
 * 支持两种模式：
 * 1. search: 搜索新职位 (默认)
 *    # bun src/cron.ts search
 * 2. digest: 发送日报汇总
 *    # bun src/cron.ts digest
 */
import OpenAI from 'openai'
import { MainAgent } from './agents/main'
import { DeliveryAgent } from './agents/delivery'
import { EmailChannel } from './channel/email'
import { validateEnv, validateWorkspace } from './env'
import { createMCPClient } from './mcp'

async function main() {
  const mode = process.argv[2] === 'digest' ? 'digest' : 'search';
  
  validateEnv(['smtp', 'openai']);
  validateWorkspace('./workspace');

  const channel = new EmailChannel({
    smtpHost: process.env.SMTP_HOST!,
    smtpPort: parseInt(process.env.SMTP_PORT ?? '587', 10),
    from: process.env.SMTP_USER!,
    to: process.env.NOTIFY_EMAIL!,
    user: process.env.SMTP_USER!,
    password: process.env.SMTP_PASSWORD!,
  });

  const mcpClient = await createMCPClient();

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const deliveryAgent = new DeliveryAgent({
      openai,
      model: process.env.MODEL ?? 'gpt-4o',
      workspaceRoot: './workspace',
      mcpClient,
      channel,
    });

    const mainAgent = new MainAgent({
      openai,
      model: process.env.MODEL ?? 'gpt-4o',
      workspaceRoot: './workspace',
      deliveryAgent,
      mcpClient,
      channel,
    });

    if (mode === 'search') {
      console.log('[cron] 正在启动搜索任务...');
      // 搜索模式保持静默，upsert_job 会负责写入，但不触发单条通知
      await mainAgent.runEphemeral(
        '搜索 targets.md 中所有公司的最新职位，使用 upsert_job 将发现的新职位写入 jobs.md。此过程无需发送邮件通知。'
      );
      console.log('[cron] 搜索任务完成。');
    } else {
      console.log('[cron] 正在生成日报汇总...');
      // 日报模式由 Agent 读取 jobs.md 并通过 channel 发送汇总
      await mainAgent.runEphemeral(
        '分析 jobs.md 中的新增岗位并发送日报汇总。如果没有新岗位，请直接回复"今日无新增"。'
      );
      console.log('[cron] 日报任务完成。');
    }

  } finally {
    await mcpClient.close();
  }
}

main().catch((err) => {
  console.error(`[cron] ${process.argv[2] || 'search'} 任务失败:`, err);
  process.exit(1);
});
