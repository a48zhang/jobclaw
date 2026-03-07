# Phase 3 · Team A — MainAgent 实现计划

> **负责模块**: `src/agents/main/index.ts`  
> **测试文件**: `src/agents/main/main.test.ts`  
> **可并行工作**：是。Team A 的开发不依赖 Team B/C 的代码完成，仅依赖其对外暴露的接口类型。

---

## 1. 任务概述

MainAgent 是整个系统的**用户入口**、**搜索引擎**与**任务调度中心**。系统只有两个 Agent：MainAgent 和 DeliveryAgent。

MainAgent 承担两类工作：
1. **交互模式**：响应用户指令，直接使用 Playwright MCP 工具在浏览器搜索职位，并在需要时通过 `spawnAgent` 拉起 DeliveryAgent 执行投递。
2. **Ephemeral 模式**：被 CronJob 或其他调用方无状态地拉起（`runEphemeral()`），执行完单个任务后销毁上下文、释放资源，结果写入 `data/` 文件或通过 Channel 推送。

**核心行为**：
- 与用户进行自然语言交互，持续保持对话
- **直接**使用 Playwright MCP 工具搜索职位，遵循**搜索 SOP Skill**（见第 5.6 节）
- 写入 `jobs.md` 前 `lock_file`，写入后 `unlock_file`（DeliveryAgent 也写同一文件）
- 通过 `spawnAgent(deliveryAgent, instruction)` 将投递任务委托给 DeliveryAgent（串行，独立上下文）
- 管理跨对话的任务上下文（通过 `session.json`）
- Ephemeral 模式下不读写 `session.json`，不污染交互会话

---

## 2. 前置依赖（本团队需要的接口契约）

Team A 不需要等待 B/C 的代码完成，但必须与它们约定以下接口。开发时**用 mock/stub 代替** B/C 实例。

### 2.1 BaseAgent（已实现）

```typescript
// src/agents/base/index.ts - 已存在，可直接使用
import { BaseAgent } from '../base'
import type { BaseAgentConfig } from '../base/types'
```

主要接口：
- `constructor(config: BaseAgentConfig)`
- `run(input: string): Promise<string>`
- `getState(): AgentSnapshot`
- `agentName: string`（只读）
- `extractContext() / restoreContext()` — 受保护，可覆盖

### 2.2 DeliveryAgent 接口（与 Team C 约定，开发时用 stub）

```typescript
interface IDeliveryAgent {
  run(input: string): Promise<string>
  getState(): AgentSnapshot
}
```

### 2.3 Channel 接口（`src/channel/base.ts`，由 Team B 定义）

**Channel 只用于向用户发送外部通知**（邮件/Webhook 等），不作为 Agent 间通信手段。Agent 间通信通过 `jobs.md` + 文件锁完成。

开发时使用以下 stub，等 Team B 提交后替换为 `import type { Channel } from '../../channel/base'`：

```typescript
interface Channel {
  send(message: ChannelMessage): Promise<void>
}

interface ChannelMessage {
  type: ChannelMessageType
  payload: Record<string, unknown>
  timestamp: Date
}
```

---

## 3. 对外暴露（本团队产出的接口）

```typescript
export interface MainAgentConfig extends BaseAgentConfig {
  deliveryAgent: IDeliveryAgent
  channel?: Channel  // 交互模式可选；Ephemeral/CronJob 模式时必须提供
}

export class MainAgent extends BaseAgent {
  constructor(config: MainAgentConfig)
  // 继承 run(input: string): Promise<string>  — 交互模式，持久化 session
  // 继承 runEphemeral(initialPrompt, options?): Promise<string>  — 无状态单次执行（BaseAgent 提供）
  // 继承 getState(): AgentSnapshot
}
```

> **`runEphemeral` 定义在 BaseAgent**，MainAgent 直接继承。CronJob 通过 `mainAgent.runEphemeral(instruction)` 拉起；DeliveryAgent 通过 `spawnAgent(deliveryAgent, instruction)` 拉起（`spawnAgent` 是 MainAgent 的 protected 方法，内部调用 `targetAgent.runEphemeral()`）。

---

## 4. 数据约定（files in workspace/data/）

MainAgent **读写** jobs.md 和 targets.md。

| 文件 | MainAgent 的关系 | 说明 |
|------|-----------------|------|
| `data/targets.md` | **读写** | 查看监测目标；引导用户添加/删除 |
| `data/jobs.md` | **读写（需加锁）** | 搜索后追加 `discovered` 行；展示状态给用户 |
| `data/userinfo.md` | 只读 | 引导用户补充信息 |
| `agents/main/session.json` | 读写 | 交互模式下的会话记忆（BaseAgent 自动管理） |
| `agents/main/notebook.md` | 读写 | 跨会话持久化笔记 |

> **CronJob 模式不读写 session.json**，保持交互会话干净。

---

## 5. 设计方案

### 5.1 架构总览

```
交互模式：
  用户输入 → MainAgent.run()
    → LLM 直接调用 Playwright 工具搜索（遵循 jobclaw-skills SOP）
    → LLM 调用 run_delivery_agent
      → spawnAgent(deliveryAgent, instruction)
        → deliveryAgent.runEphemeral(instruction, { maxSteps: 50 })  ← 独立上下文，执行完销毁
    → 返回汇总给用户

Ephemeral 模式（CronJob / 其他拉起方）：
  调用方 → mainAgent.runEphemeral(initialPrompt, { maxSteps: 50, timeoutMs: 300_000 })
    → LLM 直接调用 Playwright 工具搜索（遵循 jobclaw-skills SOP）
    → 发现新职位 → append jobs.md + channel.send({ type: 'new_job' })
    → 完成后返回（上下文销毁，session.json 不变）
```

**MCP 串行约束**：MainAgent 和 DeliveryAgent 共享同一个 `mcpClient`（同一浏览器实例）。`spawnAgent` 是串行 `await`，保证两者不同时操作浏览器。**禁止并行 `spawnAgent`**——如未来需要并行，必须分配独立的 mcpClient 实例。

### 5.2 只保留 `run_delivery_agent` 工具

搜索由 MainAgent 自己做（直接使用 MCP Playwright 工具），不再有 `run_search_agent`。`run_delivery_agent` 仍然作为内部工具存在：

```typescript
const runDeliveryAgentTool: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'run_delivery_agent',
    description: '启动投递 Agent 执行简历投递。传入本次投递的具体指令，如"投递所有 discovered 状态的职位"。投递 Agent 会自动读取 jobs.md 并完成表单填写。',
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: '传递给 DeliveryAgent 的具体指令',
        },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
}
```

调用链路：
```
LLM 推理 → 调用 run_delivery_agent 工具
         → MainAgent.executeToolCall 截获
         → 调用 this.deliveryAgent.run(instruction)
         → 将返回字符串包装为 tool result 送回 LLM
```

### 5.3 搜索写入 jobs.md 格式

MainAgent 在 systemPrompt 中声明写入职位的格式（与 DeliveryAgent 共享同一文件，必须一致）：

```
写入前：lock_file path=data/jobs.md
写入体：append_file，格式为 | {公司} | {职位} | {链接} | discovered | |
写入后：unlock_file path=data/jobs.md
```

在写入之前，LLM 必须先 `read_file data/jobs.md` 检查该职位是否已存在（任意状态），避免重复写入。

### 5.4 `runEphemeral` / `spawnAgent` 通用机制（在 BaseAgent 实现）

`runEphemeral` 是 BaseAgent 的通用方法，任何 Agent 都可被无状态地拉起。**这是 Team A 需要在 `src/agents/base/agent.ts` 中补充实现的方法**：

```typescript
// src/agents/base/agent.ts — 新增方法
async runEphemeral(
  initialPrompt: string,
  options: { timeoutMs?: number } = {}
): Promise<string> {
  const savedMessages = this.messages
  const savedState = this.state

  this.messages = []  // 独立上下文，不加载 session
  this.state = 'running'
  this.iterations = 0
  this.lastAction = 'ephemeral_start'

  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    this.initMessages(initialPrompt)
    const tools = await this.getAvailableTools()
    // runMainLoop 是将 run() 中主循环逻辑提取出的独立方法（同时重构 run() 调用它）
    const runPromise = this.runMainLoop(tools)

    const result = options.timeoutMs
      ? await Promise.race([
          runPromise,
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error(`[${this.agentName}] runEphemeral timed out after ${options.timeoutMs}ms`)),
              options.timeoutMs
            )
          }),
        ])
      : await runPromise

    return result ?? '任务完成'
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
    // 销毁临时上下文，不调用 saveSession()
    this.messages = savedMessages
    this.state = savedState
  }
}
```

`spawnAgent` 是 MainAgent 的 protected 辅助，封装 `runEphemeral` 并做错误包装：

```typescript
// src/agents/main/index.ts
protected async spawnAgent(
  agent: BaseAgent,
  initialPrompt: string,
  options: { timeoutMs?: number } = { timeoutMs: 300_000 }  // 默认 5 分钟
): Promise<string> {
  try {
    return await agent.runEphemeral(initialPrompt, options)
  } catch (error) {
    const msg = (error as Error).message
    console.error(`[MainAgent] spawnAgent(${agent.agentName}) failed:`, msg)
    return `[子任务失败] ${agent.agentName}: ${msg}`
  }
}
```

`run_delivery_agent` 工具调用时，`executeToolCall` 路由到 `this.spawnAgent(this.deliveryAgent, instruction)`。

> **BaseAgent 全局执行约束**
> - **工具调用 2 分钟超时**：`runMainLoop` 内每个 `executeToolCall` 均通过 `Promise.race` 包装 120s 超时；超时后返回错误 ToolResult，LLM 自行决定是否重试。
> - **子 Agent 迭代上限**：`runEphemeral` 链路的 Agent（当前为 DeliveryAgent）`maxIterations = 50`（BaseAgent 默认值）。迭代耗尽后 `runMainLoop` 正常返回最后一条 assistant 消息，`spawnAgent` **不重试**——用尽即完成，不是异常。

### 5.5 `onToolResult` — 搜索到新职位时发送 Channel 通知

MainAgent 覆盖 `onToolResult`，检测自己写入 `jobs.md` 的 `append_file` 结果，通过 Channel 发出通知（仅在提供了 channel 时）：

```typescript
protected async onToolResult(toolName: string, result: ToolResult): Promise<void> {
  if (!this.channel || !result.success || toolName !== 'append_file') return

  const newJobMatch = result.content.match(
    /\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(https?:\/\/\S+?)\s*\|\s*discovered\s*\|/
  )
  if (!newJobMatch) return

  const [, company, title, url] = newJobMatch
  await this.channel.send({
    type: 'new_job',
    payload: { company: company.trim(), title: title.trim(), url: url.trim() },
    timestamp: new Date(),
  })
}
```

### 5.6 Skills / SOP 加载机制

Skill 是注入到 systemPrompt 的**结构化操作规程（SOP）**，解决 LLM 执行特定任务时的行为一致性问题。

**两级存储**：

| 级别 | 目录 | 说明 |
|------|------|------|
| 代码级（只读） | `src/agents/skills/` | 随代码部署，版本管理，定义通用流程 |
| 用户级（可修改） | `workspace/skills/` | 运行时加载，可通过 MainAgent 对话更新，优先级高于代码级 |

**Skill 文件统一命名为 `jobclaw-skills.md`**，各 SOP 作为文件内的章节，不拆分为多个文件。MainAgent、DeliveryAgent 均通过 `loadSkill('jobclaw-skills')` 加载，各自读取对应章节。

**`src/agents/skills/jobclaw-skills.md`** 初始内容：
```markdown
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
```

**Skill 加载实现**（在 BaseAgent 中）：

```typescript
// src/agents/base/agent.ts 新增
protected loadSkill(name: string): string {
  const userPath = path.join(this.workspaceRoot, 'skills', `${name}.md`)
  const codePath = path.join(__dirname, '../skills', `${name}.md`)
  if (fs.existsSync(userPath)) return fs.readFileSync(userPath, 'utf-8')
  if (fs.existsSync(codePath)) return fs.readFileSync(codePath, 'utf-8')
  return ''
}
```

### 5.7 systemPrompt 要素

systemPrompt 必须包含以下信息：

1. **角色定义**：我是 JobClaw 的主 Agent，负责用户交互和职位搜索，并可委托 DeliveryAgent 执行投递
2. **搜索职责**：我直接使用 Playwright 工具访问招聘网站，遵循搜索职位 SOP
3. **写入约定**：发现职位后遵循去重 SOP（均来自 jobclaw-skills SOP），再 lock → append → unlock
4. **投递委托**：有 `run_delivery_agent` 工具可调用（通过 spawnAgent 隔离上下文）
5. **文件路径**：workspace/data 下各文件用途
6. **Skills 内嵌**：构建 systemPrompt 时调用 `loadSkill('jobclaw-skills')` 拼接 SOP

### 5.8 `extractContext` / `restoreContext`

```typescript
protected extractContext(): Record<string, unknown> {
  return {
    lastCronAt: this.lastCronAt ?? null,
  }
}

protected restoreContext(context: Record<string, unknown>): void {
  this.lastCronAt = (context.lastCronAt as string) ?? null
}
```

---

## 6. 实现清单

- [ ] **T-A-1**: 定义 `IDeliveryAgent` 接口（内联顶部）
- [ ] **T-A-2**: 定义 `MainAgentConfig` 接口（含 `channel?: Channel`）
- [ ] **T-A-3**: 编写 `runDeliveryAgentTool` Schema 定义
- [ ] **T-A-4**: 实现 `MainAgent` 类骨架（继承 BaseAgent，`agentName = 'main'`）
- [ ] **T-A-5**: 实现 `get systemPrompt()` — 调用 `loadSkill('jobclaw-skills')` 内嵌搜索 SOP + 去重 SOP
- [ ] **T-A-6**: 覆盖 `getAvailableTools()` — base 工具 + `run_delivery_agent`
- [ ] **T-A-7**: 覆盖 `executeToolCall()` — 拦截 `run_delivery_agent` 调用 `spawnAgent`，其余调用 `super`
- [ ] **T-A-8**: 在 BaseAgent 中实现 `runEphemeral(initialPrompt, options)` — 独立上下文，不读写 session，支持 `maxSteps`（默认 50）和 `timeoutMs`；子 Agent 用尽 50 步后不重试；重构 `run()` 中的主循环为 `runMainLoop()` 供两者共用。所有 tool call 设 2 分钟超时（`Promise.race`）
- [ ] **T-A-9**: 在 MainAgent 中实现 `spawnAgent(agent, instruction, options?)` — 封装 runEphemeral，统一错误处理
- [ ] **T-A-10**: 覆盖 `onToolResult()` — 检测 `append_file` 写入 `jobs.md`，发送 `new_job` Channel 通知
- [ ] **T-A-11**: 在 BaseAgent 中实现 `loadSkill(name)` — workspace/skills/ 优先于 src/agents/skills/
- [ ] **T-A-12**: 创建 `src/agents/skills/jobclaw-skills.md`（包含搜索 SOP + 去重 SOP + 投递 SOP 占位，各章节独立）
- [ ] **T-A-13**: 实现 `extractContext()` / `restoreContext()`
- [ ] **T-A-14**: 编写单元测试

---

## 7. 边界条件与错误处理

| 场景 | 期望行为 |
|------|---------|
| DeliveryAgent `run()` 抛出异常 | `executeToolCall` 捕获，返回错误 tool result，LLM 决定如何响应 |
| 用户同时要求"搜索+投递" | LLM 先自己搜索，完成后调用 `run_delivery_agent`（串行） |
| `targets.md` 为空 | Bootstrap 保证正常使用中不出现此情况。若用户手动删除后 Cron 触发，LLM 遵循 jobclaw-skills 搜索 SOP 报告"无监测目标"后停止，runEphemeral 正常返回 |
| `jobs.md` 不存在 | `append_file` 和 `lock_file` 的 tools 实现已处理文件不存在的情况（确认后填写）|
| 去重时 read_file 发现职位已存在 | 跳过，不重复 append；LLM 在回复中注明"已在列表中" |
| `channel` 未提供（交互模式） | `onToolResult` 中做 null check，静默不发通知 |
| CronJob 期间服务崩溃 | 重启后 `runCron` 从空消息开始，不受上次崩溃影响 |
| 交互模式下 session 与 CronJob 同时写入 `session.json` | `runCron` 不读写 session，不存在竞争 |

---

## 8. 验收测试标准

测试文件：`src/agents/main/main.test.ts`

### 8.1 必须通过的单元测试

**TC-A-01**: MainAgent 正常实例化（带/不带 channel）
```
Given: 有效 BaseAgentConfig + mock deliveryAgent
When: new MainAgent(config) / new MainAgent({ ...config, channel: mockChannel })
Then: 不抛出异常，agentName === 'main'
```

**TC-A-02**: getAvailableTools 包含 run_delivery_agent 但不包含 run_search_agent
```
Given: MainAgent 实例
When: agent.getAvailableTools()
Then: 包含 'run_delivery_agent'
      不包含 'run_search_agent'
      包含所有 BaseAgent 文件工具
```

**TC-A-03**: run_delivery_agent 工具调用时转发给 DeliveryAgent
```
Given: mock deliveryAgent.run() 返回 "已投递 2 个职位"
       mock OpenAI: tool_call: run_delivery_agent → stop
When: await agent.run("帮我投递所有待投递职位")
Then: deliveryAgent.run 被调用一次
```

**TC-A-04**: DeliveryAgent 抛出异常时不崩溃
```
Given: mock deliveryAgent.run() 抛出 Error("网络超时")
       mock OpenAI 收到 tool error 后返回 stop
When: await agent.run("投递职位")
Then: agent.run() 正常返回（不 throw）
      agent.getState().state === 'idle'
```

**TC-A-05**: onToolResult - append_file jobs.md discovered → channel.send new_job
```
Given: MainAgent 带 mockChannel
       result.content 包含 discovered 行
When: agent['onToolResult']('append_file', result)
Then: mockChannel.send type === 'new_job'
```

**TC-A-06**: onToolResult - 无 channel 时不崩溃
```
Given: MainAgent 不带 channel
When: agent['onToolResult']('append_file', validResult)
Then: 不抛出异常
```

**TC-A-07**: runEphemeral 不修改 session.json
```
Given: MainAgent 实例，workspace 中已有 session.json（内容为 A）
       mock OpenAI 直接返回 stop
When: await agent.runEphemeral('搜索新职位')
Then: session.json 内容仍为 A（未被改写）
```

**TC-A-08**: runEphemeral 执行后恢复原有 messages
```
Given: agent.messages = [existingMsg]
When: await agent.runEphemeral('任务')
Then: 执行完毕后 agent.messages 仍为 [existingMsg]
```

**TC-A-09-a**: runEphemeral 超时时抛出 timeout 错误并恢复消息
```
Given: mock OpenAI 永不返回（挂起）
When: await agent.runEphemeral('任务', { timeoutMs: 100 })
Then: 抛出包含 'timed out' 的 Error
      agent.messages 恢复为执行前的值
```

**TC-A-09-b**: spawnAgent 在子 Agent 超时时返回失败字符串而非抛出
```
Given: deliveryAgent.runEphemeral 抛出 timeout error
When: mainAgent['spawnAgent'](deliveryAgent, '投递', { timeoutMs: 100 })
Then: 返回包含 '[子任务失败]' 的字符串，不 throw
```

**TC-A-09-c**: loadSkill 优先返回 workspace/skills/ 中的版本
```
Given: workspace/skills/main-agent.md 存在，内容 'custom'
       src/agents/skills/main-agent.md 存在，内容 'default'
When: agent['loadSkill']('main-agent')
Then: 返回 'custom'
```

**TC-A-09-d**: loadSkill 在无用户版本时返回代码级版本
```
Given: workspace/skills/main-agent.md 不存在
       src/agents/skills/main-agent.md 存在，内容 'default'
When: agent['loadSkill']('main-agent')
Then: 返回 'default'
```

**TC-A-09**: systemPrompt 包含必要关键词
```
Then: 包含 'run_delivery_agent', 'jobs.md', 'lock_file', 'discovered', 'targets.md'
```

**TC-A-10**: extractContext / restoreContext 能保存恢复状态
```
Given: MainAgent 设置了 lastCronAt
When: context = extractContext(); restoreContext(context)
Then: lastCronAt 一致
```

### 8.2 集成测试（可选，CI 跳过）

**TC-A-11**: 与真实 DeliveryAgent 联动（需要 MCP 环境）

---

## 9. 文件完整 Skeleton（实现参考）

```typescript
// src/agents/main/index.ts

import type { ChatCompletionTool, ChatCompletionMessageToolCall } from 'openai/resources/chat/completions'
import { BaseAgent } from '../base'
import type { BaseAgentConfig } from '../base/types'
import type { ToolResult } from '../../tools/index'
import type { ChatCompletionMessageParam } from '../../types'
import type { Channel } from '../../channel/base'

interface IDeliveryAgent {
  run(input: string): Promise<string>
}

export interface MainAgentConfig extends BaseAgentConfig {
  deliveryAgent: IDeliveryAgent
  channel?: Channel
}

const RUN_DELIVERY_AGENT = 'run_delivery_agent'

export class MainAgent extends BaseAgent {
  private deliveryAgent: IDeliveryAgent
  private channel?: Channel
  private lastCronAt: string | null = null

  constructor(config: MainAgentConfig) {
    super({ ...config, agentName: 'main' })
    this.deliveryAgent = config.deliveryAgent
    this.channel = config.channel
  }

  protected get systemPrompt(): string {
    // T-A-5: 角色 + loadSkill('main-agent') + 文件路径 + 工具说明
    return ''
  }

  protected async getAvailableTools(): Promise<ChatCompletionTool[]> { /* T-A-6 */ return [] }

  protected async executeToolCall(toolCall: ChatCompletionMessageToolCall): Promise<ChatCompletionMessageParam> {
    // T-A-7: run_delivery_agent → this.spawnAgent(deliveryAgent, instruction)
    return {} as any
  }

  // runEphemeral() 继承自 BaseAgent（T-A-8 在 BaseAgent 实现）

  protected async spawnAgent(
    agent: BaseAgent,
    initialPrompt: string,
    options: { timeoutMs?: number } = { timeoutMs: 300_000 }
  ): Promise<string> { /* T-A-9 */ return '' }

  protected async onToolResult(toolName: string, result: ToolResult): Promise<void> { /* T-A-10 */ }

  protected extractContext(): Record<string, unknown> { return { lastCronAt: this.lastCronAt } }
  protected restoreContext(context: Record<string, unknown>): void { this.lastCronAt = context.lastCronAt as string ?? null }
}
```
