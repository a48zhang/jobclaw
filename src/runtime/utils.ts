import * as fs from 'node:fs'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'

export function nowIso(): string {
  return new Date().toISOString()
}

export function createRuntimeId(prefix: string): string {
  return `${prefix}_${randomUUID()}`
}

export function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

export function ensureRuntimeStateDirs(workspaceRoot: string): void {
  const relativeDirs = [
    'state/session',
    'state/delegation',
    'state/interventions',
    'state/jobs',
    'state/applications',
    'state/strategy',
    'state/user',
    'state/artifacts',
  ]

  for (const relativeDir of relativeDirs) {
    ensureDir(path.resolve(workspaceRoot, relativeDir))
  }
}
