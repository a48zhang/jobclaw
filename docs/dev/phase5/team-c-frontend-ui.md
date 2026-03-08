# Team C: 可视化前端与交互看板 (Frontend UI)

## 1. 开发任务

### 1.1 静态页面基础设施 (`public/`)
- 基于 **Vanilla JS** + **Tailwind CSS (CDN)**。
- **页面组件与交互**:
    - **Intervention Modal (核心)**: 当监听到 `intervention:required` 事件时弹出。包含 `prompt` 文本和输入框，提交后发送 `POST /api/intervention`。
    - **Dashboard**: 展示实时 Agent 状态 (SSE/WS) 和投递成功率环形图。
    - **Job Table**: 展示职位列表，支持按公司、状态、时间排序。
    - **Markdown Editor**: 支持直接编辑并保存 `targets.md`, `userinfo.md`。保存时显示 "正在锁定文件..."。
    - **Resume Action**: 触发按钮及生成的 PDF 预览。

### 1.2 WebSocket 订阅
- 监听 `/ws` 地址。
- 自动断线重连。
- 接收 `agent:log` 时，将内容按时间倒序展示在“活动流水”中，根据 `type`（info/warn/error）着色。

## 2. 验收标准
1. 在浏览器中打开看板，当 Agent 进入 `waiting` 状态时，网页端应弹出模态框且焦点自动处于输入框内。
2. 网页端编辑 `targets.md` 成功后，Agent 运行日志中应反映出更新后的目标。
3. 即使页面刷新，也能通过 API 拉取到最新的统计数据。
