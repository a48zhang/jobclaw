import * as fs from 'node:fs'
import * as path from 'node:path'

export interface LLMConfig {
  apiKey: string
  model: string
  summaryModel?: string
}

export interface Config {
  llm: LLMConfig
  serverPort?: number
}

const DEFAULT_CONFIG: Partial<Config> = {
  llm: {
    apiKey: '',
    model: 'gpt-4o',
    summaryModel: 'gpt-4o-mini',
  },
  serverPort: 3000,
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
    llm: {
      apiKey: fileConfig.llm?.apiKey || process.env['OPENAI_API_KEY'] || DEFAULT_CONFIG.llm!.apiKey,
      model: fileConfig.llm?.model || process.env['MODEL'] || DEFAULT_CONFIG.llm!.model,
      summaryModel: fileConfig.llm?.summaryModel || DEFAULT_CONFIG.llm!.summaryModel,
    },
    serverPort: fileConfig.serverPort || parseInt(process.env['SERVER_PORT'] || '', 10) || DEFAULT_CONFIG.serverPort,
  }
}
