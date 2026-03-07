# Phase 0：项目脚手架

**目标**：搭建可运行的空项目骨架。

### 任务清单

- 初始化 Bun + TypeScript 项目，配置 `tsconfig.json`（`moduleResolution: bundler`，`strict: true`）
- 安装依赖：`openai`、`@modelcontextprotocol/sdk`、`gpt-tokenizer`、`hono`、`nodemailer`
- 按 SPEC 3 创建完整目录结构，包括 `src/` 和 `workspace/` 所有子目录
- 创建 `workspace/data/userinfo.md`、`targets.md`、`jobs.md` 空文件
- 创建各 Agent 的 `workspace/agents/{name}/session.json` 初始模板和 `notebook.md` 空文件
- 创建 `.env.example` 包含 SPEC 8 中所有配置项
- `src/index.ts` 作为入口，暂时只打印启动信息

### 验收标准

`bun run src/index.ts` 正常运行不报错。
