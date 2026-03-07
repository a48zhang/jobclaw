# JobClaw 技术规格说明书

> 版本: 0.1.0  
> 更新日期: 2026-03-06

---

## 1. 项目概述

**JobClaw** 是一个智能求职助手 AI multiagent。

投递 Agent 通过 Playwright MCP 操作浏览器投递。

信息搜集 Agent 自动抓取职位并提示投递.

主 Agent 与用户交互,获取必要信息等.
---

## 2. 系统架构

```
┌────────────────────────────────────────────────────────────┐
│                        BaseAgent                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Agent Loop                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │   LLM Client  │  │     Tools     │  │   MCP Client  │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└────────────────────────────────────────────────────────────┘
                              ▲
                              │ 继承
                 ┌────────────┴────────────┐
                 │                         │
        ┌───────────────┐        ┌───────────────┐
        │  MainAgent    │        │ DeliveryAgent │
        │ (搜索+交互)   │        │  (自动投递)   │
        └───────┬───────┘        └───────────────┘
                │ spawnAgent(deliveryAgent, ...)
                └──────串行，共享 MCP 实例──────▶
```

---

## 3. 目录结构

```
jobclaw/
├── src/
│   ├── index.ts             # 入口（检测 config.yaml，决定是否 Bootstrap）
│   ├── bootstrap.ts         # Bootstrap 引导流程（首次运行）
│   ├── cron.ts              # CronJob 单次任务脚本（外部调度器触发）
│   ├── types.ts             # 类型定义
│   ├── tools/
│   │   ├── index.ts         # 工具执行器入口与 Schema 定义
│   │   ├── utils.ts         # 工具共享函数
│   │   ├── readFile.ts      # 读取文件工具实现
│   │   ├── writeFile.ts     # 写入文件工具实现
│   │   ├── appendFile.ts    # 追加文件工具实现
│   │   ├── listDirectory.ts # 列出目录工具实现
│   │   └── lockFile.ts      # 文件锁工具实现
│   ├── agents/
│   │   ├── base/            # BaseAgent 核心包
│   │   │   ├── index.ts     # 导出入口
│   │   │   ├── agent.ts     # BaseAgent 核心类
│   │   │   ├── types.ts     # Agent 相关类型定义
│   │   │   ├── constants.ts # 常量定义
│   │   │   └── context-compressor.ts  # 上下文压缩模块
│   │   ├── main/            # MainAgent（搜索+交互）
│   │   │   └── index.ts
│   │   ├── delivery/        # DeliveryAgent（表单投递）
│   │   │   └── index.ts
│   │   └── skills/          # 代码级默认 Skill（只读）
│   │       └── jobclaw-skills.md
│   ├── web/
│   │   └── server.ts        # Hono 服务端
│   └── channel/
│       ├── base.ts          # Channel 抽象接口
│       └── email.ts         # 邮件通知实现
├── workspace/
│   ├── config.yaml          # Bootstrap 完成标志（首次运行后生成）
│   ├── skills/              # 用户级 Skill（可覆盖代码默认，优先级更高）
│   │   └── jobclaw-skills.md
│   ├── agents/              # Agent 私有文件
│   │   ├── main/
│   │   │   ├── session.json # 会话记忆（会压缩）
│   │   │   └── notebook.md  # 笔记本（持久化）
│   │   └── delivery/
│   │       ├── session.json # ephemeral 模式下不读写
│   │       └── notebook.md  # 笔记本（持久化）
│   └── data/                # 共享数据（持久化，不压缩）
│       ├── userinfo.md
│       ├── targets.md
│       └── jobs.md
├── package.json
├── tsconfig.json
└── README.md
```

---

## 4. 多 Agent 架构

### 4.1 BaseAgent

所有 Agent 的基类：

- 管理与 LLM 的交互
- 处理工具调用
- 管理运行状态
- 支持本地工具和 MCP 工具

### 4.2 MainAgent

主 Agent（同时也是"搜索 Agent"）：

- 继承 BaseAgent
- 负责用户交互（交互模式）
- **直接**通过 Playwright MCP 工具搜索职位，无独立 SearchAgent
- 通过 `spawnAgent(deliveryAgent, instruction)` 将投递委托给 DeliveryAgent（串行）
- 支持 `runEphemeral(instruction)` 被 CronJob 无状态拉起，执行完毕后上下文销毁
- `systemPrompt` 通过 `loadSkill('jobclaw-skills')` 内嵌搜索 SOP 和去重 SOP

### 4.3 DeliveryAgent（投递）

职责：自动投递匹配职位

- 继承 BaseAgent
- **仅**通过 `spawnAgent` 以子进程形式运行（`runEphemeral`），永不直接 `run()`
- 最多执行 50 步，用尽后不重试，返回结果给 MainAgent
- 通过 Playwright MCP 填写表单投递
- 写入 workspace/data/jobs.md（状态更新：applied/failed/login_required）
- 通过 Channel 发送通知
- `systemPrompt` 通过 `loadSkill('jobclaw-skills')` 内嵌投递 SOP

---

## 5. 记忆机制

### 5.1 记忆架构

```
workspace/
├── config.yaml              # Bootstrap 完成标志（首次运行后生成）
├── skills/                  # 用户级 Skill（可覆盖代码默认）
│   └── jobclaw-skills.md    # 统一 Skill 文件（含搜索/去重/投递 SOP）
├── agents/                  # Agent 私有文件
│   ├── main/
│   │   ├── session.json     # 会话记忆（会压缩）
│   │   └── notebook.md      # 笔记本（持久化）
│   └── delivery/
│       ├── session.json     # ephemeral 模式下不读写
│       └── notebook.md      # 笔记本（持久化）
│
└── data/                    # 共享数据（持久化，不压缩）
    ├── userinfo.md          # 用户信息
    ├── targets.md           # 监测目标
    └── jobs.md              # 已投递岗位
```

### 5.2 文件分类

| 文件 | 类型 | 格式 | 压缩 | 说明 |
|------|------|------|------|------|
| session.json | Agent 私有 | JSON | 是 | 会话记忆，达到阈值压缩 |
| notebook.md | Agent 私有 | Markdown | 否 | 笔记本，持久化存储 |
| data/*.md | 共享数据 | Markdown | 否 | 持久化，不压缩 |

### 5.3 访问边界

- Agent 只能访问自己的 `workspace/agents/{name}/` 目录
- Agent 可以读取所有 `workspace/data/` 共享数据
- 工具层限制路径范围

### 5.4 记忆压缩

- 上下文窗口：262144 tokens
- 压缩阈值：75%（196608 tokens）
- 压缩后目标：30%（约 78643 tokens）
- 保留最近 `keepRecentMessages` 条完整消息（默认 20），更早的压缩为摘要

### 5.5 文件锁机制

共享数据文件 `jobs.md` 可能被多个 Agent 写入，需使用文件锁避免竞争：

- 写入前调用 `lock_file` 获取锁
- 写入完成后调用 `unlock_file` 释放锁
- 锁超时时间：30 秒，超时自动释放
- 锁文件位置：`workspace/.locks/jobs.md.lock`

---

## 6. Web UI（规划中）

提供可视化监控和手动干预界面。

### 6.1 功能

| 页面 | 功能 |
|------|------|
| 仪表盘 | 抓取/投递统计、最近活动 |
| 岗位列表 | 浏览已投递岗位、状态 |
| 目标管理 | 编辑 targets.md |
| 个人信息 | 编辑 userinfo.md |

### 6.2 技术栈

- 运行时：Bun
- 框架：Hono
- 前端：静态 HTML + Tailwind CSS + Alpine.js
- 实时更新：WebSocket

---

## 7. Channel（通知通道）

### 7.1 设计

Channel 是抽象接口，支持多种通知方式：

```
Channel (abstract)
    ├── EmailChannel    # 邮件通知（默认实现）
    ├── WeChatChannel   # 微信通知（预留）
    └── SmsChannel      # 短信通知（预留）
```

**职责边界**：Channel 仅用于向**外部用户**推送通知（邮件/Webhook 等），不用于 Agent 间通信。Agent 间通过 `jobs.md` + 文件锁交换数据。

### 7.2 接口定义

```typescript
export type ChannelMessageType =
  | 'new_job'           // MainAgent 发现新职位
  | 'delivery_start'    // DeliveryAgent 开始投递
  | 'delivery_success'  // 成功投递
  | 'delivery_failed'   // 投递失败
  | 'delivery_blocked'  // 需要登录/人工介入
  | 'cron_complete'     // CronJob 执行完毕汇总

export interface ChannelMessage {
  type: ChannelMessageType
  payload: Record<string, unknown>
  timestamp: Date
}

export interface Channel {
  send(message: ChannelMessage): Promise<void>
}
```

### 7.3 触发场景

| 场景 | type | payload 字段 |
|------|------|-------------|
| 发现新职位 | `new_job` | `company`, `title`, `url` |
| 开始投递 | `delivery_start` | `company`, `title`, `url` |
| 投递成功 | `delivery_success` | `company`, `title`, `url`, `time` |
| 投递失败 | `delivery_failed` | `company`, `title`, `url`, `reason?` |
| 需要登录 | `delivery_blocked` | `company`, `title`, `url`, `reason` |
| CronJob 汇总 | `cron_complete` | `newJobs`, `summary` |

### 7.4 邮件配置

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
NOTIFY_EMAIL=target@example.com
```

---

## 8. Bootstrap 首次运行

`src/index.ts` 启动时检查 `workspace/config.yaml` 是否存在：

- **不存在** → 进入 Bootstrap 引导流程（`src/bootstrap.ts`）
- **存在** → 跳过 Bootstrap，正常启动 MainAgent

Bootstrap 是一次引导性对话，引导用户：
1. 填写 `workspace/data/userinfo.md`（姓名、邮箱、简历链接等）
2. 填写 `workspace/data/targets.md`（至少添加一个公司的招聘页 URL）
3. 告知如何配置外部定时任务（`bun src/cron.ts` + 系统 cron 或 PM2）

对话结束后写入 `workspace/config.yaml`：
```yaml
version: "1"
bootstrapped_at: "2026-03-07T09:00:00Z"
```

`config.yaml` 是 Bootstrap 完成的**标志位**，不包含运行时配置。这从设计上保证了 CronJob 触发时 `targets.md` 不为空。

---

## 9. CronJob 定时任务

`src/cron.ts` 是**单次任务脚本**，由外部调度器（系统 cron、PM2、Task Scheduler 等）按需触发。**调度时机由用户或运维在系统层面决定，代码中不包含任何调度表达式、不存储 cron 配置**。

```bash
# 外部调度示例（由用户配置，不在代码中指定）
# 系统 crontab — 每天早上 9 点
0 9 * * * /usr/bin/bun /path/to/jobclaw/src/cron.ts
```

`cron.ts` 调用 `mainAgent.runEphemeral(instruction)` 而非 `mainAgent.run()`，不读写 session.json，执行完毕后上下文销毁。

---

## 10. 配置

```bash
# AI
OPENAI_API_KEY=sk-xxx

# 邮件通知（可选）
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
NOTIFY_EMAIL=target@example.com
```

---

## 11. 开发路线

| Phase | 内容 |
|-------|------|
| 1 | Agent Loop + Playwright MCP 集成 |
| 2 | 抓取功能（读取 targets.md → 写入 jobs.md）|
| 3 | 投递功能（读取 userinfo.md → 填表 → 写入 jobs.md） |
| 4 | 匹配、错误处理、状态追踪 |
| 5 | Bootstrap 引导流程 + CronJob 脚本 |
| 6 | Channel 通知（邮件优先） |
| 7 | Web UI 面板 |