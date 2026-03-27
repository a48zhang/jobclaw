# Program Status And Execution Plan

> 历史说明：本文件记录的是一次重构中途的程序状态判断。  
> 其中大量 P0/P1 问题已经变化或被修复，不再代表当前分支状态。  
> 当前执行计划请优先参考 `docs/dev/plan.md`。

本文件不是单纯的开发任务清单，而是站在团队负责人视角，对本轮 `agent-first` 重构的现状、问题总表、推进流程、并行策略和交付门禁进行统一说明。

目标：

- 让团队先看清楚“当前到了哪里”
- 把所有已知问题集中到一处，而不是分散在聊天、review 和代码里
- 给出后续推进顺序，而不是继续无序并行
- 补齐“meta 开发”层面的治理：谁先做、谁能并行、什么情况下禁止继续扩展

---

## 1. 当前状态判断

当前分支已经不再是“只有方案文档”的状态，`runtime`、`memory`、`profile`、`delegation`、`capability`、`web adapter` 都已经出现了第一版实现。

但这次改造还没有完成从“新骨架出现”到“主链真正切换”的过渡。

更准确地说，当前状态是：

- 架构方向是对的
- 新模块已经开始落地
- 旧系统还在承担主路径
- 新旧系统之间存在多处双轨并存
- 关键闭环尚未收口
- 当前分支仍处于不稳定状态，不能当成完成品

一句话结论：

`现在不是没做成，而是做到了“半集成状态”；接下来必须先收口，再继续扩展。`

---

## 2. 这轮开发暴露出的流程经验

这轮已经经历过一波“先写方案，再多线程并行开发，再回来集成”的过程。复盘下来，后续必须按下面的流程推进，而不能继续凭感觉扩展。

### 2.1 先冻结共享契约，再允许并行

并行开发前必须先冻结这些东西：

- profile 名称
- runtime 事件名
- ToolResult 结构
- 目录边界
- “谁是事实源”这一层定义

如果这些没有先冻结，多 agent 并行的结果通常不是“加速”，而是“制造两套实现”。

### 2.2 第一阶段不是扩展功能，而是建立可集成骨架

第一阶段应该只做：

- runtime 基础骨架
- memory 基础 store
- profile/capability 基本模型
- web/runtime 适配入口

不应该急着在这阶段完成所有业务切换。

### 2.3 第二阶段必须先做稳定化，而不是继续新功能

一旦第一波并行落地，必须进入一个显式的“稳定化阶段”。

这个阶段只做：

- 修编译
- 修接口不一致
- 修关键行为 bug
- 收敛重复状态
- 建回归测试

不能一边继续扩模块，一边再补这些问题。

### 2.4 只有主链闭环之后，memory/web 才值得继续推进

如果 `run_agent` 还不是真受限子 agent，`allowBrowser` 还只是文案字段，`eventBus` 还没收口，那这时去大规模推进 web、memory 展示面，只会把错误状态包装得更漂亮。

因此后续顺序必须是：

1. 主链稳定化
2. 真实 delegation / capability
3. 事实源切换
4. web 切换
5. 观测与恢复收口

### 2.5 并行不等于所有人同时改主链

这轮开发证明了一点：

- 可以并行做模块实现
- 不能并行做主链集成

后续必须明确一个“集成 owner”，由他统一做：

- 接口对齐
- 编译收口
- merge 顺序控制
- 验证结果确认

---

## 3. 问题总表

本节列出当前已知问题。这里不区分“代码 bug”与“架构未收口”，因为对团队推进来说，两者都属于必须处理的问题。

## 3.1 P0 阻塞级问题

这些问题不解决，就不应该继续扩展新能力。

### P0-1 主 Agent 的额外系统提示词组装错误

现状：

- `src/agents/main/index.ts` 中 `getAdditionalSections()` 声明返回 `string[]`
- 实际返回的是一整段字符串
- `src/agents/prompt-composer.ts` 会对 `additionalSections` 执行 `push(...additionalSections)`

结果：

- 主系统提示词会被按字符展开
- 主 Agent 行为描述失真
- TypeScript 直接报错

影响：

- 主 Agent 质量不可预测
- 当前分支不能通过类型检查

### P0-2 浏览器工具被 profile 白名单全部挡掉

现状：

- `BaseAgent` 按 `profile.allowedTools` 过滤工具
- MCP/Playwright 工具名称不在本地 allowlist 里
- `allowBrowser` 只是声明字段，没有参与真实判定

结果：

- 主 Agent 虽然声明 `allowBrowser: true`，但运行时拿不到浏览器工具
- 搜索型子 Agent 同样无法真正使用浏览器能力

影响：

- 搜索主链被直接破坏
- capability 模型与实际行为不一致

### P0-3 `run_agent` 仍然会创建全权限 `MainAgent`

现状：

- `run_agent` 会记录目标 profile
- 但执行时仍然调用 `factory.createAgent()`
- `AgentFactory` 目前固定返回 `MainAgent`

结果：

- `search`、`delivery`、`resume`、`review` 还不是真正受限角色
- 当前隔离主要仍停留在 prompt 文本层

影响：

- 本轮重构最核心目标尚未实现
- 后续 capability、delegation、web 展示都缺乏真实语义

### P0-4 当前分支仍不能稳定通过类型检查

现状：

- `tsc --noEmit` 当前仍是红的
- 已确认的直接来源包括：
  - `MainAgent` prompt 组装类型错误
  - `eventBus` bridge 的 delegation 类型与返回分支不闭合

影响：

- 当前状态不具备继续大规模演进的条件
- 无法把“新骨架”当成可靠基础

## 3.2 P1 高优先架构问题

这些问题不一定立刻阻止开发，但如果不尽快处理，会让后续每一层都继续双轨。

### P1-1 delegation 生命周期语义错误

现状：

- `run_agent` 失败/超时时返回 `{ success: false }`
- 上层 `executeToolCall()` 拿到返回值后仍会 `completeRun()`
- `DelegationManager` 当前主要发 `delegation.state_changed`

结果：

- 失败的委派会被记成完成
- 观测层拿到误导性状态

### P1-2 capability policy 已存在，但没有形成真正的 runtime enforcement

现状：

- `capability-policy.ts` 已存在
- `tools/types.ts` 中也有 `profile`、`capabilityPolicy`
- 但 `BaseAgent` 当前传给工具的 `ToolContext` 并未把这套机制完整用起来
- MCP/browser/admin/action 的授权仍未统一收口

结果：

- 能力模型存在
- 真实执行边界仍不完整

### P1-3 profile 模型存在重复定义

当前至少有两套相近定义：

- `src/agents/profiles.ts`
- `src/runtime/capability-types.ts`

风险：

- 字段漂移
- allowlist 不一致
- 类型定义与运行时行为不同步

### P1-4 领域模型也存在重复定义

当前至少有两套相近定义：

- `src/runtime/contracts.ts`
- `src/domain/types.ts`

风险：

- session/delegation/intervention/job 等对象的字段会逐步分叉
- web、runtime、memory 各自依赖不同版本模型

### P1-5 ToolResult 仍处于双格式兼容状态

现状：

- 老链路使用 `success/content/error`
- 新契约设计想要 `ok/summary/data/errorCode/errorMessage`
- 当前实现为了集成暂时兼容两套格式

影响：

- 上层适配复杂
- 工具失败语义不统一
- delegation/tool observability 容易错判

## 3.3 P2 中优先架构问题

这些问题说明“新旧系统正在并存”，需要在后续阶段收口。

### P2-1 runtime 与 observability 存在两套状态聚合方向

现状：

- `RuntimeKernel` 已有 `EventStream`、`SessionStore`、`InterventionManager`
- 另外还存在 `runtime/observability.ts`

风险：

- 同一状态可能被两套系统维护
- 出现“事件对了，但状态不一致”

### P2-2 web 仍然主要依赖 legacy 路径

现状：

- `src/web/server.ts` 仍在读 `agentRegistry`
- 仍通过 `eventBus` 广播
- `/api/jobs` 和 `/api/stats` 仍主要读取 `data/jobs.md`

结果：

- 新 runtime/store 还不是 web 的默认来源
- 页面展示与真实 runtime 状态可能不一致

### P2-3 memory store 已建成，但还没成为默认事实源

现状：

- `JobStore`、`SessionStore`、`DelegationStore`、`InterventionStore` 等已出现
- 但主流程尚未切成“先写 store，再导出 Markdown/事件”

结果：

- 结构化存储存在，但业务主链仍主要依赖旧数据路径

### P2-4 session 持久化仍然分裂

现状：

- `BaseAgent` 仍有旧 session 存储逻辑
- 新 runtime/memory 也开始维护 session

结果：

- session 的恢复语义存在双轨
- 难以判断谁是唯一可信状态

### P2-5 intervention 仍未完成端到端恢复闭环

现状：

- runtime 侧已有 intervention store/manager
- agent 侧仍保留进程内 promise 等待模型

结果：

- “已持久化” 与 “可恢复继续执行” 还不是一回事

## 3.4 P3 工程治理问题

这些不是主功能 bug，但会持续拖慢推进效率。

### P3-1 当前文档与真实状态存在时差

例如：

- 架构文档写的是目标态
- 代码现在处于中间态
- 如果没有一份“现状说明文档”，团队容易误判为已经完成切换

### P3-2 缺少统一的程序级门禁

当前虽然有测试文档，但缺少明确规则：

- 哪些问题不修不能继续开发
- 哪些模块可以继续并行
- 哪些模块必须在集成 owner 手上收口

### P3-3 缺少“阶段完成定义”

现在更像“不断加模块”，而不是“按阶段收口”。

没有阶段完成定义，就会导致：

- 模块越来越多
- 主链越来越不稳定
- review 成本持续增加

---

## 4. 领导视角下的推进原则

接下来不能再按“谁手上有什么就继续写什么”的方式推进。

必须遵守以下原则。

### 4.1 先止血，再扩展

先修：

- 编译红线
- 主链行为错误
- capability/delegation 的假隔离

再做：

- web 深度接入
- memory 深度迁移
- observability 完善

### 4.2 先统一事实源，再统一展示

先决定：

- session 谁说了算
- delegation 谁说了算
- intervention 谁说了算
- jobs 谁说了算

再去做 UI 展示和 API 扩展。

### 4.3 主链只允许一个集成 owner

并行团队可以分别开发模块，但以下内容只能由一个 owner 收口：

- `eventBus` / `EventStream`
- `AgentFactory`
- `run_agent`
- `BaseAgent`
- `web runtime adapter`

### 4.4 每个阶段结束都必须回到绿线

每一阶段结束必须满足：

- `tsc --noEmit` 通过
- 单元测试通过
- 关键链路手工验证通过

否则不能进入下一阶段。

### 4.5 用阶段目标管理，不用“继续堆任务”管理

后续应该按阶段推进，而不是继续堆细粒度任务。

每个阶段回答 3 个问题：

1. 本阶段要收口什么
2. 本阶段结束后，系统真实改进了什么
3. 哪些旧路径可以正式降级为兼容层

---

## 5. 建议的开发计划

## 阶段 0: 稳定化冻结

目标：

- 停止继续扩展新能力
- 把当前中间态收敛到可继续推进的基础

本阶段只允许做：

- 修 `tsc`
- 修 prompt 组装错误
- 修 delegation 状态错误
- 明确当前唯一集成 owner
- 冻结 contracts/profile/tool-result 口径

本阶段完成标志：

- 类型检查通过
- 所有人认同“当前哪些模块只是中间态”

## 阶段 1: delegation/capability 主链收口

目标：

- 真正实现“主 Agent + 受限子 Agent”

必须完成：

- `run_agent` 按 profile 创建不同 agent
- `AgentFactory` 不再固定返回 `MainAgent`
- MCP/browser 权限接入 profile runtime
- `allowBrowser` / `allowAdminTools` / `allowDelegationTo` 变成真实机制
- delegation 成功/失败/取消语义打通

本阶段完成标志：

- `search` 子 Agent 真的只能做 search profile 允许的事情
- `delivery` 子 Agent 真的不能访问搜索型浏览器能力
- 委派生命周期观测准确

## 阶段 2: 统一领域模型与结果模型

目标：

- 去掉“同名概念多份定义”

必须完成：

- 统一 `runtime/contracts.ts` 与 `domain/types.ts`
- 统一 profile 类型来源
- 统一 ToolResult 结构
- 明确 legacy adapter 的边界

本阶段完成标志：

- session/delegation/intervention/job/profile/tool-result 各只有一份主定义

## 阶段 3: memory 成为默认事实源

目标：

- 让结构化 store 成为主链事实源

必须完成：

- jobs 主链改为先写 `JobStore`，再导出 `jobs.md`
- session/delegation/intervention 主链改为先写 store
- 旧 Markdown/JSON 会话只保留兼容导入/导出职责

本阶段完成标志：

- 删除 `jobs.md` 后仍可由 store 重建
- 服务重启后 pending intervention、delegation 状态可恢复

## 阶段 4: web 切换到 runtime/store adapter

目标：

- web 不再依赖 legacy registry 和 Markdown 主读路径

必须完成：

- `/api/jobs` 直接读 `JobStore`
- `/api/session`、`/api/delegations`、`/api/interventions` 直接读 runtime/store
- WebSocket 消费 runtime event stream
- 页面刷新后运行态恢复

本阶段完成标志：

- web 成为 runtime/store 的展示层，而不是另一套状态源

## 阶段 5: observability 与恢复收口

目标：

- 可观测性和恢复语义一致

必须完成：

- 明确 `ObservabilityStore` 与 `RuntimeKernel` 的关系
- 保证事件与状态来源唯一
- 工具、delegation、intervention、memory 更新都能追踪

本阶段完成标志：

- 任一关键动作只有一条状态链和一条事件链

## 阶段 6: 回归与清理

目标：

- 去掉临时兼容逻辑
- 建立稳定交付面

必须完成：

- 清理废弃 adapter
- 完成 e2e 主流程
- 补齐 recovery/cancel/capability 隔离测试
- 更新文档索引和真实系统说明

本阶段完成标志：

- 可以把当前方案视作真正进入“可持续演进”状态

---

## 6. 并行策略

后续仍可以并行，但不能再像第一轮那样“所有人都碰主链”。

建议分工如下。

### 集成 Owner

唯一负责：

- `BaseAgent`
- `AgentFactory`
- `run_agent`
- `eventBus`
- `RuntimeKernel`
- 主链验证

### Runtime/Memory Owner

负责：

- store 主链迁移
- 导入导出器
- 恢复语义

### Web Owner

负责：

- runtime/store API 接入
- 观测页面
- 前端恢复逻辑

### QA Owner

负责：

- 阶段性回归套件
- 主链手工验证清单
- 阻塞级缺陷看板

---

## 7. 合并门禁

从现在开始，以下规则建议作为硬门禁。

### 门禁 A: 不允许红线合并

以下任一条件不满足，不允许继续叠加新能力：

- `tsc --noEmit` 不通过
- 单元测试主集不通过
- 已知 P0 问题未收口

### 门禁 B: 不允许再引入同名第二模型

例如：

- 再新建一份 profile 类型
- 再新建一份 session/delegation/job 定义
- 再新建一份 ToolResult

都应视为架构性回退。

### 门禁 C: 不允许 capability 只停留在 prompt 文本

所有能力边界必须最终落实为：

- 工具级拦截
- 路径级拦截
- browser/admin 级拦截
- delegation 级拦截

### 门禁 D: 不允许 web 成为事实源

web 只能展示和提交动作，不能变成另一套业务状态层。

---

## 8. 推荐验证节奏

每完成一个阶段，必须重复以下节奏：

1. 类型检查
2. 单元测试
3. 关键链路手工验证
4. 更新本文件中的问题状态
5. 再进入下一阶段

建议每一阶段都产出：

- 当前关闭了哪些问题
- 当前仍保留哪些兼容层
- 下一阶段的唯一重点是什么

---

## 9. 当前建议的直接动作

如果从现在开始继续推进，最合理的直接动作是：

1. 停止继续扩 web 和 observability 展示面。
2. 先进入“阶段 0: 稳定化冻结”。
3. 由集成 owner 修复 P0-1、P0-2、P0-3、P0-4。
4. 修完后再启动“阶段 1: delegation/capability 主链收口”。
5. 在阶段 1 完成之前，不再把 memory/web 大规模接入主流程。

---

## 10. 这份文档的用途

这份文档不是一次性说明。

后续应当把它当成：

- 当前架构状态说明
- 程序级问题总表
- 阶段推进计划
- 团队协作规则

如果后续代码状态发生变化，应优先更新本文件，再继续并行开发。
