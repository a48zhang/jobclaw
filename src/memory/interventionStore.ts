import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { InterventionRecord } from '../runtime/contracts.js'
import { getInterventionPath, ensureStateSubdir } from '../infra/workspace/paths.js'

export class InterventionStore {
  constructor(private workspaceRoot: string) {}

  private async dir(): Promise<string> {
    return ensureStateSubdir(this.workspaceRoot, 'interventions')
  }

  async save(record: InterventionRecord): Promise<void> {
    const dir = await this.dir()
    const filePath = path.join(dir, `${record.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8')
  }

  async get(id: string): Promise<InterventionRecord | undefined> {
    const filePath = getInterventionPath(this.workspaceRoot, id)
    try {
      const raw = await fs.readFile(filePath, 'utf-8')
      return JSON.parse(raw) as InterventionRecord
    } catch {
      return undefined
    }
  }

  async list(): Promise<InterventionRecord[]> {
    const dir = await this.dir()
    const entries = await fs.readdir(dir)
    const records: InterventionRecord[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const raw = await fs.readFile(path.join(dir, entry), 'utf-8')
      try {
        records.push(JSON.parse(raw) as InterventionRecord)
      } catch {
        // skip invalid
      }
    }
    return records
  }

  async listByState(state: InterventionRecord['status']): Promise<InterventionRecord[]> {
    const records = await this.list()
    return records.filter((record) => record.status === state)
  }

  async update(record: InterventionRecord): Promise<void> {
    await this.save(record)
  }
}
