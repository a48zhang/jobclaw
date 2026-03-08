import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface Config {
  API_KEY: string
  MODEL_ID: string
  SUMMARY_MODEL_ID: string
  BASE_URL: string
  SERVER_PORT: number
}

const DEFAULT_CONFIG: Config = {
  API_KEY: '',
  MODEL_ID: '',
  SUMMARY_MODEL_ID: '',
  BASE_URL: 'https://api.openai.com/v1',
  SERVER_PORT: 3000,
}

/**
 * 加载配置信息。
 * 同时负责确保 workspace 及其所有子目录（agents, data, skills, output）存在。
 * 如果 skills 目录为空，将从程序源码自动拷贝一份。
 */
export function loadConfig(workspaceRoot: string): Config {
  // 1. 确保目录结构全量存在
  const subdirs = ['agents', 'data', 'skills', 'output']
  if (!fs.existsSync(workspaceRoot)) {
    fs.mkdirSync(workspaceRoot, { recursive: true })
  }
  for (const dir of subdirs) {
    const p = path.join(workspaceRoot, dir)
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p, { recursive: true })
    }
  }

  // 1.5 自动拷贝默认 Skills 到用户的 workspace/skills
  const workspaceSkillsPath = path.join(workspaceRoot, 'skills')
  try {
    const existingSkills = fs.readdirSync(workspaceSkillsPath)
    if (existingSkills.length === 0) {
      // 获取当前运行代码所在的 src/agents/skills 路径
      const codeSkillsPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'agents/skills')
      if (fs.existsSync(codeSkillsPath)) {
        fs.cpSync(codeSkillsPath, workspaceSkillsPath, { recursive: true })
        console.log(`[Config] 已将默认技能 SOP 拷贝至: ${workspaceSkillsPath}`)
      }
    }
  } catch (err) {
    console.error(`[Config] 拷贝默认 Skills 失败:`, (err as Error).message)
  }

  // 2. 确保 config.json 模板存在
  const configPath = path.join(workspaceRoot, 'config.json')
  if (!fs.existsSync(configPath)) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
      console.log(`[Config] 已创建配置模板: ${configPath}`)
    } catch (err) {
      console.error(`[Config] 无法创建配置文件:`, (err as Error).message)
    }
  }

  // 3. 读取配置
  let fileConfig: Partial<Config> = {}
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    } catch (err) {
      console.error(`[Config] 无法解析 ${configPath}:`, (err as Error).message)
    }
  }

  return {
    API_KEY: fileConfig.API_KEY || process.env['API_KEY'] || process.env['OPENAI_API_KEY'] || DEFAULT_CONFIG.API_KEY,
    MODEL_ID: fileConfig.MODEL_ID || process.env['MODEL_ID'] || process.env['MODEL'] || DEFAULT_CONFIG.MODEL_ID,
    SUMMARY_MODEL_ID: fileConfig.SUMMARY_MODEL_ID || process.env['SUMMARY_MODEL_ID'] || process.env['SUMMARY_MODEL'] || DEFAULT_CONFIG.SUMMARY_MODEL_ID,
    BASE_URL: fileConfig.BASE_URL || process.env['BASE_URL'] || process.env['OPENAI_BASE_URL'] || DEFAULT_CONFIG.BASE_URL,
    SERVER_PORT: fileConfig.SERVER_PORT || parseInt(process.env['SERVER_PORT'] || '', 10) || DEFAULT_CONFIG.SERVER_PORT,
  }
}
