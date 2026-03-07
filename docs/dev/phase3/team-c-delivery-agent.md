# Phase 3 · Team C — DeliveryAgent 实现计划

> **负责模块**: `src/agents/delivery/index.ts`  
> **测试文件**: `src/agents/delivery/delivery.test.ts`  
> **可并行工作**：是。Team C 不依赖 Team A。依赖 Team B 的 `Channel` 接口（`src/channel/base.ts`）；如 Team B 未完成，使用本文档第 2.2 节的 stub 类型。

---

## 1. 任务概述

DeliveryAgent 是 JobClaw 的**投递执行引擎**。它接收投递指令后，读取 `jobs.md` 中所有 `discovered` 状态的职位，逐一通过 Playwright MCP 操作浏览器完成申请表单填写和提交，并将结果（`applied` / `failed` / `login_required`）回写到 `jobs.md`，同时通过 `Channel` 向用户发送**外部通知**（邮件等）。

> **Channel 职责边界**：Channel 只用于向用户推送外部通知（邮件/Webhook），不用于 Agent 间通信。Agent 间通过 `jobs.md` + 文件锁交换数据。DeliveryAgent 的 `run()` 返回值（汇总字符串）才是给 MainAgent 的回执。

**核心行为**：
1. 读取 `workspace/data/jobs.md` 获取所有 `discovered` 职位
2. 读取 `workspace/data/userinfo.md` 获取用户信息（姓名、邮件、简历链接等）
3. 对每个 `discovered` 职位：
   - 通过 `Channel.send({ type: 'delivery_start', ... })` 通知用户开始投递
   - 使用 Playwright MCP 访问招聘链接，填写并提交表单
   - 通过 `lock_file` 锁定 `jobs.md`，`write_file` 更新该行状态，`unlock_file` 释放锁
   - 通过 `Channel.send({ type: 'delivery_success' | 'delivery_failed' | 'delivery_blocked', ... })` 通知投递结果
4. 完成后返回投递汇总字符串给调用方（MainAgent）

---

## 2. 前置依赖

### 2.1 BaseAgent（已实现）

```typescript
import { BaseAgent } from '../base'
import type { BaseAgentConfig } from '../base/types'
```

### 2.2 Channel 接口（由 Team B 在 `src/channel/base.ts` 中实现）

**Channel 只用于外部通知**，不作为 Agent 间通信通道。实际文件中使用：
```typescript
import type { Channel, ChannelMessage, ChannelMessageType } from '../../channel/base'
```

如 Team B 尚未完成，使用以下 stub（最终以 Team B 的 `src/channel/base.ts` 为准，两者约定一致）：

```typescript
// 临时 stub
export type ChannelMessageType =
  | 'new_job'
  | 'delivery_start'
  | 'delivery_success'
  | 'delivery_failed'
  | 'delivery_blocked'
  | 'cron_complete'

export interface ChannelMessage {
  type: ChannelMessageType
  payload: Record<string, unknown>
  timestamp: Date
}

export interface Channel {
  send(message: ChannelMessage): Promise<void>
}
```

### 2.3 文件工具（已实现）

DeliveryAgent 使用以下工具（LLM 通过 tool calling 间接调用）：
- `read_file` — 读取 `jobs.md` / `userinfo.md`
- `write_file` — 更新 `jobs.md` 中某行的状态（使用 old_string/new_string 精确替换）
- `lock_file` / `unlock_file` — 写入前后保护 `jobs.md`
- `list_directory` — 查看 workspace 目录（辅助用）

### 2.4 Playwright MCP 工具（运行时注入）

DeliveryAgent 需要以下 Playwright 工具（由 `mcpClient` 在运行时注册）：
- `browser_navigate` — 访问招聘页面
- `browser_snapshot` — 获取页面结构（用于识别表单字段）
- `browser_fill_form` (或 `browser_type`) — 填写表单
- `browser_click` — 点击提交按钮
- `browser_wait_for` — 等待页面响应
- `browser_take_screenshot` — 异常时截图（调试）

---

## 3. 对外暴露

```typescript
export interface DeliveryAgentConfig extends BaseAgentConfig {
  channel: Channel  // 必须提供。DeliveryAgent 始终在后台执行，用户无法直接看到 run() 返回值，Channel 是唯一的实时反馈出口。
}

export class DeliveryAgent extends BaseAgent {
  constructor(config: DeliveryAgentConfig)
  // 继承 run(input: string): Promise<string>
  // 继承 getState(): AgentSnapshot
}
```

---

## 4. 数据格式约定（⚠️ 关键，与 Team B 共同遵守）

### 4.1 `workspace/data/userinfo.md` 格式（DeliveryAgent 读）

```markdown
# 用户信息

## 基本信息
- 姓名：张三
- 英文名：San Zhang
- 邮箱：zhangsan@example.com
- 电话：+86 138 0000 0000
- 现居城市：北京

## 求职意向
- 目标岗位：后端工程师 / 全栈工程师
- 期望薪资：25k-35k
- 可到岗时间：2周

## 简历
- 简历 URL：https://example.com/resume.pdf
- GitHub：https://github.com/zhangsan

## 其他
- 工作经验：3年
- 学历：本科，计算机科学
- 自我介绍：...（300字内）
```

> 如果 userinfo.md 为空或缺少关键字段，LLM 应在投递前报告"缺少 XX 信息，请通过主 Agent 补充后再投递"，而不是继续执行。

### 4.2 `workspace/data/jobs.md` 格式（与 Team B 约定一致）

```markdown
# 已发现 / 已投递岗位

| 公司 | 职位 | 链接 | 状态 | 投递时间 |
|------|------|------|------|---------|
| Acme Corp | Software Engineer | https://acme.com/jobs/123 | discovered | |
| Foo Inc | Backend Dev | https://foo.com/careers/456 | applied | 2026-03-07 14:30 |
```

**DeliveryAgent 的 `write_file` 调用格式**：

更新一行状态时，使用精确的 old_string/new_string 替换。

LLM 调用 `write_file` 时应传入：
```json
{
  "path": "data/jobs.md",
  "old_string": "| Acme Corp | Software Engineer | https://acme.com/jobs/123 | discovered | |",
  "new_string": "| Acme Corp | Software Engineer | https://acme.com/jobs/123 | applied | 2026-03-07 14:30 |"
}
```

重要约束：
- `old_string` 必须与文件中对应行完全一致（含前后空格），避免替换错行
- 写入前必须先 `lock_file`，写入后必须立即 `unlock_file`
- 投递时间格式：`YYYY-MM-DD HH:mm`（使用本地时间）

---

## 5. Skills / SOP 设计

DeliveryAgent 的操作规程作为**投递 SOP 章节**存储在统一 Skill 文件 `src/agents/skills/jobclaw-skills.md`（代码级默认），可被 `workspace/skills/jobclaw-skills.md` 覆盖。`get systemPrompt()` 通过 `loadSkill('jobclaw-skills')` 加载整个文件并内嵌。整个 Skill 文件由 Team A（T-A-12）创建，Team C 负责填充"投递职位 SOP"章节内容。

**`src/agents/skills/jobclaw-skills.md`** 中"投递职位 SOP"章节内容（即下方 systemPrompt 内容）：

### 5.1 systemPrompt 要素

```
你是 JobClaw 的投递执行 Agent（DeliveryAgent）。

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
- workspace/agents/delivery/notebook.md — 跨会话笔记（如：哪些网站需要特殊处理）
```

> **执行限制**：DeliveryAgent 以 `runEphemeral({ maxSteps: 50 })` 运行，最多执行 50 步（每次 tool call 计 1 步）。50 步用尽后**直接停止，不重试**，将当前结果返回给 MainAgent。所有 Playwright tool call 有 **2 分钟超时**（BaseAgent 层统一实现），超时时返回错误字符串并继续执行剩余步骤。

---

## 6. `onToolResult` 通知钩子实现

覆盖 `onToolResult` 检测 `write_file` 对 `jobs.md` 的状态更新，解析出投递结果并通过 Channel 发送实时通知：

```typescript
protected async onToolResult(toolName: string, result: ToolResult): Promise<void> {
  if (!result.success) return
  if (toolName !== 'write_file') return

  // result.content 应包含 write_file 成功后追加/写入的内容
  // 检测是否包含状态更新行（applied/failed/login_required）
  const appliedMatch = result.content.match(
    /\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(https?:\/\/\S+?)\s*\|\s*(applied|failed|login_required)\s*\|\s*(.+?)\s*\|/
  )

  if (!appliedMatch) return

  const [, company, title, url, status, time] = appliedMatch

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
}
```

> **注意**：`result.content` 需要由 `write_file` 实现在成功时返回写入内容。请核查 `src/tools/writeFile.ts`，确认 `ToolResult.content` 包含 `new_string` 的内容；若不包含，**调整实现使写入成功时 content 返回 `new_string`**，或在 `onToolResult` 中改为通过解析 `result.content` 中的确认信息来触发。

### 6.1 delivery_start 通知

`delivery_start` 需要在 LLM 调用 `browser_navigate` 前触发。由于 `onToolResult` 在调用后才执行，`delivery_start` 的时机不同，可以通过以下方式处理：

**方案**：检测 `browser_navigate` 的调用结果（`result.success && toolName === 'browser_navigate'`），若 URL 匹配 jobs.md 中的某个链接，则发出 `delivery_start` 通知。这样时序上稍晚，但实现最简单：

```typescript
if (toolName === 'browser_navigate' && result.success) {
  // 可以解析 result.content 中是否有招聘页的特征词
  // 或直接发一个"正在处理某 URL"的通知
  // 简化版：检测 URL 特征
  const urlMatch = result.content.match(/https?:\/\/\S+/)
  if (urlMatch) {
    await this.channel.send({
      type: 'delivery_start',
      payload: { url: urlMatch[0] },
      timestamp: new Date(),
    })
  }
}
```

---

## 7. 实现清单

- [ ] **T-C-1**: 导入 Channel 接口（`src/channel/base.ts`，等 Team B 完成；临时使用 stub）
- [ ] **T-C-2**: 定义 `DeliveryAgentConfig` 接口（`channel: Channel`，必需）
- [ ] **T-C-3**: 实现 `DeliveryAgent` 类骨架（继承 BaseAgent，`agentName = 'delivery'`）
- [ ] **T-C-4**: 实现 `get systemPrompt()` — 调用 `loadSkill('jobclaw-skills')` 加载统一 Skill 文件并拼接到 systemPrompt
- [ ] **T-C-5**: 覆盖 `onToolResult()` — 处理 `write_file` 状态更新通知 + `browser_navigate` 开始投递通知
- [ ] **T-C-6**: 实现 `extractContext()` / `restoreContext()` — 跨会话保存已投递的 URL 集合（避免重投）
- [ ] **T-C-7**: 核查 `src/tools/writeFile.ts`：确认 `ToolResult.content` 在成功时返回被写入的 `new_string`；若不符合，提出修改方案（不要擅自修改 tools 代码，提 issue 给 Team B 或 tools 维护者）
- [ ] **T-C-8**: 编写单元测试（见第 9 节）
- [ ] **T-C-9**: 在 `src/agents/skills/jobclaw-skills.md` 中填充"投递职位 SOP"章节内容（与 Team A 协调，该文件由 T-A-12 创建）

---

## 8. 边界条件与错误处理

| 场景 | 期望行为 |
|------|---------|
| `userinfo.md` 缺少关键字段（邮箱/简历） | LLM 在第一步检查时发现后停止，返回"缺少 XX 信息"说明，不执行任何投递 |
| `jobs.md` 无 `discovered` 条目 | 立即返回"暂无待投递职位" |
| 招聘页面需要登录 | 将该职位状态更新为 `login_required`，继续处理下一个 |
| 表单填写失败 / 提交超时 | 将状态更新为 `failed`，在汇总中注明原因 |
| 遇到验证码（CAPTCHA） | 将状态更新为 `failed`（标注"需要人工验证"），继续下一个 |
| `write_file` 锁超时 | LLM 重试 lock_file 最多 3 次，仍失败则状态暂不更新，在汇总中注明"状态更新失败" |
| `channel.send` 抛出异常 | 捕获异常并打印 console.error，不影响投递流程继续 |
| 同一职位在 jobs.md 中出现多行（数据异常） | `write_file` 的 old_string 精确匹配保证只更新第一个匹配行；LLM 在回复中应注明重复数据 |
| DeliveryAgent 中途崩溃（已有部分投递） | 重新 run() 时，LLM 读取 jobs.md，已是 `applied/failed` 的跳过，只处理 `discovered` 的 |

---

## 9. 验收测试标准

测试文件：`src/agents/delivery/delivery.test.ts`

### 9.1 必须通过的单元测试

**TC-C-01**: DeliveryAgent 正常实例化
```
Given: 有效 BaseAgentConfig + mockChannel
When: new DeliveryAgent({ ...config, channel: mockChannel })
Then: 不抛出异常，agentName === 'delivery'
```

**TC-C-02**: onToolResult - write_file jobs.md applied → 发送 delivery_success
```
Given: DeliveryAgent 带 mockChannel
       toolName = 'write_file'
       result = { success: true, content: '| Acme Corp | SWE | https://acme.com/j/1 | applied | 2026-03-07 14:30 |' }
When: agent['onToolResult']('write_file', result)
Then: mockChannel.send 被调用一次
      type === 'delivery_success'
      payload.company === 'Acme Corp'
      payload.status === 'applied'
```

**TC-C-03**: onToolResult - write_file jobs.md failed → 发送 delivery_failed
```
Given: 同上，但 status 字段为 'failed'
When: agent['onToolResult']('write_file', result)
Then: mockChannel.send type === 'delivery_failed'
```

**TC-C-04**: onToolResult - write_file jobs.md login_required → 发送 delivery_blocked
```
Given: 同上，status = 'login_required'
When: agent['onToolResult']('write_file', result)
Then: mockChannel.send type === 'delivery_blocked'
```

**TC-C-05**: onToolResult - read_file → channel.send 不被调用
```
Given: toolName = 'read_file', result.success = true
When: agent['onToolResult']('read_file', result)
Then: mockChannel.send 未被调用
```

**TC-C-06**: onToolResult - write_file 失败 → channel.send 不被调用
```
Given: result = { success: false, error: '锁争抢' }
When: agent['onToolResult']('write_file', result)
Then: mockChannel.send 未被调用
```

**TC-C-07**: onToolResult - browser_navigate 成功 → 发送 delivery_start
```
Given: toolName = 'browser_navigate', result = { success: true, content: '已导航至 https://acme.com/jobs/123' }
When: agent['onToolResult']('browser_navigate', result)
Then: mockChannel.send 被调用，type === 'delivery_start'
```

**TC-C-08**: channel.send 抛出异常时不影响后续执行
```
Given: mockChannel.send 抛出 Error('邮件发送失败')
       toolName = 'write_file', 合法 applied 内容
When: agent['onToolResult']('write_file', result)
Then: 不抛出异常（内部捕获）
```

**TC-C-09**: systemPrompt 包含必要关键词
```
Given: DeliveryAgent 实例
When: 访问 systemPrompt
Then: 包含 'jobs.md', 'userinfo.md', 'lock_file', 'write_file', 'applied', 'failed', 'login_required'
```

**TC-C-10**: extractContext / restoreContext 保存恢复已投递 URL
```
Given: DeliveryAgent 内部维护 deliveredUrls: Set<string>
       deliveredUrls.add('https://acme.com/j/1')
When: context = extractContext(); 新实例 restoreContext(context)
Then: deliveredUrls.has('https://acme.com/j/1') === true
```

### 9.2 集成测试（可选）

**TC-C-11**: 完整投递流程（mock OpenAI + mock MCP）
```
Given: jobs.md 包含 1 个 discovered 职位
       userinfo.md 包含完整用户信息
       mock mcpClient 返回正常的表单提交成功响应
       mock OpenAI 返回工具调用序列：browser_navigate → browser_snapshot 
                     → browser_fill_form → browser_click 
                     → lock_file → write_file(applied) → unlock_file → stop
When: await deliveryAgent.run('投递所有待投递职位')
Then: jobs.md 中该职位状态更新为 applied
      mockChannel.send 至少调用 2 次（delivery_start, delivery_success）
```

**TC-C-12**: userinfo.md 缺少邮箱时不执行投递
```
Given: userinfo.md 不含邮箱字段
       mock OpenAI 在读取 userinfo.md 后直接返回 stop（并报告缺少信息）
When: await deliveryAgent.run('投递待投递职位')
Then: write_file 未被调用
      mockChannel.send 的 delivery_start 未被调用
      返回结果中包含"缺少"或"邮箱"
```

---

## 10. 文件 Skeleton（实现参考）

```typescript
// src/agents/delivery/index.ts

import { BaseAgent } from '../base'
import type { BaseAgentConfig } from '../base/types'
import type { ToolResult } from '../../tools/index'
import type { Channel, ChannelMessage, ChannelMessageType } from '../../channel/base'

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
    // T-C-4: 完整实现
    return `...`
  }

  protected async onToolResult(toolName: string, result: ToolResult): Promise<void> {
    // T-C-5: 完整实现
    try {
      // ... 解析并发送通知
    } catch (error) {
      console.error('[DeliveryAgent] channel.send 失败:', error)
    }
  }

  protected extractContext(): Record<string, unknown> {
    // T-C-6
    return { deliveredUrls: Array.from(this.deliveredUrls) }
  }

  protected restoreContext(context: Record<string, unknown>): void {
    // T-C-6
    const urls = context.deliveredUrls
    if (Array.isArray(urls)) {
      this.deliveredUrls = new Set(urls as string[])
    }
  }
}
```
