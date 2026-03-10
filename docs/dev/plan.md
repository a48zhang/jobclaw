# JobClaw 开发计划（docs/dev/plan.md）

> 最近更新：2026-03-10  
> 说明：`docs/dev/` 已收敛为单文件计划。

## 1. 当前状态（不含工期）

- Phase 0–5：已完成并已集成（脚手架/工具层/BaseAgent/核心 Agents/Channel/Web Dashboard/简历生成）。
- Phase 6：进行中，目标是“生产化可用”——稳定性、性能、会话管理与可观测性。

## 2. 约束与不变量（必须遵守）

1. 配置扁平化：统一使用 `workspace/config.json` 顶层字段，不引入嵌套对象。
2. 写入一致性：严禁绕过 `upsert_job` 直接写 `jobs.md`。
3. 单文件体积：尽量保持单文件 < 500 行；超过则拆分到模块。
4. 协议演进：Web/TUI 事件协议只增不改；如需替换字段，必须兼容旧字段至少一个版本。

## 3. Phase 6 执行清单（同步自 todo.md）

> 规则：本节与 `todo.md` 保持一一对应；完成后同时勾选两处。

### P1：性能与稳定性

- [ ] TUI 渲染性能：引入内容哈希校验，减少 `jobs.md` 无效解析。
- [ ] 自动化重试框架：在 `BaseAgent` 层面实现工具调用的指数退避重试。
- [ ] Session 智能管理：定期清理冗余的消息历史，保持 Session 紧凑。
- [ ] 通道限流：针对邮件通知增加发送频率保护逻辑。
- [ ] 异步化消息流：统一 UI/Channel/EventBus 的“流式输出”与“最终态”处理。

### P2：产品能力

- [ ] 模拟面试：根据目标岗位信息进行模拟面试。
- [ ] 简历评价 + 修改建议：对生成的简历给出可执行的改进点与迭代流程。

## 4. Phase 6 开发路线（建议顺序）

> 原则：先做“可靠性/可观测性”再做“能力扩展”；每一项都应落到可验收的行为与可回归的测试。

1. 异步化消息流（作为其他改造的基础）：先统一协议与渲染逻辑，避免后续功能各自发明一套。
2. TUI 渲染性能：减少无效解析/渲染，为长时间运行打底。
3. 自动化重试框架：降低偶发工具失败导致的流程中断。
4. Session 智能管理：控制会话体积与磁盘 IO，避免 session.json 无限增长。
5. 通道限流：降低通知风暴风险（尤其在 cron 批处理与工具流式输出场景）。
6. 模拟面试 / 简历评价：在稳定底座之上扩展用户可见功能。

## 5. Phase 6 设计与验收要点（逐项落地）

### 5.1 异步化消息流

- 目标：统一 `ChannelMessage.streaming`、`agent:log`（Web Dashboard）与 TUI 的“流式片段 + 最终消息”处理语义。
- 建议方案：
  - Web：为 `agent:log` 增加可选 `streaming` 字段（只增不改），或新增专用事件（例如 `agent:log_stream`），并保持向后兼容。
  - Channel：明确哪些消息允许流式（如 `agent_response`、`tool_output`），哪些只允许最终态（如 `delivery_success`）。
  - TUI：将当前“流式占位 + setLine”逻辑抽象为单独 helper，避免散落在 `TUIChannel.send` 中难以维护。
- 验收标准：
  - Web Dashboard 能看到流式输出逐步更新，最终落为一条稳定消息，不重复刷屏。
  - TUI 与 Web 在同一任务上的输出粒度一致（最多只在样式上不同）。
  - 添加/更新单测覆盖：事件 payload 结构、向后兼容字段回退、流式结束后状态一致。

### 5.2 TUI 渲染性能（内容哈希）

- 目标：`data/jobs.md` 未发生有效变更时，不重复 `parseJobsMd` + `screen.render()`。
- 建议方案：
  - 在 `src/web/tui.ts` 的 `refreshJobTable()` 内缓存 `lastJobsHash`（对文件内容或 mtime+size 做快速校验）。
  - watcher 回调保持节流；新增“变更但 hash 不变”时直接返回。
- 验收标准：
  - 连续写入无关内容或重复触发 watch 时，CPU/渲染次数显著下降（可在本地用简单计数日志验证）。
  - 单测覆盖：相同内容多次 refresh 不更新 table；内容变化时更新。

### 5.3 自动化重试框架（指数退避）

- 目标：工具调用在“可重试错误”上自动恢复，避免单次偶发失败终止 Agent 流程。
- 建议方案：
  - 在 `BaseAgent.executeToolCall()` 层包装 `executeTool()` / `mcpClient.callTool()`，支持 `maxAttempts`、指数退避、抖动（可选）。
  - 明确可重试条件：超时、网络临时错误、特定工具返回的可重试错误码；禁止对“参数错误/权限错误/业务逻辑错误”重试。
  - 将每次重试用 `tool_warn`/`agent:log` 记录，但避免刷屏（配合限流）。
- 验收标准：
  - 单测覆盖：第一次失败第二次成功可自动恢复；不可重试错误不重试；达到最大次数后返回明确错误。

### 5.4 Session 智能管理

- 目标：控制 `agents/*/session.json` 体积与写入频率，避免长期运行膨胀与 IO 抖动。
- 建议方案：
  - 保存前裁剪：保留 system + 最近 N 轮对话 + 最近工具调用摘要；其余依赖 ContextCompressor 摘要。
  - 结构化写入：将“长文本内容”（如 tool_output）聚合或截断，避免 session 记录过细碎的流式片段。
  - 可选：按任务边界持久化（比如每完成一个任务或进入 idle 状态保存一次）。
- 验收标准：
  - 单测覆盖：裁剪策略生效（消息数/字段大小上限）；恢复 session 后系统行为不变。

### 5.5 通道限流（邮件/通知保护）

- 目标：避免短时间内大量 `channel.send()` 导致邮件服务/前端日志被打爆。
- 建议方案：
  - 实现 `RateLimitedChannel` wrapper（token bucket / fixed window 皆可），用于 `EmailChannel` 与可能的 Web 推送。
  - 对 `tool_output` 这类高频流量做合并（例如每 X ms 聚合为一条），而不是逐行发送。
- 验收标准：
  - 单测覆盖：在高频 send 下总发送次数被限制；超限时产生可观测的 warn 但不中断主流程。

### 5.6 模拟面试

- 目标：输入目标岗位信息 + 用户背景材料（简历/经历摘要），输出结构化面试流程与追问。
- 细化计划：见 `docs/dev/phase6-p2-interview-resume.md`。
- 建议方案：
  - 形式：新增 `InterviewAgent` 或在 MainAgent 增加任务入口（通过 Chat 指令触发）。
  - 输入：从 `targets.md`/`jobs.md` 读取岗位信息，从 resume 或用户输入读取经历摘要。
  - 输出：问题列表（按维度：项目/算法/系统/行为），并支持回合式追问（HITL）。
- 验收标准：
  - 能在 Web/TUI 触发并得到分阶段输出；每一轮用户回答后继续追问。
  - 测试：至少覆盖“入口路由/指令解析/基本对话状态保持”。

### 5.7 简历评价 + 修改建议

- 目标：对当前简历内容给出可执行修改项，并能输出“可直接落地的改写稿”。
- 细化计划：见 `docs/dev/phase6-p2-interview-resume.md`。
- 建议方案：
  - 评价维度：岗位匹配度、量化指标、STAR 表达、关键词覆盖、排版一致性。
  - 输出：改进清单 + diff 风格改写建议；可选提供“一键生成新版 typst 源文件”的工具链串联（仍走 `write_file`/`typst_compile`）。
- 验收标准：
  - 结果包含可操作清单，并能产出一份可编译的简历源文件（如启用该能力）。
  - 测试：至少覆盖“输出格式稳定 + 工具链调用顺序正确（mock）”。

## 6. 发布前验收清单（仍需人工验收）

- [ ] Cron 两种模式（`search`/`digest`）在无 SMTP 与有 SMTP 环境下行为符合预期。
- [ ] Web Dashboard 联动：`agent:state`、`agent:log`、HITL、Chat 指令投递。
- [ ] `workspace/config.json.example` 补齐并同步最新配置项。
- [ ] `README.md` 与 `SPEC.md` 同步最新行为（例如 Cron 模式差异、默认模型/配置项等）。

## 7. Web Dashboard 维护要点

- 保持 `agent:log` 协议稳定；如需演进，优先“新增字段 + 保留旧字段”。
- Chat 入口（`POST /api/chat`）只负责触发任务；执行过程统一走 WebSocket 事件流展示。
