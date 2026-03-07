# JobClaw Skills

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
   - **特殊情况**: 若页面需要登录且无法自动完成，调用 `upsert_job` 将状态更新为 `login_required`。
4. **状态更新**: 投递完成后，调用 `upsert_job` 更新状态为 `applied` 或 `failed`。

## 日报汇总 SOP (Daily Digest)
### 场景
当收到指令“分析 jobs.md 中的新增岗位并发送日报汇总”时，执行此 SOP。

### 步骤
1. **数据读取**: 读取 `workspace/data/jobs.md`。
2. **筛选策略**: 筛选出状态为 `discovered` 且日期为“今日”的职位。
3. **内容生成**:
   - 若无新增：回复“今日无新增职位”并结束。
   - 若有新增：撰写一份总结邮件，使用 Markdown 列表展示职位详情，并调用 `channel.send` 发送。
4. **邮件模板建议**:
   - **标题**: `JobClaw 职位日报 - [日期] (共 N 个新机会)`
   - **正文**: 简要开场白 + 职位列表 + 提示用户可以使用 `start delivery` 开始投递。
