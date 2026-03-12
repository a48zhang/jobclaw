/**
 * src/env.ts — 起動前の環境変数バリデーション
 *
 * 使い方:
 *   validateEnv()          // OPENAI_API_KEY のみ必須チェック（通常起動）
 *   validateEnv(['smtp'])  // SMTP 関連も必須チェック（cron.ts）
 *   validateWorkspace(workspaceRoot)  // workspace 文件深度校验
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'

import { loadConfig } from './config'

/** 必須環境変数の定義 */
const REQUIRED_BASE: Array<{ key: string; description: string }> = [
  // OPENAI_API_KEY 仍作为默认必填，除非 config.json 中提供了
]

const REQUIRED_SMTP: Array<{ key: string; description: string }> = [
  { key: 'SMTP_HOST', description: 'SMTP 服务器地址' },
  { key: 'SMTP_USER', description: 'SMTP 用户名（发件人邮箱）' },
  { key: 'SMTP_PASSWORD', description: 'SMTP 密码' },
  { key: 'NOTIFY_EMAIL', description: '通知收件人邮箱' },
]

/**
 * 在程序启动前校验必要的环境变量或配置文件。
 *
 * @param workspaceRoot 工作区路径
 * @param features 额外需要校验的功能模块。目前支持 `'smtp'`。
 */
export function validateEnv(workspaceRoot: string, features: Array<'smtp'> = []): void {
  const config = loadConfig(workspaceRoot)
  const errors: string[] = []

  if (!config.API_KEY) {
    errors.push('  - API_KEY：未在 config.json 或环境变量中配置')
  }

  if (!config.MODEL_ID) {
    errors.push('  - MODEL_ID：未在 config.json 或环境变量中配置')
  }

  if (!config.BASE_URL) {
    errors.push('  - BASE_URL：未在 config.json 或环境变量中配置')
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
      `[JobClaw] 基础配置不完整，请修复以下问题后重新启动：\n${errors.join('\n')}\n\n` +
        `参考 .env.example 或引导说明。`
    )
  }

  // 检查 typst 是否可用（仅警告，不自动安装）
  try {
    execFileSync('typst', ['--version'], { stdio: 'ignore' })
  } catch {
    const home = process.env.HOME || ''
    const cargoBinDir = path.join(home, '.cargo', 'bin')
    const typstPath = path.join(cargoBinDir, 'typst')

    if (fs.existsSync(typstPath)) {
      // 路径存在但不在 PATH 中
      process.env.PATH = `${cargoBinDir}${path.delimiter}${process.env.PATH}`
    } else {
      console.warn(
        '[JobClaw] 提示：检测到 typst 未安装。简历编译功能暂不可用。\n' +
        '          你可以在运行过程中要求 Agent “安装 typst” 来自动配置环境。'
      )
    }
  }
}
