# Phase 4 Review Improvements Implementation Plan (Revised)

> **修订日期**: 2026-03-08  
> **状态**: ✅ 已整合 GLM Team 审查建议

---

## 1. 任务计划：日志级别集成 (Log Level Integration)

**目标**：消除工具执行过程中的观测盲区，将警告（Warn）和错误（Error）实时同步至 TUI 日志窗口。

### 1.1 扩展 `ChannelMessageType` (src/types.ts 或 src/channel/base.ts)
- **改动**: 在 `ChannelMessageType` 枚举中新增类型。
- **新增**:
  - `tool_warn`: 工具执行过程中的非致命警告（如行解析失败）。
  - `tool_error`: 工具执行过程中的业务错误。

### 1.2 扩展 `ToolContext` (src/tools/index.ts)
- **改动**: 在 `ToolContext` 接口中增加 `logger` 回调字段。
- **签名**: `logger?: (line: string, type: 'info' | 'warn' | 'error') => void`。

### 1.3 基类 `BaseAgent` 调整 (src/agents/base/agent.ts)
- **配置注入**: 修改 `BaseAgentConfig` 和 `BaseAgent` 构造函数，引入可选的 `channel` 字段。
- **逻辑实现**: 在 `executeToolCall` 方法中，注入日志桥接逻辑：
  ```typescript
  const context: ToolContext = {
    workspaceRoot: this.workspaceRoot,
    agentName: this.agentName,
    logger: (line, type) => {
      if (this.channel) {
        this.channel.send({
          type: type === 'error' ? 'tool_error' : 'tool_warn',
          payload: { message: line, toolName },
          timestamp: new Date()
        });
      }
    }
  }
  ```

### 1.4 工具重构与 TUI 适配
- **工具层**: 修改 `upsertJob.ts`，将 `console.warn` 替换为 `context.logger?.(msg, 'warn')`。
- **TUI 层**: 修改 `TUIChannel` 和 `TUI` 类，确保其能识别并高亮显示 `tool_warn`（黄色）和 `tool_error`（红色）。

---

## 2. 任务计划：HITL 超时机制 (HITL Timeout)

**目标**：防止 Agent 在无人值守时因等待验证码输入而永久挂起。

### 2.1 场景化超时逻辑 (src/agents/base/agent.ts)
- **改动**: `requestIntervention(prompt: string, timeoutMs?: number)`。
- **策略**: 
  - **TUI 模式**: 默认超时 300,000ms (5 分钟)。
  - **Cron/Ephemeral 模式**: 默认超时 30,000ms (30 秒)。
- **实现**: 
  - 使用 `Promise.race` 包装挂起逻辑。
  - **超时行为**: resolve 空字符串 `""`。
  - **状态同步**: 超时后由 Agent 发出 `intervention_timeout` 事件。

### 2.2 事件协议扩展
- **新增事件**:
  - `intervention_timeout`: 告知 TUI 超时已发生，需清理界面。
  - `intervention_cancelled`: 告知 TUI 用户已取消（如按 ESC）。

### 2.3 TUI 模态框联动 (src/web/tui.ts)
- **改动**: TUI 在弹出模态框的同时，监听 `intervention_timeout` 和 `intervention_cancelled` 事件。
- **行为**: 一旦监听到上述事件，立即销毁当前 Modal，恢复主界面焦点。

---

## 3. 验收标准

1. **日志分类验证**: 制造 `jobs.md` 损坏行，验证 TUI 是否以 **黄色** 实时显示 `tool_warn` 日志。
2. **场景超时验证**:
   - 在交互模式下，5 分钟不输入应自动关闭 Modal。
   - 在 Cron 模式下，30 秒不输入应自动关闭 Modal。
3. **状态一致性**: 验证超时后 Agent 是否能正常收到空字符串回复并继续下一个职位的逻辑（不卡死）。
4. **单元测试**:
   - 补充 `BaseAgent` 对场景化超时（30s vs 5min）的测试。
   - 补充 `TUI` 对超时事件监听的 Mock 测试。

---

## 4. 执行顺序

1. **第一阶段**: 修改 `BaseAgent` 基类与配置定义（引入 `channel`）。
2. **第二阶段**: 扩展工具上下文与日志转发逻辑，重构 `upsertJob`。
3. **第三阶段**: 实现场景化超时与事件广播机制。
4. **第四阶段**: TUI 界面同步与全流程回归。
