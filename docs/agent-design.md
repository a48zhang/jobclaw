# Agent 核心实现方案

## 1. 整体设计

```
┌─────────────────────────────────────────────────────────────┐
│                        BaseAgent                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Tool-Driven Loop                     │   │
│  │   Think → Act (Tool Call) → Observe → Think ...     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │   LLM Client  │  │     Tools     │  │   MCP Client  │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ 继承
                 ┌────────────┴────────────┐
                 │                         │
        ┌───────────────┐        ┌───────────────┐
        │  MainAgent    │        │ DeliveryAgent │
        │ (调度+交互)   │        │  (自动投递)   │
        └───────┬───────┘        └───────────────┘
                │ spawnAgent(deliveryAgent, ...)
                └──────串行，共享 MCP 实例──────▶
```

**双 Agent 协作架构**：
- **MainAgent**：处理用户交互，协调任务流。直接通过 Playwright MCP 搜索职位。
- **DeliveryAgent**：专注表单填写与投递，由主 Agent 派生执行（Ephemeral 模式）。
- **HITL 机制**: 引入 `requestIntervention`，允许 Agent 在关键节点（如简历润色、登录受阻）挂起并请求用户通过 Web/TUI 介入。

---

## 2. 工具系统 (Tools)

**文件**: `src/tools/`

### 2.1 核心工具集

- `read_file` / `write_file` / `append_file`: 基础文件操作，带 10k token 截断保护。
- `lock_file` / `unlock_file`: 共享资源锁，支持 30s 自动释放。
- **`upsert_job`**: 专用职位管理工具，封装了 Markdown 解析、去重、状态更新及 Channel 通知触发。
- **`typst_compile`**: 简历编译工具，支持自动检测环境并引导 `install_typst`。
- **`run_shell_command`**: 环境感知工具，自动注入当前 OS 和 Shell 信息。

---

## 3. BaseAgent 实现

**目录**: `src/agents/base/`

为了保持代码整洁（单文件 < 500行），BaseAgent 已进行重构：

### 3.1 模块拆分

| 模块 | 职责 |
|------|------|
| `agent.ts` | 核心类定义：LLM 主循环 (ReAct)、HITL 挂起逻辑、工具分发逻辑。 |
| `agent-utils.ts` | 辅助函数：Session 读写、Channel 包装、Skill (SOP) 加载、消息初始化。 |
| `context-compressor.ts` | 记忆管理：Token 计算、基于摘要的长对话压缩。 |

### 3.2 运行模式

1. **Persistent (run)**: 加载 session.json，执行完毕后保存状态。用于主交互。
2. **Ephemeral (runEphemeral)**: 临时上下文，不读写磁盘 session。用于子任务或 Cron 自动化。

---

## 4. 具体 Agent 实现

### 4.1 MainAgent

- **职责**: 职位搜索、简历制作、任务调度。
- **SOP 驱动**: 动态加载 `src/agents/skills/index.md` 了解所需技能，并在需要时按需读取对应的具体 SOP（如 `Bootstrap`、`搜索职位`、`简历制作` 等）文件。
- **HITL**: 在简历润色阶段调用 `requestIntervention` 等待用户输入。

### 4.2 DeliveryAgent

- **职责**: 自动投递。
- **触发**: 由 MainAgent 通过 `spawnAgent` 拉起。
- **状态同步**: 投递成功或失败后，通过 `upsert_job` 同步状态至 `jobs.md`，并通过包装后的 Channel 自动发布日志至 EventBus。

---

## 5. 记忆与配置

### 5.1 扁平化配置 (`config.json`)

不再区分 `llm` 子对象，所有配置项在顶层定义：
- `API_KEY`: 密钥。
- `MODEL_ID`: 模型。
- `SUMMARY_MODEL_ID`: 摘要模型。
- `BASE_URL`: API 端点。

### 5.2 目录结构规范

- `workspace/data/`: 共享数据（Markdown 格式）。
- `workspace/agents/{name}/`: Agent 私有 session 和持久化 notebook。
- `workspace/output/`: 编译后的 PDF 简历。
