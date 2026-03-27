import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export class JsonFileStore<T> {
  constructor(private filePath: string, private defaultValue: T) {}

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

  async mutate(mutator: (current: T) => T | Promise<T>): Promise<T> {
    const current = await this.read()
    const updated = await mutator(current)
    await this.write(updated)
    return updated
  }
}
