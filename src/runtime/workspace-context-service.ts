import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { getDataPath } from '../infra/workspace/paths.js'
import { lockFile, unlockFile } from '../tools/lockFile.js'
import { checkPathPermission, normalizeAndValidatePath } from '../tools/utils.js'
import type { AgentProfile, CapabilityPolicy } from './capability-types.js'

const TARGETS_FILE = 'targets.md'
const USERINFO_FILE = 'userinfo.md'
const DEFAULT_TARGETS_HEADER = '# 监测目标'
const DEFAULT_USERINFO_HEADER = '# 用户信息'

interface ParsedTargetEntry {
  lineIndex: number
  company: string
  url: string
  notes: string
  key: string
}

interface ParsedUserinfoEntry {
  lineIndex: number
  field: string
  value: string
  style: 'bullet' | 'plain'
  key: string
}

export interface WorkspaceTargetInput {
  company?: string
  url?: string
  notes?: string
}

export interface WorkspaceContextUpdateInput {
  targets?: WorkspaceTargetInput[]
  userinfo?: Record<string, unknown>
  source?: string
}

export interface WorkspaceContextUpdateContext {
  workspaceRoot: string
  agentName: string
  profile?: AgentProfile
  capabilityPolicy?: CapabilityPolicy
}

export interface WorkspaceContextTargetSummary {
  requested: number
  added: number
  updated: number
  deduplicated: number
  ignoredInvalid: number
  unchanged: number
}

export interface WorkspaceContextUserinfoSummary {
  requested: number
  filled: number
  added: number
  deduplicated: number
  skippedEmpty: number
  skippedConflicts: number
  unchanged: number
}

export interface WorkspaceContextUpdateResult {
  changed: boolean
  updatedFiles: string[]
  source: string | null
  summary: string
  targets: WorkspaceContextTargetSummary
  userinfo: WorkspaceContextUserinfoSummary
}

export class WorkspaceContextService {
  constructor(private readonly context: WorkspaceContextUpdateContext) {}

  async update(input: WorkspaceContextUpdateInput): Promise<WorkspaceContextUpdateResult> {
    validateInputShape(input)

    const wantsTargets = Array.isArray(input.targets)
    const wantsUserinfo = Boolean(input.userinfo && typeof input.userinfo === 'object' && !Array.isArray(input.userinfo))

    if (!wantsTargets && !wantsUserinfo) {
      throw new Error('至少提供 targets 或 userinfo 其中一项')
    }

    const workspaceRoot = this.context.workspaceRoot
    const targetsAbsPath = getDataPath(workspaceRoot, TARGETS_FILE)
    const userinfoAbsPath = getDataPath(workspaceRoot, USERINFO_FILE)
    const touchedFiles = [
      ...(wantsTargets ? [{ absPath: targetsAbsPath, relPath: toWorkspaceRelative(workspaceRoot, targetsAbsPath), kind: 'targets' as const }] : []),
      ...(wantsUserinfo ? [{ absPath: userinfoAbsPath, relPath: toWorkspaceRelative(workspaceRoot, userinfoAbsPath), kind: 'userinfo' as const }] : []),
    ].sort((a, b) => a.relPath.localeCompare(b.relPath))

    for (const item of touchedFiles) {
      assertWritablePath(item.absPath, this.context)
      await ensureFileExists(item.absPath)
    }

    const acquiredLocks: string[] = []
    try {
      for (const item of touchedFiles) {
        await lockFile(item.relPath, this.context.agentName, workspaceRoot)
        acquiredLocks.push(item.relPath)
      }

      const targetResult = wantsTargets
        ? await mergeTargetsFile(targetsAbsPath, input.targets ?? [])
        : { changed: false, summary: createEmptyTargetSummary() }
      const userinfoResult = wantsUserinfo
        ? await mergeUserinfoFile(userinfoAbsPath, input.userinfo ?? {})
        : { changed: false, summary: createEmptyUserinfoSummary() }

      const updatedFiles: string[] = []
      if (targetResult.changed) updatedFiles.push(`data/${TARGETS_FILE}`)
      if (userinfoResult.changed) updatedFiles.push(`data/${USERINFO_FILE}`)

      return {
        changed: updatedFiles.length > 0,
        updatedFiles,
        source: normalizeOptionalString(input.source),
        summary: buildSummary(targetResult.summary, userinfoResult.summary),
        targets: targetResult.summary,
        userinfo: userinfoResult.summary,
      }
    } finally {
      for (const relPath of acquiredLocks.reverse()) {
        await unlockFile(relPath, this.context.agentName, workspaceRoot).catch(() => {})
      }
    }
  }
}

function validateInputShape(input: WorkspaceContextUpdateInput): void {
  if (!input || typeof input !== 'object') {
    throw new Error('参数必须是对象')
  }
  if (input.targets !== undefined && !Array.isArray(input.targets)) {
    throw new Error('targets 必须是数组')
  }
  if (input.userinfo !== undefined && (!input.userinfo || typeof input.userinfo !== 'object' || Array.isArray(input.userinfo))) {
    throw new Error('userinfo 必须是对象')
  }
}

function assertWritablePath(absPath: string, context: WorkspaceContextUpdateContext): void {
  const relativeFromWorkspace = toWorkspaceRelative(context.workspaceRoot, absPath)
  const normalizedPath = normalizeAndValidatePath(relativeFromWorkspace, context.workspaceRoot)
  if (!normalizedPath) {
    throw new Error(`路径不安全，拒绝访问：${relativeFromWorkspace}`)
  }
  const permission = checkPathPermission(
    normalizedPath,
    context.agentName,
    'write',
    context.workspaceRoot,
    context,
    { requireSharedWriteLock: false }
  )
  if (!permission.allowed) {
    throw new Error(permission.reason)
  }
}

async function ensureFileExists(absPath: string): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  try {
    await fs.access(absPath)
  } catch {
    await atomicWriteText(absPath, '')
  }
}

async function mergeTargetsFile(absPath: string, updates: WorkspaceTargetInput[]): Promise<{
  changed: boolean
  summary: WorkspaceContextTargetSummary
}> {
  const originalContent = await readText(absPath)
  const originalLines = splitLines(originalContent)
  const lines = originalLines.length === 0 ? [DEFAULT_TARGETS_HEADER] : [...originalLines]
  const summary: WorkspaceContextTargetSummary = {
    requested: updates.length,
    added: 0,
    updated: 0,
    deduplicated: 0,
    ignoredInvalid: 0,
    unchanged: 0,
  }

  let changed = originalLines.length === 0
  changed = dedupeTargetLines(lines, summary) || changed

  let entries = collectTargets(lines)
  const seenIncoming = new Set<string>()

  for (const item of updates) {
    const normalized = normalizeTargetInput(item)
    if (!normalized) {
      summary.ignoredInvalid += 1
      continue
    }
    if (seenIncoming.has(normalized.key)) {
      summary.unchanged += 1
      continue
    }
    seenIncoming.add(normalized.key)

    const existing = entries.get(normalized.key)
    if (!existing) {
      lines.push(formatTargetLine(normalized.company, normalized.url, normalized.notes))
      summary.added += 1
      changed = true
      entries = collectTargets(lines)
      continue
    }

    if (!existing.notes && normalized.notes) {
      lines[existing.lineIndex] = formatTargetLine(existing.company, existing.url, normalized.notes)
      summary.updated += 1
      changed = true
      entries = collectTargets(lines)
      continue
    }
    summary.unchanged += 1
  }

  if (changed) {
    await atomicWriteText(absPath, joinLines(lines))
  }

  return { changed, summary }
}

async function mergeUserinfoFile(absPath: string, updates: Record<string, unknown>): Promise<{
  changed: boolean
  summary: WorkspaceContextUserinfoSummary
}> {
  const originalContent = await readText(absPath)
  const originalLines = splitLines(originalContent)
  const lines = originalLines.length === 0 ? [DEFAULT_USERINFO_HEADER] : [...originalLines]
  const summary: WorkspaceContextUserinfoSummary = {
    requested: Object.keys(updates).length,
    filled: 0,
    added: 0,
    deduplicated: 0,
    skippedEmpty: 0,
    skippedConflicts: 0,
    unchanged: 0,
  }

  let changed = originalLines.length === 0
  changed = dedupeUserinfoLines(lines, summary) || changed

  let entries = collectUserinfo(lines)
  for (const [rawField, rawValue] of Object.entries(updates)) {
    const field = rawField.trim()
    if (!field) {
      summary.skippedEmpty += 1
      continue
    }
    const value = normalizeUserinfoValue(rawValue)
    if (!value) {
      summary.skippedEmpty += 1
      continue
    }

    const key = normalizeKey(field)
    const existing = entries.get(key)
    if (!existing) {
      lines.push(formatUserinfoLine(field, value))
      summary.added += 1
      changed = true
      entries = collectUserinfo(lines)
      continue
    }

    if (!existing.value) {
      lines[existing.lineIndex] = formatUserinfoLine(existing.field, value, existing.style)
      summary.filled += 1
      changed = true
      entries = collectUserinfo(lines)
      continue
    }
    if (existing.value === value) {
      summary.unchanged += 1
      continue
    }
    summary.skippedConflicts += 1
  }

  if (changed) {
    await atomicWriteText(absPath, joinLines(lines))
  }

  return { changed, summary }
}

function dedupeTargetLines(lines: string[], summary: WorkspaceContextTargetSummary): boolean {
  const seen = new Map<string, ParsedTargetEntry>()
  const removeIndices = new Set<number>()

  lines.forEach((line, index) => {
    const parsed = parseTargetLine(line, index)
    if (!parsed) return
    const existing = seen.get(parsed.key)
    if (!existing) {
      seen.set(parsed.key, parsed)
      return
    }
    removeIndices.add(index)
    summary.deduplicated += 1
    if (!existing.notes && parsed.notes) {
      lines[existing.lineIndex] = formatTargetLine(existing.company, existing.url, parsed.notes)
    }
  })

  if (removeIndices.size === 0) return false
  const kept = lines.filter((_, index) => !removeIndices.has(index))
  lines.splice(0, lines.length, ...kept)
  return true
}

function dedupeUserinfoLines(lines: string[], summary: WorkspaceContextUserinfoSummary): boolean {
  const seen = new Map<string, ParsedUserinfoEntry>()
  const removeIndices = new Set<number>()

  lines.forEach((line, index) => {
    const parsed = parseUserinfoLine(line, index)
    if (!parsed) return
    const existing = seen.get(parsed.key)
    if (!existing) {
      seen.set(parsed.key, parsed)
      return
    }
    removeIndices.add(index)
    summary.deduplicated += 1
    if (!existing.value && parsed.value) {
      lines[existing.lineIndex] = formatUserinfoLine(existing.field, parsed.value, existing.style)
    }
  })

  if (removeIndices.size === 0) return false
  const kept = lines.filter((_, index) => !removeIndices.has(index))
  lines.splice(0, lines.length, ...kept)
  return true
}

function collectTargets(lines: string[]): Map<string, ParsedTargetEntry> {
  const map = new Map<string, ParsedTargetEntry>()
  lines.forEach((line, index) => {
    const parsed = parseTargetLine(line, index)
    if (!parsed) return
    if (!map.has(parsed.key)) map.set(parsed.key, parsed)
  })
  return map
}

function collectUserinfo(lines: string[]): Map<string, ParsedUserinfoEntry> {
  const map = new Map<string, ParsedUserinfoEntry>()
  lines.forEach((line, index) => {
    const parsed = parseUserinfoLine(line, index)
    if (!parsed) return
    if (!map.has(parsed.key)) map.set(parsed.key, parsed)
  })
  return map
}

function parseTargetLine(line: string, lineIndex: number): ParsedTargetEntry | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('- ')) return null
  const raw = trimmed.slice(2).trim()
  const parts = raw.split('|').map((part) => part.trim())
  if (parts.length < 2) return null
  const company = parts[0]
  const url = parts[1]
  if (!company || !isValidHttpUrl(url)) return null
  const notes = parts.slice(2).join(' | ').trim()
  return {
    lineIndex,
    company,
    url,
    notes,
    key: buildTargetKey(company, url),
  }
}

function parseUserinfoLine(line: string, lineIndex: number): ParsedUserinfoEntry | null {
  const bulletMatch = line.match(/^\s*-\s*([^:：\n]+?)\s*[：:]\s*(.*)$/)
  if (bulletMatch) {
    const field = bulletMatch[1]?.trim()
    if (!field) return null
    return {
      lineIndex,
      field,
      value: (bulletMatch[2] ?? '').trim(),
      style: 'bullet',
      key: normalizeKey(field),
    }
  }

  const plainMatch = line.match(/^\s*([^#\-\s][^:：\n]*?)\s*[：:]\s*(.*)$/)
  if (!plainMatch) return null
  const field = plainMatch[1]?.trim()
  if (!field) return null
  return {
    lineIndex,
    field,
    value: (plainMatch[2] ?? '').trim(),
    style: 'plain',
    key: normalizeKey(field),
  }
}

function normalizeTargetInput(item: WorkspaceTargetInput): {
  company: string
  url: string
  notes: string
  key: string
} | null {
  const company = normalizeOptionalString(item.company) ?? ''
  const url = normalizeOptionalString(item.url) ?? ''
  const notes = normalizeOptionalString(item.notes) ?? ''
  if (!company || !url || !isValidHttpUrl(url)) return null
  return { company, url, notes, key: buildTargetKey(company, url) }
}

function normalizeUserinfoValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim()
  return ''
}

function buildTargetKey(company: string, url: string): string {
  return `${normalizeKey(company)}|${normalizeUrlForKey(url)}`
}

function normalizeUrlForKey(value: string): string {
  try {
    const parsed = new URL(value)
    parsed.hash = ''
    if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1)
    }
    return parsed.toString().toLowerCase()
  } catch {
    return value.trim().toLowerCase()
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase()
}

function formatTargetLine(company: string, url: string, notes?: string): string {
  const suffix = notes && notes.trim().length > 0 ? ` | ${notes.trim()}` : ''
  return `- ${company} | ${url}${suffix}`
}

function formatUserinfoLine(field: string, value: string, style: 'bullet' | 'plain' = 'bullet'): string {
  const content = `${field}：${value}`
  return style === 'plain' ? content : `- ${content}`
}

function buildSummary(targets: WorkspaceContextTargetSummary, userinfo: WorkspaceContextUserinfoSummary): string {
  const parts = [
    `targets: 新增 ${targets.added}，补全 ${targets.updated}，去重 ${targets.deduplicated}，忽略 ${targets.ignoredInvalid}`,
    `userinfo: 新增 ${userinfo.added}，补全 ${userinfo.filled}，去重 ${userinfo.deduplicated}，冲突跳过 ${userinfo.skippedConflicts}，空值跳过 ${userinfo.skippedEmpty}`,
  ]
  return parts.join('；')
}

function createEmptyTargetSummary(): WorkspaceContextTargetSummary {
  return {
    requested: 0,
    added: 0,
    updated: 0,
    deduplicated: 0,
    ignoredInvalid: 0,
    unchanged: 0,
  }
}

function createEmptyUserinfoSummary(): WorkspaceContextUserinfoSummary {
  return {
    requested: 0,
    filled: 0,
    added: 0,
    deduplicated: 0,
    skippedEmpty: 0,
    skippedConflicts: 0,
    unchanged: 0,
  }
}

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf-8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

function splitLines(content: string): string[] {
  if (!content) return []
  return content.replace(/\r\n/g, '\n').split('\n')
}

function joinLines(lines: string[]): string {
  return lines.join('\n')
}

function toWorkspaceRelative(workspaceRoot: string, absPath: string): string {
  return path.relative(path.resolve(workspaceRoot), absPath).replace(/\\/g, '/')
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}`
  await fs.writeFile(tempPath, content, 'utf-8')
  await fs.rename(tempPath, filePath)
}
