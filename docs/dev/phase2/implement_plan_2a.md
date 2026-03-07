# Phase 2a: BaseAgent 核心执行链实现 (工期约 1.5 - 2 天)

> 目标：实现 BaseAgent 的基础架子、工具管理以及核心自主循环（Tool-Driven Loop），确保 Agent 能“跑通一次任务”。

## 1. 结构化初始化 (Task 2.1 & 2.2)
- **BaseAgent 基类定义**：
    - 完成 `src/agents/base.ts` 的接口设计。
    - 实现构造函数，持久化 `openai`, `agentName`, `model`, `workspaceRoot`, `mcpClient`, `keepRecentMessages` 等参数。
- **System Prompt 管理**：
    - 实现 `abstract getSystemPrompt(): string`。
    - 在子类实现中确保包含 Agent 身份、读写权限说明（`/agents/{name}/`, `/data/`）。

## 2. 工具集成与调度 (Task 2.3 & 2.4)
- **getAvailableTools**：
    - 组合 `src/tools/index.ts` 中的 6 个本地文件工具。
    - (可选) 实现 MCP 工具的映射逻辑，将 MCP `Tool` 转换为 OpenAI `ChatCompletionTool` 类型。
- **executeToolCall**：
    - 包装核心调用逻辑。
    - 实现对 `onToolResult` 钩子的调用。
    - **关键**：严格构造并返回响应对象 `{ role: 'tool', tool_call_id, content }`，确保格式符合 OpenAI 规范。

## 3. 实现原生 Tool-Driven 循环 (Task 2.6)
- **循环主体逻辑**：
    - 实现 `run(input)` 方法。
    - 维持一个内部 `messages: ChatCompletionMessageParam[]` 列表。
    - **并行执行逻辑**：
        - 捕获选中的 `tool_calls`。
        - 使用 `Promise.all` 映射 `executeToolCall`。
        - 将 `assistant` 消息和后续的所有 `tool` 消息按顺序推入历史。
- **退出条件**：
    - LLM 停止生成 `tool_calls` 且有文本输出（正常结束）。
    - 达到 `maxIterations` 阈值。
- **状态同步**：
    - 完成循环前后的 `state` 切换（`idle` -> `running` -> `idle/waiting`）。

## 验收标准
- 创建一个测试 Agent 继承 BaseAgent，能通过调用 `read_file` 和 `list_directory` 回答关于目录结构的问题。
- 确认并行工具调用后，消息序列（Assistant -> Tool1 -> Tool2...）格式正确，LLM 能继续下轮思考。
