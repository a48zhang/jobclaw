#!/usr/bin/env tsx
import * as fs from 'node:fs'
import * as path from 'node:path'

// ── Global Crash Logger ───────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
  console.error('\n[JobClaw Error] 发生未捕获的异常:', error)
  const workspaceDir = path.resolve(process.cwd(), 'workspace')
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })
  const logFile = path.resolve(workspaceDir, 'crash.log')
  const message = `[${new Date().toISOString()}] CRASH: ${error.stack || error}\n`
  fs.appendFileSync(logFile, message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('\n[JobClaw Error] 发生未处理的 Promise 拒绝:', reason)
  const workspaceDir = path.resolve(process.cwd(), 'workspace')
  if (!fs.existsSync(workspaceDir)) fs.mkdirSync(workspaceDir, { recursive: true })
  const logFile = path.resolve(workspaceDir, 'crash.log')
  const message = `[${new Date().toISOString()}] REJECTION: ${reason}\n`
  fs.appendFileSync(logFile, message)
})

import { bootstrapCLI } from './cli/index.js'

bootstrapCLI()
