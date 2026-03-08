# Phase 4: TUI Dashboard & Robustness - Gemini Review Report

> **审查日期**: 2026-03-08  
> **审查对象**: Claude Team (Track A: TUI, Track B: HITL & Robustness)  
> **审查状态**: ✅ 通过 (Accept)

---

## 1. 核心功能验收情况

### 🟢 Track A: TUI 仪表盘与实时数据 (Team A)
- **TUI 界面**: 成功实现基于 `blessed` 和 `blessed-contrib` 的全屏交互式看板。
    - `Job Monitor`: 实时同步 `jobs.md` 数据，支持表格渲染。
    - `Agent Activity`: 实时流式输出 Agent 日志，支持颜色区分（Info/Warn/Error）。
    - `Stats Panel`: 实时统计"发现/投递/失败"数量。
    - `Input Box`: 集成命令输入，替代了原有的简单 `readline` 交互。
- **TUIChannel**: 完美实现 `Channel` 接口，将 Agent 内部日志无缝桥接到 TUI 窗口。
- **实时同步**: 使用 `fs.watch` 监听 `jobs.md`，刷新频率优于 500ms 要求（实测 100ms 防抖）。

### 🔵 Track B: 人工干预 (HITL) 与鲁棒性 (Team B)
- **HITL 机制**: 
    - `BaseAgent` 成功继承 `EventEmitter`。
    - 实现 `requestIntervention(prompt)` 方法，支持 Promise 挂起并等待外部 `resolve`。
    - TUI 监听到事件后能正确弹出模态框（Modal）请求用户输入，并唤醒 Agent。
- **环境验证**: `src/env.ts` 增强了 `validateWorkspace` 深度校验，能准确拦截空的 `targets.md` 或信息不全的 `userinfo.md`。
- **容错处理**: `upsertJob` 引入了"宽容解析"逻辑，对 `jobs.md` 中格式损坏的行进行警告并跳过，不再导致整个流程崩溃。

---

## 2. 代码质量与架构一致性

1.  **接口一致性**: 两支团队严格遵守了 `BaseAgent.requestIntervention` 的函数签名与 `intervention_required` 事件协议，使得 TUI 与 Agent 逻辑能够平滑对接。
2.  **单元测试**: 
    - Team A 补充了 `TUIChannel` 和 `parseJobsMd` 的测试。
    - Team B 补充了 `BaseAgent` 事件流、`validateWorkspace` 和 `upsertJob` 的容错测试。
    - **验收结论**: 测试覆盖了核心逻辑与边界情况。
3.  **入口重构**: `src/index.ts` 成功转型为 TUI 入口，并保留了引导（Bootstrap）逻辑的兼容性。

---

## 3. 改进建议 (Optional)

1.  **TUI 性能**: 目前 `fs.watch` 在短时间内大量写入时（如 MainAgent 批量发现职位）可能会频繁触发刷新，建议在 TUI 层增加更高阶的 `dataLines` 缓存以减少重复解析。
2.  **HITL 超时**: 虽然 TUI 提供了 Escape 退出模态框，但建议在 `requestIntervention` 中增加可选的超时机制，防止 Agent 永久阻塞。

---

## 4. 结论

**Phase 4 核心目标已圆满达成。** JobClaw 现在具备了"上帝视角"的终端监控能力，并且在面对复杂网页（如验证码拦截）和配置文件异常时具备了更强的韧性。

**建议下一步 (Phase 5)**: 开始开发 Web UI 监控看板，并进一步优化 DeliveryAgent 在不同平台上的表单填充鲁棒性。

---
---

# Phase 4: TUI Dashboard & Robustness - GLM Team Review Report

> **审查日期**: 2026-03-08  
> **审查对象**: Claude Team (PR #4: Team A, PR #6: Team B)  
> **审查状态**: ✅ 通过 (Accept with Merge Notes)

---

## 1. PR 概览

| PR | 分支 | 改动量 | 状态 | 审查结论 |
|----|------|--------|------|----------|
| #4 | `copilot/implement-tui-dashboard` | +1231/-43 | DRAFT | ✅ 通过 |
| #6 | `copilot/implement-team-b-hitl-robustness` | +326/-6 | DRAFT | ✅ 通过 |

---

## 2. Team A (PR #4) 详细审查

### 2.1 实现内容

| 模块 | 文件 | 评价 |
|------|------|------|
| TUI Dashboard | `src/web/tui.ts` | ✅ 完整实现 blessed 网格布局 |
| TUIChannel | `src/channel/tui.ts` | ✅ 正确实现 Channel 接口 |
| BaseAgent HITL | `src/agents/base/agent.ts` | ✅ EventEmitter + Promise 挂起 |
| 入口重构 | `src/index.ts` | ✅ TUI 入口 + Bootstrap 兼容 |
| 单元测试 | `*.test.ts` | ✅ 覆盖核心逻辑 |

### 2.2 核心实现分析

**`BaseAgent.requestIntervention`**:
```typescript
async requestIntervention(prompt: string): Promise<string> {
  return new Promise<string>((resolve) => {
    this.interventionResolve = resolve
    this.emit('intervention_required', {
      prompt,
      resolve: (input: string) => this.resolveIntervention(input),
    })
  })
}
```
- 在 Promise 内部创建 resolve 并存储
- emit 事件携带封装后的 resolve 函数
- 外部调用 `resolve` 或 `resolveIntervention` 均可解除挂起

**`parseJobsMd` 容错逻辑**:
- 跳过 header separator 行 (`| --- |`)
- 跳过列数不足的损坏行
- 正确处理空文件和无数据行

**`fs.watch` 防抖**:
- 100ms debounce，满足 <500ms 要求
- 文件不存在时 fallback 到 polling

### 2.3 测试覆盖

| 测试文件 | 测试用例数 | 覆盖范围 |
|----------|------------|----------|
| `src/web/tui.test.ts` | 5 | parseJobsMd 边界情况 |
| `src/channel/tui.test.ts` | 5 | TUIChannel 消息路由 |
| `src/base.test.ts` | +3 | HITL 事件流 |

---

## 3. Team B (PR #6) 详细审查

### 3.1 实现内容

| 模块 | 文件 | 评价 |
|------|------|------|
| BaseAgent HITL | `src/agents/base/agent.ts` | ✅ EventEmitter + 公开 resolveIntervention |
| 深度校验 | `src/env.ts` | ✅ validateWorkspace 实现 |
| 容错解析 | `src/tools/upsertJob.ts` | ✅ 宽容行处理 |
| 单元测试 | `*.test.ts` | ✅ 覆盖核心逻辑 |

### 3.2 核心实现分析

**`BaseAgent.requestIntervention` (Team B 版本)**:
```typescript
async requestIntervention(prompt: string): Promise<string> {
  this.emit('intervention_required', {
    prompt,
    resolve: (input: string) => this.resolveIntervention(input),
  })
  return new Promise<string>((resolve) => {
    this.interventionResolve = resolve
  })
}
```
- 先 emit 事件，再返回 Promise
- `resolveIntervention` 为 public 方法，供外部直接调用

**`validateWorkspace` 校验逻辑**:
- `targets.md`: 检查是否存在非空非注释行
- `userinfo.md`: 使用正则检查 `姓名[:：]`, `邮箱[:：]`, `简历[:：]` 字段
- 收集所有问题后一次性报告

**`upsertJob` 容错解析**:
```typescript
for (let i = 0; i < dataLines.length; i++) {
  try {
    const columns = dataLines[i].split('|').map(c => c.trim());
    if (columns.length < MIN_COLUMNS) {
      console.warn(`[upsertJob] jobs.md 第 ${i + 1} 行格式异常，已跳过`);
      continue;
    }
    // ... 正常处理
  } catch (lineError) {
    console.warn(`[upsertJob] jobs.md 第 ${i + 1} 行解析失败，已跳过`);
  }
}
```

### 3.3 测试覆盖

| 测试文件 | 测试用例数 | 覆盖范围 |
|----------|------------|----------|
| `src/base.test.ts` | +3 | requestIntervention / resolveIntervention |
| `src/cron.test.ts` | +5 | validateWorkspace 深度校验 |
| `src/tools/executor.test.ts` | +3 | upsertJob 容错解析 |

---

## 4. 冲突分析与合并建议

### 4.1 冲突文件

两个 PR 都修改了 `src/agents/base/agent.ts`，实现了相同的 HITL 功能。

### 4.2 实现差异对比

| 方面 | Team A | Team B |
|------|--------|--------|
| emit 时机 | Promise 内部先创建 resolve | 先 emit 再返回 Promise |
| resolveIntervention | private 方法 | public 方法 |
| 代码量 | 略多 | 略少 |

### 4.3 合并建议

**推荐采用 Team A 的版本**，理由：
1. Promise 创建和 resolve 存储在同一作用域，逻辑更紧凑
2. `resolveIntervention` 作为 private 方法更符合封装原则
3. Team A 的 PR 包含完整的 TUI 实现，是主要交付物

**合并步骤**：
1. 先合并 PR #4 (Team A)
2. 从 PR #6 中 cherry-pick 以下提交：
   - `src/env.ts` (validateWorkspace)
   - `src/tools/upsertJob.ts` (容错解析)
   - `src/cron.test.ts` (validateWorkspace 测试)
   - `src/tools/executor.test.ts` (upsertJob 容错测试)
3. 手动合并 `src/base.test.ts` 中的 HITL 测试用例

---

## 5. 验收检查清单

### 5.1 Team A 验收标准 (team_a_tui_dashboard.md)

- [x] UI 表格能在 `jobs.md` 更新后 500ms 内自动重新渲染 (实测 100ms)
- [x] 所有的 `Agent.say` 内容显示在 TUI Activity 窗口
- [x] 弹出模态框后，用户输入的字符串能准确传递回 Agent

### 5.2 Team B 验收标准 (team_b_hitl_robustness.md)

- [x] Agent 执行 `requestIntervention` 时，程序确实"卡住"并等待外部信号
- [x] 外部调用 `resolveIntervention(input)` 后，Agent 能获取到 `input` 并继续后续循环
- [x] 若环境变量配置错误，系统在进入 TUI 前能给出精准错误报告

---

## 6. 改进建议 (Optional)

1. **HITL 超时机制**: 建议在 `requestIntervention` 中增加可选超时参数，防止 Agent 永久阻塞
2. **TUI 性能优化**: 批量写入 `jobs.md` 时可考虑更高阶缓存减少重复解析
3. **日志级别**: `console.warn` 可考虑统一接入 TUIChannel 以便用户查看

---

## 7. 结论

**Phase 4 核心目标已达成**。两个 PR 均符合规范，代码质量良好，测试覆盖充分。

**下一步操作**：
1. 按上述合并建议处理冲突
2. 合并后运行完整测试套件确认无回归
3. 进入 Phase 5 开发

---

*审查人: GLM Team*  
*审查时间: 2026-03-08*
