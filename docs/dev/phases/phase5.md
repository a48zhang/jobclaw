# Phase 5：Web UI

**目标**：实现 `src/web/server.ts` 和前端页面。

### 任务清单

#### 5.1 状态事件总线

- 在 `src/` 下创建 `eventBus.ts`，导出单例 Node.js `EventEmitter`
- 定义事件类型：`agent:state`、`job:update`、`notification`
- BaseAgent 在 `state` 变化时 emit 事件
- Hono 服务器订阅 eventBus，通过 WebSocket 广播给前端

#### 5.2 Hono 服务端（`src/web/server.ts`）

实现以下路由：

| 路由 | 方法 | 功能 |
|------|------|------|
| `/` | GET | 返回仪表盘 HTML |
| `/api/jobs` | GET | 读取 `jobs.md` 并解析返回 JSON |
| `/api/targets` | GET/POST | 读取/写入 `targets.md` |
| `/api/userinfo` | GET/POST | 读取/写入 `userinfo.md` |
| `/ws` | WebSocket | 实时推送 eventBus 事件 |

#### 5.3 前端页面

- 四个页面：仪表盘、岗位列表、目标管理、个人信息
- 使用 Tailwind CSS 和 Alpine.js，无构建步骤
- 仪表盘通过 WebSocket 实时刷新状态

### 验收标准

浏览器访问本地服务，能看到仪表盘实时更新 Agent 状态和最新投递记录。
