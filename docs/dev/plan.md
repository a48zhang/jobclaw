# JobClaw 当前收口状态

> 最近更新：2026-03-28  
> 说明：本文件只保留“当前真实状态”和“未来可选扩展方向”。截至本次收口，前一轮架构治理计划已完成，不再保留为活跃 backlog。

## 1. 当前已收口的架构结论

- Web 是默认也是主路径；TUI 只保留兼容 / 调试定位。
- `MainAgent` 是唯一长期入口；子任务通过 `AgentFactory + run_agent` 按 profile 创建受限 `ProfileAgent`。
- Agent 对话是主产品控制面；配置页和资料页只承担人工校对 / 覆写职责。
- Runtime / Web 的正式读模型位于 `workspace/state/**`。
- `workspace/agents/{agent}/session.json` 是 Agent 私有 checkpoint，不再作为 Web / API 的事实来源。
- 职位数据以后端结构化存储 `workspace/state/jobs/jobs.json` 为事实源；`workspace/data/jobs.md` 作为可读、可编辑的导入导出视图保留。
- `workspace/data/targets.md` 与 `workspace/data/userinfo.md` 作为共享工作区上下文保留，允许 Agent 在对话中逐步起草和更新。
- WebSocket 已由 runtime event stream 和 structured stores 驱动，但继续输出兼容的 `snapshot` / `agent:*` / `intervention:*` 事件，避免前端协议震荡。
- MCP / 浏览器能力是可选依赖。MCP 不可用时系统仍可启动，但浏览器搜索与投递链路会被明确降级。

## 2. 本轮已完成的治理项

### 2.1 数据与事实源

- jobs 后端读写统一到结构化 store。
- `jobs.md` 的手工编辑与导入替换语义已与结构化后端对齐。
- conversation snapshot 已落到 `state/conversation`，并与主 Agent 持久化同步。

### 2.2 运行时稳定性

- 工具调用支持自动重试与更清晰的降级提示。
- 长会话持久化不再让 `session.json` 无限膨胀。
- intervention timeout sweep、delegation recovery 和 runtime reload / restart 语义已经收口。
- 全量回归在本轮收口后已通过 `npm test`。

### 2.3 Runtime / Web 接口

- `/api/runtime/sessions`、`/api/delegations*`、`/api/interventions*`、`/api/session/:agentName` 已优先读取 runtime / structured stores。
- WebSocket snapshot 由 runtime session store 驱动，不再依赖内存态 `agentRegistry` 作为主读面。
- 页面重连时会补发 pending interventions，保证 runtime 状态与 UI 一致。

## 3. 当前不再作为缺陷保留、但需要明确边界的事项

- MCP 降级策略：
  系统不会在浏览器不可用时伪造搜索 / 投递能力；当前正式行为是降级并提示，而不是提供第二套非浏览器业务实现。

- TUI 保留策略：
  当前仓库继续保留 TUI 代码，但它不是主产品路径；后续若要继续演进，应单独立项，而不是混入 Web 主线。

## 4. 未来可选扩展方向

以下内容属于后续产品/能力扩展，不属于当前架构收口缺口：

1. 为 MCP 不可用场景设计真正的替代搜索渠道，而不是仅做降级提示。
2. 如果要长期保留 TUI，再单独补齐对应 UX 和回归测试。
3. 如果将来需要真正恢复中的 delegated execution，再设计 checkpointable child-run protocol，而不是复用当前 read model。
4. 如果将来要继续强化聊天主路径，再把“何时由 Agent 自动补全文档、何时升级为人工追问”固化成更细的 runtime policy。
