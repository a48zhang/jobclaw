# JobClaw Project TODO

- [x] 修复 `/api/config/:name` 首次保存失败：首次创建 `targets.md` / `userinfo.md` 时先确保目标文件存在，再进入锁流程。
- [x] 修复 `run_agent` 超时语义：超时后必须真正取消或隔离子任务，避免后台继续产生副作用。
- [x] 修复静态文件服务对自定义 `workspaceRoot` 的支持，确保 `output/` 文件可正常访问。
- [x] 修复上下文压缩预算：压缩后重新校验 token，必要时继续压缩直到低于阈值。
- [x] 清理过时的 bootstrap/TUI/DeliveryAgent 文案与死代码，并补对应测试。
- [ ] TUI 渲染性能: 引入内容哈希校验，减少 `jobs.md` 无效解析。
- [ ] 自动化重试框架: 在 `BaseAgent` 层面实现工具调用的指数退避重试。
- [ ] Session 智能管理: 定期清理冗余的消息历史，保持 Session 紧凑。
- [ ] 通道限流: 针对邮件通知增加发送频率保护逻辑。
- [ ] 异步化消息流
- [ ] request 交互原语: 将当前 `intervention` 机制升级为 LLM 可显式调用的 `request` 能力。
- [ ] PDF 简历读取链路: 支持上传 PDF 简历，并通过 `read_pdf` tool 提取文本供评价使用。
- [ ] 模拟面试：根据岗位信息和现有材料进行回合式模拟面试，并在结束后统一评分与点评。
- [ ] 简历诊断+改写：评价当前简历并给出可直接落地的改写结果。
