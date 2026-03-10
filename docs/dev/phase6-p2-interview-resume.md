# Phase 6 P2：模拟面试 & 简历评价（按产品逻辑的开发计划）

> 重点：这两项能力不是“独立工具”，而是服务于 Job 流水线（发现 → 选择 → 准备 → 投递 → 复盘）。计划只写需要开发的功能切片与验收。

## A. 产品主流程（这阶段要对齐的逻辑）

1. 用户在 Web Dashboard（或 TUI）看到 `jobs.md` 的岗位列表。
2. 用户针对“某一个岗位”做准备：
   - 简历：对该岗位做差距分析 → 给出可应用的改写建议 →（用户确认后）生成/更新简历 PDF。
   - 面试：基于该岗位与用户背景进行多轮模拟面试（含追问），输出可执行的改进点。
3. 以上过程必须做到：
   - “以岗位为中心”：所有输出都必须绑定到某条 job（至少绑定 `url`）。
   - “以交互为中心”：主要产出在 UI 中展示（日志/对话/HITL），不新增额外落盘文件作为交付物。

## B. UI 能力切片（必须做）

### B1. Job 级别操作入口（Web Dashboard）

- 在 job 列表的每一行增加动作（最少 2 个）：
  - `Review Resume`：对该 job 进行简历差距分析与改写建议（只读）
  - `Mock Interview`：对该 job 开始面试回合
- 交互要求：
  - “Review Resume”默认一次性输出结构化报告（见 D2）。
  - “Mock Interview”必须支持多轮：每轮问题 → 用户回答（HITL）→ 追问/下一题（见 D1）。

### B2. Apply Rewrite（可选但建议做）

- 在 “Review Resume” 输出后，提供一个确认入口（按钮或二次确认弹窗）：
  - `Apply Rewrite + Build PDF`
- 约束：必须二次确认后才允许改动 `workspace/data/resume.typ`。

## C. 服务端接口（必须做）

> 不依赖“用户输入指令文本”，由 UI 直接调用接口触发对应任务。

- 新增 REST：
  - `POST /api/jobs/resume/review`（body: `{ url: string }`）
  - `POST /api/jobs/interview/start`（body: `{ url: string }`）
  - （可选）`POST /api/jobs/resume/apply`（body: `{ url: string }`，表示“基于刚刚的建议应用改写并编译”）
- 行为：
  - 通过 `jobs.md` 反查该 `url` 对应行（company/title/status/time）。
  - 构造明确 prompt 传入 `MainAgent.runEphemeral(...)`，并要求：
    - 使用既有 skills（见 D）
    - 输出结构固定（便于 UI 渲染）
    - 需要用户输入时，走 HITL（Dashboard 已有弹窗链路）

## D. Skill 与 Tool 编排（必须做）

### D1. 模拟面试（改 `workspace/skills/interviewer.md` 或新增 `workspace/skills/mock-interview.md`，二选一）

- 绑定 job：必须先读出该 job 的 `{company,title,url}`，并把它写入面试上下文开头（一行即可）。
- 每轮输出结构固定（每轮一块）：
  - `Q:`（问题）
  - `Rubric:`（考察点/优秀回答要点）
  - `Follow-up:`（基于用户回答的 1–2 个追问）
  - `Takeaway:`（可执行改进点）
- 多轮机制：
  - 每轮必须 HITL 收集用户回答（否则无法追问）。
  - 用户输入 `结束` 时立刻结束并输出总结。

### D2. 简历评价（改 `workspace/skills/interviewer.md`）

- 输入读取（必须）：
  - `read_file data/userinfo.md`
  - `read_file data/resume.typ`（不存在则提示用户先生成简历）
- 输出结构固定（顺序固定）：
  1) `## Red Flags (≤3)`
  2) `## JD Gap`
  3) `## Rewrite Suggestions (Copy/Paste Bullets)`
  4) `## Interviewer Questions`
  5) `## Action Items`
- 绑定 job：报告开头必须包含该 job 的 `url`（一行即可）。

### D3. 应用改写 + 编译（改 `workspace/skills/resume-mastery.md`，可选但建议）

- 必须二次确认后才允许：
  - `write_file data/resume.typ`
  - `typst_compile` → `workspace/output/resume.pdf`
- 输出必须包含 PDF 可访问路径（Dashboard 已能静态访问 `/workspace/output/*`）。

## E. 测试与验收（必须可回归）

### E1. 人工验收

- 在 Dashboard job 行点击 `Review Resume`：
  - 输出包含固定 5 个标题
  - 且包含该 job 的 `url`
- 在 Dashboard job 行点击 `Mock Interview`：
  - 完成 ≥ 3 轮（本阶段最低要求），每轮包含 `Q/Rubric/Follow-up/Takeaway`
  - 能通过 HITL 输入回答并触发追问
- （若做 Apply）点击 `Apply Rewrite + Build PDF`：
  - 必须二次确认
  - 生成 `workspace/output/resume.pdf`

### E2. 自动化回归（建议加）

- `src/web/server.ts`：新增接口单测（mock `agentRegistry.get('main')` 与 `runEphemeral` 调用参数，断言 prompt 包含 job url）。
- `workspace/skills/*`：轻量测试（字符串断言）确保输出标题与关键约束存在，防止后续改动破坏结构。
