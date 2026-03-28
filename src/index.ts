#!/usr/bin/env tsx
import * as fs from 'node:fs'
import * as path from 'node:path'
import { resolveWorkspaceRoot } from './infra/workspace/paths.js'

function getCrashWorkspaceDir(): string {
  const workspaceArgIndex = process.argv.findIndex((arg) => arg === '--workspace' || arg === '-w')
  const configuredWorkspace =
    workspaceArgIndex >= 0 && typeof process.argv[workspaceArgIndex + 1] === 'string'
      ? process.argv[workspaceArgIndex + 1]
      : path.resolve(process.cwd(), 'workspace')
  return resolveWorkspaceRoot(configuredWorkspace)
}

// ── Global Crash Logger ───────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
  console.error('\n[JobClaw Error] 发生未捕获的异常:', error)
  const workspaceDir = getCrashWorkspaceDir()
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })
  const logFile = path.resolve(workspaceDir, 'crash.log')
  const message = `[${new Date().toISOString()}] CRASH: ${error.stack || error}\n`
  fs.appendFileSync(logFile, message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('\n[JobClaw Error] 发生未处理的 Promise 拒绝:', reason)
  const workspaceDir = getCrashWorkspaceDir()
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })
  const logFile = path.resolve(workspaceDir, 'crash.log')
  const message = `[${new Date().toISOString()}] REJECTION: ${reason}\n`
  fs.appendFileSync(logFile, message)
})

import { bootstrapCLI } from './cli/index.js'

bootstrapCLI()
