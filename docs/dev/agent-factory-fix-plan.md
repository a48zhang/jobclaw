# Agent Factory 修复计划（合并后补救）

> 目标：在已合并到 main 的基础上，补齐未完成重构点，确保运行路径、通知路径与测试全部一致。

## P0（必须先修）

### 1. 修复 run_agent 分发路径（本地工具优先）
- 问题：`run_agent` 已注册到 `TOOLS`，但 `BaseAgent.executeToolCall` 仍使用硬编码 `localTools` 列表，未包含 `run_agent`。
- 风险：当 `mcpClient` 存在时，`run_agent` 会被误判为 MCP 工具并调用失败。
- 修复：
1. 在 `src/tools/index.ts` 导出 `LOCAL_TOOL_NAMES`（唯一事实来源）。
2. `BaseAgent` 改为通过 `LOCAL_TOOL_NAMES.includes(toolName)` 判定本地工具。
3. 删除 `BaseAgent` 内硬编码本地工具数组。
- 验收：
1. `run_agent` 在有/无 MCP 两种场景都走本地工具分支。
2. 单测覆盖 `run_agent` 调度分支（含 MCP 存在时）。

### 2. 移除 server 对 runEphemeral 的依赖
- 问题：`/api/resume/build` 与 `/api/resume/review` 仍调用 `mainAgent.runEphemeral`。
- 修复：
1. 在 `server` 层注入 `AgentFactory`（通过 `createApp` 参数或模块注入）。
2. 两个接口改为 `factory.createAgent({ persistent: false })` + `agent.run(...)`。
3. 错误日志保留，返回结构保持兼容。
- 验收：
1. `src/web/server.ts` 不再出现 `runEphemeral`。
2. 对应接口行为与当前返回码兼容。

## P1（同一轮完成）

### 3. 完成“主 Agent 统一通知”收敛
- 问题：`DeliveryAgent` 与 `delivery_*` channel 类型仍保留。
- 修复：
1. 删除 `src/agents/delivery/index.ts` 与其引用。
2. 从 `src/channel/base.ts` 删除 `delivery_start|delivery_success|delivery_failed|delivery_blocked`。
3. 清理 `src/channel/tui.ts`、`src/channel/email.ts` 中 delivery 专用渲染/主题映射。
4. 在 `MainAgent.onToolResult`（或 run_agent 结果处理）统一发送对外状态消息。
- 验收：
1. 代码库不再包含 `DeliveryAgent` 类型或 `delivery_*` 通知分支。
2. 用户仍能收到关键任务状态（由主 Agent 输出）。

### 4. 让配置类型去掉 `any`
- 问题：`factory?: any`、`as any` 破坏了类型边界。
- 修复：
1. 在 `src/agents/base/types.ts`、`src/tools/index.ts` 引入明确的 `AgentFactory` 类型（用 `import type` 处理循环依赖）。
2. 删除 `src/agents/factory.ts` 中 `as any` 构造。
- 验收：
1. `tsc --noEmit` 无新增类型警告。
2. 不再出现 `factory?: any`、`as any` 的临时逃逸写法（除历史无关代码）。

## P2（测试与回归兜底）

### 5. 补齐测试迁移
- 现状问题：
1. `tests/unit/base.test.ts` 仍在测 `runEphemeral`。
2. `tests/unit/web/server.test.ts` 仍 mock `runEphemeral`。
3. `tests/unit/cron.test.ts` 用例仍围绕 `runEphemeral`。
4. `tests/unit/agents/main.test.ts` 被删除后未补新用例。
- 修复：
1. BaseAgent：新增 `run_agent` 本地分发与超时语义测试，删除 ephemeral 相关断言。
2. Web Server：改测“是否通过 factory 创建临时 agent 并触发 run”。
3. Cron：覆盖 `search|digest` 双模式在新架构下行为。
4. MainAgent：恢复并重建关键测试（工具可用性、通知责任、子任务调用路径）。
- 验收：
1. `npm test` 通过。
2. 新增用例能覆盖上述 4 条关键路径。

## 执行顺序
1. 先改 `tools/base agent` 路由（P0-1）。
2. 再改 `server` 入口（P0-2）。
3. 再做通知收敛与 Delivery 清理（P1-3）。
4. 然后做类型收紧（P1-4）。
5. 最后批量迁移测试并跑全量回归（P2-5）。

## 建议的提交拆分
1. `fix(agent): unify local tool detection and run_agent dispatch`
2. `refactor(server): replace runEphemeral with factory-created temp agents`
3. `refactor(channel): remove delivery-specific notification path`
4. `chore(types): remove any around factory wiring`
5. `test(agent): migrate tests from runEphemeral to run_agent flow`
