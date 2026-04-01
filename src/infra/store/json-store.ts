import * as fs from 'node:fs/promises'
import * as syncFs from 'node:fs'
import * as path from 'node:path'
import { acquireLock, releaseLock } from './file-lock.js'

export class JsonFileStore<T> {
  constructor(
    private filePath: string,
    private defaultValue: T,
    private workspaceRoot?: string
  ) {}

  private async ensureFile(): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    try {
      await fs.access(this.filePath)
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify(this.defaultValue, null, 2), 'utf-8')
    }
  }

  async read(): Promise<T> {
    await this.ensureFile()
    const content = await fs.readFile(this.filePath, 'utf-8')
    try {
      return JSON.parse(content) as T
    } catch {
      await fs.writeFile(this.filePath, JSON.stringify(this.defaultValue, null, 2), 'utf-8')
      return this.defaultValue
    }
  }

  async write(value: T): Promise<void> {
    const dir = path.dirname(this.filePath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.filePath, JSON.stringify(value, null, 2), 'utf-8')
  }

  writeSync(value: T): void {
    const dir = path.dirname(this.filePath)
    syncFs.mkdirSync(dir, { recursive: true })
    syncFs.writeFileSync(this.filePath, JSON.stringify(value, null, 2), 'utf-8')
  }

  async mutate(mutator: (current: T) => T | Promise<T>): Promise<T> {
    const current = await this.read()
    const updated = await mutator(current)
    await this.write(updated)
    return updated
  }

  /**
   * Atomically mutate the store with a file-level lock: acquires the lock,
   * reads current state, applies the mutator, writes the result, releases the lock.
   * Prevents TOCTOU races between concurrent callers (Issue 7 fix).
   *
   * The mutator returns { records, result } so callers can retrieve a derived value
   * (e.g., the updated ApplicationRecord) after the atomic update.
   */
  async mutateWithLock<U>(
    mutator: (current: T) => { records: T; result: U } | Promise<{ records: T; result: U }>,
    holder = 'JsonFileStore'
  ): Promise<U> {
    if (!this.workspaceRoot) {
      throw new Error('mutateWithLock requires workspaceRoot to be set on JsonFileStore')
    }
    await acquireLock(this.filePath, this.workspaceRoot, holder)
    try {
      const current = await this.read()
      const { records: updated, result } = await mutator(current)
      await this.write(updated)
      return result
    } finally {
      await releaseLock(this.filePath, this.workspaceRoot, holder)
    }
  }
}
