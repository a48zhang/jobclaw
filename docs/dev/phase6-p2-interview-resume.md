# Phase 6 P2：模拟面试 & 简历评价（开发计划）

## 1) Resume：评价 → 改写 → 编译（必须）

- 改 `workspace/skills/interviewer.md`
  - `data/resume.typ` 不存在时：引导先生成简历（不要继续瞎评）
  - 输出必须包含“可直接应用的改写内容”（可粘贴 bullets/替换段落）
  - 用户确认“按建议改写并生成 PDF”时：明确切到 `resume-mastery`
- 改 `workspace/skills/resume-mastery.md`
  - 增加“应用改写”步骤：把改写写入 `data/resume.typ`
  - `typst_compile` 生成 `output/resume.pdf`
  - 信息缺失继续按现有 HITL 原则逐步问

## 2) Mock interview：多轮追问（必须）

- 新增 `workspace/skills/mock-interview.md`（推荐）
  - 每轮必须 HITL 收集回答
  - 每轮至少 1 个追问，且追问必须引用上一轮回答的具体点
  - 终止条件：用户说结束 / 达到轮次上限
- 或扩展 `workspace/skills/interviewer.md` 增加面试模式（不推荐）

## 3) 验收（必须）

- 简历闭环：用户表达“针对岗位优化简历”→ 最终拿到 `output/resume.pdf`
- 模拟面试：用户表达“模拟面试”→ 完成 ≥ 3 轮（问题→回答→追问）
