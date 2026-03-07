# Phase 3：具体 Agent 实现

**目标**：基于逻辑协作构建具体 Agent 功能。

### 任务清单

#### 3.1 MainAgent（`src/agents/main.ts`）

- 继承 BaseAgent
- `systemPrompt` 说明：用户交互 Agent，负责理解用户意图、协调跨 Agent 任务执行
- 直接持有 `SearchAgent` 和 `DeliveryAgent` 实例
- 任务执行逻辑：根据意图直接调用对应 Agent 的 `run()` 方法，并将其返回值作为自己的响应内容
- 支持任务上下文传递：将当前交互中的关键信息存入 `context` 共享给子 Agent

#### 3.2 SearchAgent（`src/agents/search.ts`）

- 继承 BaseAgent
- 构造函数额外接收可选的 `channel?: Channel`
- `systemPrompt` 说明：信息搜集 Agent，核心职责是通过 Playwright 工具在浏览器中发现职位。必须将发现的职位追加写入 `jobs.md`（初始状态 `discovered`），写入前必须使用 `lock_file`
- 观察者模式：覆盖 `onToolResult`，每当 `write_file` 或 `append_file` 成功更新了 `jobs.md` 时，解析出新职位通过 `channel` 发送通知

#### 3.3 DeliveryAgent（`src/agents/delivery.ts`）

- 继承 BaseAgent
- 构造函数额外接收 `channel: Channel`
- `systemPrompt` 说明：投递执行 Agent，核心职责是执行实际的申请流程。读取 `jobs.md` 获取待投递列表，匹配 `userinfo.md`，操作浏览器填写表单。完成后必须更新 `jobs.md` 对应条目的状态
- 实时反馈：覆盖 `onToolResult`，每当捕获到投递相关的工具执行结果（成功/失败/异常阻断）时，立即通过 `channel` 发送状态快照给用户

#### 3.4 jobs.md 字段约定

| 字段 | 写入方 | 说明 |
|------|--------|------|
| 公司 | SearchAgent | 公司名称 |
| 职位 | SearchAgent | 职位名称 |
| 链接 | SearchAgent | 招聘页面 URL |
| 状态 | DeliveryAgent | discovered / applied / failed / login_required |
| 时间 | DeliveryAgent | 投递时间 |

### 验收标准

- SearchAgent 能读取 `targets.md`，访问招聘页，将职位写入 `jobs.md`（状态为 `discovered`）
- DeliveryAgent 能读取 `jobs.md` 中 `discovered` 条目，填表投递，更新状态
