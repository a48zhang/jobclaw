import * as fs from 'node:fs'
import * as path from 'node:path'

import { loadConfig } from './config.js'

/**
 * 检查是否需要执行 Bootstrap 引导流程。
 * 判定标准：config.json 不存在，或者其中的关键配置 (API_KEY/MODEL_ID/BASE_URL) 为空。
 *
 * @param workspaceRoot workspace 根目录路径
 */
export function needsBootstrap(workspaceRoot: string): boolean {
  const configPath = path.join(workspaceRoot, 'config.json')
  if (!fs.existsSync(configPath)) return true

  try {
    // 判定是否需要引导必须基于 config.json 文件本身，而非环境变量兜底值；
    // 否则用户只要设置了环境变量，就永远不会进入 Bootstrap，导致 data/ 初始化缺失。
    const raw = fs.readFileSync(configPath, 'utf-8')
    const fileConfig = JSON.parse(raw) as Partial<{ API_KEY: string; MODEL_ID: string; BASE_URL: string }>
    return !fileConfig.API_KEY || !fileConfig.MODEL_ID || !fileConfig.BASE_URL
  } catch {
    return true
  }
}

/**
 * Bootstrap 引导提示词。
 * 由 src/index.ts 传给 MainAgent.run() 驱动引导对话。
 * 引导结束后，MainAgent 通过文件工具写入 workspace/config.json。
 */
export const BOOTSTRAP_PROMPT = `【系统初始化引导】
欢迎使用 JobClaw！这是你第一次启动，请按以下步骤完成配置：

1. 请告诉我你的姓名、邮箱和简历链接，我会帮你填写 workspace/data/userinfo.md。
2. 请告诉我你想监测的目标公司及其招聘页 URL（至少一个），我会帮你填写 workspace/data/targets.md。
3. 配置完成后，我会说明如何通过系统 cron 或 PM2 定期运行 "npm run cron" 实现自动化搜索。
4. 最后我会写入 workspace/config.json 标记初始化已完成。

请开始：你叫什么名字？`
