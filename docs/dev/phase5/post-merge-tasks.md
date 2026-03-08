# Phase 5 Integration & Post-Merge Tasks 🦞

本文档列出了在 Team A/B/C 三个分支合并到主集成线后，需要进行的“微调”与闭环任务。

---

## 1. 后端集成层 (Server & API)

### 1.1 补齐简历生成端点
- **任务**: 在 `src/web/server.ts` 中实现 `POST /api/resume/build`。
- **逻辑**: 
    - 接收请求后，通过全局 `eventBus` 发送一个自定义事件，或直接调用 `MainAgent` 的 `runEphemeral("生成简历")`。
    - 返回 `{ ok: true }` 以响应前端按钮。

### 1.2 参数容错标准化
- **任务**: 优化 `GET/POST /api/config/:name` 端点。
- **逻辑**: 
    - 检查 `name` 参数是否以 `.md` 结尾。
    - 若无后缀（如 `targets`），则自动补齐为 `targets.md`。
    - 确保后端寻找的文件路径始终固定在 `workspace/data/` 目录下。

### 1.3 统计接口增强
- **任务**: 完善 `GET /api/stats`。
- **逻辑**: 
    - 确保能正确统计 `jobs.md` 中所有可能的状态（discovered, applied, failed, login_required）。
    - 增加缓存机制（可选），避免高频刷新导致的文件 IO 压力。

---

## 2. 工具与 Agent 逻辑增强

### 2.1 Typst 工具安全性补丁
- **任务**: 在 `src/tools/typstCompile.ts` 中，调用 `execFile` 前增加目录写权限预检。
- **逻辑**: 使用 `fs.access(outputDir, fs.constants.W_OK)` 检查，若无权限则返回明确的中文错误信息。

### 2.2 错误引导优化
- **任务**: 拦截 `typst compile` 的原始错误。
- **逻辑**: 针对“字体未找到”等常见报错，在返回给 Agent 的 `content` 中增加操作指引（如：“请检查字体路径是否包含 Noto Sans CJK SC”）。

---

## 3. 前端交互微调 (UI/UX)

### 3.1 异常状态处理
- **任务**: 优化 `public/index.html` 中的 `gen-resume` 逻辑。
- **逻辑**: 增加对 `/api/resume/build` 返回非 200 状态码的处理，弹出简单的错误提示。

### 3.2 空状态视觉
- **任务**: 修正图表渲染。
- **逻辑**: 当 `total: 0` 时，环形图应显示“暂无数据”占位图或默认灰色圆环，避免 Chart.js 报错或空白。

---

## 4. 全链路验收测试 (E2E Validation)

合并完成后，必须按以下流程进行端到端验收：

1.  **启动服务**: `bun run src/index.ts` 并打开浏览器。
2.  **配置校验**: 在 Web 界面编辑 `targets.md`，保存后确认 `workspace/data/targets.md` 已更新。
3.  **日志校验**: 在 TUI 或网页端输入“搜索职位”，确认 WebSocket 能实时推送 `agent:log` 且带有正确着色。
4.  **简历闭环**: 点击“生成简历 PDF”，观察活动流水是否出现“简历已生成”通知，并点击链接下载验证。
5.  **干预校验**: 触发一个需要 `requestIntervention` 的任务（如：润色简历），确认网页端弹出模态框且提交后 Agent 能恢复执行。

---
**负责人**: 集成负责人 (Integration Manager)
**状态**: 待执行 (Pending Merge)
