# JobClaw 技术规格说明书

> 版本: 0.2.0  
> 更新日期: 2026-03-12

---

## 1. 项目概述

**JobClaw** 是一个全自动求职管家 Multi-Agent 系统。

- **MainAgent**: 负责用户交互、职位搜索协调、任务调度及简历制作。
- **DeliveryAgent**: 通过 Playwright MCP 浏览器工具执行自动化表单填写与职位投递。
- **Web Dashboard**: 实时可视化看板，支持 Agent 状态监控、实时日志流及人工干预（HITL）。

---

## 2. 系统架构

```
┌────────────────────────────────────────────────────────────┐
│                        BaseAgent                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    Agent Loop                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                            │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │   LLM Client  │  │     Tools     │  │   MCP Client  │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└────────────────────────────────────────────────────────────┘
                              ▲
                              │ 继承
                 ┌────────────┴────────────┐
                 │                         │
        ┌───────────────┐        ┌───────────────┐
        │  MainAgent    │        │ DeliveryAgent │
        │ (交互+调度)   │        │  (表单投递)   │
        └───────┬───────┘        └───────────────┘
                │ spawnAgent(deliveryAgent, ...)
                └──────串行，共享 MCP 实例──────▶
```

---

## 3. 目录结构

```
jobclaw/
├── src/
│   ├── index.ts             # 交互模式入口（检测 config.json，决定是否 Bootstrap）
│   ├── bootstrap.ts         # Bootstrap 引导流程定义
│   ├── cron.ts              # 定时任务入口（无状态拉起）
│   ├── config.ts            # 配置加载器（支持 config.json 与环境变量）
│   ├── env.ts               # 环境校验与路径预检
│   ├── eventBus.ts          # 全局强类型事件总线 (TypedEventBus)
│   ├── agents/
│   │   ├── base/            # Agent 基座
│   │   │   ├── agent.ts     # 逻辑核心（已重构拆分）
│   │   │   └── agent-utils.ts # 通用辅助（Session/Channel/Skill）
│   │   ├── main/            # 主 Agent 逻辑
│   │   └── delivery/        # 投递 Agent 逻辑
│   ├── tools/               # 智能工具库 (Shell, Typst, File, UpsertJob)
│   ├── web/
│   │   ├── server.ts        # Hono Web 服务器 (REST API + WebSocket)
│   │   └── tui.ts           # Blessed TUI 界面
│   └── channel/             # 通知通道 (Email, TUI)
├── public/                  # 静态前端资源 (Vanilla JS + Tailwind)
├── workspace/               # 工作区目录
│   ├── config.json          # 扁平化全局配置
│   ├── data/                # 业务数据 (jobs.md, userinfo.md, targets.md)
│   ├── agents/              # Agent 私有记忆
│   └── output/              # 产物输出 (resume.pdf)
```

---

## 4. 记忆与配置机制

### 4.1 扁平化配置 (`config.json`)

系统采用扁平化的配置结构，支持环境变量覆盖：

| 配置项 | 环境变量 | 说明 |
| :--- | :--- | :--- |
| `API_KEY` | `OPENAI_API_KEY` | LLM 鉴权密钥 |
| `MODEL_ID` | `MODEL` | 主任务模型 ID |
| `LIGHT_MODEL_ID` | `LIGHT_MODEL` | 轻量模型 ID（可选） |
| `BASE_URL` | `OPENAI_BASE_URL` | API Endpoint (Base URL) |
| `SERVER_PORT` | `SERVER_PORT` | Web 看板端口 (默认 3000) |

### 4.2 记忆压缩

- **机制**: 当 Token 计数超过阈值时，`ContextCompressor` 将历史消息汇总为摘要。
- **保护**: 始终保留 `system` 消息和最近 `N` 条原始消息。

### 4.3 文件锁机制

共享文件（如 `jobs.md`, `targets.md`）由 `lock_file` 工具管理：
- **租约**: 30 秒超时自动释放。
- **粒度**: 文件级互斥锁。

---

## 5. 交互与可视化

### 5.1 Web 看板 (Phase 5)
- **实时流**: 基于 WebSocket 推送 Agent 的 `Think` 和 `Tool` 详细日志。
- **人工干预 (HITL)**: 当 Agent 调用 `request` 工具时，网页弹出实时弹窗供用户输入。
- **配置编辑**: 支持直接在线编辑 Markdown 配置并保存。

### 5.2 TUI 仪表盘
- 针对命令行环境的 Blessed 界面，显示任务统计与活动流水。

---

## 6. 专用工具集

- **`run_shell_command`**: 环境感知工具，自动探测 OS (Windows/Linux/macOS) 和 Shell (Bash/Pwsh)。
- **`typst_compile`**: 智能简历编译，支持环境自愈引导。
- **`upsert_job`**: 原子化职位数据维护，自动触发通知。
- **`read_pdf`**: 读取 PDF 并提取文本（简历/JD），失败时返回明确错误。

---

## 7. 路线图完成度

- [x] **Phase 1-2**: 核心 Agent 循环与 MCP 集成。
- [x] **Phase 3**: 搜索与投递业务闭环。
- [x] **Phase 4**: TUI 交互与系统鲁棒性。
- [x] **Phase 5**: Web 可视化看板、HITL、智能简历制作工具链。
- [ ] **Phase 6**: 高级生产特性（自动化重试、Session 深度管理等）。
