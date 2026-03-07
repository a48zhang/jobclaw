// src/agents/delivery/index.ts

import * as fs from 'node:fs'
import * as path from 'node:path'
import { BaseAgent } from '../base'
import type { BaseAgentConfig } from '../base/types'
import type { ToolResult } from '../../tools/index'
import type { Channel, ChannelMessageType } from '../../channel/base'

export interface DeliveryAgentConfig extends BaseAgentConfig {
  channel: Channel
}

export class DeliveryAgent extends BaseAgent {
  private channel: Channel
  private deliveredUrls: Set<string> = new Set()

  constructor(config: DeliveryAgentConfig) {
    super({ ...config, agentName: 'delivery' })
    this.channel = config.channel
  }

  protected get systemPrompt(): string {
    const defaultSkillsPath = path.resolve(import.meta.dir, '../skills/jobclaw-skills.md')
    const overridePath = path.resolve(this.workspaceRoot, 'skills', 'jobclaw-skills.md')

    let skillContent: string

    if (fs.existsSync(overridePath)) {
      skillContent = fs.readFileSync(overridePath, 'utf-8')
    } else if (fs.existsSync(defaultSkillsPath)) {
      skillContent = fs.readFileSync(defaultSkillsPath, 'utf-8')
    } else {
      skillContent = this.defaultSkillContent()
    }

    return skillContent
  }

  protected async onToolResult(toolName: string, result: ToolResult): Promise<void> {
    try {
      if (!result.success) return

      if (toolName === 'browser_navigate') {
        const urlMatch = result.content.match(/https?:\/\/\S+/)
        if (urlMatch) {
          await this.channel.send({
            type: 'delivery_start',
            payload: { url: urlMatch[0] },
            timestamp: new Date(),
          })
        }
        return
      }

      if (toolName !== 'write_file') return

      const appliedMatch = result.content.match(
        /\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(https?:\/\/\S+?)\s*\|\s*(applied|failed|login_required)\s*\|\s*(.+?)\s*\|/
      )

      if (!appliedMatch) return

      const [, company, title, url, status, time] = appliedMatch

      if (status === 'applied') {
        this.deliveredUrls.add(url.trim())
      }

      const typeMap: Record<string, ChannelMessageType> = {
        applied: 'delivery_success',
        failed: 'delivery_failed',
        login_required: 'delivery_blocked',
      }

      await this.channel.send({
        type: typeMap[status] ?? 'delivery_failed',
        payload: {
          company: company.trim(),
          title: title.trim(),
          url: url.trim(),
          status: status.trim(),
          time: time.trim(),
        },
        timestamp: new Date(),
      })
    } catch (error) {
      console.error('[DeliveryAgent] channel.send 失败:', error)
    }
  }

  protected extractContext(): Record<string, unknown> {
    return { deliveredUrls: Array.from(this.deliveredUrls) }
  }

  protected restoreContext(context: Record<string, unknown>): void {
    const urls = context.deliveredUrls
    if (Array.isArray(urls)) {
      this.deliveredUrls = new Set(urls as string[])
    }
  }

  private defaultSkillContent(): string {
    return `你是 JobClaw 的投递执行 Agent（DeliveryAgent）。

## 职责
读取待投递职位列表，自动操作浏览器完成简历投递，并更新每笔投递的结果状态。

## 数据文件
- workspace/data/jobs.md — 读取 discovered 职位；完成后更新状态
- workspace/data/userinfo.md — 读取用户信息用于填写表单

## 工作流程
1. 读取 workspace/data/userinfo.md，确认用户信息完整
   - 如缺少关键字段（姓名、邮箱、简历），立即停止并报告
2. 读取 workspace/data/jobs.md，筛选出所有状态为 discovered 的职位
   - 如没有 discovered 职位，报告"暂无待投递职位"后结束
3. 对每个 discovered 职位（按顺序逐一处理）：
   a. 使用 browser_navigate 访问招聘链接
   b. 使用 browser_snapshot 获取页面内容，识别表单字段
   c. 如果页面需要登录：
      - 跳过此职位
      - lock_file → write_file（状态改为 login_required，时间记录当前时间）→ unlock_file
      - 继续下一个
   d. 使用表单工具填写用户信息并提交
   e. 等待响应，判断是否提交成功
   f. lock_file → write_file（更新状态为 applied 或 failed，记录当前时间）→ unlock_file
4. 汇报本次投递结果：X 个成功，Y 个失败，Z 个需要登录

## 重要规则
- write_file 前必须先 lock_file，写完立即 unlock_file
- 使用 old_string/new_string 精确替换行，old_string 须与文件中的行完全一致
- 投递时间格式：YYYY-MM-DD HH:mm
- 状态只能改为：applied / failed / login_required（不能改回 discovered）
- 遇到验证码或复杂人机验证时，将状态改为 failed，在摘要中单独列出

## 我的记忆文件
- workspace/agents/delivery/notebook.md — 跨会话笔记（如：哪些网站需要特殊处理）`
  }
}
