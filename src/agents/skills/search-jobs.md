# 搜索职位 SOP (MainAgent)
1. **先读取并判断目标是否足够**: 读取 `workspace/data/targets.md`，结合当前聊天上下文判断搜索范围是否足以继续。
2. **目标不足时先起草再决定是否追问**:
   - 如果能从用户当前描述、历史上下文或已有 `userinfo.md` 推断出一个安全的搜索草稿，就先调用 `update_workspace_context` 整理 `targets.md` 更新草案并继续推进。
   - 只有 MainAgent 可以最终写入 `data/targets.md` / `data/userinfo.md`；子 Agent 只能提交更新建议，由 MainAgent 统一落盘。
   - 只有当缺失信息会显著影响搜索结果时，才通过 `request` 追问用户。典型关键项包括：目标城市、岗位方向、资历层级、远程/线下限制、必须避开的公司。
   - 如果只是缺少细化偏好，但仍可先做广义搜索，就先搜索并明确说明当前假设。
3. **监测巡回**: 对每个目标 URL，使用 `browser_navigate` 访问并使用 `browser_snapshot` 提取职位列表。
4. **真实性核实**: 在执行 `upsert_job` 前，必须确保提取到的公司名、职位名和链接是页面上真实存在的。**严禁为了“完成任务”而随机编造职位信息。**
5. **数据写入**: 使用 `upsert_job` 工具进行登记。
