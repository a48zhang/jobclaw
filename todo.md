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

## Phase 5: Web UI & Resume Mastery (Current)
- [ ] **Web 基础设施**: 搭建基于 `Hono` 的轻量级 Web 服务器与 EventBus 状态总线。
- [ ] **数据可视化**: 提供 `jobs.md` 的实时统计 API 和 Web 表格展示。
- [ ] **交互式配置**: 在网页端直接编辑 `targets.md` 和 `userinfo.md`（支持文件锁）。
- [ ] **Resume Skill**: 引入 `typst_compile` 工具，实现简历生成 SOP 与 Web 触发入口。
- [ ] **操作日志**: Web 端的 Agent 活动流实时同步（WS/SSE）。

## Phase 6: 高级生产特性 (Future)
- [ ] **TUI 渲染性能**: 引入内容哈希校验，减少 `jobs.md` 无效解析。
- [ ] **自动化重试框架**: 在 `BaseAgent` 层面实现工具调用的指数退避重试。
- [ ] **Session 智能管理**: 定期清理冗余的消息历史，保持 Session 紧凑。
- [ ] **通道限流**: 针对邮件通知增加发送频率保护逻辑。
