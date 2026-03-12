# 工作龙虾 JobClaw 🦀

JobClaw 是一款基于 AI 的自动化求职管家。它采用多智能体（Multi-Agent）架构，并结合 Model Context Protocol (MCP) 协议，旨在全自动执行从职位发现到简历投递的求职全生命周期。

> 🚧 **项目正在积极开发中，非常欢迎提交 PR 或反馈！**

## 🚀 核心功能

- 自动化职位发现：通过 `MainAgent` 配合基于 Playwright 的 MCP 工具，自动搜索招聘网站及公司官网。
- 智能职位追踪：自动维护 `workspace/data/jobs.md`，实现职位去重、状态更新（已发现、已投递、已拒绝等）及变更通知。
- 简历大师：基于 Typst 模版生成高质量 PDF 简历。Agent 能够根据特定职位描述自动优化简历内容。
- 自动化投递：专用的 `DeliveryAgent` 负责执行复杂的表单填写与投递操作，自主导航各类招聘门户，帮你免去在各种网页填写应聘表格的烦恼。
- 实时监控看板：
  - TUI 仪表盘：适用于终端环境的轻量级 Blessed 界面。
  - Web 控制台：基于 Hono 的现代 Web 界面，支持实时日志流、状态可视化及在线配置编辑。

## 🏗 系统架构

JobClaw 采用双 Agent 协作模式：
1. MainAgent (主智能体)：系统核心。负责全局调度、职位搜索策略及用户职业数据维护。
2. DeliveryAgent (投递智能体)：临时专家。由主智能体派生，专注于执行高精度的浏览器自动化操作，帮你进行岗位投递。

所有业务数据均以易读的 Markdown 格式存储在 `workspace/` 目录中，确保透明度与可审计性。

## 🛠 快速上手

```bash
# 安装依赖
npm install

# 建立全局链接
npm link

# 启动助手
npm run dev
```

## 📋 运行环境

- 运行环境: Node.js 20+
- LLM: 兼容 OpenAI 协议的 API
- 可选依赖: [Typst](https://typst.app/) (用于编译 PDF 简历)

## 致谢

- [OrangeX4/Chinese-Resume-in-Typst](https://github.com/OrangeX4/Chinese-Resume-in-Typst) 简历Typst模板
