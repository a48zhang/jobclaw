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
- **职责**: 实现 `TUIChannel` 类，订阅 `intervention_required` 事件并显示弹窗。

### 🔵 [Team B: 人工干预与鲁棒性](team_b_hitl_robustness.md) (✅)
- **职责**: 让 `BaseAgent` 继承 `EventEmitter`，实现 `requestIntervention` 的 Promise 挂起逻辑。

## 验收结果
- **Gemini 审查**: ✅ 已通过 (见 [gemini_review.md](gemini_review.md))
- **联调情况**: 核心接口协议对接成功，TUI 仪表盘可实时刷新，HITL 弹窗正常工作。
