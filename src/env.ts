/**
 * src/env.ts — 起動前の環境変数バリデーション
 *
 * 使い方:
 *   validateEnv()          // OPENAI_API_KEY のみ必須チェック（通常起動）
 *   validateEnv(['smtp'])  // SMTP 関連も必須チェック（cron.ts）
 */

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
}
