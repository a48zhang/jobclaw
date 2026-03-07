# JobClaw Project TODO

## Phase 3: 核心功能集成与重构 (Current)

### 专用工具实现 (消灭正则)
- [ ] **upsert_job 工具**: 实现 `src/tools/upsertJob.ts`。
  - 自动处理 `lock_file` / `unlock_file`。
  - 封装标准 Markdown 表格行格式化逻辑。
  - 内部根据状态变更自动触发 `Channel` 通知。
- [ ] **MainAgent 重构**: 搜索到职位后调用 `upsert_job`，删除脆弱的 `onToolResult` 正则解析逻辑。
- [ ] **DeliveryAgent 重构**: 投递状态变更后调用 `upsert_job`，删除 `write_file` 后的正则嗅探逻辑。

### 紧急集成修复 (P1/P2)
- [ ] **P1 (Cron 对齐)**: 修改 `src/cron.ts` 的正则解析逻辑，使其匹配 MainAgent 的 `[FOUND: N]` 标记。
- [ ] **P2 (SOP 填充)**: 验证并进一步完善 `src/agents/skills/jobclaw-skills.md` 中的“投递职位 SOP”细节。

### 已完成集成 (Merged to Main)
- [x] **Team A (MainAgent)**: 基础 Agent 方法增强、[FOUND: N] 统计、MCP 状态感知的系统提示词。
- [x] **Team B (Infrastructure)**: MCP 客户端初始化、Bootstrap 引导循环、环境变量校验、邮件通道实现。
- [x] **Team C (DeliveryAgent)**: `loadSkill` 规范化、投递流程逻辑实现。

---

## Phase 4: TUI 仪表盘与鲁棒性集成 (Next)

### TUI 终端仪表盘 (Blessed)
- [ ] **布局实现**: 实现基于 `blessed` 的 Grid 布局（Chat 窗口 + 职位表格 + 实时数据面板）。
- [ ] **实时数据流**: 
  - 监听 `jobs.md` 文件变化，自动刷新 TUI 表格。
  - 订阅 `Channel` 事件，在仪表盘展示实时 Agent 动作。
- [ ] **人工干预 UI**: 当 Agent 检测到验证码或登录阻断时，在 TUI 弹出显著提示，并允许用户在 TUI 中输入反馈或手动操作浏览器。

### 系统鲁棒性优化
- [ ] **宽容解析**: 重构 `jobs.md` 的读取逻辑，使其能容忍 LLM 或用户手动修改引入的非关键格式错误。
- [ ] **环境预检**: 实现 `validateEnv` 的完整预检逻辑，在程序启动前确认所有 API Key、SMTP 和 Workspace 路径配置正确。

---

## Phase 5: Web UI & Monitoring (Future)
- [ ] 提供基于 Hono 的可视化监控看板。
- [ ] 实现交互式的 `targets.md` 和 `userinfo.md` 编辑器。
