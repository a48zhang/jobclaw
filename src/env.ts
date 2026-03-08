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
 * userinfo.md 中需要存在的关键字段。
 * 使用正则匹配「字段名后跟冒号（中英文）」，避免误匹配含该词的其他文本。
 */
const USERINFO_REQUIRED_FIELDS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /^姓名[:：]/m, description: '姓名' },
  { pattern: /^邮箱[:：]/m, description: '邮箱' },
  { pattern: /^简历[:：]/m, description: '简历链接' },
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

  if (!config.llm.apiKey) {
    errors.push('  - LLM API Key：未在 config.json 或环境变量 (OPENAI_API_KEY) 中配置')
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

/**
 * 深度校验 workspace 文件配置是否完整。
 * - targets.md 不能为空（需包含实际内容）
 * - userinfo.md 必须包含所有关键字段
 *
 * @param workspaceRoot workspace 根目录路径
 * @throws 当校验不通过时抛出详细错误
 */
export function validateWorkspace(workspaceRoot: string): void {
  const errors: string[] = []

  // 校验 targets.md 非空
  const targetsPath = path.join(workspaceRoot, 'data', 'targets.md')
  if (fs.existsSync(targetsPath)) {
    const targetsContent = fs.readFileSync(targetsPath, 'utf-8')
    const hasContent = targetsContent
      .split('\n')
      .some((line) => line.trim() && !line.trim().startsWith('#'))
    if (!hasContent) {
      errors.push('  - targets.md：文件为空，请至少添加一个监测目标（公司招聘页 URL）')
    }
  } else {
    errors.push('  - targets.md：文件不存在，请运行 bootstrap 完成初始化')
  }

  // 校验 userinfo.md 关键字段
  const userinfoPath = path.join(workspaceRoot, 'data', 'userinfo.md')
  if (fs.existsSync(userinfoPath)) {
    const userinfoContent = fs.readFileSync(userinfoPath, 'utf-8')
    const missingFields = USERINFO_REQUIRED_FIELDS.filter(
      ({ pattern }) => !pattern.test(userinfoContent)
    )
    if (missingFields.length > 0) {
      const fieldList = missingFields.map(({ description }) => description).join('、')
      errors.push(`  - userinfo.md：缺少关键字段（${fieldList}），请运行 bootstrap 完善个人信息`)
    }
  } else {
    errors.push('  - userinfo.md：文件不存在，请运行 bootstrap 完成初始化')
  }

  if (errors.length > 0) {
    throw new Error(
      `[JobClaw] workspace 配置不完整，请修复以下问题后重新启动：\n${errors.join('\n')}`
    )
  }
}
