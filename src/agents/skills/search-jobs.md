# 搜索职位 SOP (MainAgent)
1. **读取目标**: 读取 `workspace/data/targets.md`，获取所有待搜索公司和 URL。
2. **监测巡回**: 对每个目标 URL，使用 `browser_navigate` 访问并使用 `browser_snapshot` 提取职位列表。
3. **真实性核实**: 在执行 `upsert_job` 前，必须确保提取到的公司名、职位名和链接是页面上真实存在的。**严禁为了“完成任务”而随机编造职位信息。**
4. **数据写入**: 使用 `upsert_job` 工具进行登记。