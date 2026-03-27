# Workstream D: Tools And Capabilities

> 历史说明：本文件属于历史交接包，描述的是当时的实现拆分计划，不等同于当前代码状态。

本工作流负责把工具执行和能力边界从“约定”升级为“runtime 约束”。

## 1. 目标

保留 Agent 使用工具的自由度，但让工具权限、取消语义和高风险能力治理变成真实机制。

## 2. 交付内容

- 统一 tool runtime
- capability policy 实现
- MCP wrapper 重构
- admin tools 隔离
- 真实取消支持

## 3. 建议写入范围

- `src/tools/**`
- `src/infra/mcp/**`
- 为 capability 补充必要类型或适配层

## 4. 不应主动改动

- `src/web/**`
- `src/memory/**`
- `src/domain/**`

## 5. 详细任务

### 5.1 Tool Runtime

- 所有工具统一为结构化输入/输出
- 输出格式至少包含：
  - `ok`
  - `summary`
  - `data`
  - `errorCode`
  - `errorMessage`

### 5.2 Capability Policy

- 按 profile 限制工具
- 按 profile 限制路径读写
- 高风险工具默认不暴露

### 5.3 Shell Tool 隔离

- `run_shell_command` 不再作为默认业务工具
- 迁移到 admin-only 或显式批准路径

### 5.4 MCP Wrapper

- 固化版本策略
- 封装 listTools/callTool/close/health
- 补取消、超时和错误分类

### 5.5 Tool Cancellation

- 工具支持 `AbortSignal`
- 不能只在上层 `Promise.race` 返回超时
- 超时必须尽可能中止底层执行

## 6. 实现约束

- 不允许 profile 绕过 capability 直接调用工具
- 不允许工具层自己假定某个 Agent 一定有权限
- 旧工具可兼容，但要走新 runtime 包装

## 7. 完成标准

- profile 对工具和路径限制生效
- MCP/本地工具/高风险工具具备统一调用接口
- 超时后底层执行能停止或明确上报不可中止

## 8. 测试要求

- capability allow/deny 测试
- shell admin-only 测试
- tool cancellation 测试
- MCP wrapper 错误分类测试
- 本地工具结构化输出测试

## 9. 验证步骤

1. 用 search profile 调用 resume-only 工具
2. 确认被拒绝
3. 触发一个可中止长工具
4. 发送取消
5. 确认工具停止，事件流中出现取消结果
