# Agent-First 架构方向文档

> 状态：方向文档，不是当前代码事实源
> 更新时间：2026-03-28
> 当前事实请以 `docs/SPEC.md` 和 `docs/agent-design.md` 为准

## 1. 文档定位

这份文档只回答一个问题：

在已经完成本轮 Runtime / Agent 基础收敛之后，JobClaw 后续应该沿着什么架构方向继续演进。

它不是：

- 当前实现说明
- 活跃开发任务清单
- 按阶段排期的执行计划

这样处理的原因很直接：

- 当前系统已经落地 `RuntimeKernel`
- 主 Agent / 子 Agent 已经切到 profile 驱动
- capability policy、structured stores、runtime recovery semantics 已经成为真实运行约束

因此，这份文档如果继续写成“从零开始的 Phase 1-7 重构计划”，就会和代码现实冲突，也会误导后续 agent 或开发者。

## 2. 当前已落地的基础

当前系统已经具备以下基线能力：

- 用户面对的是一个长期存在的 `MainAgent`
- 子任务通过 `ProfileAgent` 运行，而不是再创建临时全权限主 Agent
- profile 已经参与工具、读写路径、浏览器能力和委派能力的约束
- Runtime 已经维护会话快照、对话快照、delegation 状态和 intervention 状态
- Runtime reload / restart 后，系统会把无法继续的 in-flight 状态收敛为可解释终态，而不是假装“无缝恢复”
- WebSocket 展示已经由 runtime 事件流和结构化状态驱动，而不是直接依赖进程内临时对象

这意味着“agent-first”不再是纯概念，而是已经有一层真实底座。

## 3. 这个方向要保留什么

JobClaw 后续不应该走“把产品彻底任务流化”的路线。

应该保留的核心特征：

- 一个持续对话的主 Agent
- 主 Agent 自主决定是否搜索、追问、委派、生成简历、触发投递
- 用户继续通过自然语言驱动系统，而不是被迫进入表单化工作流
- skill 继续作为运行时操作方法论注入，而不是把能力硬编码成固定页面按钮

换句话说，系统的自由度应该保留在“决策层”，而不是保留在“权限失控”和“状态失真”上。

## 4. 方向性架构原则

### 4.1 主 Agent 是唯一长期入口

后续无论增加多少功能，用户都仍然应该只面对一个主 Agent 会话。

不要演化成：

- 多个并列的一等 Agent 入口
- 前端直接驱动多个后端执行器
- 用 UI 流程替代主 Agent 的总控职责

主 Agent 的职责应稳定为：

- 理解用户长期意图
- 选择策略
- 决定是否委派
- 汇总外部结果
- 维护对用户一致的会话体验

### 4.2 子 Agent 必须是“真实受限角色”

子 Agent 的意义不是“多开几个模型调用”，而是把不同类型的执行动作隔离到真实边界内。

这个方向必须继续坚持：

- profile 决定能力边界
- runtime 强制执行边界
- prompt 只负责解释角色，不负责承担安全性本身

如果未来新加 profile，也应满足同样约束：

- 明确可用工具
- 明确可读范围
- 明确可写范围
- 明确是否允许浏览器
- 明确是否允许继续委派

### 4.3 Runtime 才是系统底座

系统稳定性的来源不应该是“提示词更复杂”，而应该是 Runtime 的真实约束和状态管理。

后续所有演进都应优先放在 Runtime 层判断：

- 状态是否可持久化
- 重启后语义是否明确
- 是否能被观测
- 是否能解释失败原因
- 是否会污染主会话

如果一个能力只能靠 prompt 维持一致性，而没有 runtime 契约，它就还没有真正进入可交付状态。

### 4.4 结构化状态优先于文本拼装

Markdown 和聊天历史可以继续存在，但不应继续承担唯一事实源角色。

后续演进应继续强化：

- 会话读模型
- 对话快照
- delegation 状态
- intervention 状态
- jobs / artifacts / user facts 等结构化状态

可读文档是视图，不是事实本体。

### 4.5 恢复语义必须保守而明确

系统不应该伪装成“任何事情都能在重启后继续跑下去”。

当前已经确定的方向是正确的：

- pending intervention 可以恢复展示
- 无法继续的 delegated run 应收敛为 `cancelled`
- 过期 intervention 应收敛为 `timeout`

未来即使增强恢复能力，也必须先定义清楚哪些状态可恢复，哪些状态只能终止，而不是把“不确定是否安全”的执行继续下去。

## 5. 后续演进时应该重点观察的断层

这部分不是 backlog，而是后续判断架构是否继续健康的检查框架。

### 5.1 Prompt 仍然偏重

虽然 profile 和 runtime 已经落地，但主 Agent 仍然承担较多复合职责。

后续应持续观察：

- 主提示是否再次膨胀成单点总汇编
- profile 提示、skill 注入、memory 注入是否还能分层定位
- 新能力加入时，是否又回到“往主 prompt 继续堆规则”

### 5.2 主 Agent 仍可能承担过多执行细节

主 Agent 应该负责策略与协调，而不是长期回到“自己执行一切”的模式。

后续需要持续约束：

- 能委派的执行型工作，尽量落到对应 profile
- 主 Agent 直接做高风险或重操作时，要有明确理由
- 子 Agent 输出应继续保持可归并、可解释、可审计

### 5.3 状态模型仍需持续收敛

当前底座已经形成，但状态层仍然容易随着功能增长而再次分叉。

后续要避免：

- 前端自己维护一套事实
- Agent checkpoint 和 Runtime store 语义混叠
- 临时日志被误当作正式状态

判断标准很简单：

一个状态如果会影响恢复、展示、重试或审计，它就应该进入正式 store，而不是只留在消息文本里。

### 5.4 观测契约不能再次碎裂

这轮工作已经把 Web 展示更多地收拢到 runtime 事件和结构化 store。

后续要避免重新出现：

- 前端依赖私有进程对象读取状态
- 同一件事存在两套生命周期事件
- “流式文本”和“最终状态”彼此矛盾

事件体系不需要追求花哨，但必须坚持一件事只有一套权威来源。

## 6. 一个更清晰的目标态

如果继续沿着正确方向推进，目标态应接近下面这个模型：

```text
User
  |
  v
MainAgent
  |
  +-- decides strategy
  +-- reads structured memory
  +-- requests intervention
  +-- delegates bounded work
  |
  +-- ProfileAgent(search / delivery / resume / review / future profiles)
  |     - real capability boundary
  |     - isolated execution context
  |     - observable lifecycle
  |
  \-- RuntimeKernel
        - event stream
        - session / conversation / delegation / intervention stores
        - capability policy
        - recovery semantics
        - web delivery adapters
```

目标态强调的是四件事：

- 主 Agent 继续自由决策
- 子 Agent 继续受限执行
- Runtime 继续掌握状态与边界
- Web 继续消费结构化事实，而不是猜测后端过程

## 7. 对后续开发的约束

以后如果有人基于这份文档继续设计或开发，应先检查三件事：

1. 新方案是否把“自由度”错误地放成了“更少约束”
2. 新能力是否引入了新的隐性事实源
3. 重启、失败、人工介入、前端展示这四个场景下，语义是否仍然一致

如果这三件事说不清，就说明方案还没有达到可交付质量。

## 8. 一句话结论

JobClaw 的 `agent-first` 方向，不是把系统做成任务流产品，而是让一个持续对话的主 Agent 建立在真实的 Runtime、能力边界、结构化状态和可解释恢复语义之上。
