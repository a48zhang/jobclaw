# JobClaw 开发计划（docs/dev/plan.md）

> 最近更新：2026-03-10  
> 说明：`docs/dev/` 已收敛为单文件计划；历史阶段文档与 review 结论都整合在本文件中。

## 1. 当前状态（不含工期）

- Phase 0–5：已完成并已集成（脚手架/工具层/BaseAgent/核心 Agents/Channel/Web Dashboard/简历生成）。
- Phase 6：进行中，目标是“生产化可用”——稳定性、性能、会话管理与可观测性。

## 2. 约束与不变量（必须遵守）

1. 配置扁平化：统一使用 `workspace/config.json` 顶层字段，不引入嵌套对象。
2. 写入一致性：严禁绕过 `upsert_job` 直接写 `jobs.md`。
3. 单文件体积：尽量保持单文件 < 500 行；超过则拆分到模块。
4. 协议演进：Web/TUI 事件协议只增不改；如需替换字段，必须兼容旧字段至少一个版本。

## 3. Review 结论汇总（V0.2.0）

### 已完成（与代码一致）

- `agent:log` 字段协议已做兼容处理（避免前端依赖字段破坏）。
- `upsert_job` 工具结果结构已补齐关键信息，便于 Delivery/通知端准确呈现。
- `runEphemeral` 状态恢复与 UI 同步逻辑已对齐（避免状态与事件流不一致）。
- Cron：`digest` 才强制 SMTP 校验；`search` 模式允许无 SMTP 运行。

### 发布前复核清单（仍需人工验收）

- [ ] Cron 两种模式（`search`/`digest`）在无 SMTP 与有 SMTP 环境下行为符合预期。
- [ ] Web Dashboard 联动：`agent:state`、`agent:log`、HITL、Chat 指令投递。
- [ ] `workspace/config.json.example` 补齐并同步最新配置项。
- [ ] `README.md` 与 `SPEC.md` 同步最新行为（例如 Cron 模式差异、默认模型/配置项等）。

## 4. Phase 6 执行清单（同步自 todo.md）

> 规则：本节与 `todo.md` 保持一一对应；完成后同时勾选两处。

### P1：性能与稳定性

- [ ] TUI 渲染性能：引入内容哈希校验，减少 `jobs.md` 无效解析。
- [ ] 自动化重试框架：在 `BaseAgent` 层面实现工具调用的指数退避重试。
- [ ] Session 智能管理：定期清理冗余的消息历史，保持 Session 紧凑。
- [ ] 通道限流：针对邮件通知增加发送频率保护逻辑。
- [ ] 异步化消息流：统一 UI/Channel/EventBus 的“流式输出”与“最终态”处理。

### P2：产品能力

- [ ] 模拟面试：根据目标岗位信息进行模拟面试。
- [ ] 简历评价 + 修改建议：对生成的简历给出可执行的改进点与迭代流程。

## 5. Web Dashboard 维护要点

- 保持 `agent:log` 协议稳定；如需演进，优先“新增字段 + 保留旧字段”。
- Chat 入口（`POST /api/chat`）只负责触发任务；执行过程统一走 WebSocket 事件流展示。
