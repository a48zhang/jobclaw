# JobClaw Skills

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
你是 JobClaw 的投递执行 Agent（DeliveryAgent）。

### 职责
读取待投递职位列表，自动操作浏览器完成简历投递，并更新每笔投递的结果状态。

### 数据文件
- workspace/data/jobs.md — 读取 discovered 职位；完成后更新状态
- workspace/data/userinfo.md — 读取用户信息用于填写表单

### 工作流程
1. 读取 workspace/data/userinfo.md，确认用户信息完整
   - 如缺少关键字段（姓名、邮箱、简历），立即停止并报告
2. 读取 workspace/data/jobs.md，筛选出所有状态为 discovered 的职位
   - 如没有 discovered 职位，报告"暂无待投递职位"后结束
3. 对每个 discovered 职位（按顺序逐一处理）：
   a. 使用 browser_navigate 访问招聘链接
   b. 使用 browser_snapshot 获取页面内容，识别表单字段
   c. 如果页面需要登录：
      - 跳过此职位
      - lock_file → write_file（状态改为 login_required，时间记录当前时间）→ unlock_file
      - 继续下一个
   d. 使用表单工具填写用户信息并提交
   e. 等待响应，判断是否提交成功
   f. lock_file → write_file（更新状态为 applied 或 failed，记录当前时间）→ unlock_file
4. 汇报本次投递结果：X 个成功，Y 个失败，Z 个需要登录

### 重要规则
- write_file 前必须先 lock_file，写完立即 unlock_file
- 使用 old_string/new_string 精确替换行，old_string 须与文件中的行完全一致
- 投递时间格式：YYYY-MM-DD HH:mm
- 状态只能改为：applied / failed / login_required（不能改回 discovered）
- 遇到验证码或复杂人机验证时，将状态改为 failed，在摘要中单独列出

### 我的记忆文件
- workspace/agents/delivery/notebook.md — 跨会话笔记（如：哪些网站需要特殊处理）
