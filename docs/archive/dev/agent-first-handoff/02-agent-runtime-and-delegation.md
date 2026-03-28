# Workstream B: Agent Runtime And Delegation

> 历史说明：本文件属于历史交接包，描述的是当时的实现拆分计划，不等同于当前代码状态。

本工作流负责让 Agent 从“大一统 `MainAgent`”演化成“主 Agent + 受限 profile + 委派管理”。

## 1. 目标

保留主 Agent 的对话自由度，但让子 Agent 变成真实存在的受限角色。

## 2. 交付内容

- `BaseAgentRunner`
- `PromptComposer`
- `MemoryInjector`
- `MainAgentProfile`
- `SearchAgentProfile`
- `DeliveryAgentProfile`
- `ResumeAgentProfile`
- `ReviewAgentProfile`
- `DelegationManager`

## 3. 建议写入范围

- `src/agents/**`

## 4. 不应主动改动

- `src/web/**`
- `src/tools/**`
- `src/memory/**`

## 5. 详细任务

### 5.1 BaseAgentRunner

- 只保留通用 LLM loop
- 接受 profile、memory snapshot、tool runtime、event emitter
- 移除对具体业务的硬编码

### 5.2 PromptComposer

- 将 prompt 拆成：
  - policy
  - profile
  - skills
  - memory
  - current context
- 允许按 profile 组装

### 5.3 Profile 定义

- 每个 profile 都要声明：
  - allowed tools
  - readable roots
  - writable roots
  - allow browser
  - allow notifications
  - allow admin tools
  - allow delegation to

### 5.4 DelegationManager

- 主 Agent 可创建子 Agent
- 子 Agent 运行结果要回流到主 Agent
- 子 Agent 生命周期进入统一 EventStream
- 子 Agent 可取消

### 5.5 MainAgent 迁移

- 旧 `MainAgent` 保留兼容层
- 逐步迁移到新的 profile/runner 组合
- 不再允许 `run_agent` 默认创建全权限 `MainAgent`

## 6. 实现约束

- profile 是 runtime 约束，不是纯 prompt 文本
- 主 Agent 可以自由决定何时委派
- 子 Agent 不能默认继承主 Agent 的全部工具和写权限

## 7. 完成标准

- 主 Agent 能继续自然语言对话
- 主 Agent 能委派给受限 profile
- 子 Agent 的事件可见
- 子 Agent 的权限边界可验证

## 8. 测试要求

- `PromptComposer` 组合测试
- profile 工具白名单测试
- 主 Agent 委派创建测试
- 子 Agent 结果回流测试
- 子 Agent 取消测试

## 9. 验证步骤

1. 创建主 Agent session
2. 触发一次搜索委派
3. 确认生成 `delegatedRun`
4. 确认事件流能看到创建、执行、完成
5. 确认搜索子 Agent 无法调用 delivery-only 工具
