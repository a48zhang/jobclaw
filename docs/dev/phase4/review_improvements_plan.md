# Phase 4 Review Improvements Implementation Plan

> **日期**: 2026-03-08  
> **目标**: 落实 Phase 4 验收中提出的"人工干预超时"与"日志级别集成"两项改进建议。

---

## 1. 任务计划：日志级别集成 (Log Level Integration)

**目标**：消除工具执行过程中的观测盲区，将警告（Warn）和错误（Error）实时同步至 TUI 日志窗口。

### 1.1 修改 `src/tools/index.ts` (工具上下文扩展)
- **改动**: 在 `ToolContext` 接口中增加可选的 `logger` 字段。
- **签名**: `logger?: (line: string, type: 'info' | 'warn' | 'error') => void`。

### 1.2 修改 `src/agents/base/agent.ts` (日志桥接)
- **改动**: 在 `executeToolCall` 方法中，注入 Agent 持有的 `Channel` 逻辑。
- **实现**: 
  ```typescript
  const context: ToolContext = {
    workspaceRoot: this.workspaceRoot,
    agentName: this.agentName,
    logger: (line, type) => {
      // 若 Agent 绑定了具备 send 方法的 Channel (如 TUIChannel)，则转发
      if (this.config.channel) {
        this.config.channel.send({
          type: type === 'error' ? 'delivery_failed' : 'delivery_blocked', // 映射到现有类型或扩展类型
          payload: { message: line },
          timestamp: new Date()
        });
      }
    }
  }
  ```

### 1.3 修改 `src/tools/upsertJob.ts` (应用日志回调)
- **改动**: 将文件内部所有的 `console.warn` 替换为 `context.logger?.(msg, 'warn')`。

---

## 2. 任务计划：HITL 超时机制 (HITL Timeout)

**目标**：防止 Agent 在无人值守（如 Cron 任务）时因等待用户输入验证码而永久阻塞。

### 2.1 修改 `src/agents/base/agent.ts` (核心挂起逻辑)
- **改动**: `requestIntervention(prompt: string, timeoutMs?: number)`。
- **实现**: 
  - 使用 `Promise.race` 包装原有的挂起逻辑。
  - **默认超时**: 设定默认超时（如 300,000ms / 5分钟）。
  - **超时行为**: 若超时，自动调用 `resolve("")` 并记录一条 `warn` 日志。
  - **SOP 对齐**: 告知 Agent 若收到空回复，应视为"无法获取用户输入，建议跳过当前职位"。

### 2.2 修改 `src/web/tui.ts` (UI 同步)
- **改动**: 当 `requestIntervention` 的 Promise 结束（无论是用户输入还是超时）时，确保 TUI 模态框被销毁且输入焦点恢复到主输入框。

---

## 3. 验收标准

1. **日志显示**: 手动修改 `jobs.md` 制造损坏行，运行 `upsert_job`，验证 TUI `Agent Activity` 窗口是否出现黄色警告日志。
2. **超时恢复**: 模拟触发 `requestIntervention`，5 分钟内不进行操作，验证 Agent 是否能自动恢复运行并打印超时日志。
3. **单元测试**: 
   - 补充 `BaseAgent` 对 `requestIntervention` 超时逻辑的测试用例。
   - 补充 `upsertJob` 调用 `context.logger` 的 mock 测试。

---
---

# GLM Team 审查意见

> **审查日期**: 2026-03-08  
> **审查状态**: ✅ 通过，需修正部分实现细节

---

## 1. 日志级别集成计划审查

### ✅ 认可的设计决策
- 在 `ToolContext` 中增加可选 `logger` 字段是合理的
- 将 `console.warn` 替换为回调函数的思路正确

### ⚠️ 需要修正的问题

#### 问题 1: `this.config.channel` 不存在
计划中的代码示例使用了 `this.config.channel`，但：
- `BaseAgent` 没有 `config` 属性，配置参数直接解构到实例属性
- `BaseAgent` 本身没有 `channel` 字段

**当前实际情况** (Team A PR #4):
- `MainAgent` 有 `channel` 字段 (通过 `MainAgentConfig.channel` 注入)
- `DeliveryAgent` 也有 `channel` 字段
- 但 `BaseAgent` 基类没有

**建议方案**:
```typescript
// 方案 A: 在 BaseAgent 中增加可选 channel
export interface BaseAgentConfig {
  // ... 现有字段
  channel?: Channel
}

// 方案 B: 通过 onToolResult 钩子在子类中实现日志转发
// (不需要修改 BaseAgent)
```

#### 问题 2: ChannelMessage 类型映射不合适
计划中将 warn/error 映射到 `delivery_failed` / `delivery_blocked` 是语义错配。

**建议**: 扩展 `ChannelMessage.type` 枚举：
```typescript
type ChannelMessageType = 
  | 'new_job'
  | 'delivery_success'
  | 'delivery_failed'
  | 'delivery_blocked'
  | 'cron_complete'
  | 'tool_warn'    // 新增
  | 'tool_error'   // 新增
```

---

## 2. HITL 超时机制计划审查

### ✅ 认可的设计决策
- 使用 `Promise.race` 实现超时是标准做法
- 超时后返回空字符串让 Agent 继续执行是合理的降级策略

### ⚠️ 需要修正的问题

#### 问题 1: 5 分钟默认超时对 Cron 场景过长
- Cron 任务通常在无人值守时运行
- 5 分钟等待会严重影响任务吞吐量
- **建议**: 区分两种场景
  - **TUI 模式**: 默认 5 分钟 (用户在场)
  - **Cron 模式**: 默认 30 秒或禁用 HITL

**建议方案**:
```typescript
async requestIntervention(
  prompt: string, 
  options?: { timeoutMs?: number; skipOnTimeout?: boolean }
): Promise<string> {
  const timeout = options?.timeoutMs ?? (this.isEphemeral ? 30_000 : 300_000)
  // ...
}
```

#### 问题 2: 缺少超时事件的区分
计划中只提到"记录 warn 日志"，但没有区分：
- 用户主动取消 (Escape 键)
- 超时自动取消

**建议**: 发出不同的事件
```typescript
// 超时时
this.emit('intervention_timeout', { prompt })

// 用户取消时
this.emit('intervention_cancelled', { prompt })
```

#### 问题 3: TUI 模态框销毁时机
计划提到"Promise 结束时销毁模态框"，但：
- 超时发生在 Agent 内部，TUI 不知道何时销毁
- 需要监听 `intervention_timeout` 事件

**建议**: TUI 同时监听 `intervention_timeout` 和 `intervention_cancelled` 事件来销毁模态框。

---

## 3. 修订后的实现计划

### 3.1 日志级别集成

```
Step 1: 扩展 ChannelMessage 类型 (src/channel/base.ts)
Step 2: ToolContext 增加 logger 字段 (src/tools/index.ts)
Step 3: BaseAgentConfig 增加 channel 字段 (src/agents/base/types.ts)
Step 4: BaseAgent 在 executeToolCall 中注入 logger
Step 5: upsertJob 使用 context.logger 替代 console.warn
Step 6: TUIChannel 处理 tool_warn / tool_error 类型
```

### 3.2 HITL 超时机制

```
Step 1: requestIntervention 增加 timeoutMs 参数
Step 2: 使用 Promise.race 实现超时
Step 3: 超时时发出 intervention_timeout 事件
Step 4: 区分 Cron 模式和 TUI 模式的默认超时值
Step 5: TUI 监听 intervention_timeout 销毁模态框
Step 6: 更新 SOP 说明空回复的处理方式
```

---

## 4. 结论

Gemini 的改进计划**方向正确**，但实现细节需要调整：
1. 日志集成需要正确处理 channel 的注入路径
2. HITL 超时需要区分 TUI/Cron 场景

**建议**: 将修订后的计划作为 Phase 4.1 或 Phase 5 的子任务执行。

---

*审查人: GLM Team*  
*审查时间: 2026-03-08*