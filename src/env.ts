import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

import { getConfigStatus } from './config.js'

const REQUIRED_SMTP: Array<{ key: string; description: string }> = [
  { key: 'SMTP_HOST', description: 'SMTP 服务器地址' },
  { key: 'SMTP_USER', description: 'SMTP 用户名（发件人邮箱）' },
  { key: 'SMTP_PASSWORD', description: 'SMTP 密码' },
  { key: 'NOTIFY_EMAIL', description: '通知收件人邮箱' },
]

export interface EnvValidationOptions {
  allowMissingBase?: boolean
}

export interface EnvValidationResult {
  ready: boolean
  missingBase: Array<'API_KEY' | 'MODEL_ID' | 'BASE_URL'>
}

function ensureTypstInPath(): void {
  try {
    execFileSync('typst', ['--version'], { stdio: 'ignore' })
    return
  } catch {
    const home = process.env.HOME || ''
    const cargoBinDir = path.join(home, '.cargo', 'bin')
    const typstPath = path.join(cargoBinDir, 'typst')

    if (fs.existsSync(typstPath)) {
      process.env.PATH = `${cargoBinDir}${path.delimiter}${process.env.PATH}`
      return
    }

    console.warn(
      '[JobClaw] 提示：检测到 typst 未安装。简历编译功能暂不可用。\n' +
      '          你可以在运行过程中要求 Agent “安装 typst” 来自动配置环境。'
    )
  }
}

export function validateEnv(
  workspaceRoot: string,
  features: Array<'smtp'> = [],
  options: EnvValidationOptions = {}
): EnvValidationResult {
  const configStatus = getConfigStatus(workspaceRoot)
  const errors: string[] = []

  if (!options.allowMissingBase) {
    for (const field of configStatus.missingFields) {
      errors.push(`  - ${field}：未在 config.json 或环境变量中配置`)
    }
  }

  if (features.includes('smtp')) {
    for (const { key, description } of REQUIRED_SMTP) {
      if (!process.env[key]) {
        errors.push(`  - ${key}：${description}`)
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `[JobClaw] 基础配置不完整，请修复以下问题后重新启动：\n${errors.join('\n')}\n\n参考 .env.example 或引导说明。`
    )
  }

  ensureTypstInPath()

  return {
    ready: configStatus.ready,
    missingBase: configStatus.missingFields,
  }
}
