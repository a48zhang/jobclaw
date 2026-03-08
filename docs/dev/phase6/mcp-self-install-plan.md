# Agent 环境自愈：基于 Shell 工具的浏览器依赖安装方案 🦞

## 1. 背景
JobClaw 依赖 Playwright 执行自动化操作。在部分 Linux 环境下，环境配置涉及 Node 包、浏览器二进制及系统动态库。

**核心思想**: 充分利用已有的 `run_shell_command` 工具，通过在 SOP（Standard Operating Procedure）中注入环境修复指令，让 Agent 具备自主运维能力，而非开发专用安装工具。

---

## 2. 技术实现路径

### 2.1 工具层优化 (`run_shell_command`)
- **调整**: 为 `run_shell_command` 增加 `timeout` 参数（单位：毫秒）。
- **原因**: 默认的 30s 超时不足以完成浏览器下载。Agent 在执行安装逻辑时，需显式设置超时时间为 `600000` (10分钟)。

### 2.2 诊断与修复 SOP (`jobclaw-skills.md`)
新增“环境故障自愈”章节，包含以下指令逻辑：
1.  **探测阶段**:
    - 如果 MCP 启动失败，执行 `npx playwright --version` 检查安装情况。
    - 如果工具调用提示 `Executable not found`，定位缺失组件。
2.  **修复阶段 (需用户授权)**:
    - 第一步 (Node): `npm install -g @playwright/mcp`
    - 第二步 (Browser): `npx playwright install chromium`
    - 第三步 (Deps): `npx playwright install-deps chromium` (仅限 Linux)
3.  **验证阶段**:
    - 重新运行 `npx playwright --version` 确认修复结果。

### 2.3 交互逻辑
- **识别异常**: Agent 必须能识别 LLM 返回的特定错误（如 MCP Stdio 异常退出）。
- **用户授权**: 在执行 `install-deps` 等可能涉及 `sudo` 或大容量下载的操作前，Agent 必须通过对话明确告知用户后果。

---

## 3. 为什么选择此方案？
1.  **代码零增加**: 无需引入新的工具函数，降低系统维护成本。
2.  **过程透明**: 用户能在 TUI 日志中看到 Agent 运行的每一条 shell 指令，安全性更高。
3.  **自适应性**: Agent 可以根据不同的 Linux 发行版（如 Ubuntu vs Alpine）调整安装指令，比写死的 TS 代码更灵活。

---

## 4. 待办事项 (Action Items)
- [ ] 修改 `src/tools/shell.ts` 支持自定义超时。
- [ ] 在 `src/tools/index.ts` 的工具 Schema 中暴露 `timeout` 参数。
- [ ] 更新 `src/agents/skills/jobclaw-skills.md` 注入环境修复 SOP。

---
**负责人**: Gemini CLI
**状态**: 方案已根据反馈优化 (Approved)
