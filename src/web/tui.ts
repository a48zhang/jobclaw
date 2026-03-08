/**
 * TUI Dashboard - Phase 4 Team A
 * Full-screen interactive terminal dashboard using blessed & blessed-contrib
 *
 * Layout:
 *   ┌──────────────────────┬──────────────────┐
 *   │     Job Monitor      │  Stats Panel     │
 *   ├──────────────────────┴──────────────────┤
 *   │            Agent Activity Log           │
 *   ├─────────────────────────────────────────┤
 *   │                Input Box                │
 *   └─────────────────────────────────────────┘
 */
import * as blessed from 'blessed'
import * as contrib from 'blessed-contrib'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { TUIChannel } from '../channel/tui'
import type { BaseAgent } from '../agents/base/agent'

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
  /** Called when the user submits a command from the Input Box */
  onCommand: (input: string) => Promise<void>
}

// ─── jobs.md parser ───────────────────────────────────────────────────────────

/**
 * Parse jobs.md into an array of JobRow objects.
 * Gracefully skips malformed lines.
 */
export function parseJobsMd(content: string): JobRow[] {
  const rows: JobRow[] = []
  const lines = content.split('\n')

  let pastHeader = false
  for (const line of lines) {
    if (!line.trim().startsWith('|')) continue
    // Skip header separator lines like | --- |
    if (/^\|\s*[-:]+\s*\|/.test(line)) {
      pastHeader = true
      continue
    }
    if (!pastHeader) continue

    const cols = line.split('|').map((c) => c.trim())
    // cols[0] is empty (before first |), cols[1..5] are the data columns
    if (cols.length < 6) continue
    const [, company, title, url, status, time] = cols
    if (!company && !title) continue
    rows.push({ company: company ?? '', title: title ?? '', url: url ?? '', status: status ?? '', time: time ?? '' })
  }
  return rows
}

// Column headers for the Job Monitor table
const JOB_TABLE_HEADERS = ['公司', '职位', '链接', '状态', '时间']

export class TUI {
  private screen: blessed.Widgets.Screen
  private jobTable: contrib.Widgets.TableElement
  private activityLog: contrib.Widgets.LogElement
  private inputBox: blessed.Widgets.TextboxElement
  private channel: TUIChannel

  private workspaceRoot: string
  private jobsPath: string
  private onCommand: (input: string) => Promise<void>
  private watcher: fs.FSWatcher | null = null
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: TUIOptions) {
    this.workspaceRoot = options.workspaceRoot
    this.jobsPath = path.resolve(options.workspaceRoot, 'data/jobs.md')
    this.onCommand = options.onCommand

    // ── Screen ──────────────────────────────────────────────────────────────
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'JobClaw 🦞',
      fullUnicode: true,
    })

    // ── Grid (12 rows × 12 cols) ─────────────────────────────────────────────
    const grid = new contrib.grid({ rows: 12, cols: 12, screen: this.screen })

    // ── Job Monitor (top 7 rows × 12 cols) ──────────────────────────────────
    this.jobTable = grid.set(0, 0, 7, 12, contrib.table, {
      keys: true,
      vi: true,
      label: ' Job Monitor ',
      border: { type: 'line' },
      style: {
        header: { fg: 'cyan', bold: true },
        cell: { fg: 'white', selected: { bg: 'blue' } },
      },
      columnWidth: [16, 20, 48, 12, 12],
    } as contrib.Widgets.TableOptions)

    // ── Agent Activity Log (middle 4 rows × 12 cols) ─────────────────────────
    this.activityLog = grid.set(7, 0, 4, 12, contrib.log, {
      label: ' Agent Activity ',
      border: { type: 'line' },
      scrollable: true,
      style: { fg: 'green' },
      bufferLength: 200,
      fullUnicode: true,
      tags: true,
      wrap: true, // 开启自动换行
    } as contrib.Widgets.LogOptions)

    // ── Input Box (bottom 1 row × 12 cols) ───────────────────────────────────
    this.inputBox = grid.set(11, 0, 1, 12, blessed.textbox, {
      label: ' Command > ',
      border: { type: 'line' },
      style: { fg: 'yellow', focus: { border: { fg: 'yellow' } } },
      inputOnFocus: true,
      fullUnicode: true,
      tags: true,
    })

    // ── TUIChannel wired to Activity Log ─────────────────────────────────────
    this.channel = new TUIChannel((line, type) => {
      const color = type === 'error' ? '{red-fg}' : type === 'warn' ? '{yellow-fg}' : '{green-fg}'
      this.activityLog.log(`${color}${line}{/}`)
      this.screen.render()
    })

    // ── Key bindings ─────────────────────────────────────────────────────────
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.destroy()
      process.exit(0)
    })

    this.inputBox.key('enter', async () => {
      const value = this.inputBox.getValue().trim()
      this.inputBox.clearValue()
      if (!value) {
        this.screen.render()
        return
      }

      // Show busy status
      const originalLabel = this.inputBox.options.label || ' Command > '
      this.inputBox.setLabel(' [Running...] ')
      this.screen.render()

      try {
        await this.onCommand(value)
      } catch (err) {
        this.activityLog.log(`{red-fg}[error] ${(err as Error).message}{/}`)
      } finally {
        this.inputBox.setLabel(originalLabel)
        this.inputBox.focus()
        this.screen.render()
      }
    })

    this.inputBox.focus()
    this.screen.render()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** The TUIChannel instance to pass to agents */
  get tuiChannel(): TUIChannel {
    return this.channel
  }

  /**
   * Subscribe to a BaseAgent's lifecycle events.
   * Wires up `intervention_required` → modal prompt.
   */
  attachAgent(agent: BaseAgent): void {
    const onRequired = ({ prompt, resolve }: { prompt: string; resolve: (v: string) => void }) => {
      this.showInterventionModal(prompt, resolve, agent)
    }
    agent.on('intervention_required', onRequired)
  }

  /** Start watching jobs.md for changes */
  startWatching(): void {
    if (this.watcher) return

    // Initial render
    this.refreshJobTable()

    try {
      this.watcher = fs.watch(this.jobsPath, () => {
        // Debounce: refresh within 100ms of the last change
        if (this.refreshTimer) clearTimeout(this.refreshTimer)
        this.refreshTimer = setTimeout(() => {
          this.refreshJobTable()
        }, 100)
      })
    } catch {
      // File might not exist yet; poll instead
      setInterval(() => this.refreshJobTable(), 500)
    }
  }

  /** Render the TUI (call after setup) */
  render(): void {
    this.screen.render()
  }

  /** Clean up watchers and destroy the screen */
  destroy(): void {
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    this.screen.destroy()
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private refreshJobTable(): void {
    let rows: JobRow[] = []
    try {
      const content = fs.readFileSync(this.jobsPath, 'utf-8')
      rows = parseJobsMd(content)
    } catch {
      rows = []
    }

    const headers = JOB_TABLE_HEADERS
    const data = rows.map((r) => [r.company, r.title, r.url, r.status, r.time])

    this.jobTable.setData({ headers, data })
    this.screen.render()
  }

  /** Show a modal asking the user to enter intervention input */
  private showInterventionModal(prompt: string, resolve: (v: string) => void, agent: BaseAgent): void {
    const modal = blessed.box({
      top: 'center',
      left: 'center',
      width: '60%',
      height: 9,
      border: { type: 'line' },
      label: ' ⚠ 人工干预 ',
      style: { border: { fg: 'yellow' }, fg: 'white' },
      tags: true,
      content: `{yellow-fg}${prompt}{/}\n\n请在下方输入后按 Enter 继续：`,
      fullUnicode: true,
    })

    const input = blessed.textbox({
      parent: modal,
      top: 6,
      left: 2,
      right: 2,
      height: 1,
      style: { fg: 'yellow' },
      inputOnFocus: true,
      fullUnicode: true,
    })

    const cleanup = () => {
      this.screen.remove(modal)
      this.inputBox.focus()
      this.screen.render()
      agent.removeListener('intervention_timeout', onTimeout)
      agent.removeListener('intervention_handled', onHandled)
    }

    const onTimeout = () => {
      this.activityLog.log(`{yellow-fg}[HITL] 超时已自动跳过{/}`)
      cleanup()
    }

    const onHandled = () => {
      cleanup()
    }

    agent.once('intervention_timeout', onTimeout)
    agent.once('intervention_handled', onHandled)

    this.screen.append(modal)
    input.focus()
    this.screen.render()

    const submit = () => {
      const value = input.getValue()
      cleanup()
      resolve(value)
    }

    input.key('enter', submit)
    // Also allow Escape to resolve with empty string so Agent is not permanently stuck
    input.key('escape', () => {
      cleanup()
      resolve('')
    })
  }
}
