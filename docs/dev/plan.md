# JobClaw 开发计划（docs/dev/plan.md）

> 最近更新：2026-03-11  
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

- [ ] request 交互原语：将当前 `intervention` 机制升级为 LLM 可显式调用的 `request` 能力。
- [ ] PDF 简历读取链路：支持用户上传 PDF 简历，并通过 `read_pdf` tool 提取文本供后续评价使用。
- [ ] 模拟面试：根据岗位信息和现有材料进行回合式模拟面试，并在结束后统一评分与点评。
- [ ] 简历诊断 + 改写：评价当前简历并给出可直接落地的改写结果。

## 4. Phase 6 开发路线（建议顺序）

> 原则：先做“可靠性/可观测性”再做“能力扩展”；每一项都应落到可验收的行为与可回归的测试。

1. 异步化消息流（作为其他改造的基础）：先统一协议与渲染逻辑，避免后续功能各自发明一套。
2. TUI 渲染性能：减少无效解析/渲染，为长时间运行打底。
3. 自动化重试框架：降低偶发工具失败导致的流程中断。
4. Session 智能管理：控制会话体积与磁盘 IO，避免 session.json 无限增长。
5. 通道限流：降低通知风暴风险（尤其在 cron 批处理与工具流式输出场景）。
6. request 交互原语：先打通 Agent 可控提问、等待用户输入、继续执行的链路，再让交互型 skill 落在稳定接口上。
7. PDF 简历读取链路：先补齐“上传 PDF -> 提取文本 -> 进入评价流程”的底层能力，避免 skill 只能处理文本文件。
8. 模拟面试 / 简历诊断：基于 request 和 PDF 读取能力落地用户可见功能。

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

### 5.6 request 交互原语

- 目标：将当前代码中的 `requestIntervention()` 升级为 LLM 可以直接调用的 `request` 能力，解决“文档写了可请求用户输入，但模型实际上没有这个工具”的错位问题。
- 背景现状：
  - 当前 Agent 内部已有 `requestIntervention()` 与 `intervention:required/resolved` 事件链路。
  - 当前模型只能在 prompt 中被动“被要求这么做”，不能像调用文件工具那样显式发起一次 request。
  - 交互型能力（模拟面试、简历澄清、投递阻塞处理）都依赖这一层能力稳定可用。
- 开发拆分：
  - 第 1 步：定义 `request` 工具契约。建议参数至少包含 `prompt`、`kind`、`options`、`timeout_ms`、`allow_empty`。`kind` 首版支持 `text`、`confirm`、`single_select` 即可。
  - 第 2 步：在 `BaseAgent.getAvailableTools()` 中注入 `request` 工具定义，并在 `executeToolCall()` 中走特殊分支，不落到普通本地工具执行器。
  - 第 3 步：将 `request` 的执行适配到现有 `requestIntervention()`。首版允许 `request` 作为公开工具名，而内部仍复用现有事件总线与超时逻辑。
  - 第 4 步：升级事件协议。为 `intervention:required/resolved` 增加可选字段：`requestId`、`kind`、`options`、`timeoutMs`。保持旧字段仍可工作，满足“协议只增不改”约束。
  - 第 5 步：升级 Web/TUI。Web 弹窗与 TUI modal 先支持 `text`/`confirm` 两种表现；`single_select` 不足时回退为文本输入。
  - 第 6 步：补齐调用规范。系统提示、skill SOP、SPEC 统一改写为使用 `request`，并声明“若没有该工具则退回普通多轮对话”只作为兼容策略，不作为主路径。
  - 第 7 步：补测试。覆盖工具注册、超时、事件透传、用户输入回填、ephemeral 模式行为、前端协议兼容。
- 验收标准：
  - 模型能显式调用 `request`，任务暂停并等待用户输入，收到输入后继续完成后续推理。
  - 旧的 `POST /api/intervention` 与现有 TUI 处理链路仍可用。
  - 单测覆盖：成功路径、超时路径、空输入路径、兼容旧 payload 路径。

### 5.7 模拟面试

- 目标：输入岗位信息（可选）和用户现有材料后，执行一场回合式模拟面试；面试过程中只提问和追问，不即时打分，统一在结束后给出完整反馈。
- 细化计划：见 `docs/dev/phase6-p2-interview-resume.md`。
- 建议方案：
  - 形式：先以 skill 方式落地，新增 `mock-interview.md`，由 MainAgent 按指令触发；暂不急着拆独立 `InterviewAgent`。
  - 输入：优先读取 `targets.md`、`jobs.md`、`userinfo.md`、`resume.typ`；若用户提供具体 JD，则优先按 JD 面试。
  - 轮次：按“自我介绍 → 简历讲解（项目/实习）→ 深挖简历 → 基础知识（计网/系统/八股）→ LeetCode”推进，但允许 Agent 根据用户表现跳题、追问或提前结束。
  - 结束条件：由 Agent 判断“信息已足够形成评价”时结束，或用户明确提出结束。
  - 输出：只在结束时统一生成总分、子项得分、整体表现分析、薄弱点、推荐答案（仅在该项答得差时给出）和改进建议。
- 验收标准：
  - 能在 Web/TUI 触发并完成至少 3 轮以上问答，且不会在中途插入评分。
  - 结束报告结构稳定，至少包含总分、分项得分、表现分析、推荐答案、改进建议。
  - 测试：至少覆盖“入口路由/对话状态保持/结束态报告结构”。

### 5.8 PDF 简历读取链路

- 目标：支持用户上传 PDF 简历，并将其中的文本提取为 Agent 可消费的结构化结果，供简历诊断与后续改写流程复用。
- 细化计划：见 `docs/dev/phase6-p2-interview-resume.md`。
- 建议方案：
  - 形式：做成底层工具 `read_pdf`，而不是单独 skill；skill 只负责流程编排，PDF 解析必须由稳定工具承担。
  - 上传：Web 新增 `POST /api/resume/upload`，使用 `multipart/form-data` 保存文件到 `workspace/data/uploads/`。
  - 读取：新增 `src/tools/readPdf.ts`，工具参数建议至少包含 `path`、`pages`、`max_chars`、`include_meta`。
  - 输出：返回提取文本、页数、是否截断、可选元数据；必要时附带“清洗后文本”而不是直接把原始 PDF 流暴露给模型。
  - 依赖：首版优先使用纯 JS PDF 解析库；暂不依赖 OCR，不把扫描件支持纳入 MVP。
  - 接入：`resume-clinic` 在发现用户上传 PDF 时优先调用 `read_pdf`，再进入评价/改写流程。
- 验收标准：
  - 用户可通过 Web 上传文本型 PDF 简历。
  - Agent 能调用 `read_pdf` 成功拿到文本并输出简历评价。
  - 对扫描件或解析失败场景，返回明确错误和下一步建议，而不是让模型自行猜测内容。

### 5.9 简历诊断 + 改写

- 目标：对当前简历内容给出可执行修改项，并能输出“可直接落地的改写稿”。
- 细化计划：见 `docs/dev/phase6-p2-interview-resume.md`。
- 建议方案：
  - 形式：新增 `resume-clinic.md` skill，负责“评价 + 改写”；原 `resume-mastery.md` 继续负责“生成/维护简历源文件”。
  - 输入：读取 `userinfo.md`、现有 `resume.typ`，可选读取目标岗位信息或具体 JD；如果用户上传 PDF，则先通过 `read_pdf` 获取可分析文本。
  - 输出分两段：先给审查报告（岗位匹配度、量化指标、STAR 表达、关键词覆盖、排版一致性），再在用户要求或任务指令允许时直接改写并回写 Typst。
  - 工具链：改写落地仍走 `write_file`/`append_file`/`typst_compile`，不引入新的文件写入路径。
- 验收标准：
  - 结果包含可操作清单，并能产出一份可编译的简历源文件（如启用改写能力）。
  - 测试：至少覆盖“输出格式稳定 + 工具链调用顺序正确（mock）”。

## 6. 发布前验收清单（仍需人工验收）

- [ ] Cron 两种模式（`search`/`digest`）在无 SMTP 与有 SMTP 环境下行为符合预期。
- [ ] Web Dashboard 联动：`agent:state`、`agent:log`、HITL、Chat 指令投递。
- [ ] `workspace/config.json.example` 补齐并同步最新配置项。
- [ ] `README.md` 与 `SPEC.md` 同步最新行为（例如 Cron 模式差异、默认模型/配置项等）。

## 7. Web Dashboard 维护要点

- 保持 `agent:log` 协议稳定；如需演进，优先“新增字段 + 保留旧字段”。
- Chat 入口（`POST /api/chat`）只负责触发任务；执行过程统一走 WebSocket 事件流展示。
