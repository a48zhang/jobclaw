# Phase 4 - Team A: TUI Dashboard & Real-time Data

> **目标**: 构建终端仪表盘，监听并处理 Agent 事件。

---

## 1. 核心任务

### 1.1 `TUIChannel` 实现 (`src/channel/tui.ts`)
- **继承**: 实现 `Channel` 接口。
- **功能**: `send(msg)` 方法将信息实时输出到 TUI 的 `Activity Log` 窗口。

### 1.2 监听 Agent 状态与人工干预
- **订阅 `intervention_required`**:
    ```typescript
    mainAgent.on('intervention_required', ({ prompt, resolve }) => {
      // 1. TUI 弹出 modal 窗口
      const input = showPromptModal(prompt);
      // 2. 获取用户输入后，手动调用 resolve
      resolve(input);
    });
    ```

### 1.3 实时数据流与 UI 刷新
- **任务**: 使用 `fs.watch` 监听 `jobs.md`。每当变动发生（由 Team B 的逻辑触发），解析并更新 `blessed` Table。

---

## 2. 验收标准
- [ ] UI 表格能在 `jobs.md` 更新后 500ms 内自动重新渲染。
- [ ] 所有的 `Agent.say` 内容显示在 TUI Activity 窗口。
- [ ] 弹出模态框后，用户输入的字符串能准确传递回 Agent。
