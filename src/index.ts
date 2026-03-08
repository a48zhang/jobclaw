#!/usr/bin/env bun
import * as fs from 'node:fs'
import * as path from 'node:path'

// ── Global Crash Logger ───────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
  console.error('\n[JobClaw Error] 发生未捕获的异常:', error)
  const logFile = path.resolve(process.cwd(), 'crash.log')
  const message = `[${new Date().toISOString()}] CRASH: ${error.stack || error}\n`
  fs.appendFileSync(logFile, message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  console.error('\n[JobClaw Error] 发生未处理的 Promise 拒绝:', reason)
  const logFile = path.resolve(process.cwd(), 'crash.log')
  const message = `[${new Date().toISOString()}] REJECTION: ${reason}\n`
  fs.appendFileSync(logFile, message)
})

import { bootstrapCLI } from './cli'

bootstrapCLI()
