# Phase 6 P2：模拟面试 & 简历评价（Skill + Tool 组合落地计划）

> 重点：不新增复杂系统，优先通过“Skill SOP + 现有工具(read/write/typst/HITL) + workspace 文件产物”直接做出可用闭环。

## 1. 为什么不用“新 Agent/新协议”

- 入口已具备：Web `POST /api/chat` 与 TUI `onCommand` 都会触发 `MainAgent.runEphemeral(...)`。
- 技能已具备：
  - 简历评价视角：`workspace/skills/interviewer.md`
  - 简历生成/改写链路：`workspace/skills/resume-mastery.md`
- 工具已具备：`read_file` / `write_file` / `append_file` / `typst_compile` / HITL（`requestIntervention`）。

结论：下一阶段重点应该是“把 SOP 固化成可重复执行的流程 + 可复盘产物 + 最小指令约定”，而不是先写新框架。

## 2. 指令约定（用户可以直接用）

> 先做到“无 UI 改动也能用”：用户在 Web/TUI 直接输入这些指令即可。

### 2.1 模拟面试

- `开始模拟面试：<目标岗位>；<级别>；<方向>`  
  示例：`开始模拟面试：后端 Go；mid；系统设计+并发`

### 2.2 简历评价（只读）

- `评价简历：<目标岗位>`  
  示例：`评价简历：资深前端工程师（React）`

### 2.3 应用改写（会改文件 + 编译）

- `应用简历改写：基于上一份评价，把改写落到 resume.typ 并编译`  
  - 默认覆盖：`workspace/data/resume.typ`
  - 编译产物：`workspace/output/resume.pdf`

## 3. 计划产物（全部写回 workspace，保证可复盘）

- 模拟面试记录：`workspace/data/interviews/<timestamp>-<role>.md`
- 简历评价报告：`workspace/data/resume-review/<timestamp>-<role>.md`
- （可选）保留改写副本：`workspace/data/resume.<timestamp>.typ`（避免覆盖；由指令控制）

## 4. 需要补齐/强化的 Skill（核心工作量在 SOP，不在代码）

### 4.1 新增一个“模拟面试” SOP（计划）

- 新文件：`workspace/skills/mock-interview.md`
- 内容要点（必须“可落地 + 可复盘”）：
  - 先 `read_file data/userinfo.md` 获取背景；如果没写目标岗位，必须 HITL 追问（一次只问 1–2 个关键点）。
  - 生成面试大纲：维度（项目/基础/系统设计/行为）+ 每维 2–3 题。
  - 每轮必须输出固定结构（便于回归与渲染）：
    - `Q:` 问题
    - `What I’m testing:` 考察点
    - `Follow-up:`（基于用户回答给 1–2 个追问）
    - `Takeaway:` 如何回答更好（可直接复述的要点）
  - 结束时写入报告文件（`write_file`）。

### 4.2 固化“简历评价”输出模板（计划）

对 `workspace/skills/interviewer.md` 的补强方向：
- 不把输出写成“泛泛点评”，而是严格固定为：
  - `[Red Flags ≤ 3]`
  - `[JD 对齐差距]`（关键词缺口清单）
  - `[逐段改写建议]`（可直接粘贴的 bullets，尽量给定量化结构）
  - `[面试官必问]`（基于简历内容的追问清单）
  - `[Action Items]`（按优先级的可执行清单）
- 评价完成后必须 `write_file` 一份报告到 `workspace/data/resume-review/...`。

### 4.3 强化“应用改写”的两段式确认（计划）

对 `workspace/skills/resume-mastery.md` 的补强方向：
- “评价”阶段不改文件；“应用改写”阶段才改 `resume.typ`。
- 应用改写前，如果缺失关键字段（联系方式/教育等），应 HITL 逐条补齐（符合已有 SOP 原则）。
- 改写落盘后必须 `typst_compile`，并在输出中明确 `output/resume.pdf` 路径。

## 5. Tool 编排（把 SOP 变成可预测行为）

> 不改代码也能先落地；后续如需更强的确定性，再加“指令路由”。

### 5.1 模拟面试（推荐编排）

1. `read_file data/userinfo.md`
2. （可选）`read_file data/targets.md` / `data/jobs.md`（补齐岗位信息）
3. HITL 获取目标岗位/级别/方向（缺啥问啥）
4. 多轮问答（每轮固定结构输出）
5. `write_file data/interviews/...` 保存记录与复盘

### 5.2 简历评价（推荐编排）

1. `read_file data/userinfo.md`
2. `read_file data/resume.typ`（优先）或提示 `resume.pdf` 路径存在
3. 生成固定模板报告
4. `write_file data/resume-review/...` 保存报告

### 5.3 应用改写（推荐编排）

1. `read_file data/resume-review/<latest>.md`（或由用户指定要应用哪份）
2. `read_file data/resume.typ`
3. `write_file data/resume.typ`（或写副本）
4. `typst_compile` 生成 `workspace/output/resume.pdf`

## 6. 最小工程改动（可选，但能显著提升可用性）

> 这部分只做“锦上添花”，不应成为阻塞项。

- （可选）在 `workspace/skills/index.md` 增加 `mock-interview` 的入口说明，提升模型选择 SOP 的稳定性。
- （可选）增加一个“latest review file” 约定：评价完后在日志中打印报告路径，应用改写默认使用该路径（无需新增存储层）。

## 7. 验收标准（更贴近 Skill + Tool）

### 7.1 模拟面试

- 用户仅通过 `POST /api/chat` 或 TUI 输入即可完成 ≥ 5 轮问答。
- 每轮输出包含固定字段（`Q/What I’m testing/Follow-up/Takeaway`）。
- 结束后能在 `workspace/data/interviews/...` 找到复盘文件，且内容结构稳定。

### 7.2 简历评价 + 改写

- `评价简历` 不修改 `resume.typ`，只产出报告文件。
- `应用简历改写` 才会修改 `resume.typ`（或副本）并触发 `typst_compile`。
- 编译成功后产出 `workspace/output/resume.pdf`，并在日志中提示路径。
