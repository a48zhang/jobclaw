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

/** 必須環境変数の定義 */
const REQUIRED_BASE: Array<{ key: string; description: string }> = [
  { key: 'OPENAI_API_KEY', description: 'OpenAI API 密钥' },
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
 * 在程序启动前校验必要的环境变量。
 * 缺少任意必需变量时，打印友好提示并抛出错误（fail fast）。
 *
 * @param features 额外需要校验的功能模块。目前支持 `'smtp'`。
 */
export function validateEnv(features: Array<'smtp'> = []): void {
  const required = [...REQUIRED_BASE]

  if (features.includes('smtp')) {
    required.push(...REQUIRED_SMTP)
  }

  const missing = required.filter(({ key }) => !process.env[key])

  if (missing.length > 0) {
    const lines = missing.map(({ key, description }) => `  - ${key}：${description}`)
    throw new Error(
      `[JobClaw] 缺少必要的环境变量，请在 .env 文件中配置：\n${lines.join('\n')}\n\n` +
        `参考 .env.example 文件了解完整配置说明。`
    )
  }

  // 检查 typst 是否可用（自动尝试安装）
  try {
    execFileSync('typst', ['--version'], { stdio: 'ignore' })
  } catch {
    // 检查 cargo 安装路径是否在 PATH 中，如果不在则尝试自动安装
    const home = process.env.HOME || ''
    const cargoBin = path.join(home, '.cargo', 'bin')
    const typstPath = path.join(cargoBin, 'typst')
    
    if (fs.existsSync(typstPath)) {
      // 如果二进制存在但不在 PATH 中，尝试临时添加到 PATH
      process.env.PATH = `${cargoBin}${path.delimiter}${process.env.PATH}`
    } else {
      console.log('[JobClaw] 检测到 typst 未安装，准备自动安装...')
      try {
        // 由于这里是同步调用，我们直接尝试通过 cargo 安装
        execFileSync('cargo', ['install', 'typst-cli'], { stdio: 'inherit' })
        process.env.PATH = `${cargoBin}${path.delimiter}${process.env.PATH}`
      } catch {
        console.warn(
          '[JobClaw] 警告：typst 自动安装失败。简历编译功能将不可用。\n' +
            '          请手动安装：https://typst.app/docs/installation/'
        )
      }
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
