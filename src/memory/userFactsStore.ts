import { JsonFileStore } from '../infra/store/json-store.js'
import { getUserFactsPath } from '../infra/workspace/paths.js'
import type { UserFacts } from '../runtime/contracts.js'

const DEFAULT_FACTS: UserFacts = {
  version: 1,
  targetRoles: [],
  targetLocations: [],
  skills: [],
  constraints: [],
  sourceRefs: [],
}

export class UserFactsStore {
  private store: JsonFileStore<UserFacts>

  constructor(private workspaceRoot: string) {
    this.store = new JsonFileStore(getUserFactsPath(workspaceRoot), DEFAULT_FACTS)
  }

  async get(): Promise<UserFacts> {
    return this.store.read()
  }

  async update(updater: (current: UserFacts) => UserFacts | Promise<UserFacts>): Promise<UserFacts> {
    const updated = await this.store.mutate(updater)
    return updated
  }

  async importFromMarkdown(content: string, sourceRef: string): Promise<UserFacts> {
    const partial = parseUserFacts(content)
    return this.store.mutate((current) => {
      const merged: UserFacts = {
        ...current,
        version: current.version + 1,
        targetRoles: partial.targetRoles ?? current.targetRoles,
        targetLocations: partial.targetLocations ?? current.targetLocations,
        seniority: partial.seniority ?? current.seniority,
        skills: mergeArrays(current.skills, partial.skills),
        constraints: mergeArrays(current.constraints, partial.constraints),
        sourceRefs: mergeArrays(current.sourceRefs, [sourceRef], true),
      }
      return merged
    })
  }
}

function mergeArrays(
  base: string[],
  addition: string[] | undefined,
  unique = true
): string[] {
  if (!addition || addition.length === 0) {
    return base
  }
  const merged = [...base, ...addition]
  return unique ? Array.from(new Set(merged)) : merged
}

function parseUserFacts(content: string): Partial<UserFacts> {
  const parsed: Partial<UserFacts> = {}
  let currentSection = ''
  const lines = content.split(/\r?\n/)

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('##')) {
      currentSection = trimmed.replace(/^##\s*/, '').trim()
      continue
    }

    if (!trimmed.startsWith('-')) continue

    const [, keyRaw, valueRaw] = trimmed.match(/^-+\s*([^：:]+)\s*[：:]\s*(.*)$/) ?? []
    if (!keyRaw) continue
    const key = keyRaw.trim()
    const value = valueRaw?.trim()
    if (!value) continue

    switch (true) {
      case key.includes('方向'):
        parsed.targetRoles = splitValue(value)
        break
      case key.includes('城市'):
        parsed.targetLocations = splitValue(value)
        break
      case key.includes('学历'):
      case key.includes('年限'):
        parsed.seniority = value
        break
      case key.includes('关键词'):
        parsed.constraints = splitValue(value)
        break
      case currentSection.includes('技能'):
        parsed.skills = mergeArrays(parsed.skills ?? [], splitValue(value))
        break
      default:
        if (['语言', '框架', '工具'].some((marker) => key.includes(marker))) {
          parsed.skills = mergeArrays(parsed.skills ?? [], splitValue(value))
        }
    }
  }

  return parsed
}

function splitValue(value: string): string[] {
  return value
    .split(/[，,、;/]/)
    .map((item) => item.trim())
    .filter(Boolean)
}
