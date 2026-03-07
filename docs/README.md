# JobClaw 文档索引

## 开发规范

- 应当尽力避免单文件过大(超过500行).
- 本阶段开发结束后,应当去掉非必要的注释,保留可读性注释
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

### 开发阶段

| 阶段 | 文件 | 内容 |
|------|------|------|
| Phase 0 | [dev/phases/phase0.md](dev/phases/phase0.md) | 项目脚手架 - 环境搭建与目录结构初始化 |
| Phase 1 | [dev/phases/phase1.md](dev/phases/phase1.md) | 类型定义与工具层 - 核心类型与文件/锁工具实现 |
| Phase 2 | [dev/phases/phase2.md](dev/phases/phase2.md) | BaseAgent - ReAct 循环与上下文管理 |
| Phase 3 | [dev/phases/phase3.md](dev/phases/phase3.md) | 具体 Agent 实现 - Main/Search/Delivery Agent |
| Phase 4 | [dev/phases/phase4.md](dev/phases/phase4.md) | Channel 通知 - 邮件通知模块集成 |
| Phase 5 | [dev/phases/phase5.md](dev/phases/phase5.md) | Web UI - 可视化看板与实时推送 |

# 开发进度

| 阶段 | 状态 | 说明 |
|------|------|------|
| Phase 0 | ✅ 完成 | 项目脚手架 - 环境搭建与目录结构初始化 |
| Phase 1 | ⏳ 待开始 | 类型定义与工具层 |
| Phase 2 | ⏳ 待开始 | BaseAgent |
| Phase 3 | ⏳ 待开始 | 具体 Agent 实现 |
| Phase 4 | ⏳ 待开始 | Channel 通知 |
| Phase 5 | ⏳ 待开始 | Web UI |
