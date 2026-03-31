# Agent 核心实现说明

本文档描述当前代码中的真实 Agent 设计，优先以 `src/agents/`、`src/tools/`、`src/runtime/` 实现为准。

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
  ProfileAgent(profile-driven)
       ^
       |
   MainAgent(main profile)
       |
       \-- run_agent -> delegated ProfileAgent
```

当前实现中：

- `MainAgent` 是用户长期面对的主 Agent。
- 子任务不再创建临时 `MainAgent`，而是创建对应 profile 的 `ProfileAgent`。
- `ProfileAgent` 的能力边界由 profile 和 capability policy 共同限制。
- `RuntimeKernel` 负责主 Agent 生命周期、配置重载、事件流和人工干预状态。
- `MainAgent` 具备通过本地文件工具读写 `workspace/data/targets.md` 与 `workspace/data/userinfo.md` 的能力，因此这些文档可以作为对话中的工作区上下文持续维护。

## 2. BaseAgent

`src/agents/base/agent.ts` 是当前核心执行器。

### 2.1 消息与执行模型

- `submit()` 将普通输入放入队列，将 `/new`、`/clear` 作为即时命令处理
- `processLoop()` 逐条消费队列，保证同一 Agent 内串行执行
- `enqueueExecution()` 进一步保证 `run()` 不并发读写共享状态
- `consumePendingQueuedInputs()` 会在安全边界把排队消息并入当前上下文

这意味着当前模型是“单 Agent 串行长期会话”，不是“每条消息一个新会话”。

### 2.2 LLM 主循环

`runMainLoop()` 的当前行为：

- 过滤空 assistant 消息
- 在第一条 `system` 消息前注入当前时间
- 发起流式 OpenAI 请求
- 累积文本输出与 `tool_calls`
- 通过 channel / eventBus 向前端同步流式片段
- 若模型请求工具，则执行工具并继续下一轮
- 若模型返回纯文本，则结束本轮

### 2.3 工具来源

工具列表由三部分组成：

1. 本地工具
2. 内建 `request` 工具
3. MCP 返回的浏览器工具

本地工具包括：

- `update_workspace_context`：增量维护 targets.md / userinfo.md。执行去重合并（基于 company + url 精确去重），保留已有笔记，source 字段记录触发来源。

执行路径：

- 本地工具命中 `LOCAL_TOOL_NAMES` 时，走 `executeTool()`
- `request` 走 `executeRequestToolCall()`
- 其他工具在 MCP 存在时转发给 MCP

### 2.4 人工干预

`request` 是当前正式可调用的工具。

执行路径：

1. 模型调用 `request`
2. Agent 校验参数
3. 通过 `requestIntervention()` 发起请求
4. `eventBus` 广播 `intervention:required`
5. Web 端展示输入界面
6. 用户提交后广播 `intervention:resolved`
7. Agent 继续执行

支持的 `kind`：

- `text`
- `confirm`
- `single_select`

产品语义补充：

- `request` 是正式的人工升级通道，不应替代正常的上下文推断与草拟。
- 当 `MainAgent` 仍能基于当前对话、安全假设和工作区文档继续时，应优先更新上下文并继续执行。
- 当缺失信息已经影响搜索范围、简历策略、自动化授权或高风险写入时，再发起 intervention。

### 2.5 持久化

- `loadSession()` / `saveSession()` 继续使用 `workspace/agents/{agentName}/session.json` 作为 Agent 私有 checkpoint
- `saveSession()` 同步维护 `workspace/state/conversation/{sessionId}.json`，供 Web / Runtime 读取最近对话摘要
- `resetSession()` 会同时清理 checkpoint 对应的 conversation snapshot
- `ContextCompressor` 负责长会话压缩；运行中持久化会使用截断快照避免 `session.json` 持续膨胀

### 2.6 人工干预与恢复语义

- `request` 仍是正式的人机协作入口
- Runtime 会持久化 pending intervention，并负责 timeout sweep
- 页面重连时，server 会把仍 pending 的 intervention 重新补发给前端
- Runtime reload / restart 后，不能安全继续的 in-flight delegated run 会被收敛为 `cancelled`

## 3. ProfileAgent

`src/agents/profile-agent.ts` 是 profile 驱动的通用 Agent。

它负责：

- 根据 `profileName` 装配 profile
- 拼接系统提示
- 注入 skill sections
- 注入额外 sections

当前支持的 profile：

- `main`
- `search`
- `delivery`
- `resume`
- `review`

profile 决定：

- `allowedTools`
- `readableRoots`
- `writableRoots`
- `allowBrowser`
- `allowDelegationTo`

## 4. MainAgent

`src/agents/main/index.ts` 是固定使用 `main` profile 的主 Agent。

### 4.1 系统提示组成

当前主提示由以下内容组成：

- 主角色说明
- MCP 可用性提示
- 职位搜索与筛选规则
- 简历生成规则
- 简历评价 / 模拟面试规则
- skill 索引内容
- 数据文件说明

### 4.2 主职责

当前 `MainAgent` 负责：

- 用户主对话
- 维护和更新工作区上下文文档（如 `targets.md`、`userinfo.md`）
- 搜索职位
- 简历生成
- 简历评价
- 模拟面试
- 子任务调度

### 4.3 工具结果钩子

`onToolResult()` 当前会额外处理：

- `typst_compile` 成功时发出“简历已生成”相关日志与事件
- `run_agent` 完成时发出子任务成功/失败日志

## 5. AgentFactory 与子 Agent

`src/agents/factory.ts` 当前负责：

- 保存共享依赖
- 生成唯一 agent 名称
- 根据 `profileName` 创建 `MainAgent` 或 `ProfileAgent`
- 根据 `skillName` 装载工作区或内置 skill 内容

创建规则：

- `profileName === "main"` 时创建 `MainAgent`
- 其他 profile 创建 `ProfileAgent`

子 Agent 的当前特征：

- 默认 `persistent: false`
- 默认无 channel
- 与主 Agent 隔离消息历史
- 共享 OpenAI、MCP、workspace 和模型配置

`run_agent` 当前适合执行：

- 搜索类子任务
- 投递类子任务
- 简历生成类子任务
- 评价 / 审查类子任务

## 6. 能力控制

能力边界不只靠 prompt，也靠 runtime policy。

`src/tools/capability-policy.ts` 当前会限制：

- 浏览器工具使用权限
- 本地工具使用权限
- 文件读写路径
- profile 间委派

因此“子 Agent 是否受限”不再只是文案约束，而是运行时真实约束。

## 7. Runtime 与 Web 协作

Agent 与前端并不直接耦合。

当前协作层次：

- `RuntimeKernel`
  管理主 Agent、配置重载、MCP、事件流、干预状态和运行时恢复语义
- `channel`
  将 agent 响应、工具调用和输出转换成外部消息
- `eventBus`
  负责状态、日志、流式输出、工具消息、上下文使用量和人工干预事件
- `WebSocket`
  将事件广播给 Web 前端

当前 Web 可实时看到：

- 文本流式输出
- 工具调用 / 工具输出
- Agent 状态变化
- 上下文 token 使用量

补充约束：

- WebSocket 的上游已经切到 runtime event stream 与 structured stores，不再依赖 `agentRegistry` 作为主读面。
- 为了避免前端协议震荡，server 仍会把 runtime 事件适配成现有的 `snapshot` / `agent:*` / `intervention:*` 事件名。
- 页面重连时，server 会基于 runtime store 重新下发 agent snapshot，并补发仍处于 pending 的人工干预。

## 8. 当前边界

- Web 是主路径；TUI 仍保留，但定位为兼容 / 调试入口。
- `state/session` 与 `state/conversation` 是 Runtime / Web 的正式会话读模型。
- `workspace/agents/{agentName}/session.json` 不是对外 API 契约，而是 BaseAgent 自己的执行恢复文件。
- delegated run 与 intervention 的恢复策略当前是“收敛到可解释终态”，不是“重启后继续执行未完成任务”。

## 9. 容易混淆的点

- 当前默认入口是 Web，不是 TUI
- `MainAgent` 仍是用户唯一长期入口
- 当前“子 Agent”是按 profile 创建的 `ProfileAgent`
- `search` / `delivery` / `resume` / `review` 已经是可运行 profile，不再只是 prompt 文本标签
