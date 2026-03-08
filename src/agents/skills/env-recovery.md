# 环境故障自愈 (Browser/MCP)
### 场景
当调用浏览器工具（如 `browser_navigate`）失败，提示“可执行文件未找到”、“环境缺失”或 MCP 服务启动失败时，执行此 SOP。

### 步骤
1. **环境诊断**: 使用 `run_shell_command` 执行 `npx playwright --version` 确认 Playwright 是否安装。
2. **向用户解释**: 向用户详细说明缺失的组件（Playwright 浏览器或系统依赖库）及其对任务的影响。
3. **获取授权**: 询问用户：“检测到当前环境缺少必要的浏览器组件，是否允许我为您执行全自动环境配置？（约占用 500MB 空间）”。
4. **执行修复 (需用户确认后)**:
   - 使用 `run_shell_command` 依次执行以下指令，并设置 `timeout: 600000` (10分钟)：
     - `npx playwright install chromium` (安装浏览器)
     - `npx playwright install-deps chromium` (安装系统库，仅限 Linux)
5. **验证与恢复**: 修复完成后，重新尝试之前的浏览器操作。

### 注意事项
- 在非 Linux 环境下无需执行 `install-deps`。
- 始终通过 `run_shell_command` 的输出确认安装进度。
- 若安装过程中遇到权限问题（如需 sudo），及时告知用户。