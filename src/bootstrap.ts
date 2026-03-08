import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * 检查是否需要执行 Bootstrap 引导流程。
 * Bootstrap 完成的标志位是 workspace/config.json 存在。
 *
 * @param workspaceRoot workspace 根目录路径
 */
export function needsBootstrap(workspaceRoot: string): boolean {
  return !fs.existsSync(path.join(workspaceRoot, 'config.json'))
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
3. 请提供你的 LLM 配置信息：
   - API_KEY (如果你已经在环境变量中设置了，可以跳过)
   - MODEL_ID (必须指定，例如 o3-mini)
   - SUMMARY_MODEL_ID (必须指定，用于上下文压缩)
   - BASE_URL (可选，默认为 OpenAI 官方地址)
4. 配置完成后，我会说明如何通过系统 cron 或 PM2 定期运行 "bun src/cron.ts" 实现自动化搜索。
5. 最后我会写入 workspace/config.json 标记初始化已完成。

请开始：你叫什么名字？`
