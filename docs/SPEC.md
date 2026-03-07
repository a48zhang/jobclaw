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
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  MainAgent    │    │ SearchAgent   │    │ DeliveryAgent │
│  (用户交互)    │    │  (职位抓取)   │    │  (自动投递)   │
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## 3. 目录结构

```
jobclaw/
├── src/
│   ├── index.ts             # 入口
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
│   │   ├── main/            # MainAgent
│   │   │   └── index.ts
│   │   ├── search/          # SearchAgent
│   │   │   └── index.ts
│   │   └── delivery/        # DeliveryAgent
│   │       └── index.ts
│   ├── web/
│   │   └── server.ts        # Hono 服务端
│   └── channel/
│       ├── base.ts          # Channel 抽象接口
│       └── email.ts         # 邮件通知实现
├── workspace/
│   ├── agents/              # Agent 私有文件
│   │   ├── main/
│   │   │   ├── session.json # 会话记忆（会压缩）
│   │   │   └── notebook.md  # 笔记本（持久化）
│   │   ├── search/
│   │   │   ├── session.json
│   │   │   └── notebook.md
│   │   └── delivery/
│   │       ├── session.json
│   │       └── notebook.md
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

主 Agent：

- 继承 BaseAgent
- 负责用户交互
- 管理任务队列，分发任务到其他 Agent
- 协调 Agent 间通信

### 4.3 SearchAgent（信息搜集）

职责：自动抓取职位信息

- 继承 BaseAgent
- 构造函数接收 MCP 客户端和可选的 Channel
- 通过 Playwright MCP 访问招聘页面
- 解析页面提取职位信息
- 写入 workspace/data/jobs.md
- 发现匹配职位后通过 Channel 发送"新职位匹配"通知

### 4.4 DeliveryAgent（投递）

职责：自动投递匹配职位

- 继承 BaseAgent
- 匹配职位与用户意向
- 通过 Playwright MCP 填写表单投递
- 写入 workspace/data/jobs.md
- 通过 Channel 发送通知

---

## 5. 记忆机制

### 5.1 记忆架构

```
workspace/
├── agents/                  # Agent 私有文件
│   ├── main/
│   │   ├── session.json     # 会话记忆（会压缩）
│   │   └── notebook.md      # 笔记本（持久化）
│   ├── search/
│   │   ├── session.json
│   │   └── notebook.md
│   └── delivery/
│       ├── session.json
│       └── notebook.md
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

### 7.2 接口定义

```typescript
interface Channel {
  send(title: string, content: string, options?: Record<string, unknown>): Promise<boolean>;
}
```

### 7.3 触发场景

| 场景 | 通知内容 |
|------|----------|
| 投递成功 | 公司 + 职位 + 时间 |
| 投递失败 | 公司 + 职位 + 错误原因 |
| 需要登录 | 公司 + 登录入口 |
| 新职位匹配 | 职位数量 + 匹配度 |

### 7.4 邮件配置

```bash
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=user@example.com
SMTP_PASS=password
NOTIFY_EMAIL=target@example.com
```

---

## 8. 配置

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

## 9. 开发路线

| Phase | 内容 |
|-------|------|
| 1 | Agent Loop + Playwright MCP 集成 |
| 2 | 抓取功能（读取 targets.md → 写入 jobs.md） |
| 3 | 投递功能（读取 userinfo.md → 填表 → 写入 jobs.md） |
| 4 | 匹配、错误处理、状态追踪 |
| 5 | Web UI 面板 |
| 6 | Channel 通知（邮件优先） |