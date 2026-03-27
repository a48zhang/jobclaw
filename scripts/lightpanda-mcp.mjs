#!/usr/bin/env node
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { lightpanda } from '@lightpanda/browser'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '..')
const mcpCliPath = path.resolve(repoRoot, 'node_modules/@playwright/mcp/cli.js')

const host = process.env.LIGHTPANDA_HOST || '127.0.0.1'
const port = Number.parseInt(process.env.LIGHTPANDA_CDP_PORT || '9222', 10)
const forwardedArgs = process.argv.slice(2)

let lightpandaProc
let mcpProc
let shuttingDown = false

async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true

  if (mcpProc && !mcpProc.killed) {
    mcpProc.kill('SIGTERM')
  }

  if (lightpandaProc) {
    lightpandaProc.stdout.destroy()
    lightpandaProc.stderr.destroy()
    lightpandaProc.kill()
  }

  process.exit(code)
}

process.on('SIGINT', () => shutdown(130))
process.on('SIGTERM', () => shutdown(143))

try {
  lightpandaProc = await lightpanda.serve({ host, port })

  const cdpEndpoint = `http://${host}:${port}`
  const args = ['--cdp-endpoint', cdpEndpoint, ...forwardedArgs]

  mcpProc = spawn(process.execPath, [mcpCliPath, ...args], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  })

  mcpProc.on('exit', (code, signal) => {
    if (signal === 'SIGINT') return shutdown(130)
    if (signal === 'SIGTERM') return shutdown(143)
    return shutdown(code ?? 0)
  })

  mcpProc.on('error', async (error) => {
    console.error('[lightpanda-mcp] Failed to start Playwright MCP:', error)
    await shutdown(1)
  })
} catch (error) {
  console.error('[lightpanda-mcp] Failed to start Lightpanda MCP bridge:', error)
  await shutdown(1)
}
