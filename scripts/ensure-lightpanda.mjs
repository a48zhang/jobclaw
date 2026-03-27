#!/usr/bin/env node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const executablePath =
  process.env.LIGHTPANDA_EXECUTABLE_PATH ??
  path.join(os.homedir(), '.cache', 'lightpanda-node', 'lightpanda')

const hasExecutableBinary = (() => {
  if (!fs.existsSync(executablePath)) return false
  try {
    fs.accessSync(executablePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
})()

if (hasExecutableBinary) {
  process.exit(0)
}

console.error(`[e2e] Lightpanda binary is missing or not executable at ${executablePath}`)
console.error('[e2e] Downloading Lightpanda browser with the local package CLI...')

const cliPath = path.resolve('node_modules', '@lightpanda', 'browser', 'dist', 'cli', 'main.js')

if (!fs.existsSync(cliPath)) {
  console.error(`[e2e] Missing Lightpanda CLI at ${cliPath}`)
  process.exit(1)
}

const result = spawnSync(process.execPath, [cliPath, 'upgrade'], {
  stdio: 'inherit',
  env: process.env,
})

if (result.status !== 0 || !fs.existsSync(executablePath)) {
  console.error('[e2e] Failed to prepare the Lightpanda binary.')
  console.error('[e2e] Set LIGHTPANDA_EXECUTABLE_PATH to a valid binary or rerun with network access.')
  process.exit(result.status ?? 1)
}
