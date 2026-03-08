# Web Dashboard 重构与 Agent Chat 支持计划

## 1. 现状分析 (Current State Analysis)

目前系统前端 (`public/index.html`) 是一个平铺的单页应用（Grid 布局），所有功能模块挤在同一个页面中：
- **左侧**：Agent 状态、职位列表 (Job Table)、活动流水 (Activity Log)。
- **右侧**：投递统计 (Donut Chart)、配置编辑器 (Config Editor)、简历操作 (Resume Action)。

**存在的问题**：
1. **信息密度过高**：所有内容都在一页，随着职位数据和日志的增多，页面会显得杂乱，不易聚焦。
2. **缺乏交互性 (无 Agent Chat)**：目前的“活动流水”只是单向接收后端的 `agent:log` 事件，用户无法主动在页面上向 Agent 发送指令或进行多轮对话。
3. **功能耦合**：配置编辑、简历生成与职位查看属于不同的工作流，放在一起干扰视线。

**后端现状 (`src/web/server.ts`)**：
- 提供了获取职位、统计数据、读写配置、触发简历生成的 REST API。
- 提供了 WebSocket 通道实时推送 Agent 状态和日志。
- 具备触发短暂任务 (Ephemeral Run) 的能力，例如 `/api/resume/build` 中调用了 `mainAgent.runEphemeral('生成简历')`。这为实现 Chat 提供了基础。

## 2. 重构目标 (Refactoring Goals)

1. **引入多 Tab 导航（或侧边栏导航）**，将功能按模块拆分，提升用户体验。
2. **实现 Agent Chat 界面**，作为默认首页，支持用户主动输入指令，并以对话流的形式展示 Agent 的执行过程和回复。
3. **保持后端核心业务逻辑稳定**，通过新增极少量的 API 接口来支持前端的交互升级。
4. **保留全局人工干预机制**，无论用户在哪个 Tab，一旦 Agent 需要干预，都能弹出全局弹窗。

## 3. 详细实施计划 (Implementation Plan)

### 阶段一：后端 API 扩展支持 Chat

**文件：`src/web/server.ts`**
- 新增 `POST /api/chat` 接口。
- 接收 JSON payload: `{ "message": "用户的输入指令" }`。
- 逻辑：获取 `main` agent，调用 `mainAgent.runEphemeral(message)` 异步执行任务。
- 返回 `{ ok: true }`，告知前端指令已接收。Agent 的后续执行日志将通过现有的 WebSocket `agent:log` 推送给前端。

### 阶段二：前端 UI 结构与样式重构 (Tab 化)

**文件：`public/index.html`**
- **增加导航栏 (Navigation/Tabs)**：在页面顶部或侧边增加导航按钮（智能助理、职位看板、工作区配置、简历操作）。
- **页面容器 (Tab Panels)**：
  - 将原来的 Grid 布局拆解为多个隐藏/显示的 `<div>` 容器。
  - 通过 JavaScript 控制 Tab 的切换逻辑，同一时间只显示一个容器。

### 阶段三：Agent Chat 界面开发

**文件：`public/index.html` (在 "智能助理" Tab 内)**
- **聊天记录区 (Chat History Area)**：
  - 替代原有的“活动流水”。
  - 采用类似 ChatGPT 的对话气泡样式（用户消息居右，Agent 消息居左，使用不同颜色区分 info/warn/error）。
  - 处理 WebSocket 发来的 `agent:log`，将其追加到聊天记录区中，并自动滚动到底部。
- **输入交互区 (Input Area)**：
  - 增加一个文本输入框 (`<textarea>` 或 `<input>`) 和发送按钮。
  - 绑定键盘 `Enter` 发送事件。
  - 点击发送时，调用 `/api/chat` 将消息发给后端，并在聊天记录区中立即渲染一条“用户消息”。
- **Agent 状态气泡**：保留在 Chat 页面顶部，实时显示 Agent 是否正在 `running` 或 `idle`。

### 阶段四：其他功能模块迁移

**文件：`public/index.html`**
- **职位看板 Tab**：将原有的职位表格 (Job Table) 和 环形图 (Donut Chart) 移入此 Tab，并调整为左右或上下布局，使其更宽敞。
- **工作区配置 Tab**：将 Markdown Editor 移入此 Tab，提供全屏宽度的编辑体验。
- **简历操作 Tab**：将生成简历按钮和下载链接移入此 Tab。

### 阶段五：全局组件保留与测试

- 确保 **WebSocket 重连逻辑**、**全局的人工干预弹窗 (Intervention Modal)** 不受 Tab 切换的影响，属于全局 DOM 层级。
- 联调测试：发送一条 Chat 消息，观察 Agent 状态变为 running，并观察日志是否在 Chat 窗口中逐条打出，最后 Agent 完成任务。

## 4. 影响与风险评估 (Risk Assessment)

- **前端变更范围大**：需要对 `public/index.html` 进行大规模的 HTML 结构和 CSS 调整。由于使用了 TailwindCSS，主要工作量在于 DOM 结构的重排和 JS 逻辑的封装（如 Tab 切换状态机）。
- **后端变更风险极小**：仅新增一个路由映射，复用已有的 `runEphemeral`，完全不破坏现有的 EventBus 和 Agent 生命周期。
- **图表兼容性注意**：需要确保 `jobs` 数据、`stats` 图表在首次切换到对应 Tab 时能够正确渲染（由于 Chart.js 图表 canvas 只有在容器可见时才能正常获取尺寸，可能需要在 Tab 切换事件中触发图表的初始化或更新）。
