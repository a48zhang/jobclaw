# Phase 6 P2：模拟面试 & 简历评价（下一阶段重点计划）

> 本文件只描述“模拟面试”和“简历评价+修改建议”的落地方案与验收标准，不包含工期。

## 1. 目标与非目标

### 目标

- 让用户可以在 Web Dashboard / TUI 发起“模拟面试”，并进行多轮问答（含追问），最终产出可复盘的面试记录与改进建议。
- 让用户可以发起“简历评价”，得到结构化问题清单（可执行），并可选将建议落到 `workspace/data/resume.typ` 的可编译改写稿（仍走既有工具链 `write_file` + `typst_compile`）。
- 输出协议与现有事件流兼容：结果可通过 `agent:log`（以及未来的流式扩展）展示，不破坏现有 UI。

### 非目标（本阶段不做）

- 不做“真实在线投递的一键自动化面试题库抓取/刷题系统”。
- 不做复杂的评分模型或排名体系（先保证可用与可复盘）。
- 不引入新的持久化依赖（默认仍使用 workspace 文件 + session.json）。

## 2. 用户使用路径（UX Flow）

### 2.1 Web Dashboard

- 入口：复用 `POST /api/chat`，通过指令触发：
  - `开始模拟面试：<公司/岗位/链接/目标等级>` 或 `mock interview ...`
  - `评价简历：<目标岗位>` 或 `review resume ...`
- 展示：
  - 面试过程：按轮次流式显示问题 → 用户回答 → 追问/下一题。
  - 简历评价：一次性结构化报告 +（可选）“生成改写版简历”按钮再触发一次任务。
- 产物下载：
  - 简历 PDF 仍通过既有 `/workspace/output/*` 静态路径访问。

### 2.2 TUI

- 入口：在输入框中键入同样指令（复用 `onCommand` → `MainAgent.runEphemeral`）。
- 展示：
  - 面试过程：优先使用“流式消息”展示（若已实现 Phase 6 的流式统一）。
  - 简历评价：报告直接输出到日志区域，并在结束时提示产物文件路径（见 2.3）。

### 2.3 可复盘产物（写入 workspace）

- 面试记录：`workspace/data/interviews/<timestamp>-<role>.md`
- 简历评价报告：`workspace/data/resume-review/<timestamp>-<role>.md`
- （可选）改写版简历：
  - 直接覆盖：`workspace/data/resume.typ`（默认）
  - 或保留副本：`workspace/data/resume.<timestamp>.typ`（避免误覆盖；由配置或指令控制）

## 3. 输入数据与对齐策略

### 3.1 输入来源

- 用户背景：`workspace/data/userinfo.md`
- 目标岗位：
  - 优先：用户指令中的岗位/级别/公司/链接
  - 其次：`workspace/data/targets.md` 与 `workspace/data/jobs.md`（用于抽取目标岗位信息）
- 简历内容：
  - Typst 源：`workspace/data/resume.typ`（优先）
  - PDF：`workspace/data/resume.pdf`（仅用于提示存在与路径；不作为主要可编辑输入）

### 3.2 对齐策略（必须显式）

- 每次任务必须明确 `Target Role`（岗位名 + 级别 + 技术栈关键字）。
- 若用户未提供目标岗位：
  - 模拟面试：必须触发 HITL 询问后再继续。
  - 简历评价：同上，否则输出会失焦。

## 4. 核心能力拆解（实现层面）

## 4.1 模拟面试（Mock Interview）

### A. 运行形态

优先方案（建议）：
- 新增专用 Agent：`InterviewAgent`
  - 只负责：生成问题、追问、记录用户回答、在结束时生成复盘报告。
  - 由 `MainAgent` 通过工具（或 `spawnAgent` 机制）调度运行。

备选方案：
- 直接由 `MainAgent` 在 `runEphemeral` 中执行（实现快，但长期难维护/难测试）。

### B. 会话状态（建议最小结构）

- `InterviewSession`（内存 + session.json 轻量持久化）：
  - `targetRole`: string
  - `level`: 'intern' | 'junior' | 'mid' | 'senior' (可扩展)
  - `focus`: string[]（如 system-design / frontend / backend / data / product）
  - `rounds`: `{ question, answer, followUps[] }[]`
  - `verdict`: string（结束总结）

### C. 输出格式（可测试/可复盘）

- 面试过程中：每轮至少包含：
  - `Q:` 主问题（含考察点）
  - `Follow-up:` 追问（基于用户回答的薄弱点）
  - `Takeaway:` 用户该怎么补充/怎么答更好
- 面试结束后生成 `Interview Report`（Markdown）：
  - [亮点]
  - [硬伤与风险点]
  - [高频追问清单]
  - [下一步训练计划]（不写工期，只写训练主题清单）

### D. 工具与文件交互（建议）

- `read_file`：读取 `userinfo.md` / `targets.md` / `jobs.md`（必要时）。
- `write_file`：写入面试记录到 `workspace/data/interviews/...`。
- `requestIntervention`：当缺少 Target Role、或需要用户提供“面试方向偏好/岗位链接”时触发。

## 4.2 简历评价 + 修改建议（Resume Review + Rewrite）

### A. 运行形态

两段式（建议）：
1) `Resume Review`：只读评估 + 生成“修改清单”和“改写建议片段”（不直接改文件）
2) `Apply Rewrite`（可选）：在用户确认后再写入 `resume.typ` 并编译

### B. 评价维度（结构化、可执行）

- 匹配度：关键词覆盖、技术栈一致性、岗位级别匹配
- 可信度：量化指标、边界与职责、难点与取舍
- 可拷问性：每段经历能否引出 2–3 个硬核追问且简历已埋钩子
- 可读性：层次结构、长度控制、重点突出、重复/空话

### C. 输出格式（固定模板，便于回归）

- [Red Flags]：最容易直接淘汰的点（≤ 3）
- [JD 对齐差距]：缺失关键词/能力点（条目化）
- [逐段改写建议]：给出“原句 → 改写句”或“要点 → 可直接粘贴的 bullets”
- [面试官追问]：基于改写后的 bullets 给 5–10 个必问问题（用于自检）
- [改写实施方案]：
  - 需要用户补充的信息（逐条询问）
  - 改写策略（不写工期）

### D. 与现有 skills 的关系

- 复用：
  - `workspace/skills/interviewer.md`（严苛审阅视角）
  - `workspace/skills/resume-mastery.md`（生成/改写/编译流程）
- 建议补充（可选）：
  - 在 `interviewer.md` 中加入“输出模板固定化”说明（避免每次格式漂移）。

## 5. 需要补齐的工程接口（最小集）

> 目标是“能跑起来 + 可测试 + 可复盘”，不追求一次性做全功能 UI。

- 指令约定（建议）：
  - `mock interview` / `开始模拟面试`：进入多轮问答模式
  - `review resume` / `评价简历`：生成报告
  - `apply resume rewrite` / `生成改写版简历`：在确认后写入并编译
- 事件与展示：
  - 面试问答建议使用“流式消息”展示（依赖 Phase 6 的消息流统一项）。
  - 若暂未实现 Web 流式，则至少保证轮次输出可读且不刷屏（每轮一条）。

## 6. 测试与验收（必须可回归）

### 6.1 单测建议（不依赖真实 LLM）

- 指令解析：输入文本 → 路由到正确的任务类型/Agent（mock）。
- 产物写入：生成的 markdown 路径、文件内容包含固定标题/章节（snapshot/包含断言）。
- 两段式流程：`review` 后不会写 `resume.typ`；`apply` 后才会写并触发 `typst_compile`（mock 工具执行）。

### 6.2 人工验收清单（可复制到 issue）

- 模拟面试：
  - 能完成至少 5 轮问答，且每轮包含追问与 takeaway。
  - 结束后生成可复盘报告文件，并在 UI 中提示路径。
- 简历评价：
  - 报告结构符合固定模板；Action Items 可直接执行。
  - 可选改写流程在用户确认后才改文件；改写后的简历可编译成功（产出 PDF）。

