import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ArtifactRecord } from '../runtime/contracts.js'
import { ensureStateSubdir } from '../infra/workspace/paths.js'

export class ArtifactStore {
  constructor(private workspaceRoot: string) {}

  private async artifactsDir(): Promise<string> {
    return ensureStateSubdir(this.workspaceRoot, 'artifacts')
  }

  async save(record: ArtifactRecord): Promise<void> {
    const dir = await this.artifactsDir()
    const filePath = path.join(dir, `${record.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf-8')
  }

  async list(): Promise<ArtifactRecord[]> {
    const dir = await this.artifactsDir()
    const entries = await fs.readdir(dir)
    const records: ArtifactRecord[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue
      const raw = await fs.readFile(path.join(dir, entry), 'utf-8')
      try {
        records.push(JSON.parse(raw) as ArtifactRecord)
      } catch {
        // ignore malformed artifact metadata
      }
    }
    return records
  }

  async recordGenerated(
    name: string,
    type: ArtifactRecord['type'],
    relPath: string,
    meta: Record<string, unknown> = {}
  ): Promise<ArtifactRecord> {
    const record: ArtifactRecord = {
      id: Date.now().toString(36),
      name,
      type,
      path: relPath,
      createdAt: new Date().toISOString(),
      meta,
    }
    await this.save(record)
    return record
  }
}
