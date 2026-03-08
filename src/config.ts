import * as fs from 'node:fs'
import * as path from 'node:path'

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
 * 优先级：workspace/config.json > 环境变量 > 默认值
 */
export function loadConfig(workspaceRoot: string): Config {
  const configPath = path.join(workspaceRoot, 'config.json')
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
