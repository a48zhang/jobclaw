# Testing And Validation

> 历史说明：本文件属于历史交接包，描述的是当时的测试拆分计划，不等同于当前代码状态。

本文件是所有工作流共享的测试与验证方案。

## 1. 总体验收目标

系统重构后必须满足：

- 用户仍然通过主 Agent 对话驱动系统
- 主 Agent 可以自由委派
- 子 Agent 真实受限
- 长期事实从消息历史中分离
- 人工介入可持久化和恢复
- Web 层可观测主 Agent、子 Agent、工具和人工介入状态

## 2. 测试层级

### 2.1 单元测试

覆盖：

- runtime 组件
- prompt composer
- profile 权限
- stores
- tool runtime
- exporters

### 2.2 集成测试

覆盖：

- runtime + agent runner
- agent + tool runtime
- delegation manager + event stream
- memory stores + exporters
- web adapter + runtime

### 2.3 端到端测试

覆盖：

- 用户聊天触发搜索委派
- 用户聊天触发简历生成
- 人工介入流程
- 页面刷新后的状态恢复

## 3. 最小测试矩阵

### Runtime

- runtime 创建/关闭
- event 订阅与回放
- intervention timeout
- session 恢复

### Agent

- 主 Agent 正常对话
- 主 Agent 创建子 Agent
- 子 Agent 结果回流
- 子 Agent 取消

### Capability

- profile 工具白名单
- profile 路径白名单
- admin tool 默认拒绝

### Memory

- conversation summary 存取
- user facts 导入
- job facts 导出到 markdown
- intervention 恢复

### Web

- `/api/chat`
- `/api/intervention`
- delegated runs 查询
- WebSocket 事件广播

## 4. 验证场景

### 场景 A: 主 Agent 搜索并委派

1. 用户输入“帮我找后端岗位”
2. 主 Agent 决定创建 `SearchAgent`
3. 事件流出现 `delegation.created`
4. 子 Agent 运行并返回结果
5. 主 Agent 汇总回复用户

验收：

- 子 Agent 生命周期可见
- 结果写入结构化 job store
- `jobs.md` 可导出

### 场景 B: 主 Agent 请求人工补充信息

1. 用户资料不完整
2. 主 Agent 发起 intervention
3. 页面显示等待输入
4. 重启服务
5. 页面刷新后仍能看到 pending intervention
6. 用户提交输入后主 Agent 恢复

验收：

- intervention 可持久化
- 恢复后上下文不丢失

### 场景 C: 子 Agent 权限隔离

1. 创建 `SearchAgent`
2. 尝试调用 delivery-only 工具或写非法路径
3. 系统拒绝

验收：

- 被拒绝的动作有明确事件和错误信息
- 不产生副作用

### 场景 D: 工具取消

1. 触发长时间 MCP 或本地工具调用
2. 发起取消
3. 验证底层执行已停止或明确上报不可中止

验收：

- 不是只在上层返回超时文本
- 系统状态与副作用一致

## 5. 自动化测试建议

- `tests/unit/runtime/**`
- `tests/unit/agents/**`
- `tests/unit/memory/**`
- `tests/unit/tools/**`
- `tests/unit/web/**`
- `tests/e2e/agent-first/**`

## 6. 手工验证清单

- 启动 Web 控制台后仍能正常聊天
- 主 Agent 输出流正常
- 委派轨迹可见
- 工具轨迹可见
- intervention 可提交
- 页面刷新后运行态仍可恢复
- 导出的 `jobs.md` 内容正确
- 无权限动作被拦截

## 7. CI 要求

- TypeScript 编译必须通过
- 单元测试必须通过
- 关键集成测试必须通过
- 至少保留一条主流程 e2e：
  - 聊天
  - 委派
  - intervention
  - 恢复

## 8. 交付时必须附带的证据

每个工作流合并时至少提供：

- 改动说明
- 新增测试列表
- 本地验证步骤
- 已知限制
- 如果修改了共享契约，必须说明变更点
