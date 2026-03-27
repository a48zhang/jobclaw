# JobClaw 技术规格说明书

> 版本：0.2  
> 更新日期：2026-03-27

## 1. 项目概述

JobClaw 是一个默认通过 Web 控制台运行的求职自动化系统。

当前系统由 3 个核心层组成：

- `RuntimeKernel`
  负责配置装配、主 Agent 生命周期、MCP 接入、事件流、会话状态、人工干预状态和运行时恢复语义。
- `MainAgent`
  是用户长期面对的主 Agent，负责自由对话、任务调度和主流程控制。
- `ProfileAgent`
  作为受限子 Agent 运行，按 profile 获得不同的工具、读写路径和浏览器能力。

Web 端通过 HTTP API + WebSocket 展示：

- 主对话和实时流式输出
- 职位看板与统计
- 配置状态
- 简历任务与产物
- 工具调用与人工干预事件

`workspace/` 是运行期事实来源，配置、会话、状态和业务数据都写入其中。

## 2. 运行入口

### 2.1 默认启动

CLI 默认命令是启动 Web 控制台：

```bash
jobclaw
# 或
npm run start
```

对应代码路径：

- `src/index.ts`
- `src/cli/index.ts`
- `src/tui-runner.ts`

实际启动流程：

1. 初始化 `workspace/`
2. 读取配置状态
3. 创建 `RuntimeKernel`
4. 启动 Web 服务
5. 若基础模型配置完整，则加载主 Agent；否则进入设置向导状态

### 2.2 Cron 模式

```bash
jobclaw cron
# 或
npm run cron
```

`src/cron.ts` 当前支持：

- `search`
  运行一次搜索任务
- `digest`
  运行日报任务，并通过 `EmailChannel` 发送摘要

Cron 模式要求基础配置完整。

## 3. 系统架构

```text
CLI / Cron
   |
   v
RuntimeKernel
   |
   +-- Config + Workspace bootstrap
   +-- OpenAI client
   +-- Playwright MCP client (optional)
   +-- Event stream + session/delegation/conversation stores + intervention manager
   \-- AgentFactory
          |
          +-- MainAgent
          \-- ProfileAgent(search / delivery / resume / review)
```

当前真实架构特点：

- `MainAgent` 是用户唯一长期入口。
- 子任务通过 `AgentFactory.createAgent({ profileName })` 创建对应 profile 的 `ProfileAgent`。
- capability policy 会限制 profile 的工具、读写路径、委派范围和浏览器能力。
- Web 模式允许缺少基础模型配置启动，此时主 Agent 不创建，但 Web 仍可进入设置态。
- MCP / 浏览器能力是可选依赖；不可用时系统仍可启动。

## 4. 目录结构

```text
jobclaw/
├── src/
│   ├── agents/
│   ├── runtime/
│   ├── memory/
│   ├── tools/
│   ├── web/
│   ├── cli/
│   ├── channel/
│   ├── config.ts
│   ├── env.ts
│   ├── mcp.ts
│   ├── tui-runner.ts
│   └── cron.ts
├── public/
├── docs/
├── tests/
└── workspace/
    ├── config.json
    ├── agents/
    ├── data/
    ├── skills/
    ├── output/
    └── state/
```

`workspace/` 在代码中会自动初始化：

- `config.json`
- `data/userinfo.md`
- `data/targets.md`
- `skills/` 默认 skill 副本
- `agents/` 持久化会话目录
- `output/` 产物目录
- `state/session`
- `state/conversation`
- `state/delegation`
- `state/interventions`
- `state/jobs`
- `state/user`
- `state/artifacts`

## 5. 配置与环境

### 5.1 配置文件

配置文件是 `workspace/config.json`，字段为扁平结构：

- `API_KEY`
- `MODEL_ID`
- `LIGHT_MODEL_ID`
- `BASE_URL`
- `SERVER_PORT`

### 5.2 环境变量覆盖

`src/config.ts` 当前支持：

- `API_KEY` <- `API_KEY` / `OPENAI_API_KEY`
- `MODEL_ID` <- `MODEL_ID` / `MODEL`
- `LIGHT_MODEL_ID` <- `LIGHT_MODEL_ID` / `LIGHT_MODEL`
- `BASE_URL` <- `BASE_URL` / `OPENAI_BASE_URL`
- `SERVER_PORT` <- `SERVER_PORT`

### 5.3 启动校验

`src/env.ts` 的当前行为：

- Web 模式允许缺少 `API_KEY` / `MODEL_ID` / `BASE_URL` 启动
- Cron 模式要求基础配置完整
- `digest` 模式额外要求 SMTP 相关环境变量
- 启动时会检查 `typst`；缺失时只告警，不阻止服务启动

## 6. Agent 运行模型

### 6.1 BaseAgent

`BaseAgent` 负责：

- 消息队列与串行执行
- OpenAI 流式响应
- 本地工具与 MCP 工具装载
- tool call 执行与消息历史回写
- `request` 工具触发人工干预
- 会话压缩与持久化

### 6.2 MainAgent

`MainAgent` 继承 `ProfileAgent`，固定使用 `main` profile。

当前主要职责：

- 用户主对话
- 搜索职位
- 简历生成
- 简历评价与模拟面试
- 调度子 Agent
- 汇总工具结果和子任务结果

### 6.3 ProfileAgent

`ProfileAgent` 根据 `profileName` 动态装配系统提示和能力边界。

当前支持的 profile：

- `main`
- `search`
- `delivery`
- `resume`
- `review`

profile 决定：

- 可用工具
- 可读写路径
- 是否允许浏览器工具
- 是否允许委派其他 profile

### 6.4 持久化策略

- Web 模式主 Agent 默认持久化到 `workspace/agents/{agentName}/session.json`
- `run_agent` 创建的子 Agent 默认不持久化
- cron 中创建的 Agent 默认不持久化
- `workspace/agents/{agentName}/session.json` 是 Agent 私有 checkpoint
- `workspace/state/session/{sessionId}.json` 是 Runtime / Web 的会话读模型
- `workspace/state/conversation/{sessionId}.json` 保存最近对话与摘要，供 Web 恢复历史消息

## 7. 工具与能力控制

本地工具注册在 `src/tools/index.ts`，当前主要包括：

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

此外，`BaseAgent` 会注入：

- `request`

如果 MCP 可用，Playwright 浏览器工具也会并入工具列表。

能力边界由 `capability-policy` 控制：

- 浏览器工具是否允许
- 本地工具是否允许
- 文件读写路径是否允许
- profile 间委派是否允许

## 8. Web 控制台

### 8.1 当前前端能力

`public/` 当前包含：

- 聊天面板
- 职位看板与统计
- 基础设置编辑
- `targets.md` / `userinfo.md` 编辑
- 简历 PDF 生成
- PDF 简历上传与评价
- 人工干预弹窗
- 实时日志与 Agent 状态展示

### 8.2 API 概览

`src/web/server.ts` 当前提供的主要接口：

- `GET /api/settings`
- `POST /api/settings`
- `GET /api/jobs`
- `GET /api/stats`
- `POST /api/jobs/status`
- `POST /api/jobs/delete`
- `POST /api/intervention`
- `GET /api/runtime/sessions`
- `GET /api/delegations`
- `GET /api/delegations/:sessionId`
- `GET /api/interventions`
- `GET /api/interventions/:ownerId`
- `GET /api/session/:agentName`
- `POST /api/chat`
- `POST /api/resume/build`
- `GET /api/resume/status`
- `POST /api/resume/review`
- `POST /api/resume/upload`
- `GET /api/config/:name`
- `POST /api/config/:name`
- `GET /workspace/output/*`
- `GET /ws`

### 8.3 WebSocket 事件

当前会广播：

- `agent:state`
- `agent:log`
- `agent:stream`
- `agent:tool`
- `job:updated`
- `intervention:required`
- `intervention:resolved`
- `context:usage`

补充说明：

- WebSocket 的真实上游已经是 runtime event stream 与 structured stores。
- 为了维持前端兼容，server 会把 runtime 事件适配为现有的 `agent:*` / `intervention:*` / `context:usage` 事件。
- 连接建立时的 `snapshot` 来自 `state/session`；若存在 pending intervention，也会在连接时补发对应的 `intervention:required`。

## 9. 数据文件

当前运行依赖的主要文件和目录：

- `workspace/config.json`
- `workspace/data/userinfo.md`
- `workspace/data/targets.md`
- `workspace/data/jobs.md`
- `workspace/state/jobs/jobs.json`
- `workspace/data/uploads/resume-upload.pdf`
- `workspace/output/resume.pdf`
- `workspace/agents/**`
- `workspace/state/**`

事实源规则：

- 职位数据以后端结构化存储 `workspace/state/jobs/jobs.json` 为正式事实源。
- `workspace/data/jobs.md` 保留为可读、可编辑的导入导出表示，不再作为后端唯一数据源。

## 10. 当前文档边界

本文件只记录当前代码的真实行为。

以下文档不应当被当作当前事实源：

- `docs/agent-first-architecture.md`
  这是方向性设计文档
- `docs/architecture-refactor-tasks.md`
  这是历史阶段任务清单
- `docs/dev/agent-first-handoff/**`
  这是历史交接包
