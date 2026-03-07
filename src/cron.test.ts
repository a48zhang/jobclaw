// CronJob 单元测试 — Team B
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import type { Channel, ChannelMessage } from './channel/base'
import { validateEnv } from './env'
import { needsBootstrap } from './bootstrap'

// ─── 辅助：创建 mock Channel ──────────────────────────────────────────────
function makeMockChannel() {
  const sent: ChannelMessage[] = []
  const channel: Channel = {
    send: mock(async (msg: ChannelMessage) => {
      sent.push(msg)
    }),
  }
  return { channel, sent }
}

// ─── 辅助：创建 mock MainAgent ────────────────────────────────────────────
function makeMockMainAgent(runEphemeralResult: string) {
  return {
    runEphemeral: mock(async (_input: string) => runEphemeralResult),
  }
}

// ─── cron main() 逻辑（提取为可测试纯函数）──────────────────────────────────
async function cronMain(
  mainAgent: { runEphemeral(input: string): Promise<string> },
  channel: Channel
): Promise<void> {
  const result = await mainAgent.runEphemeral(
    '搜索 targets.md 中所有公司的最新职位，将发现的新职位写入 jobs.md'
  )

  const countMatch = result.match(/发现\s*(\d+)\s*个新职位/)
  const newJobs = countMatch ? parseInt(countMatch[1], 10) : 0

  if (newJobs > 0) {
    await channel.send({
      type: 'cron_complete',
      payload: { newJobs, summary: result },
      timestamp: new Date(),
    })
  }
}

// ─── TC-B-06: 发现新职位时发送 cron_complete ─────────────────────────────
describe('cron main()', () => {
  test('TC-B-06: 发现 3 个新职位时发送 cron_complete，payload.newJobs === 3', async () => {
    const { channel, sent } = makeMockChannel()
    const mainAgent = makeMockMainAgent('已完成搜索，发现 3 个新职位，已写入 jobs.md。')

    await cronMain(mainAgent, channel)

    expect(sent).toHaveLength(1)
    expect(sent[0].type).toBe('cron_complete')
    expect(sent[0].payload.newJobs).toBe(3)
  })

  // ─── TC-B-07: 无新职位时不发通知 ──────────────────────────────────────
  test('TC-B-07: 未发现新职位时不调用 channel.send', async () => {
    const { channel, sent } = makeMockChannel()
    const mainAgent = makeMockMainAgent('已完成搜索，未发现新职位。')

    await cronMain(mainAgent, channel)

    expect(sent).toHaveLength(0)
  })

  // ─── TC-B-08: runEphemeral 抛出异常时 main() 抛出 ────────────────────
  test('TC-B-08: runEphemeral 抛出异常时 cronMain 也抛出', async () => {
    const { channel } = makeMockChannel()
    const mainAgent = {
      runEphemeral: mock(async (_input: string) => {
        throw new Error('MCP 连接失败')
      }),
    }

    await expect(cronMain(mainAgent, channel)).rejects.toThrow('MCP 连接失败')
  })
})

// ─── validateEnv ────────────────────────────────────────────────────────────
describe('validateEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    // 隔离环境变量
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  test('所有必须变量都存在时不抛出异常', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    expect(() => validateEnv()).not.toThrow()
  })

  test('缺少 OPENAI_API_KEY 时抛出友好错误', () => {
    delete process.env.OPENAI_API_KEY
    expect(() => validateEnv()).toThrow(/OPENAI_API_KEY/)
  })

  test('smtp 模式下缺少 SMTP_HOST 时抛出友好错误', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    delete process.env.SMTP_HOST
    expect(() => validateEnv(['smtp'])).toThrow(/SMTP_HOST/)
  })

  test('smtp 模式下所有变量都存在时不抛出异常', () => {
    process.env.OPENAI_API_KEY = 'sk-test'
    process.env.SMTP_HOST = 'smtp.example.com'
    process.env.SMTP_USER = 'noreply@example.com'
    process.env.SMTP_PASSWORD = 'secret'
    process.env.NOTIFY_EMAIL = 'user@example.com'
    expect(() => validateEnv(['smtp'])).not.toThrow()
  })

  test('错误信息引用 .env.example', () => {
    delete process.env.OPENAI_API_KEY
    expect(() => validateEnv()).toThrow(/.env.example/)
  })
})

describe('needsBootstrap', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-test-'))
  })

  test('TC-B-09: config.yaml 存在时返回 false', () => {
    fs.writeFileSync(path.join(tmpDir, 'config.yaml'), 'version: "1"\n')
    expect(needsBootstrap(tmpDir)).toBe(false)
  })

  test('TC-B-10: config.yaml 不存在时返回 true', () => {
    expect(needsBootstrap(tmpDir)).toBe(true)
  })
})
