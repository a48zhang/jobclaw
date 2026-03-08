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

## Phase 4: TUI 仪表盘与鲁棒性集成 (Completed)
- [x] **布局实现**: 实现基于 `blessed` 的 Grid 布局。
- [x] **实时数据流**: 监听 `jobs.md` 变化并订阅 Channel 事件。
- [x] **人工干预 UI**: 实现 TUI 模态框弹出。
- [x] **系统鲁棒性**: 实现宽容解析与环境预检。

## Phase 5: Web UI & Monitoring (Current)
- [ ] 提供基于 Hono 的可视化监控看板。
- [ ] 实现交互式的 `targets.md` 和 `userinfo.md` 编辑器。
- [ ] **TUI 性能优化 (远期)**:
  - 引入内容哈希校验，避免 `jobs.md` 无变化时的重复解析。
  - 优化 Blessed Table 渲染，减少批量写入时的闪烁。
