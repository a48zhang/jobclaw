# 架构重构任务清单（历史归档）

> 生成时间：2026-03-27  
> 当前状态：历史文档，不再作为当前执行 backlog  
> 当前参考：`docs/dev/plan.md`、`docs/SPEC.md`、`docs/agent-design.md`

## 1. 文档定位

本文件原本用于在一次大规模架构重构前，尽可能完整地枚举潜在改造点。

它的特点是：

- 覆盖面很大
- 任务颗粒度偏架构理想态
- 同时混合了“当前必须做”和“未来可能做”

随着后续代码推进，这份清单已经不适合作为当前 backlog，因为其中很多事项：

- 已经部分落地
- 暂时不做
- 或被更小、更贴近现状的计划文档替代

## 2. 它记录过哪些方向

这份历史清单主要覆盖过以下主题：

- Runtime 内核收口
- 任务模型重建
- Use case 分层
- 结构化存储与事实源
- Tool runtime 和 capability
- Web 与可观测性
- MCP 与浏览器自动化
- 配置与环境治理

这些主题今天仍然有参考价值，但不应再直接照单执行。

## 3. 为什么不再作为当前计划

主要原因有三点：

1. 其中不少问题已经在当前代码中有了第一版实现，例如 runtime、profile、capability、memory、web adapter。
2. 它没有区分“当前代码事实”和“未来理想形态”，容易把设计目标误读成已确认路线。
3. 作为执行清单过大过散，不适合当前知识库继续保留为主计划文档。

## 4. 当前应使用的文档

如果要看当前架构与计划，请优先阅读：

- `docs/SPEC.md`
- `docs/agent-design.md`
- `docs/dev/plan.md`
- `docs/agent-first-architecture.md`

其中：

- `SPEC.md` 记录当前代码事实
- `agent-design.md` 记录当前 Agent 设计
- `dev/plan.md` 记录当前仍需推进的事项
- `agent-first-architecture.md` 记录偏未来的设计方向

## 5. 一句话结论

这份文档保留为历史参考，但不再代表“现在应该做什么”。
