# JobClaw Project TODO

## Phase 3: Core Implementation & Infrastructure (Integration Phase)

### 紧急修复项 (P1/P2)
- [ ] **P1 (Cron 对齐)**: 修改 `src/cron.ts` 的正则解析逻辑，使其匹配 MainAgent 的 `[FOUND: N]` 标记。
- [ ] **P2 (SOP 填充)**: 在 `src/agents/skills/jobclaw-skills.md` 中完整填充“投递职位 SOP”章节。
- [ ] **P2 (重构建议)**: 将职位操作逻辑从通用文件工具迁移至 `upsert_job` 专用工具，彻底移除正则。

### 待合并验证 (Branches Status)
- [x] **Team A (MainAgent)**: `BaseAgent` 核心方法增强、`[FOUND: N]` 标记实现。
- [x] **Team B (Infrastructure)**: MCP 客户端注入、Bootstrap 对话循环、环境变量校验。
- [x] **Team C (DeliveryAgent)**: `loadSkill` 规范化、状态冗余清理。

### 下一阶段任务
- [ ] 实现 `src/tools/upsertJob.ts` (封装加锁、格式化与 Channel 通知)。
- [ ] 重构 MainAgent 与 DeliveryAgent 以使用 `upsert_job`。
- [ ] 实现 Phase 4 的 TUI 终端仪表盘。
