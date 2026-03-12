/**
 * TUI Dashboard - Phase 4 Team A
 * Full-screen interactive terminal dashboard using blessed & blessed-contrib
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const blessed = require('blessed')
const contrib = require('blessed-contrib')
import * as fs from 'node:fs'
import * as path from 'node:path'
import { TUIChannel } from '../channel/tui.js'
import type { BaseAgent } from '../agents/base/agent.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JobRow {
  company: string
  title: string
  url: string
  status: string
  time: string
}

export interface TUIOptions {
  workspaceRoot: string
  onCommand: (input: string) => Promise<void>
}

export function parseJobsMd(content: string): JobRow[] {
  const rows: JobRow[] = []
  const lines = content.split('\n')
  let pastHeader = false
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue
    if (/^\|\s*[-:]+\s*\|/.test(line)) {
      pastHeader = true
      continue
    }
    if (!pastHeader) continue
    const cols = line.split('|').map((c) => c.trim())
    if (cols.length < 6) continue
    const [, company, title, url, status, time] = cols
    if (!company && !title) continue
    rows.push({ company: company ?? '', title: title ?? '', url: url ?? '', status: status ?? '', time: time ?? '' })
  }
  return rows
}

const JOB_TABLE_HEADERS = ['公司', '职位', '链接', '状态', '时间']
const MIN_LOG_HEIGHT = 5 // 日志框最小高度
const MIN_JOB_HEIGHT = 5 // 职位表最小高度

export class TUI {
  private screen: any
  private jobTable: any
  private activityLog: any
  private inputBox: any
  private channel: TUIChannel

  private workspaceRoot: string
  private jobsPath: string
  private onCommand: (input: string) => Promise<void>
  private watcher: fs.FSWatcher | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private showingJobs: boolean = false
  private lastCtrlC: number = 0

  constructor(options: TUIOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.jobsPath = path.resolve(options.workspaceRoot, 'data/jobs.md')
    this.onCommand = options.onCommand

    this.screen = blessed.screen({
      smartCSR: true,
      title: 'JobClaw 🦞',
      fullUnicode: true,
      handleSIGINT: false,
    })

    // 1. 初始化组件
    this.jobTable = contrib.table({
      keys: true, vi: true, label: ' Job Monitor ', border: { type: 'line' },
      style: { header: { fg: 'cyan', bold: true }, cell: { fg: 'white', selected: { bg: 'blue' } } },
      columnWidth: [16, 20, 48, 12, 12],
    } as any)

    this.activityLog = blessed.log({
      label: ' Agent Activity ', border: { type: 'line' },
      scrollable: true, alwaysScroll: true,
      scrollbar: { ch: ' ', style: { inverse: true } },
      style: { fg: 'green' }, bufferLength: 1000,
      fullUnicode: true, tags: true, wrap: true, mouse: true,
    })

    this.inputBox = blessed.textbox({
      label: ' Command (Type /jobs to toggle) > ', border: { type: 'line' },
      style: { fg: 'yellow', focus: { border: { fg: 'yellow' } } },
      inputOnFocus: true, fullUnicode: true, tags: true,
      height: 3, // 稍微增加输入框高度，防止小屏幕下边框遮挡文字
    })

    // 执行初始布局计算
    this.applyLayout()

    this.screen.append(this.activityLog)
    this.screen.append(this.inputBox)

    this.channel = new TUIChannel(
      (line: string, type?: string) => {
        const color = type === 'error' ? '{red-fg}' : type === 'warn' ? '{yellow-fg}' : '{green-fg}'
        this.activityLog.log(`${color}${line}{/}`)
        this.activityLog.setScrollPerc(100)
        this.screen.render()
      },
      () => this.activityLog
    )

    // 2. 事件监听
    this.screen.on('resize', () => {
      this.applyLayout()
      this.screen.render()
    })

    this.screen.program.on('keypress', (_ch: string, key: any) => {
      if (key && key.ctrl && key.name === 'c') {
        const now = Date.now()
        if (now - this.lastCtrlC < 100) return
        if (now - this.lastCtrlC < 2000) {
          this.destroy()
          process.exit(0)
        } else {
          this.lastCtrlC = now
          this.activityLog.log('{yellow-fg}(System) [QUIT] 再按一次 Ctrl-C 退出 JobClaw{/}')
          this.activityLog.setScrollPerc(100)
          this.screen.render()
        }
      }
    })

    this.screen.key(['escape', 'q'], () => {
      this.destroy()
      process.exit(0)
    })

    this.inputBox.key('enter', async () => {
      const value = this.inputBox.getValue().trim()
      this.inputBox.clearValue()
      if (!value) { this.screen.render(); return }

      const originalLabel = this.inputBox.options.label || ' Command > '
      this.inputBox.setLabel(' [Running...] ')
      this.screen.render()

      try {
        await this.onCommand(value)
      } catch (err) {
        this.activityLog.log(`{red-fg}[error] ${(err as Error).message}{/}`)
        this.activityLog.setScrollPerc(100)
      } finally {
        this.inputBox.setLabel(originalLabel)
        this.inputBox.focus()
        this.screen.render()
      }
    })

    this.inputBox.focus()
    this.screen.render()
  }

  /** 统一布局计算逻辑 */
  private applyLayout(): void {
    const totalH = this.screen.height as number
    const inputH = 3
    
    if (this.showingJobs) {
      // 开启职位监控时的布局
      let jobH = Math.floor((totalH - inputH) * 0.5)
      let logH = totalH - inputH - jobH

      // 强制最小高度约束
      if (logH < MIN_LOG_HEIGHT) {
        logH = MIN_LOG_HEIGHT
        jobH = totalH - inputH - logH
      }
      if (jobH < MIN_JOB_HEIGHT) {
        jobH = MIN_JOB_HEIGHT
        logH = totalH - inputH - jobH
      }

      this.jobTable.top = 0
      this.jobTable.height = jobH
      this.jobTable.width = '100%'

      this.activityLog.top = jobH
      this.activityLog.height = logH
      this.activityLog.width = '100%'
    } else {
      // 纯日志对话模式
      this.activityLog.top = 0
      this.activityLog.height = totalH - inputH
      this.activityLog.width = '100%'
    }

    this.inputBox.top = totalH - inputH
    this.inputBox.width = '100%'
  }

  toggleJobs(): void {
    this.showingJobs = !this.showingJobs
    if (this.showingJobs) {
      this.screen.append(this.jobTable)
      this.startWatching()
    } else {
      this.screen.remove(this.jobTable)
    }
    this.applyLayout()
    this.inputBox.focus()
    this.activityLog.setScrollPerc(100)
    this.screen.render()
  }

  get tuiChannel(): TUIChannel { return this.channel }

  attachAgent(agent: BaseAgent): void {
    agent.on('intervention_required', ({ prompt, resolve, kind, options }: { prompt: string, resolve: (v: string) => void, kind?: string, options?: string[] }) => {
      this.showInterventionModal(prompt, resolve, agent, kind, options)
    })
  }

  startWatching(): void {
    this.refreshJobTable()
    if (this.watcher) return
    try {
      this.watcher = fs.watch(this.jobsPath, () => {
        if (this.refreshTimer) clearTimeout(this.refreshTimer)
        this.refreshTimer = setTimeout(() => this.refreshJobTable(), 100)
      })
    } catch {
      setInterval(() => this.refreshJobTable(), 1000)
    }
  }

  render(): void { this.screen.render() }

  destroy(): void {
    if (this.watcher) this.watcher.close()
    this.screen.destroy()
  }

  private refreshJobTable(): void {
    if (!this.showingJobs) return
    let rows: JobRow[] = []
    try {
      const content = fs.readFileSync(this.jobsPath, 'utf-8')
      rows = parseJobsMd(content)
    } catch { rows = [] }
    this.jobTable.setData({ headers: JOB_TABLE_HEADERS, data: rows.map((r) => [r.company, r.title, r.url, r.status, r.time]) })
    this.screen.render()
  }

  private showInterventionModal(
    prompt: string,
    resolve: (v: string) => void,
    agent: BaseAgent,
    kind?: string,
    options?: string[]
  ): void {
    const optionsText = Array.isArray(options) && options.length > 0
      ? `\n\n 可选项：\n ${options.map((value, index) => `${index + 1}. ${value}`).join('\n ')}`
      : ''
    const inputHint = kind === 'confirm'
      ? ' 请在下方输入 yes / no 后按 Enter 继续：'
      : ' 请在下方输入后按 Enter 继续：'
    const modal = blessed.box({
      top: 'center', left: 'center', width: '60%', height: 10, border: { type: 'line' },
      label: ' ⚠ 人工干预 ', style: { border: { fg: 'yellow' }, fg: 'white' }, tags: true,
      content: `\n {yellow-fg}${prompt}{/}${optionsText}\n\n${inputHint}`, fullUnicode: true,
    })
    const input = blessed.textbox({ parent: modal, top: 7, left: 2, right: 2, height: 1, style: { fg: 'yellow' }, inputOnFocus: true, fullUnicode: true })
    const cleanup = () => {
      this.screen.remove(modal); this.inputBox.focus(); this.screen.render()
      agent.removeListener('intervention_timeout', onTimeout); agent.removeListener('intervention_handled', onHandled)
    }
    const onTimeout = () => { this.activityLog.log(`{yellow-fg}[HITL] 超时已自动跳过{/}`); this.activityLog.setScrollPerc(100); cleanup() }
    const onHandled = () => cleanup()
    agent.once('intervention_timeout', onTimeout); agent.once('intervention_handled', onHandled)
    this.screen.append(modal); input.focus(); this.screen.render()
    input.key('enter', () => { const v = input.getValue(); cleanup(); resolve(v) })
    input.key('escape', () => { cleanup(); resolve('') })
  }
}
