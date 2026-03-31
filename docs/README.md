# JobClaw 文档索引

## 开发规范

- 应当尽力避免单文件过大(超过500行).
- 本阶段开发结束后,应当去掉非必要的注释,保留可读性注释
- 提交代码前应当执行npm test
- 提交代码时需使用英文提交消息,视情况前缀为Plan: Add: Update: Refactor: Fix:等.
- 如有必要,拆分成多个commit,不要一次性提交大量代码
- 做计划不需要列出任何关于工期的内容
- 很可能有人和你同时工作，因此请确保在提交commit时只选择你自己的文件，不要弄坏别人的文件

## 当前事实源

| 文件 | 说明 |
|------|------|
| [SPEC.md](SPEC.md) | 当前系统规格：入口、运行模式、目录结构、配置、Runtime、Web API、工具与数据流。 |
| [agent-design.md](agent-design.md) | 当前 Agent 设计：`BaseAgent`、`ProfileAgent`、`MainAgent`、能力控制与运行协作。 |

## 当前规划与评审

| 文件 | 说明 |
|------|------|
| [dev/plan.md](dev/plan.md) | 当前仍未完成或需要继续演进的开发项。 |
| [agent-first-architecture.md](agent-first-architecture.md) | 面向未来的架构设计文档，不等同于当前代码事实。 |

## 产品文档

| 文件 | 说明 |
|------|------|
| [pm/README.md](pm/README.md) | 产品文档索引。 |
| [pm/product-direction-and-requirements.md](pm/product-direction-and-requirements.md) | 当前阶段要解决的产品问题、需求优先级和阶段目标，已收敛到“Agent 对话优先”的产品原则。 |
| [pm/product-strategy-and-operating-plan.md](pm/product-strategy-and-operating-plan.md) | 聚焦“现在做什么”和“将来做什么”的产品计划，强调聊天入口和 Agent 维护上下文。 |

## 历史文档

| 文件 | 说明 |
|------|------|
| [archive/README.md](archive/README.md) | 历史归档文档入口。 |
| [archive/frontend-ui-review.md](archive/frontend-ui-review.md) | 2026-03-27 的前端问题审查与修复计划，相关项已完成。 |
| [archive/frontend-ui-task-list.md](archive/frontend-ui-task-list.md) | 基于当时前端审查拆出的任务清单，现仅保留历史记录。 |
| [archive/user-logic-review.md](archive/user-logic-review.md) | 2026-03-27 的用户链路审查，部分问题已修复，现仅保留历史结论与遗留启发。 |
| [archive/architecture-refactor-tasks.md](archive/architecture-refactor-tasks.md) | 历史阶段的重构任务清单，不再作为当前执行 backlog。 |
| [archive/dev/agent-first-handoff/README.md](archive/dev/agent-first-handoff/README.md) | 历史交接包入口，反映某次 `agent-first` 重构阶段的切分与问题判断。 |

## 已知原则

- 默认启动模式是 Web 控制台，不是 TUI；TUI 只保留兼容/调试定位。
- 代码中的真实入口是 `src/index.ts -> src/cli/index.ts -> src/tui-runner.ts`。
- `MainAgent` 是用户唯一长期入口；子任务通过 `AgentFactory + run_agent` 按 profile 创建 `ProfileAgent`。
- 主产品入口是 Agent 对话；配置页和资料页用于人工覆写、校对和恢复，不应替代聊天主路径。
- `workspace/data/targets.md` 与 `workspace/data/userinfo.md` 应被视为 Agent 可在对话中持续维护的工作内存，而不是要求用户先手工填完的硬前置表单。
- 职位数据以后端结构化存储 `workspace/state/jobs/jobs.json` 为事实来源；`workspace/data/jobs.md` 是可读、可编辑的导入导出视图。
- `workspace/state/session` 与 `workspace/state/conversation` 是 Runtime / Web 的正式读模型；`workspace/agents/*/session.json` 是 Agent 私有 checkpoint。
- Runtime reload / restart 后，不会伪恢复未完成子任务；系统会把无法继续的 in-flight 状态收敛到可解释终态。
