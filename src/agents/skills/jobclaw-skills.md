# JobClaw Skills

## 系统初始化 SOP (Bootstrap)
1. **收集信息**: 引导用户提供姓名、邮箱、简历链接以及监测目标。
2. **填写文件**: 将信息分别写入 \`data/userinfo.md\` 和 \`data/targets.md\`。
3. **LLM 配置**: 询问用户 OpenAI API Key 和模型 ID。
4. **生成配置**: 将所有配置写入 \`config.json\`。格式示例：
   \`\`\`json
   {
     "llm": {
       "apiKey": "用户的 key",
       "model": "gpt-4o",
       "summaryModel": "gpt-4o-mini"
     },
     "serverPort": 3000
   }
   \`\`\`
5. **结束引导**: 告知用户初始化完成，可以使用 \`run search\` 开始工作。

## 搜索职位 SOP (MainAgent)
1. **读取目标**: 读取 `workspace/data/targets.md`，获取所有待搜索公司和 URL。
2. **监测巡回**: 对每个目标 URL，使用 `browser_navigate` 访问并使用 `browser_snapshot` 提取职位列表（公司、职位名、完整链接）。
3. **数据写入**: 对每个发现的职位，使用 `upsert_job` 工具进行登记。工具会自动处理查重和格式化。
   - `status`: 固定为 `discovered`。

## 投递职位 SOP (DeliveryAgent)
1. **环境检查**: 读取 `workspace/data/userinfo.md` 确认个人信息（姓名、简历等）完整。
2. **任务获取**: 读取 `workspace/data/jobs.md`，筛选出状态为 `discovered` 的职位。
3. **自动化投递**: 对每个待投递职位：
   - 访问 URL，填写表单并提交。
   - **重试机制**: 若因网络波动或偶发错误导致失败，**最多重试 3 次**。
   - **特殊情况**: 若页面需要登录且无法自动完成，调用 \`upsert_job\` 将状态更新为 \`login_required\`。
4. **状态更新**: 投递完成后（或达到重试上限），调用 \`upsert_job\` 更新状态为 \`applied\` 或 \`failed\`。

## 日报汇总 SOP (Daily Digest)
### 场景
当收到指令“分析 jobs.md 中的新增岗位并发送日报汇总”时，执行此 SOP。

### 步骤
1. **数据读取**: 读取 \`workspace/data/jobs.md\`。
2. **筛选策略**: 筛选出状态为 \`discovered\` 且日期为“今日”的职位。
3. **内容生成**:
   - 若无新增：回复“今日无新增职位”并结束。
   - 若有新增：撰写一份总结邮件，使用 Markdown 列表展示职位详情，并调用 \`channel.send\` 发送。
4. **邮件模板建议**:
   - **标题**: \`JobClaw 职位日报 - [日期] (共 N 个新机会)\`
   - **正文**: 简要开场白 + 职位列表 + 提示用户可以使用 \`start delivery\` 开始投递。

## 简历制作技能 SOP (Resume Mastery)
### 场景
当用户要求"生成简历"、"更新简历"或"把项目 X 的描述精简"时，执行此 SOP。

### 步骤
1. **信息读取**: 使用 \`read_file\` 读取 \`data/userinfo.md\`，获取姓名、邮箱、工作经历等个人信息。
2. **准备模板**: 使用 \`read_file\` 读取模板文件作为 Typst 模板基础。若 workspace 中已有 \`data/resume.typ\` 则优先使用。
3. **内容填充**: 根据 \`userinfo.md\` 中的信息，将模板内容写入 \`data/resume.typ\`（使用 \`write_file\` 或 \`append_file\`）。
4. **润色确认**（可选）: 若简历内容有模糊或需优化之处，通过 \`requestIntervention\` 向用户发起询问，例如"项目 A 的描述是否需要精简？"，等待用户确认后再继续。
5. **编译 PDF**: 使用 \`typst_compile\` 工具，传入 \`input_path: "data/resume.typ"\` 进行编译，生成 \`workspace/output/resume.pdf\`。
6. **通知用户**: 编译成功后，告知用户 PDF 已生成在 \`output/resume.pdf\`。

### 注意事项
- 中文字符必须正确渲染；模板已配置多种中文字体回退（Noto Sans CJK SC 等）。
- 若用户要求修改某一部分（如"精简项目 A 描述到 2 行"），使用 \`write_file\` 精确替换对应内容，然后重新调用 \`typst_compile\` 重新编译。
- 生成的 PDF 路径始终为 \`workspace/output/resume.pdf\`。
