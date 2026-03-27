# Workstream A: Runtime Foundation

> 历史说明：本文件属于历史交接包，描述的是当时的实现拆分计划，不等同于当前代码状态。

本工作流负责建立新的 runtime 底座。

## 1. 目标

把当前散落在模块级全局变量里的运行时状态，收敛成可实例化、可替换、可测试的 runtime。

## 2. 交付内容

- `RuntimeKernel`
- `EventStream`
- `InterventionManager`
- `SessionStore`
- Runtime bootstrap 适配层

## 3. 建议写入范围

- `src/runtime/**`
- `src/index.ts`
- `src/cli/**`
- `src/cron.ts`
- 必要的启动适配层

## 4. 不应主动改动

- `src/agents/**`
- `src/tools/**`
- `src/web/**`
- `src/memory/**`

## 5. 详细任务

### 5.1 RuntimeKernel

- 创建 `RuntimeKernel`
- 负责组装 EventStream、stores、capability policy、delegation manager、MCP client
- 提供 `start()`、`shutdown()`、`reloadConfig()` 接口

### 5.2 EventStream

- 替代当前进程级单例 `eventBus`
- 支持订阅、取消订阅、事件回放接口
- 所有事件遵守 `00-shared-contracts.md`

### 5.3 InterventionManager

- 统一接收人工介入请求
- 维护 pending/resolved/timeout 状态
- 不允许只靠内存 Promise 保存等待状态

### 5.4 SessionStore

- 存取 `AgentSession`
- 提供按 `sessionId` 读取、保存、更新状态接口
- 允许未来切换存储实现

### 5.5 Bootstrap 适配

- 旧入口可以继续存在
- 但入口只负责创建 runtime，不再自行拼接全局对象

## 6. 实现约束

- 所有 runtime 组件必须是显式依赖注入
- 不要新增新的模块级单例
- 不直接依赖旧 `MainAgent` 的内部状态结构

## 7. 完成标准

- 可以创建一个 runtime 实例并显式关闭
- 人工介入请求可通过 manager 管理
- event 不再必须依赖旧全局总线
- CLI/Web/Cron 都能通过 runtime 获取依赖

## 8. 测试要求

- `RuntimeKernel` 生命周期测试
- `EventStream` 订阅/取消订阅/事件顺序测试
- `InterventionManager` pending/resolved/timeout 测试
- `SessionStore` 持久化与恢复测试

## 9. 验证步骤

1. 创建 runtime
2. 注册一个假订阅者
3. 发出一条 intervention request
4. 持久化 session
5. 关闭 runtime
6. 重启 runtime 并确认状态仍可恢复
