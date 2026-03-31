# 系统初始化 SOP (Bootstrap)
1. **先完成最小运行配置**: 优先确认 `API_KEY`、`MODEL_ID`、`LIGHT_MODEL_ID`（可选）和 `BASE_URL`，让主 Agent 可以开始对话。
2. **整理已知上下文**: 如果用户在初始化时已经给出了姓名、经历、目标岗位、目标城市或公司信息，就优先调用 `update_workspace_context` 把这些信息写入 `data/userinfo.md` / `data/targets.md` 作为初稿。
3. **不要把资料收集做成硬前置表单**: 若用户没有一次性给全信息，不要阻塞启动；保留最小草稿，并在后续聊天中继续补齐。
4. 生成配置: 将配置写入 `config.json`。格式示例：
   ```json
   {
     "API_KEY": "用户的 key",
     "MODEL_ID": "主模型 ID",
     "LIGHT_MODEL_ID": "轻量模型 ID（可选）",
     "BASE_URL": "",
     "SERVER_PORT": 3000
   }
   ```
5. **结束引导**: 告知用户初始化完成，可以直接开始与 Agent 对话；Agent 会在聊天过程中继续补齐 `targets.md` / `userinfo.md`，只在关键信息不足时追问用户。
