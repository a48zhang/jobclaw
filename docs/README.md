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
| [SPEC.md](SPEC.md) | 技术规格说明书 - 系统架构、目录结构、多 Agent 架构、记忆机制等 |
| [agent-design.md](agent-design.md) | Agent 核心实现方案 - 类型定义、工具层、BaseAgent 及子类实现细节 |

## 开发文档

| 文件 | 说明 |
|------|------|
| [dev/plan.md](dev/plan.md) | 开发计划总览与阶段依赖关系 |
| [dev/phase6-p2-interview-resume.md](dev/phase6-p2-interview-resume.md) | Phase 6 P2 重点计划：模拟面试与简历评价 |

> 说明：历史 Phase 分拆文档已收敛整合到 `dev/plan.md`，避免多文件重复与失同步。
