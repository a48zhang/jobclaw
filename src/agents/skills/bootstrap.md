# 系统初始化 SOP (Bootstrap)
1. **收集信息**: 引导用户提供姓名、邮箱、简历链接以及监测目标。
2. **填写文件**: 将信息分别写入 `data/userinfo.md` 和 `data/targets.md`。
3. LLM 配置: 询问用户 API_KEY、MODEL_ID 和 BASE_URL。
4. 生成配置: 将所有配置写入 `config.json`。格式示例：
   ```json
   {
     "API_KEY": "用户的 key",
     "MODEL_ID": "主模型 ID",
     "SUMMARY_MODEL_ID": "压缩模型 ID",
     "BASE_URL": "https://api.openai.com/v1",
     "SERVER_PORT": 3000
   }
   ```
5. **结束引导**: 告知用户初始化完成，可以使用 `run search` 开始工作。