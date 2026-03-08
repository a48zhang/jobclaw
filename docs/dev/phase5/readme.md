# Phase 5: Web UI & Resume Mastery (智能看板与简历专家)

**目标**：实现基于 Hono 的可视化监控看板，并集成基于 Typst 的智能简历制作技能。

## 1. 任务清单 (Task List)

### 🟢 5.1 Web 基础设施与状态总线
- **EventBus**: 在 `src/eventBus.ts` 实现单例事件总线，捕获 Agent 状态变更与职位更新。
- **Hono Server**: 实现 `src/web/server.ts`，提供静态文件服务与 REST API。
- **实时推送**: 集成 WebSocket 或 SSE，将 `eventBus` 事件实时推送至前端。

### 🔵 5.2 简历制作技能 (Resume-Skill)
- **Typst 工具**: 实现 `src/tools/typstCompile.ts`，封装系统 `typst` 命令。
- **简历模板**: 在 `src/agents/skills/templates/` 引入 `chinese-resume-in-typst` 基础模板。
- **智能 SOP**: 在 `jobclaw-skills.md` 中增加简历制作流程（数据审计、对话润色、编译输出）。

### 🟡 5.3 可视化前端页面 (Web UI)
- **仪表盘**: 实时展示 Agent 状态（idle/running/waiting/error）及投递成功率。
- **岗位管理**: 解析并展示 `jobs.md` 列表，支持状态高亮。
- **配置编辑**: 在线编辑 `targets.md` 和 `userinfo.md`，支持文件锁保护。
- **简历面板**: 提供 `build resume` 触发按钮及生成的 PDF 预览/下载入口。

---

## 2. API 设计 (API Contract)

| 路由 | 方法 | 功能 |
| :--- | :--- | :--- |
| `/api/jobs` | GET | 返回 `jobs.md` 的结构化 JSON |
| `/api/stats` | GET | 返回各状态职位总数统计 |
| `/api/config/:name` | GET/POST | 读取/保存配置文件（支持 targets, userinfo） |
| `/api/resume/build` | POST | 触发 Agent 执行简历编译流程 |
| `/ws` | WS | 实时推送 Agent 活动日志与状态 |

---

## 3. 验收标准 (Definition of Done)
1. 浏览器访问主页能实时看到 TUI 模式下的所有统计信息。
2. 用户在网页端修改 `targets.md` 后，Agent 下次运行能读取到新目标。
3. 点击“生成简历”后，系统能调用 `typst` 正确在 `workspace/output/` 生成 PDF。
