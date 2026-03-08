#!/usr/bin/env bun
import * as fs from 'node:fs'
import * as path from 'node:path'

// ── Global Crash Logger ───────────────────────────────────────────────────
process.on('uncaughtException', (error) => {
  const logFile = path.resolve(process.cwd(), 'crash.log')
  const message = `[${new Date().toISOString()}] CRASH: ${error.stack || error}\n`
  fs.appendFileSync(logFile, message)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  const logFile = path.resolve(process.cwd(), 'crash.log')
  const message = `[${new Date().toISOString()}] REJECTION: ${reason}\n`
  fs.appendFileSync(logFile, message)
})

import { bootstrapCLI } from './cli'

bootstrapCLI()
