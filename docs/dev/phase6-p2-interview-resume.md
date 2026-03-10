# Phase 6 P2：模拟面试 & 简历评价（开发计划）

> 目标：用最少工程改动，把“模拟面试”和“简历评价/改写”做成稳定可复用的能力。计划只写开发任务与验收，不写背景分析。

## A. 交付物（必须产出）

- `workspace/skills/mock-interview.md`：新增 SOP（模拟面试）
- `workspace/skills/interviewer.md`：输出模板固定化 + 结果落盘（简历评价）
- `workspace/skills/resume-mastery.md`：两段式（评价不改文件 / 应用改写才改）+ 落盘与编译（简历改写）
- `workspace/skills/index.md`：补充上述 2 个入口说明（减少模型选择漂移）

## B. 指令入口（必须能用，且无需 UI 改动）

> 入口统一走 `POST /api/chat` 或 TUI 输入 → `MainAgent.runEphemeral(...)`。

- 模拟面试：
  - `开始模拟面试：<目标岗位>；<级别>；<方向>`
- 简历评价（只读）：
  - `评价简历：<目标岗位>`
- 应用改写（写文件 + 编译）：
  - `应用简历改写：使用上一份评价，将改写落到 resume.typ 并编译`

## C. 产物落盘规范（必须遵守）

- 面试记录：`workspace/data/interviews/<timestamp>-<role>.md`
- 简历评价：`workspace/data/resume-review/<timestamp>-<role>.md`
- 简历源文件：
  - 默认覆盖：`workspace/data/resume.typ`
  - 可选副本：`workspace/data/resume.<timestamp>.typ`（仅当指令明确要求“保留副本”）
- PDF：`workspace/output/resume.pdf`

## D. Skill 变更清单（具体要改什么）

### D1. `workspace/skills/mock-interview.md`（新增）

- 必须先 `read_file data/userinfo.md`。
- 若缺少目标岗位/级别/方向：必须 HITL（一次只问 1–2 个关键字段）。
- 面试流程（最小可用）：
  - 总轮次 ≥ 5（允许用户随时 `结束`）。
  - 每轮输出必须使用固定块结构（便于前端/TUI 渲染与回归）：
    - `Q:`（问题）
    - `Rubric:`（考察点/优秀回答要点）
    - `Follow-up:`（基于用户回答的 1–2 个追问）
    - `Takeaway:`（下一次怎么答，给可直接背诵的要点）
- 结束时必须 `write_file` 写入 `data/interviews/...`，并在对话中打印文件路径。

### D2. `workspace/skills/interviewer.md`（修改）

- 保留“严苛面试官”风格，但输出必须固定为以下标题（顺序固定）：
  1) `## Red Flags (≤3)`
  2) `## JD Gap`
  3) `## Rewrite Suggestions (Copy/Paste Bullets)`
  4) `## Interviewer Questions`
  5) `## Action Items`
- 输入读取约定：
  - 必须 `read_file data/userinfo.md`
  - 必须 `read_file data/resume.typ`（如果不存在则要求用户先生成或提供文本）
- 完成后必须 `write_file` 写入 `data/resume-review/...`，并在对话中打印文件路径。

### D3. `workspace/skills/resume-mastery.md`（修改）

- 强制两段式：
  - `评价简历`：只读，不改 `resume.typ`
  - `应用简历改写`：才允许 `write_file data/resume.typ`（或副本）并 `typst_compile`
- 应用改写前：
  - 若关键字段缺失（联系方式/教育等），必须 HITL 逐条补齐（沿用既有 SOP 原则）。
- 应用改写后：
  - 必须 `typst_compile`，并在对话中打印 `output/resume.pdf` 路径。

### D4. `workspace/skills/index.md`（修改）

- 增加入口说明：
  - “模拟面试：使用 mock-interview SOP”
  - “简历评价：使用 interviewer SOP；应用改写：使用 resume-mastery SOP”

## E. 最小工程改动（可选项，只有在不稳定时才做）

- （可选）在 MainAgent 的 system prompt 或 skills index 中加强“指令 → SOP”映射（减少模型自由发挥）。
- （可选）在输出中统一打印 `REPORT_PATH=` 与 `PDF_PATH=` 行，便于 UI 解析与跳转（只增不改）。

## F. 验收（必须可回归）

### F1. 人工验收

- 模拟面试：
  - 仅通过 Web/TUI 输入指令即可完成 ≥ 5 轮，并生成 `data/interviews/...`。
  - 每轮输出包含 `Q/Rubric/Follow-up/Takeaway` 四块。
- 简历评价：
  - `评价简历` 生成 `data/resume-review/...`，且标题结构固定。
- 简历改写：
  - `应用简历改写` 才会修改 `data/resume.typ`（或副本）并成功生成 `output/resume.pdf`。

### F2. 自动化验收（建议加单测/轻量集成测）

- 断言 skills 文件存在且包含关键标题/关键约束（字符串断言即可）。
- 断言指令触发时，LLM system prompt 能“看到” skills index（回归：避免引用丢失）。
