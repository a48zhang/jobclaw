import { cac } from 'cac'
import * as path from 'node:path'
import { runTUI } from '../tui-runner'
import { runCron } from '../cron'

export function bootstrapCLI() {
  const cli = cac('jobclaw')

  cli
    .command('', 'Start JobClaw in TUI mode (Default)')
    .option('-w, --workspace <path>', 'Path to workspace directory', { default: path.join(process.cwd(), 'workspace') })
    .action(async (options) => {
      await runTUI(options.workspace)
    })

  cli
    .command('cron', 'Run a single cron iteration (for daily summary/delivery)')
    .option('-w, --workspace <path>', 'Path to workspace directory', { default: path.join(process.cwd(), 'workspace') })
    .action(async (options) => {
      await runCron(options.workspace)
    })

  cli.help()
  cli.version('0.1.0')

  try {
    cli.parse()
  } catch (err) {
    if (err instanceof Error) {
      console.error(err.message)
    }
    process.exit(1)
  }
}
