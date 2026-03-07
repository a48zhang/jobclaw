# Phase 3 · Team B — Channel & CronJob 基础设施实现计划

> **负责模块**:  
> - `src/channel/base.ts` — Channel 接口定义  
> - `src/channel/email.ts` — Email 通知实现  
> - `src/cron.ts` — CronJob 入口  
> **测试文件**: `src/channel/channel.test.ts`, `src/cron.test.ts`  
> **可并行工作**：是。Team B 不依赖 Team A/C，但 A/C 都依赖 Team B 的 `Channel` 接口类型，因此 **Team B 应优先定义并发布接口类型**（哪怕实现还是空的）。

---

## 1. 任务概述

Team B 负责三件事：

1. **Channel**：定义对外通知系统。Channel 是 JobClaw **向用户推送外部通知的唯一出口**（邮件/Webhook 等）。它不用于 Agent 间通信——Agent 间通过 `jobs.md` + 文件锁交换数据。

2. **CronJob**：实现定时任务入口。CronJob 通过 `mainAgent.runEphemeral(instruction)` 无状态地拉起 MainAgent 执行自动化任务，通过 Channel 将结果通知用户。CronJob 本身不含业务逻辑。

3. **Bootstrap**：系统首次运行的引导流程。确保用户在挂载 CronJob 之前已配置好 `targets.md` 和 `userinfo.md`，从设计上杜绝"监测目标为空"的 Cron 触发场景。

---

## 2. Channel 设计

### 2.1 职责边界

| 用途 | 是否走 Channel |
|------|--------------|
| DeliveryAgent 告知用户"投递成功" | ✅ Channel.send |
| MainAgent 告知用户"发现新职位" | ✅ Channel.send（CronJob 模式下必须；交互模式可选） |
| Agent A 通知 Agent B 执行任务 | ❌ 通过 jobs.md 状态 + DeliveryAgent.run() |
| 用户在 chat 里看到的对话回复 | ❌ 直接 run() 返回值，不走 Channel |

### 2.2 Channel 接口（`src/channel/base.ts`）

```typescript
/** 通知消息类型 */
export type ChannelMessageType =
  | 'new_job'           // MainAgent 搜索发现新职位（通知用户查看）
  | 'delivery_start'    // DeliveryAgent 开始处理某职位
  | 'delivery_success'  // DeliveryAgent 成功投递
  | 'delivery_failed'   // DeliveryAgent 投递失败
  | 'delivery_blocked'  // DeliveryAgent 遇到需要登录/人工介入的情况
  | 'cron_complete'     // CronJob 执行完毕的汇总通知

/** 通知消息结构 */
export interface ChannelMessage {
  type: ChannelMessageType
  /** 业务数据，各类型含义见下方说明 */
  payload: Record<string, unknown>
  timestamp: Date
}

/**
 * Channel 抽象接口
 * 实现类负责将消息通过具体通道（邮件、Webhook 等）送达用户
 */
export interface Channel {
  send(message: ChannelMessage): Promise<void>
}
```

### 2.3 各消息类型 payload 约定

| type | payload 字段 | 含义 |
|------|-------------|------|
| `new_job` | `company`, `title`, `url` | 发现的新职位信息 |
| `delivery_start` | `company`, `title`, `url` | 开始投递的职位 |
| `delivery_success` | `company`, `title`, `url`, `time` | 成功投递的职位及时间 |
| `delivery_failed` | `company`, `title`, `url`, `time`, `reason?` | 失败的职位及原因 |
| `delivery_blocked` | `company`, `title`, `url`, `reason` | 需人工介入的职位 |
| `cron_complete` | `newJobs`, `summary` | cron 完成汇总 |

### 2.4 Email 实现（`src/channel/email.ts`）

使用 nodemailer 或类似库实现，从 `.env` 读取配置：

```typescript
import type { Channel, ChannelMessage } from './base'

export interface EmailChannelConfig {
  /** SMTP 主机 */
  smtpHost: string
  /** SMTP 端口 */
  smtpPort: number
  /** 发件人邮箱 */
  from: string
  /** 收件人邮箱 */
  to: string
  /** SMTP 用户名 */
  user: string
  /** SMTP 密码（从环境变量读取，不硬编码） */
  password: string
}

export class EmailChannel implements Channel {
  constructor(private config: EmailChannelConfig) {}

  async send(message: ChannelMessage): Promise<void> {
    const subject = this.buildSubject(message)
    const body = this.buildBody(message)
    // ... 调用 SMTP 发送
  }

  private buildSubject(message: ChannelMessage): string {
    // 根据 type 生成易读的邮件标题
  }

  private buildBody(message: ChannelMessage): string {
    // 格式化 payload 为人类可读的邮件正文
  }
}
```

**.env.example 需要新增字段**（向 Team A/C 知会）：
```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=noreply@example.com
SMTP_PASSWORD=
NOTIFY_EMAIL=user@example.com
```

---

## 3. CronJob 设计

### 3.1 CronJob 入口（`src/cron.ts`）

`src/cron.ts` 是一个**单次任务脚本**，由外部调度器（系统 cron、PM2、Task Scheduler 等）按需触发，每次调用执行一次完整搜索。**调度时机由用户或运维在系统层面决定，`cron.ts` 中不包含任何调度表达式**。

**核心设计原则**：
- `src/cron.ts` 只负责初始化 Agent 和发送结果通知，**不包含业务逻辑**
- 业务逻辑在 `mainAgent.runEphemeral()` 中执行
- `runEphemeral()` 不读写 session.json，不污染交互会话

```typescript
// src/cron.ts — 单次任务脚本，由外部调度器触发
import OpenAI from 'openai'
import { MainAgent } from './agents/main'
import { DeliveryAgent } from './agents/delivery'
import { EmailChannel } from './channel/email'

async function main() {
  const channel = new EmailChannel({ /* from env */ })
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  // ...初始化 mcpClient...

  const deliveryAgent = new DeliveryAgent({
    openai, model: process.env.MODEL!, workspaceRoot: './workspace',
    mcpClient, channel,
  })

  const mainAgent = new MainAgent({
    openai, model: process.env.MODEL!, workspaceRoot: './workspace',
    mcpClient, deliveryAgent, channel,
  })

  const result = await mainAgent.runEphemeral(
    '搜索 targets.md 中所有公司的最新职位，将发现的新职位写入 jobs.md'
  )

  // 解析 result 中的 newJobs 数量（约定 LLM 回复结尾包含 "发现 N 个新职位"）
  const countMatch = result.match(/发现\s*(\d+)\s*个新职位/)
  const newJobs = countMatch ? parseInt(countMatch[1]) : 0

  if (newJobs > 0) {
    await channel.send({
      type: 'cron_complete',
      payload: { newJobs, summary: result },
      timestamp: new Date(),
    })
  }
}

main().catch(err => {
  console.error('[cron] 任务失败:', err)
  process.exit(1)
})
```

**外部调度示例**（由用户在系统层面配置，不在代码中指定）：
```
# 系统 crontab — 每天早上 9 点
0 9 * * * /usr/bin/bun /path/to/jobclaw/src/cron.ts

# PM2 ecosystem.config.js
{ cron_restart: '0 9 * * *', script: 'src/cron.ts' }
```

### 3.2 依赖库

```json
{
  "dependencies": {
    "nodemailer": "^6.0.0"
  }
}
```

（移除 `node-cron` — 调度由外部工具负责。）

### 3.3 session 隔离保证

`cron.ts` 调用 `mainAgent.runEphemeral()` 而非 `mainAgent.run()`，不读写 session.json，执行完毕后上下文销毁。Team B 在 `cron.ts` 中不需要手动处理 session。

---

## 4. Bootstrap 流程（`src/bootstrap.ts`）

### 4.1 触发条件

系统入口（`src/index.ts`）启动时检查 `workspace/config.yaml` 是否存在：

- **不存在** → 进入 Bootstrap 引导流程
- **存在** → 跳过 Bootstrap，正常启动 MainAgent

### 4.2 Bootstrap 流程

Bootstrap 是一次引导性对话，由 MainAgent 的普通 `run()` 驱动（无需特殊模式）：

1. 欢迎用户，说明 JobClaw 用途
2. 引导填写 `workspace/data/userinfo.md`（姓名、邮箱、简历链接等关键字段）
3. 引导填写 `workspace/data/targets.md`（至少添加一个公司的招聘页 URL）
4. 告知用户如何设置外部定时任务（`bun src/cron.ts` + 系统 cron 或 PM2）
5. 对话结束后，MainAgent 通过文件工具写入 `workspace/config.yaml`

### 4.3 `workspace/config.yaml` 结构

```yaml
version: "1"
bootstrapped_at: "2026-03-07T09:00:00Z"
```

`config.yaml` 是 Bootstrap 完成的**标志位**，不包含运行时配置。运行时配置继续从 `.env` 读取。

### 4.4 设计保证

Bootstrap 完成后，`targets.md` 至少包含一个有效 URL，`userinfo.md` 包含必要字段。这从设计上**保证了 CronJob 触发时 `targets.md` 不为空**，`cron_no_targets` 消息类型不再需要。

---

## 5. 实现清单

- [ ] **T-B-1**: 实现 `src/channel/base.ts` — 定义完整的 `ChannelMessageType`, `ChannelMessage`, `Channel` 接口（内容见第 2.2、2.3 节）⚠️ **优先完成，Team A/C 开发依赖此接口**
- [ ] **T-B-2**: 实现 `src/channel/email.ts` — `EmailChannel` 类，包含 SMTP 配置、邮件标题/正文构建
- [ ] **T-B-3**: 更新 `.env.example` — 添加 SMTP 相关环境变量
- [ ] **T-B-4**: 安装依赖 `nodemailer`（移除 `node-cron`），更新 `package.json`
- [ ] **T-B-5**: 实现 `src/cron.ts` — 单次任务脚本，调用 `mainAgent.runEphemeral()`，发现新职位时通过 Channel 推送 `cron_complete` 通知
- [ ] **T-B-6**: 实现 `src/bootstrap.ts` — 检测 `workspace/config.yaml`，驱动引导对话，完成后写入 config.yaml
- [ ] **T-B-7**: 更新 `src/index.ts` — 启动前检查 `config.yaml` 是否存在，不存在则进入 Bootstrap 流程
- [ ] **T-B-8**: 编写单元测试（见第 7 节）

---

## 6. 边界条件与错误处理

| 场景 | 期望行为 |
|------|-------|
| SMTP 配置缺失 | `EmailChannel` 构造时检查必需配置，缺失则抛出明确错误（启动时 fail fast） |
| `channel.send()` SMTP 发送失败 | 打印错误，不抛出（不影响 Agent 主流程） |
| `runEphemeral()` 执行超时 / 抛出异常 | `main()` 未捕获时 `process.exit(1)` 退出，外部调度器记录失败日志 |
| 同一脚本上次还没趪完 | 外部调度器负责防重入（如 PM2 `cron_restart` 超时设置，或 flock 包装） |
| 邮件内容包含 HTML 注入 | `buildBody` 对 payload 中所有字符串做 HTML escape，避免注入 |

---

## 7. 验收测试标准

### 7.1 必须通过的单元测试

**TC-B-01**: Channel 接口类型检查
```
Given: src/channel/base.ts 导出 Channel 接口
When: 实现 MockChannel: Channel
Then: TypeScript 编译通过，无类型错误
```

**TC-B-02**: EmailChannel 正常实例化
```
Given: 有效 EmailChannelConfig
When: new EmailChannel(config)
Then: 不抛出异常
```

**TC-B-03**: EmailChannel.send 调用 SMTP 发送
```
Given: mock SMTP transport
When: channel.send({ type: 'new_job', payload: { company: 'Acme', title: 'SWE', url: '...' }, timestamp: new Date() })
Then: SMTP transport 的 sendMail 被调用一次
      邮件 subject 包含 'Acme' 或 'SWE'
```

**TC-B-04**: EmailChannel.send 失败时不抛出
```
Given: SMTP transport 抛出 ECONNREFUSED
When: await channel.send(...)
Then: 不抛出异常（内部捕获并 console.error）
```

**TC-B-05**: buildBody 对 payload 字符串做 HTML escape
```
Given: payload.company = '<script>alert(1)</script>'
When: emailChannel['buildBody'](message)
Then: 返回的字符串包含 '&lt;script&gt;' 而不是原始 '<script>'
```

**TC-B-06**: cron.ts - main() 发现新职位时发送 cron_complete
```
Given: mock mainAgent.runEphemeral() 返回 "发现 3 个新职位，..."
       mock channel.send spy
When: main()
Then: channel.send type === 'cron_complete'
      payload.newJobs === 3
```

**TC-B-07**: cron.ts - main() 无新职位时不发通知
```
Given: mock mainAgent.runEphemeral() 返回 "未发现新职位"
When: main()
Then: channel.send 未被调用
```

**TC-B-08**: cron.ts - main() 抛出异常时 process.exit(1)
```
Given: mock mainAgent.runEphemeral() 抛出 Error('MCP 连接失败')
When: main()
Then: main() 抛出异常（调用方 .catch 处理）
```

**TC-B-09**: bootstrap.ts - config.yaml 存在时 needsBootstrap 返回 false
```
Given: workspace/config.yaml 存在
When: needsBootstrap('./workspace')
Then: 返回 false
```

**TC-B-10**: bootstrap.ts - config.yaml 不存在时 needsBootstrap 返回 true
```
Given: workspace/config.yaml 不存在
When: needsBootstrap('./workspace')
Then: 返回 true
```

### 7.2 集成测试（可选）

**TC-B-11**: 端到端邮件发送（需要真实 SMTP 配置，CI 跳过）

---

## 8. 文件 Skeleton（实现参考）

```typescript
// src/channel/base.ts
export type ChannelMessageType =
  | 'new_job' | 'delivery_start' | 'delivery_success'
  | 'delivery_failed' | 'delivery_blocked'
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

```typescript
// src/channel/email.ts
import nodemailer from 'nodemailer'
import type { Channel, ChannelMessage } from './base'

export class EmailChannel implements Channel {
  // ...
  async send(message: ChannelMessage): Promise<void> {
    try {
      // ...
    } catch (error) {
      console.error('[EmailChannel] 发送失败:', error)
      // 不 rethrow
    }
  }
}
```

```typescript
// src/cron.ts — 单次任务脚本
async function main() { /* T-B-5 */ }

main().catch(err => {
  console.error('[cron] 任务失败:', err)
  process.exit(1)
})
```

```typescript
// src/bootstrap.ts
import fs from 'fs'
import path from 'path'

export function needsBootstrap(workspaceRoot: string): boolean {
  return !fs.existsSync(path.join(workspaceRoot, 'config.yaml'))
}

// Bootstrap 对话由 MainAgent.run() 完成
// src/index.ts 调用示例：
// if (needsBootstrap('./workspace')) {
//   await mainAgent.run('【系统初始化引导】请引导用户完成 JobClaw 配置，结束后写入 workspace/config.yaml')
// }
```

