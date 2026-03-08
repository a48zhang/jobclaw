# Phase 4: TUI Dashboard & Robustness Integration

**目标**: 将 JobClaw 升级为交互式终端工具。

---

## 🛑 核心接口协议 (The Contract) - 必读
**两支团队必须严格遵守以下函数签名与事件名，确保并行开发后可无缝集成。**

### 1.1 人工干预协议 (HITL)
- **方法**: `BaseAgent.requestIntervention(prompt: string): Promise<string>`
- **事件**: `agent.on('intervention_required', { prompt, resolve })`
- **逻辑**: Agent 调用此方法时会返回一个 `Promise`。TUI 监听到事件后弹出 UI，用户输入后调用 `resolve(input)` 唤醒 Agent。

### 1.2 日志流协议 (Logging)
- **类名**: `TUIChannel` (需实现 `Channel` 接口)
- **方法**: `send(message: string, type: 'info'|'warn'|'error'|'thought')`
- **集成**: `MainAgent` 与 `DeliveryAgent` 构造函数接收 `TUIChannel` 实例。

---

## 任务拆分 (✅ 已完成)

### 🟢 [Team A: TUI 仪表盘与实时数据](team_a_tui_dashboard.md) (✅)
### 🔵 [Team B: 人工干预与鲁棒性](team_b_hitl_robustness.md) (✅)

---

## 🛑 Phase 4.2: 最终润色 (✅ 已完成)
**目标**: 修复综合审计中发现的 P0/P1 级瑕疵，确保系统达到生产级稳健性。

- [x] **[P0] 启动预检强化**: 在 `src/index.ts` 和 `src/cron.ts` 中补全 `validateWorkspace` 调用。 (✅)
- [x] **[P1] 动态锁持有者**: 重构 `upsertJob` 逻辑，从上下文动态获取 `agentName` 作为锁持有者标识。 (✅)
- [x] **[P1] MCP 数据精简**: 修改 `src/mcp.ts`，对 `callTool` 的返回结果进行文本提取，减少 Token 消耗。 (✅)
- [x] **[P1] 投递重试逻辑**: 在 `jobclaw-skills.md` 中增加显式的投递重试指引。 (✅)

---

## 验收结果
- **Gemini 审查**: ✅ 已通过 (见 [gemini_review.md](gemini_review.md))
- **综合审计报告**: 🚩 待 P4.2 完成后关闭 (见 [final_audit_and_plan.md](final_audit_and_plan.md))
