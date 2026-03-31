# 投递职位 SOP (delivery skill)
1. **环境检查**: 读取 `workspace/data/userinfo.md` 确认个人信息（姓名、简历等）完整。
2. **任务获取**: 读取 `workspace/data/jobs.md`，筛选出状态为 `discovered` 的职位。
3. **自动化投递**: 对每个待投递职位：
   - 访问 URL，填写表单并提交。
   - **重试机制**: 若因网络波动或偶发错误导致失败，**最多重试 3 次**。
   - **特殊情况**: 若页面需要登录且无法自动完成，调用 `upsert_job` 将状态更新为 `login_required`。
4. **状态更新**: 投递完成后（或达到重试上限），调用 `upsert_job` 更新状态为 `applied` 或 `failed`。
5. **上下文写入约束**:
   - 不得直接修改 `data/targets.md` 或 `data/userinfo.md`。
   - 如发现这些上下文文档需要补充，只输出建议并交回 MainAgent 统一更新。
