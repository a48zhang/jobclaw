# Phase 2：BaseAgent

**目标**：实现 `src/agents/base.ts`，基于现代 OpenAI Tool Calling 构建自主循环。

### 任务清单

#### 2.1 属性初始化

- 构造函数接收：`openai` 实例、`agentName`、`model`、`workspaceRoot`、可选 `mcpClient`
- `maxIterations` 默认 50
- `state` 初始为 `'idle'`

#### 2.2 `systemPrompt` 抽象属性

- 声明为抽象属性，由子类实现
- 仅包含：角色定位、核心职责、操作原则、文件路径说明

#### 2.3 `getAvailableTools()`

- 收集本地六个文件工具的 schema
- 若有 `mcpClient`，调用 `client.listTools()` 并转换为 OpenAI `ChatCompletionTool` 格式
- 返回合并后的工具数组

#### 2.4 `executeToolCall(toolCall)`

- 解析 `toolCall.function.name` 和 `arguments`
- 若是本地工具，调用 `executeTool`；否则调用 `mcpClient.callTool`
- 成功/失败均调用 `this.onToolResult(toolName, result)` 钩子
- 返回 `{ role: 'tool', tool_call_id: toolCall.id, content: resultString }` 对象

#### 2.5 `onToolResult(toolName, result)` 钩子

- 默认实现为空
- 子类可覆盖以实现实时副作用（如推送 Channel 通知）

#### 2.6 `run(input)`（原生 Tool-Driven 循环）

- 进入前将 `state` 改为 `'running'`
- 消息历史管理：
  - 启动时读取 `workspace/agents/{agentName}/session.json`
  - 如果 session 中有历史消息，则将其追加到初始 `[{ role: 'system', content: systemPrompt }]` 之后
  - 再追加当前的 `user input`
- **自主循环**（最多 `maxIterations` 次）：
  - 调用 `openai.chat.completions.create`，传入所有消息历史和 `tools`
  - 如果 `message.content` 不为空，将其视为模型的推理思考或直接回答
  - 如果 `message.tool_calls` 存在：
    - **并行执行**：使用 `Promise.all` 调用 `executeToolCall` 处理数组中的所有 tool_call
    - 将助手消息（含 tool_calls 对象）和所有工具返回的消息（role: tool）**全量**推入历史
    - 继续下一次循环以让 LLM 处理工具执行结果
  - 如果没有 `tool_calls` 且返回了内容，则退出循环并返回最终结果
- 超过 `maxIterations` 时记录状态为 `'waiting'` 并提示
- 循环结束后调用 `checkAndCompress()` 更新 `session.json`

#### 2.7 `checkAndCompress()`（上下文自适应管理）

- 使用 `gpt-tokenizer` 计算 full history 的 token 数
- 触发策略：超过 75% 阈值（196608 tokens）
- 压缩逻辑：
  - 保留 `[{ role: 'system' }]`
  - 保留最近 `keepRecentMessages`（默认 20）条消息（涵盖多轮 Tool Call 往返）
  - 中间部分调用 LLM 总结为一条 `[{ role: 'user', content: "Earlier summary: ..." }]`
- 目标：将上下文窗口降至 30% 以下

#### 2.8 `getState()`

返回当前状态快照。

### 验收标准

- BaseAgent 能根据用户问题自动决定调用一个或多个工具
- 工具结果能被 LLM 正确理解并产生后续动作
- 并行工具调用能正确合并到消息历史中，不引起顺序错乱。
