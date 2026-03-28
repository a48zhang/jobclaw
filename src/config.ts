import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { migrateLegacyStateDirSync, resolveWorkspaceRoot } from './infra/workspace/paths.js'

export interface Config {
  API_KEY: string
  MODEL_ID: string
  LIGHT_MODEL_ID: string
  BASE_URL: string
  SERVER_PORT: number
}

export interface ConfigStatus {
  config: Config
  missingFields: Array<'API_KEY' | 'MODEL_ID' | 'BASE_URL'>
  ready: boolean
}

const DEFAULT_CONFIG: Config = {
  API_KEY: '',
  MODEL_ID: '',
  LIGHT_MODEL_ID: '',
  BASE_URL: '',
  SERVER_PORT: 3000,
}

const DEFAULT_USERINFO_MD = `# 个人信息

- 姓名：
- 邮箱：
- 手机：
- 个人主页：

## 求职意向

- 方向：
- 城市：
- 学历/年限：
- 关键词：

## 技能栈

- 语言：
- 框架：
- 工具：

## 项目经历

- 项目名称：
  - 时间：
  - 技术栈：
  - 亮点：
`

const DEFAULT_TARGETS_MD = `# 监测目标

> 每行一条目标，格式：公司名 | 网址 | 备注

- 示例公司 | https://example.com/jobs | 前端/后端
`

function ensureWorkspaceDirs(workspaceRoot: string): void {
  workspaceRoot = resolveWorkspaceRoot(workspaceRoot)
  const subdirs = ['agents', 'data', 'skills', 'output']
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true })
  }
  for (const dir of subdirs) {
    const dirPath = path.join(workspaceRoot, dir)
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }
}

function ensureDefaultMarkdowns(workspaceRoot: string): void {
  workspaceRoot = resolveWorkspaceRoot(workspaceRoot)
  const userinfoPath = path.join(workspaceRoot, 'data', 'userinfo.md')
  if (!fs.existsSync(userinfoPath)) {
    fs.writeFileSync(userinfoPath, DEFAULT_USERINFO_MD, 'utf-8')
  }

  const targetsPath = path.join(workspaceRoot, 'data', 'targets.md')
  if (!fs.existsSync(targetsPath)) {
    fs.writeFileSync(targetsPath, DEFAULT_TARGETS_MD, 'utf-8')
  }
}

function ensureDefaultSkills(workspaceRoot: string): void {
  workspaceRoot = resolveWorkspaceRoot(workspaceRoot)
  const workspaceSkillsPath = path.join(workspaceRoot, 'skills')
  try {
    const existingSkills = fs.readdirSync(workspaceSkillsPath)
    if (existingSkills.length === 0) {
      const codeSkillsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agents/skills')
      if (fs.existsSync(codeSkillsPath)) {
        fs.cpSync(codeSkillsPath, workspaceSkillsPath, { recursive: true })
        console.log(`[Config] 已将默认技能 SOP 拷贝至: ${workspaceSkillsPath}`)
      }
    }
  } catch (err) {
    console.error('[Config] 拷贝默认 Skills 失败:', (err as Error).message)
  }
}

export function ensureWorkspaceSetup(workspaceRoot: string): void {
  workspaceRoot = resolveWorkspaceRoot(workspaceRoot)
  ensureWorkspaceDirs(workspaceRoot)
  migrateLegacyStateDirSync(workspaceRoot)
  ensureDefaultMarkdowns(workspaceRoot)
  ensureDefaultSkills(workspaceRoot)
}

export function getConfigPath(workspaceRoot: string): string {
  return path.join(resolveWorkspaceRoot(workspaceRoot), 'config.json')
}

function ensureConfigTemplate(workspaceRoot: string): void {
  const configPath = getConfigPath(workspaceRoot)
  if (!fs.existsSync(configPath)) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
      console.log(`[Config] 已创建配置模板: ${configPath}`)
    } catch (err) {
      console.error('[Config] 无法创建配置文件:', (err as Error).message)
    }
  }
}

export function readConfigFile(workspaceRoot: string): Partial<Config> {
  ensureWorkspaceSetup(workspaceRoot)
  ensureConfigTemplate(workspaceRoot)

  const configPath = getConfigPath(workspaceRoot)
  if (!fs.existsSync(configPath)) {
    return {}
  }

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Partial<Config>
  } catch (err) {
    console.error(`[Config] 无法解析 ${configPath}:`, (err as Error).message)
    return {}
  }
}

function normalizePort(value: unknown): number {
  const port = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(port) && port > 0 ? port : DEFAULT_CONFIG.SERVER_PORT
}

function resolveConfig(fileConfig: Partial<Config>): Config {
  const resolvedModel = fileConfig.MODEL_ID || process.env['MODEL_ID'] || process.env['MODEL'] || DEFAULT_CONFIG.MODEL_ID
  const resolvedLightModel = fileConfig.LIGHT_MODEL_ID || process.env['LIGHT_MODEL_ID'] || process.env['LIGHT_MODEL'] || ''

  return {
    API_KEY: fileConfig.API_KEY || process.env['API_KEY'] || process.env['OPENAI_API_KEY'] || DEFAULT_CONFIG.API_KEY,
    MODEL_ID: resolvedModel,
    LIGHT_MODEL_ID: resolvedLightModel || resolvedModel,
    BASE_URL: fileConfig.BASE_URL || process.env['BASE_URL'] || process.env['OPENAI_BASE_URL'] || DEFAULT_CONFIG.BASE_URL,
    SERVER_PORT: normalizePort(process.env['SERVER_PORT'] || fileConfig.SERVER_PORT),
  }
}

export function getConfigStatus(workspaceRoot: string): ConfigStatus {
  const config = resolveConfig(readConfigFile(workspaceRoot))
  const missingFields: Array<'API_KEY' | 'MODEL_ID' | 'BASE_URL'> = []

  if (!config.API_KEY) missingFields.push('API_KEY')
  if (!config.MODEL_ID) missingFields.push('MODEL_ID')
  if (!config.BASE_URL) missingFields.push('BASE_URL')

  return {
    config,
    missingFields,
    ready: missingFields.length === 0,
  }
}

export function loadConfig(workspaceRoot: string): Config {
  return getConfigStatus(workspaceRoot).config
}

export function saveConfigFile(workspaceRoot: string, updates: Partial<Config>): Config {
  ensureWorkspaceSetup(workspaceRoot)
  ensureConfigTemplate(workspaceRoot)

  const configPath = getConfigPath(workspaceRoot)
  const current = readConfigFile(workspaceRoot)
  const next: Config = {
    ...DEFAULT_CONFIG,
    ...current,
    ...updates,
    SERVER_PORT: normalizePort(updates.SERVER_PORT ?? current.SERVER_PORT ?? DEFAULT_CONFIG.SERVER_PORT),
  }

  if (!next.LIGHT_MODEL_ID) {
    next.LIGHT_MODEL_ID = next.MODEL_ID
  }

  fs.writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf-8')
  return next
}
