# Agent-First 开发交接包

> 历史说明：本目录反映一次 `agent-first` 重构阶段的并行交接方案与当时的问题判断。  
> 其中的切分方式、阻塞项和阶段计划不再代表当前代码现状。  
> 当前事实源请优先参考 `docs/SPEC.md`、`docs/agent-design.md`、`docs/dev/plan.md`。

本目录用于把 `docs/agent-first-architecture.md` 细化成可直接移交给多个 Agent 并行开发的工程文档。

目标：

- 保持 `agent-first` 方向，不把产品改造成强任务化系统
- 明确模块边界、并行切分方式、文件所有权和集成顺序
- 让不同 Agent 可以在低冲突前提下同时开发
- 为每条工作流提供测试与验证标准

## 1. 交接原则

- 用户始终面对一个长期会话的主 Agent
- 子 Agent 是受限角色，不是另一个全权限 `MainAgent`
- Runtime 负责能力边界、状态、恢复、人工介入和观测
- 结构化数据是事实源，Markdown 是可读视图
- 所有并行开发以 `00-shared-contracts.md` 为准

## 2. 文档清单

- `00-shared-contracts.md`
  - 全局接口、事件、目录和边界约定
- `01-runtime-foundation.md`
  - RuntimeKernel、EventStream、InterventionManager、SessionStore
- `02-agent-runtime-and-delegation.md`
  - BaseAgentRunner、PromptComposer、Profile、DelegationManager
- `03-memory-and-data.md`
  - MemorySystem、结构化存储、Markdown exporter
- `04-tools-and-capabilities.md`
  - Tool runtime、capability policy、MCP、admin tools
- `05-web-and-observability.md`
  - Web API、WebSocket、前端观测面、事件消费
- `06-testing-and-validation.md`
  - 统一测试矩阵、集成验证、回归要求
- `07-program-status-and-execution-plan.md`
  - 团队负责人视角的现状判断、问题总表、推进流程、阶段计划和合并门禁

## 3. 并行切分

### Agent A: Runtime Foundation

- 文档：`01-runtime-foundation.md`
- 主要写入范围：
  - `src/runtime/**`
  - `src/interfaces/cli/**` 或现有入口适配层
  - `src/interfaces/cron/**` 或现有入口适配层
- 不应主动改动：
  - `src/agents/**`
  - `src/tools/**`
  - `src/web/**`

### Agent B: Agent Runtime And Delegation

- 文档：`02-agent-runtime-and-delegation.md`
- 主要写入范围：
  - `src/agents/**`
- 可只读依赖：
  - `src/runtime/**`
  - `src/memory/**`
- 不应主动改动：
  - `src/web/**`
  - `src/tools/**`

### Agent C: Memory And Data

- 文档：`03-memory-and-data.md`
- 主要写入范围：
  - `src/memory/**`
  - `src/domain/**`
  - `src/infra/store/**`
  - `src/infra/workspace/**`
- 不应主动改动：
  - `src/agents/**`
  - `src/web/**`

### Agent D: Tools And Capabilities

- 文档：`04-tools-and-capabilities.md`
- 主要写入范围：
  - `src/tools/**`
  - `src/infra/mcp/**`
  - `src/runtime/capability-types.ts` 如需补充类型
- 不应主动改动：
  - `src/web/**`
  - `src/memory/**`

### Agent E: Web And Observability

- 文档：`05-web-and-observability.md`
- 主要写入范围：
  - `src/web/**`
  - `public/js/**`
  - `public/index.html`
  - `public/css/**`
- 不应主动改动：
  - `src/tools/**`
  - `src/memory/**`

### Agent F: QA And Validation

- 文档：`06-testing-and-validation.md`
- 主要写入范围：
  - `tests/**`
  - `scripts/test.sh`
  - 必要的 test fixtures
- 允许少量适配：
  - 为了测试注入点补极少量非业务性代码

## 4. 依赖关系

### 先行契约

以下内容必须先稳定，再进行并行开发：

- `00-shared-contracts.md` 中的核心接口命名
- 事件名
- 目录结构
- capability 和 profile 概念

### 并行关系

- Agent A、B、C、D、E 都可以基于共享契约并行开始
- Agent F 可以先搭测试骨架，再在其他流合并后补全

### 集成顺序

1. A Runtime Foundation
2. C Memory And Data
3. D Tools And Capabilities
4. B Agent Runtime And Delegation
5. E Web And Observability
6. F QA And Validation

## 5. 合并规则

- 每个 Agent 先完成自己文档中列出的最小闭环
- 合并前必须对照 `06-testing-and-validation.md` 自检
- 若需要变更共享契约，必须同步修改 `00-shared-contracts.md`
- 若跨工作流修改不可避免，优先新增适配层，不要直接侵入别人的新模块

## 6. Definition Of Done

以下条件同时满足，才视为本轮架构重构完成：

- 主 Agent 仍然是用户唯一入口
- 子 Agent 通过 profile 和 capability 真实受限
- 长期事实不再只存在于消息历史和 Markdown
- 人工介入可持久化并支持恢复
- 所有关键动作可观测、可追踪
- Web 层能展示主 Agent、子 Agent、工具和人工介入状态
- 测试覆盖新的 runtime、memory、delegation 和 event 流
