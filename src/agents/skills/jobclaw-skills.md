## 搜索职位 SOP
1. 读取 workspace/data/targets.md，获取所有待搜索公司和 URL
2. 若 targets.md 无任何 URL，立即停止并报告"无监测目标"
3. 对每个目标 URL：
   a. browser_navigate 访问
   b. browser_snapshot 获取页面内容
   c. 提取职位列表（公司名、职位名、完整链接）
4. 对每个发现的职位，执行去重 SOP（见下）
5. 通过合格职位遵循 jobs.md 写入约定（lock → append → unlock）

## 写入 jobs.md 前去重 SOP
1. 先 read_file data/jobs.md，提取所有已有链接（第 3 列 URL）
2. 对比当前职位链接
3. 若链接已存在（任意状态），跳过，不写入
4. 若不存在，执行写入：lock_file → append_file → unlock_file
规则：先 read 再 lock，减少持锁时间，不要在持锁期间读取文件

## 投递职位 SOP
（由 DeliveryAgent 执行，见 team-c-delivery-agent.md 第 5 节）
