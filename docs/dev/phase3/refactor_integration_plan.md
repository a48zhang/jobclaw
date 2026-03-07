# Phase 3: 集成与重构实现计划 (Final Integration & Refactoring)

> **目标**: 实现“搜报分离”架构。引入 `upsert_job` 工具确保数据稳健，通过“日报模式”优化用户通知体验。

---

## 1. 核心任务：实现 `upsert_job` 专用工具

### 1.1 工具规范 (`src/tools/upsertJob.ts`)
- **职责**: 纯粹的数据管理，不再内置通知逻辑。
- **参数**: `company`, `title`, `url`, `status`, `time`。
- **逻辑**: 自动处理 `lock_file`，执行 Markdown 格式化，确保 `jobs.md` 永不损坏。

---

## 2. 搜报分离架构 (Decoupled Notification)

### 2.1 搜索任务 (Search - 静默)
- `MainAgent` 执行搜索并调用 `upsert_job` 写入。
- 整个过程不触发单条邮件通知。

### 2.2 日报任务 (Daily Digest - 定时汇总)
- **触发**: 每天固定时间（如 12:00）运行。
- **指令**: `mainAgent.runEphemeral("分析 jobs.md 中的新增岗位并发送日报汇总")`。
- **Agent 逻辑**:
  1. 读取 `jobs.md`。
  2. 识别状态为 `discovered` 且时间为“最近”的行。
  3. **合并通知**: 如果有新增，LLM 生成一份格式精美的汇总报告，调用 `Channel.send`；若无新增，静默退出。

---

## 3. 实现路线图 (Implementation Timeline)

### 步骤 1: 工具层重构 (去通知化)
- [ ] 编写 `src/tools/upsertJob.ts`（纯净的文件操作）。
- [ ] 注册工具并移除 Agent 中所有 `onToolResult` 里的正则解析。

### 步骤 2: SOP 增强 (日报技能)
- [ ] 在 `jobclaw-skills.md` 中填充 **“日报汇总 SOP”**：
  - 指导 Agent 如何根据 `time` 列筛选岗位。
  - 定义日报邮件的 Markdown 模板（标题、列表、亮点总结）。

### 步骤 3: 系统入口调整
- [ ] 修改 `src/cron.ts` 支持两种模式：`search` 模式与 `digest` 模式。
- [ ] 确保 `digest` 模式下 `Channel` 正常工作。
