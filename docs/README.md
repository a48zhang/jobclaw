# JobClaw 文档索引

## 开发规范

- 应当尽力避免单文件过大(超过500行).
- 本阶段开发结束后,应当去掉非必要的注释,保留可读性注释
- 提交代码前应当执行npm test
- 提交代码时需使用英文提交消息,视情况前缀为Plan: Add: Update: Refactor: Fix:等.
- 如有必要,拆分成多个commit,不要一次性提交大量代码
- 做计划不需要列出任何关于工期的内容

## 核心文档

| 文件 | 说明 |
|------|------|
| [SPEC.md](SPEC.md) | 当前系统规格：入口、运行模式、目录结构、配置、Web API、工具与数据流。 |
| [agent-design.md](agent-design.md) | Agent 实现说明：`BaseAgent` 主循环、工具调度、会话持久化、`request` 交互与子 Agent。 |

## 开发文档

| 文件 | 说明 |
|------|------|
| [dev/plan.md](dev/plan.md) | 当前仍未完成或需要继续演进的开发项。 |

## 已知原则

- 默认启动模式是 Web 控制台，不是 TUI。
- 代码中的真实入口是 `src/index.ts -> src/cli/index.ts -> src/tui-runner.ts`。
- `MainAgent` 是当前唯一实际业务 Agent 类型；“子 Agent”通过 `AgentFactory + run_agent` 创建，复用同一套 `MainAgent` 实现。
- 职位数据以 `workspace/data/jobs.md` 为事实来源，结构化写入优先使用 `upsert_job`。
