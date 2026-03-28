import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { getStatePath, migrateLegacyStateDirSync, resolveWorkspaceRoot } from '../../../src/infra/workspace/paths.js'

describe('workspace path helpers', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    }
  })

  it('normalizes a project root to its nested workspace directory', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-project-root-'))
    tempDirs.push(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"jobclaw-test"}', 'utf-8')

    expect(resolveWorkspaceRoot(projectRoot)).toBe(path.join(projectRoot, 'workspace'))
    expect(getStatePath(projectRoot, 'jobs', 'jobs.json')).toBe(path.join(projectRoot, 'workspace', 'state', 'jobs', 'jobs.json'))
  })

  it('migrates legacy root state into workspace/state and keeps existing workspace files authoritative', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jobclaw-legacy-state-'))
    tempDirs.push(projectRoot)
    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true })
    fs.writeFileSync(path.join(projectRoot, 'package.json'), '{"name":"jobclaw-test"}', 'utf-8')

    const legacyStateDir = path.join(projectRoot, 'state')
    const workspaceRoot = path.join(projectRoot, 'workspace')
    const canonicalStateDir = path.join(workspaceRoot, 'state')

    fs.mkdirSync(path.join(legacyStateDir, 'jobs'), { recursive: true })
    fs.mkdirSync(path.join(legacyStateDir, 'user'), { recursive: true })
    fs.mkdirSync(path.join(legacyStateDir, 'strategy'), { recursive: true })
    fs.mkdirSync(path.join(canonicalStateDir, 'strategy'), { recursive: true })

    fs.writeFileSync(path.join(legacyStateDir, 'jobs', 'jobs.json'), '[{"id":"legacy-job"}]', 'utf-8')
    fs.writeFileSync(path.join(legacyStateDir, 'user', 'facts.json'), '{"version":1,"skills":["legacy"]}', 'utf-8')
    fs.writeFileSync(path.join(legacyStateDir, 'strategy', 'preferences.json'), '{"updatedAt":"old"}', 'utf-8')
    fs.writeFileSync(path.join(canonicalStateDir, 'strategy', 'preferences.json'), '{"updatedAt":"new"}', 'utf-8')

    migrateLegacyStateDirSync(projectRoot)

    expect(fs.existsSync(legacyStateDir)).toBe(false)
    expect(fs.readFileSync(path.join(canonicalStateDir, 'jobs', 'jobs.json'), 'utf-8')).toBe('[{"id":"legacy-job"}]')
    expect(fs.readFileSync(path.join(canonicalStateDir, 'user', 'facts.json'), 'utf-8')).toBe('{"version":1,"skills":["legacy"]}')
    expect(fs.readFileSync(path.join(canonicalStateDir, 'strategy', 'preferences.json'), 'utf-8')).toBe('{"updatedAt":"new"}')
  })
})
