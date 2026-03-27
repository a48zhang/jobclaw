# JobClaw 技术规格说明书

> 版本: 0.1.0  
> 更新日期: 2026-03-27

## 1. 项目概述

JobClaw 是一个以 `MainAgent` 为核心的求职自动化系统，默认通过 Web 控制台运行。

- `MainAgent` 负责用户交互、职位搜索、简历生成、简历评价与子任务调度。
- 子任务不再依赖独立 Agent 类型，而是通过 `run_agent` 创建临时 `MainAgent` 实例执行。
- Web 端通过 HTTP API + WebSocket 展示会话、日志、工具调用、职位状态与人工干预请求。
- `workspace/` 是运行期事实来源，配置、会话和业务数据都写入其中。

## 2. 运行入口

### 2.1 默认启动

CLI 默认命令是启动 Web 控制台：

```bash
jobclaw
# 或
npm run start
```

对应代码路径：

- `src/index.ts`: 进程入口与全局 crash logger
- `src/cli/index.ts`: CLI 命令定义
- `src/tui-runner.ts`: 实际启动 Web 服务、加载配置、创建 `MainAgent`

### 2.2 Cron 模式

```bash
jobclaw cron
# 或
npm run cron
```

`src/cron.ts` 当前支持两种模式：

- `search`: 运行一次搜索任务，静默写入 `jobs.md`
- `digest`: 运行日报任务，通过 `EmailChannel` 发送汇总

## 3. 系统架构

```text
CLI / Cron
   |
   v
runServer / runCron
   |
   +-- Config + Workspace bootstrap
   +-- OpenAI client
   +-- Playwright MCP client (optional)
   +-- AgentFactory
   \-- MainAgent
          |
          +-- BaseAgent loop
          +-- Local tools
          +-- MCP tools
          \-- request / run_agent
```

当前真实架构特点：

- `MainAgent` 是唯一有业务实现的 Agent。
- `src/agents/search/index.ts` 当前没有独立搜索逻辑，不应视为可运行 Agent。
- 临时子任务通过 `AgentFactory.createAgent({ persistent: false })` 创建。
- Web 与 TUI 共用部分展示/解析逻辑，但默认交互模式是 Web。

## 4. 目录结构

```text
jobclaw/
├── src/
│   ├── index.ts
│   ├── cli/index.ts
│   ├── tui-runner.ts
│   ├── cron.ts
│   ├── config.ts
│   ├── env.ts
│   ├── eventBus.ts
│   ├── mcp.ts
│   ├── agents/
│   │   ├── base/
│   │   ├── factory.ts
│   │   ├── main/
│   │   ├── search/
│   │   └── skills/
│   ├── tools/
│   ├── web/
│   └── channel/
├── public/
├── docs/
├── tests/
└── workspace/
    ├── config.json
    ├── agents/
    ├── data/
    ├── output/
    └── skills/
```

`workspace/` 在代码里会被自动初始化：

- `config.json`
- `data/userinfo.md`
- `data/targets.md`
- `skills/` 默认 skill 副本
- `agents/` 会话目录
- `output/` 产物目录

## 5. 配置与环境

### 5.1 配置文件

配置文件是 `workspace/config.json`，字段为扁平结构：

- `API_KEY`
- `MODEL_ID`
- `LIGHT_MODEL_ID`
- `BASE_URL`
- `SERVER_PORT`

### 5.2 环境变量覆盖

`src/config.ts` 当前支持的覆盖关系：

- `API_KEY` <- `API_KEY` / `OPENAI_API_KEY`
- `MODEL_ID` <- `MODEL_ID` / `MODEL`
- `LIGHT_MODEL_ID` <- `LIGHT_MODEL_ID` / `LIGHT_MODEL`
- `BASE_URL` <- `BASE_URL` / `OPENAI_BASE_URL`
- `SERVER_PORT` <- `SERVER_PORT`

### 5.3 启动校验

`src/env.ts` 的实际行为：

- Web 模式允许缺少基础 LLM 配置启动，此时进入“设置向导模式”
- Cron 模式要求基础配置完整
- `digest` 模式额外要求 SMTP 相关环境变量
- 启动时会尝试检查 `typst`，缺失时只警告，不阻止服务启动

## 6. Agent 运行模型

### 6.1 BaseAgent

`BaseAgent` 负责：

- 维护消息队列与串行执行链
- 调用 OpenAI 流式 Chat Completions
- 动态装载本地工具与 MCP 工具
- 执行 tool call 并把结果写回消息历史
- 支持 `request` 工具触发人工干预
- 支持上下文压缩与持久化 session

### 6.2 MainAgent

`MainAgent` 在系统提示中内嵌：

- 职位搜索规则
- 简历生成规则
- 简历评价与模拟面试规则
- skill 索引内容

当前它负责的主要能力：

- 搜索职位
- 调用 `upsert_job` 维护 `jobs.md`
- 调用 `run_agent` 执行投递类或其他隔离子任务
- 生成简历 PDF
- 基于上传 PDF 或工作区材料做简历评价
- 发起 `request` 等待用户补充输入

### 6.3 持久化策略

- `persistent: true` 的 Agent 会读写 `workspace/agents/{agentName}/session.json`
- Web 模式主 Agent 默认持久化
- `run_agent` 创建的临时 Agent 默认不持久化
- `cron` 中的 Agent 默认不持久化

## 7. 工具系统

`src/tools/index.ts` 当前注册的本地工具包括：

- `read_file`
- `write_file`
- `append_file`
- `list_directory`
- `lock_file`
- `unlock_file`
- `upsert_job`
- `typst_compile`
- `install_typst`
- `run_shell_command`
- `read_pdf`
- `grep`
- `get_time`
- `run_agent`

此外，`BaseAgent` 还会额外注入内建工具：

- `request`

如果 MCP 可用，Playwright MCP 暴露的浏览器工具也会并入工具列表。

## 8. Web 控制台

### 8.1 当前前端能力

`public/` 下的前端实现当前包含：

- 聊天面板
- 职位看板与统计
- 基础设置编辑
- `targets.md` / `userinfo.md` 编辑
- 简历 PDF 生成
- PDF 简历上传与评价
- 人工干预弹窗
- 实时日志与 agent 状态展示

### 8.2 API 概览

`src/web/server.ts` 当前提供的主要接口：

- `GET /api/settings`
- `POST /api/settings`
- `GET /api/jobs`
- `GET /api/stats`
- `POST /api/intervention`
- `GET /api/session/:agentName`
- `POST /api/chat`
- `POST /api/resume/build`
- `POST /api/resume/review`
- `POST /api/resume/upload`
- `GET /api/config/:name`
- `POST /api/config/:name`
- `GET /workspace/output/*`
- `GET /ws` WebSocket

### 8.3 WebSocket 事件

当前事件总线与 WebSocket 会广播：

- `agent:state`
- `agent:log`
- `agent:stream`
- `agent:tool`
- `job:updated`
- `intervention:required`
- `intervention:resolved`
- `context:usage`

## 9. 数据文件

当前运行依赖的主要数据文件：

- `workspace/config.json`
- `workspace/data/userinfo.md`
- `workspace/data/targets.md`
- `workspace/data/jobs.md`
- `workspace/data/uploads/resume-upload.pdf`
- `workspace/output/resume.pdf`
- `workspace/agents/*/session.json`

## 10. 一致性约束

- 职位写入应优先通过 `upsert_job`，不要手写覆盖 `jobs.md` 结构。
- 文档描述的默认入口应始终与 CLI 行为一致。
- “子 Agent” 在当前代码语义里是“临时 `MainAgent` 实例”，不是独立类层级。
- 文档中提到的功能，只有在 `src/` 中存在对应入口、工具或路由时才视为已实现。
