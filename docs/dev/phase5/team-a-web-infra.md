# Team A: 后端基础设施与状态集成 (Web Infrastructure)

## 1. 开发任务

### 1.1 状态总线 (EventBus)
- 在 `src/eventBus.ts` 实现一个单例 `EventEmitter`。
- **核心事件声明**:
    - `agent:state`: 载荷 `{ agentName, state }`。
    - `agent:log`: 载荷 `{ agentName, type, message, timestamp }`。
    - `job:updated`: 载荷 `{ company, title, status }`。
    - `intervention:required`: 载荷 `{ agentName, prompt }`。
    - `intervention:resolved`: 载荷 `{ agentName, input }`。

### 1.2 BaseAgent 与入口集成
- 修改 `src/agents/base/agent.ts`:
    - 在 `setState` 中 emit `agent:state`。
    - 拦截所有 `channel.send` 或 `logger` 调用，同步 emit `agent:log`。
    - 在 `requestIntervention` 中 emit `intervention:required`，并监听 `intervention:resolved` 以恢复执行。
- 修改 `src/index.ts`: 启动主循环前并行启动 `startServer()`。

### 1.3 Hono API & WebSocket
- **WebSocket (`/ws`)**:
    - 建立连接时发送当前所有 Agent 的快照状态。
    - 实时转发所有 `eventBus` 事件。
- **REST API**:
    - `POST /api/intervention`: 载荷 `{ input }`。调用后 emit `intervention:resolved`。
    - `GET /api/jobs`: 解析 `jobs.md` 返回结构化数组。
    - `POST /api/config/:name`: 保存 `targets.md` 或 `userinfo.md` (须调用 `lockFile` 确保线程安全)。

## 2. 验收标准
1. 通过浏览器的 WebSocket 调试工具能实时看到 Agent 的 Think/Tool 过程日志。
2. 当 Agent 发起干预请求时，API 能正确接收到前端的回传并让 Agent 继续执行。
3. 并发压力下，文件写入操作不会损坏 Markdown 格式。
