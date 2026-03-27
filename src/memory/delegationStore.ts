import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { DelegatedRun } from '../runtime/contracts.js'
import { getDelegationPath, ensureStateSubdir } from '../infra/workspace/paths.js'

export class DelegationStore {
  constructor(private workspaceRoot: string) {}

  private async delegationDir(): Promise<string> {
    return ensureStateSubdir(this.workspaceRoot, 'delegation')
  }

  async save(run: DelegatedRun): Promise<void> {
    const dir = await this.delegationDir()
    const filePath = path.join(dir, `${run.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(run, null, 2), 'utf-8')
  }

  async get(id: string): Promise<DelegatedRun | undefined> {
    const filePath = getDelegationPath(this.workspaceRoot, id)
    try {
      const data = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(data) as DelegatedRun
    } catch {
      return undefined
    }
  }

  async list(): Promise<DelegatedRun[]> {
    const dir = await this.delegationDir()
    const entries = await fs.readdir(dir)
    const runs: DelegatedRun[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const raw = await fs.readFile(path.join(dir, entry), 'utf-8')
      try {
        runs.push(JSON.parse(raw) as DelegatedRun)
      } catch {
        // skip invalid files
      }
    }
    return runs
  }

  async listByParent(parentSessionId: string): Promise<DelegatedRun[]> {
    const runs = await this.list()
    return runs.filter((run) => run.parentSessionId === parentSessionId)
  }
}
