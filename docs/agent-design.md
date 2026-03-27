# Agent 核心实现方案

本文档描述当前代码中的真实 Agent 设计，优先以 `src/agents/` 与 `src/tools/` 实现为准。

## 1. 设计总览

```text
BaseAgent
  ├─ OpenAI streaming loop
  ├─ local tools
  ├─ MCP tools
  ├─ request intervention bridge
  ├─ context compressor
  └─ session persistence
       ^
       |
   MainAgent
       |
       \-- run_agent -> ephemeral MainAgent
```

当前实现中：

- `MainAgent` 是唯一实际有业务行为的 Agent 类型。
- `run_agent` 不会创建专门的“DeliveryAgent”或“SearchAgent”，而是创建临时 `MainAgent`。
- 临时 Agent 与主 Agent 共享 OpenAI、MCP、workspace 和模型配置，但消息历史隔离。

## 2. BaseAgent

`src/agents/base/agent.ts` 是当前核心实现，主要职责如下。

### 2.1 消息与执行模型

- `submit()` 将普通输入放入队列，将 `/new`、`/clear` 作为即时命令处理。
- `processLoop()` 逐条消费队列，保证同一 Agent 内串行执行。
- `enqueueExecution()` 再次保证 `run()` 不会并发读写共享状态。
- `consumePendingQueuedInputs()` 会在安全边界把排队中的用户消息合并进当前上下文。

这意味着当前 Agent 模型不是“每条消息启动一个新会话”，而是“单 Agent 串行长期会话”。

### 2.2 LLM 主循环

`runMainLoop()` 的真实行为：

- 过滤掉空 assistant 消息
- 在第一条 `system` 消息前动态注入当前时间
- 发送流式 OpenAI 请求
- 累积文本输出与 `tool_calls`
- 通过 channel / eventBus 把流式响应同步到前端
- 若模型请求工具，则执行工具并继续下一轮
- 若模型返回纯文本，则结束本轮任务

### 2.3 工具来源

工具列表由三部分组成：

1. `src/tools/index.ts` 中的本地工具
2. `BaseAgent` 内建的 `request` 工具
3. MCP 客户端返回的 Playwright 工具

工具执行分支规则：

- 本地工具名命中 `LOCAL_TOOL_NAMES` 时，走 `executeTool()`
- 工具名是 `request` 时，走 `executeRequestToolCall()`
- 否则在 MCP 存在时，转发给 MCP

### 2.4 人工干预

`request` 工具是当前代码里正式可调用的工具，不再只是文档约定。

执行路径：

1. 模型调用 `request`
2. `BaseAgent.executeRequestToolCall()` 校验参数
3. 内部复用 `requestIntervention()`
4. 通过 `eventBus` 发出 `intervention:required`
5. Web 端或 TUI 收到后展示输入界面
6. 用户提交后发出 `intervention:resolved`
7. Agent 继续执行

支持的 `kind`：

- `text`
- `confirm`
- `single_select`

### 2.5 持久化与恢复

- `loadSession()` 读取 `workspace/agents/{agentName}/session.json`
- `saveSession()` 仅在 `persistent: true` 时写磁盘
- `resetSession()` 会归档旧 session 并清空内存状态
- `ContextCompressor` 在消息过长时负责摘要压缩

## 3. MainAgent

`src/agents/main/index.ts` 在 `BaseAgent` 基础上补充业务系统提示与工具结果钩子。

### 3.1 系统提示组成

当前系统提示由以下部分拼接：

- 主角色说明
- MCP 可用性提示
- 职位搜索与筛选规则
- `skills/index.md` 的索引内容
- 简历生成规则
- 简历评价 / 模拟面试规则
- 数据文件说明
- BaseAgent 注入的核心行为准则

### 3.2 业务职责

当前 `MainAgent` 实际承担：

- 用户主对话
- 职位搜索
- 简历生成
- 简历评价
- 模拟面试
- 子任务调度

### 3.3 工具结果钩子

`onToolResult()` 目前对两类工具做额外处理：

- `typst_compile` 成功时，推送“简历已生成”相关日志与事件
- `run_agent` 完成时，推送子任务成功/失败日志

## 4. AgentFactory 与子 Agent

`src/agents/factory.ts` 当前很轻量，职责只有：

- 保存共享依赖
- 生成唯一 agent 名称
- 创建新的 `MainAgent`

创建出的临时 Agent：

- 默认 `persistent: false`
- 默认无 channel
- 与主 Agent 隔离消息历史
- 可以复用相同的本地工具与 MCP 能力

`run_agent` 当前适合执行：

- 简历生成类独立任务
- 使用特定 skill 的投递任务
- 不希望污染当前主会话的隔离任务

## 5. Skills 机制

skill 文件当前位于两处之一：

- `workspace/skills/*.md`
- `src/agents/skills/*.md`

加载优先级：

1. 工作区覆盖版本
2. 代码内置默认版本

`config.ts` 在初始化 workspace 时，会把内置 skills 复制到 `workspace/skills/`。

这意味着 skill 是“运行期可被用户覆盖的 SOP”，不是编译期常量。

## 6. 事件与展示

Agent 与前端之间不是直接耦合，而是通过 `channel` 和 `eventBus` 协作：

- `channel` 负责把 agent 响应、工具调用、工具输出转成外部消息
- `wrapChannel()` 会同步发出 `agent:log`
- `eventBus` 负责状态、日志、流式片段、工具消息、上下文使用量和人工干预事件
- WebSocket 会把这些事件广播到前端

当前 Web 展示能实时看到：

- 文本流式输出
- 工具调用/工具输出
- agent 状态变化
- 上下文 token 使用量
- 人工干预请求

## 7. 与文档容易混淆的点

- 当前没有独立可运行的 `SearchAgent`。
- 当前“子 Agent”不是单独类，而是临时 `MainAgent`。
- 当前默认入口不是 TUI。
