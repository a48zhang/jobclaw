# 工作龙虾 JobClaw 🦀

JobClaw 是一款以 Agent 对话为主入口的自动化求职管家。它采用以 `MainAgent` 为核心、按需派生子任务的多智能体架构，并结合 Model Context Protocol (MCP) 协议，覆盖从职位发现到简历投递的求职链路。

> 🚧 **项目正在积极开发中，非常欢迎提交 PR 或反馈！**

## 🚀 核心功能

- 自动化职位发现：通过 `MainAgent` 配合基于 Playwright 的 MCP 工具，自动搜索招聘网站及公司官网；当 MCP 不可用时，系统会进入明确降级状态，但浏览器相关链路不会伪装为可用。
- 智能职位追踪：后端以 `workspace/state/jobs/jobs.json` 作为结构化事实源，并维护 `workspace/data/jobs.md` 作为可读、可编辑的导入导出视图。
- 简历大师：基于 Typst 模版生成高质量 PDF 简历。Agent 能够根据特定职位描述自动优化简历内容。
- 自动化投递：通过 `run_agent` 工具拉起带 `delivery` skill 的临时子任务，执行表单填写与投递。
- 实时监控看板：
  - Web 控制台：基于 Hono 的界面，支持实时日志流、状态可视化及在线配置编辑。

## 🏗 系统架构

JobClaw 采用主 Agent + 临时子任务模式：
1. MainAgent (主智能体)：系统核心。负责用户主对话、全局调度、上下文资料维护、搜索策略以及何时追问用户。
2. Ephemeral Sub-Agent (临时子任务)：由主 Agent 通过 `run_agent` 按需创建，结合特定 skill 执行投递、简历处理等隔离任务。

运行时公开状态主要落在 `workspace/state/**`；其中 `state/session`、`state/conversation` 和 `state/jobs/jobs.json` 是 Web / Runtime 的正式读模型。`workspace/agents/{agent}/session.json` 仍保留为 Agent 私有 checkpoint，不作为外部接口事实源。

## 🛠 快速上手

```bash
# 安装依赖
npm install

# 建立全局链接
npm link

# 启动 Web 控制台
npm run start
```

## 📋 运行环境

- 运行环境: Node.js 20+
- LLM: 兼容 OpenAI 协议的 API
- 可选依赖: [Typst](https://typst.app/) (用于编译 PDF 简历)
- 可选依赖: Playwright MCP (用于职位搜索与浏览器投递链路)

## 当前运行边界

- 默认入口是 Web 控制台；TUI 仅保留兼容/调试定位，不再是主路径。
- 主路径是 Agent 对话；配置页和资料页是人工覆写 / 校对界面，不是默认起手路径。
- WebSocket 由 runtime event stream 驱动，但对前端继续输出兼容的 `snapshot` / `agent:*` / `intervention:*` 事件。
- MCP 不可用时，系统仍可启动和查看状态，但浏览器搜索与投递能力会被明确降级。

## 致谢

- [OrangeX4/Chinese-Resume-in-Typst](https://github.com/OrangeX4/Chinese-Resume-in-Typst) 简历Typst模板
