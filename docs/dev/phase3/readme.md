# Phase 3：核心功能与基础设施实现

**目标**：基于“两 Agent 架构”实现具体功能逻辑，并构建系统运行所需的基础设施（通知、定时任务、引导流程）。

### 任务清单

#### 3.1 MainAgent（`src/agents/main/index.ts`）
- **核心职责**：用户交互、职位搜索、任务调度。
- **搜索逻辑**：发现新职位后，**必须调用 `upsert_job` 工具**进行去重写入（严禁直接操作文件），工具会自动发出通知。
- **任务委派**：通过 `spawnAgent` 工具启动 DeliveryAgent 执行投递（串行，独立上下文）。
- **SOP 遵循**：通过 `loadSkill('jobclaw-skills')` 内嵌搜索与去重 SOP。

#### 3.2 基础设施与专用工具（Channel / Cron / Bootstrap / Tools）
- **upsert_job** (专用工具): 实现 `src/tools/upsertJob.ts`，支持结构化参数更新 `jobs.md`，自动处理锁逻辑并根据状态变化触发 `Channel` 通知。
- **Channel**: 定义统一的通知接口 `src/channel/base.ts` 及邮件实现 `src/channel/email.ts`。
- **CronJob**: 实现 `src/cron.ts` 单次任务脚本，支持外部调度器无状态拉起 `mainAgent.runEphemeral()`。
- **Bootstrap**: 实现 `src/bootstrap.ts` 首次运行引导流程，确保 `userinfo.md` 和 `targets.md` 正确配置。
- **入口集成**: 更新 `src/index.ts` 支持交互模式与引导模式的切换。

#### 3.3 DeliveryAgent（`src/agents/delivery/index.ts`）
- **核心职责**：表单自动投递。
- **执行模式**：仅作为子进程（`runEphemeral`）被拉起，单次运行上限 50 步。
- **状态更新**: 投递状态变更后，**必须调用 `upsert_job` 工具**更新状态，工具会自动发出通知。
- **SOP 遵循**：通过 `loadSkill('jobclaw-skills')` 内嵌投递 SOP。

#### 3.4 jobs.md 字段约定

| 字段 | 写入方 | 说明 |
|------|--------|------|
| 公司 | MainAgent | 公司名称 |
| 职位 | MainAgent | 职位名称 |
| 链接 | MainAgent | 招聘页面 URL |
| 状态 | DeliveryAgent | discovered / applied / failed / login_required |
| 时间 | DeliveryAgent | 投递时间 (YYYY-MM-DD HH:mm) |

### 验收标准
- **搜索**：MainAgent 能读取 `targets.md`，使用浏览器发现职位并去重写入 `jobs.md`。
- **投递**：DeliveryAgent 能自动读取 `discovered` 条目，匹配 `userinfo.md` 完成投递并更新状态。
- **通知**：发现新职位或投递状态变更时，用户能收到邮件通知。
- **自动化**：`cron.ts` 能在不污染对话 Session 的情况下独立运行。
