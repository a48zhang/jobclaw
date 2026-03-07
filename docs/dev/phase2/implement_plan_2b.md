# Phase 2b: 记忆管理与自适应上下文压缩 (工期约 1.5 - 2 天)

> 目标：解决 Agent 的“长期运行”问题，实现 Session 的持久化加载、Token 监控以及上下文的高效摘要/压缩。

## 1. Session 持久化 (Task 2.6 延伸)
- **初始态加载**：
    - 在 `run()` 开始时实现 `loadSession()`。
    - 从 `workspace/agents/{agentName}/session.json` 读取历史消息。
    - 逻辑：维持 `[System]` + `[Old History]` + `[New User Input]` 的注入顺序。
- **结果持久化**：
    - 在 `run()` 结束或异常中断时实现 `saveSession()`。

## 2. Token 监控与计算 (Task 2.7)
- **Token 统计器**：
    - 编写工具函数，使用 `gpt-tokenizer` 对 `messages` 数组进行全量计算。
    - 计算结果需包含 `messages` 的 `role` 和 `content` 权重。

## 3. 自适应上下文压缩策略 (Task 2.7 核心)
- **checkAndCompress 逻辑实现**：
    - 设置 196k (75%) 触发阈值。
- **深度压缩算法**：
    - **首端保留**：保留第一个 `system` 消息。
    - **末端保留**：切片截取最后 `keepRecentMessages` (默认 20) 条消息作为活跃上下文。
    - **中间摘要**：
        - 将中间被剔除的消息列表发送给 LLM（使用较廉价模型，如 gpt-4o-mini 或 flash）。
        - 生成一段综合摘要，涵盖已完成的任务、当前已知的事实、待办项。
    - **重组历史**：
        - 生成 `[{ role: 'user', content: "SYSTEM_SUMMARY: [摘要内容]" }]` 插入到保留的头尾之间。

## 4. 状态快照与容错 (Task 2.8)
- **getState**：
    - 实现返回包含 `state`, `iterations`, `tokenCount`, `lastAction` 的快照。

## 验收标准
- 模拟一个超过 200k tokens 的巨大 Session，验证 Agent 能在读取后自动触发压缩。
- 压缩后的消息历史不应导致 LLM 丢失核心任务目标（通过验证摘要内容覆盖了 currentTask）。
