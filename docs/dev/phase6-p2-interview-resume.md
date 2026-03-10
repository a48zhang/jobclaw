# Phase 6 P2：模拟面试 & 简历评价（按产品逻辑的开发计划）

> 前提：用户与 Agent 的交互是自然语言；Agent 自己决策加载哪些 skill、调用哪些 tool；开发重点是“把决策做得稳定、可控、可复用”，而不是做固定的入口/按钮/输出模板。

## A. 产品逻辑（要实现的用户体验）

用户只需要表达意图，例如：
- “帮我准备这个岗位的面试”
- “我的简历适配这个岗位吗？帮我改到能投”

系统行为（核心）：
1) Agent 先确认目标（岗位/级别/偏好），缺信息就 HITL 问最少的问题。
2) Agent 自动选择合适的 skill（例如 `interviewer` / `resume-mastery` / 未来的 `mock-interview`），并按 skill 指导调用 tool。
3) 过程与结果直接在 UI（Web/TUI）对话/日志里呈现；不强制用户学指令，也不要求固定输出格式。

## B. 这阶段真正需要开发的东西

### B1. Skill 选择（已具备，不是本阶段重点）

当前已实现的产品逻辑基础：
- MainAgent system prompt 已内嵌 skills index（`src/agents/main/index.ts`）。
- skills index 已明确要求：复杂任务先 `read_file` 对应 SOP（`workspace/skills/index.md` / `src/agents/skills/index.md`）。

本阶段不再围绕“如何让 Agent 看到/选择 skill”做工程投入，重点转向下面两个能力本身的 SOP 完整度与多轮交互体验。

### B2. “简历评价 → 改写 → 编译”闭环（必须）

目标：用户说“帮我把简历改到更适配这个岗位”，Agent 能自主把工作拆成两步并拿到可用 PDF。

开发任务：
- 升级 `workspace/skills/interviewer.md`（“评价”）：
  - 明确输入来源优先级：`data/resume.typ`（优先）→ 否则引导先生成简历。
  - 明确输出要求：必须给“可直接改写的内容”（例如可粘贴的 bullets / 替换段落），而不是停留在点评层面。
  - 明确交接条件：当用户表示“按建议改写并生成 PDF”，进入 `resume-mastery`。
- 升级 `workspace/skills/resume-mastery.md`（“应用改写 + 编译”）：
  - 增加“应用改写”步骤：把改写落到 `data/resume.typ`，然后 `typst_compile` 产出 PDF。
  - 保持现有的逐步 HITL 收集信息原则（缺关键信息就问，不要一次要一堆）。

### B3. “模拟面试（多轮追问）”能力（必须）

目标：用户说“模拟面试”，Agent 能多轮追问并根据回答动态调整。

开发任务（二选一，推荐新增以避免污染 interviewer）：
- 新增 `workspace/skills/mock-interview.md`：
  - 明确每轮必须 HITL 收集回答，否则无法追问。
  - 明确“终止条件”：用户说结束/时间到/达到轮次上限。
  - 明确“质量杠杆”：每轮至少包含一个追问，且追问必须引用用户上一轮回答中的具体点（避免泛问）。
- 或者扩展 `workspace/skills/interviewer.md` 增加面试模式（不推荐，易混淆职责）。

## C. 工程边界（这阶段不做什么）

- 不新增专用 REST 入口来触发这些能力（仍走现有 chat/HITL 流）。
- 不要求固定输出模板；只要求“包含必要信息并可执行”，并能触发下一步 skill（例如从评价到改写）。
- 不新增强制落盘的“报告文件”作为交付物（可以落盘作为实现手段，但不作为产品依赖）。

## D. 验收（必须能看出来做到了）

### D1. 人工验收场景

1) 简历改写闭环：
   - 用户表达“针对某岗位优化简历”
   - Agent 主动选择 `interviewer` → 给出可应用建议 → 用户确认后切换 `resume-mastery` → 产出 `output/resume.pdf`
2) 模拟面试：
   - 用户表达“模拟面试某岗位”
   - Agent 主动选择 `mock-interview`（或 interviewer 的面试模式）并完成多轮追问（至少 3 轮）

### D2. 可观测性验收

- 在 Web/TUI 的日志中能看到 Agent 选择了哪些 skill（至少能看到 skill 名称），方便定位“为什么走了这条路径”。
