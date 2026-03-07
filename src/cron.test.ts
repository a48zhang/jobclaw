// CronJob 单元测试 — Team B
import { describe, test, expect, mock, beforeEach } from 'bun:test'
import type { Channel, ChannelMessage } from './channel/base'

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

// ─── TC-B-09 / TC-B-10: needsBootstrap ────────────────────────────────────
import { needsBootstrap } from './bootstrap'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

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
