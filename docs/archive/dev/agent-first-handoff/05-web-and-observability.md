# Workstream E: Web And Observability

> 历史说明：本文件属于历史交接包，描述的是当时的实现拆分计划，不等同于当前代码状态。

本工作流负责把新的 runtime、delegation 和 memory 能力映射到 Web 控制台。

## 1. 目标

让前端仍然保持“一个主 Agent 对话”的用户体验，同时能看到子 Agent、工具和人工介入的真实状态。

## 2. 交付内容

- 新的 Web runtime 适配
- 会话状态 API
- intervention API
- delegation/event API
- WebSocket 事件消费更新
- 前端观测面更新

## 3. 建议写入范围

- `src/web/**`
- `public/js/**`
- `public/index.html`
- `public/css/**`

## 4. 不应主动改动

- `src/tools/**`
- `src/memory/**`
- `src/domain/**`

## 5. 详细任务

### 5.1 Web Runtime Adapter

- Web 层不再直接操作旧全局 agent registry
- 通过 runtime 获取主 session、delegated runs、interventions

### 5.2 API 调整

保留聊天入口，同时补这些能力：

- 获取主 session 状态
- 获取 delegated runs 列表
- 提交 intervention 输入
- 获取运行中的工具和事件流状态

### 5.3 WebSocket 事件

- 消费新 EventStream
- 处理：
  - `session.state_changed`
  - `session.output_chunk`
  - `delegation.*`
  - `tool.*`
  - `intervention.*`
  - `memory.updated`

### 5.4 前端展示

- 继续以聊天为主
- 增加：
  - 主 Agent 状态
  - 子 Agent 委派轨迹
  - 工具轨迹
  - 等待人工输入状态
  - 最近记忆更新状态

## 6. 实现约束

- 不改变“用户主要面对主 Agent”的产品方向
- 不把 UI 改成任务中心看板
- 但必须增加足够的运行态观测

## 7. 完成标准

- 聊天功能继续可用
- 用户能看到子 Agent 委派和完成
- 用户能处理 pending intervention
- 页面刷新后可恢复当前运行态

## 8. 测试要求

- Web API 契约测试
- WebSocket 事件消费测试
- intervention 端到端测试
- delegated runs 展示测试
- 页面重连/刷新恢复测试

## 9. 验证步骤

1. 打开聊天页
2. 发送一条触发委派的消息
3. 观察子 Agent 轨迹显示
4. 触发人工介入
5. 刷新页面
6. 确认等待状态仍可见并可提交
