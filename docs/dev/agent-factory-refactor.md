# Agent Factory 重构计划

> 去掉 runEphemeral，改用新实例 + 工厂模式。DeliveryAgent 转为 skill，不再作为独立 Agent。

## 背景

当前 `runEphemeral()` 方法用于执行临时任务，通过在同一实例上临时替换 `messages` 实现状态隔离。这种设计存在以下问题：

1. **状态复杂**：`runningEphemeral` 标志影响多处逻辑
2. **队列吞没风险**：`consumePendingQueuedInputs()` 在 ephemeral 模式下返回 0
3. **测试复杂**：需要处理状态恢复测试
4. **并发限制**：同一实例只能串行执行，无法真正并行
5. **架构冗余**：DeliveryAgent 本质上是 MainAgent + delivery skill，无需独立存在

## 架构设计

### 核心变化

```
Before:
- MainAgent (主对话)
- DeliveryAgent (投递专用 Agent)
- 通过 run_delivery_agent 工具调用

After:
- MainAgent (唯一 Agent 类型)
- Delivery 功能转为 skill (skills/delivery.md)
- 通过 run_agent 工具创建临时 MainAgent 执行 skill
```

### 新架构图

```
┌─────────────────────────────────────────────────────────────┐
│                     AgentFactory                            │
├─────────────────────────────────────────────────────────────┤
│  共享资源：                                                  │
│  - mcpClient: MCPClient (Playwright 连接)                   │
│  - openai: OpenAI                                           │
│  - workspaceRoot: string                                    │
│  - model / lightModel: string                               │
├─────────────────────────────────────────────────────────────┤
│  createAgent(options) → MainAgent                           │
│  - options: { agentName?, persistent?, channel? }           │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    run_agent 工具                           │
├─────────────────────────────────────────────────────────────┤
│  {                                                          │
│    "instruction": "投递职位",    // 任意指令                │
│    "skill": "delivery",          // 可选，指定 skill        │
│    "timeout_ms": 300000          // 可选                    │
│  }                                                          │
│                                                             │
│  创建临时 MainAgent 执行指令，静默执行后返回结果             │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    MainAgent Instance                       │
├─────────────────────────────────────────────────────────────┤
│  - 独立的 messages[]                                        │
│  - 独立的 state                                             │
│  - 共享的 mcpClient (引用)                                  │
│  - persistent: 控制是否保存 session                         │
│  - 可通过 run_agent 工具创建子 Agent                        │
└─────────────────────────────────────────────────────────────┘
```

### 示例：任务执行

```
MainAgent (用户对话, persistent=true)
    │
    └── run_agent(skill="delivery", instruction="投递职位")
            └── 临时 MainAgent (加载 delivery skill, 静默执行, 返回结果)

MainAgent (用户对话)
    │
    └── run_agent(instruction="生成简历")
            └── 临时 MainAgent (静默执行, 返回结果)
```

## 实施步骤

### Step 1: 更新 BaseAgent 配置

**文件**: `src/agents/base/types.ts`

```typescript
export interface BaseAgentConfig {
  openai: OpenAI
  agentName: string
  model: string
  lightModel?: string
  workspaceRoot: string
  mcpClient?: MCPClient
  channel?: Channel
  maxIterations?: number
  keepRecentMessages?: number
  persistent?: boolean  // 是否持久化 session，默认 false
  factory?: AgentFactory
}
```

**文件**: `src/tools/index.ts`

```typescript
export interface ToolContext {
  workspaceRoot: string
  agentName: string
  logger: (line: string) => void
  factory?: AgentFactory  // 由 BaseAgent 显式传入，供 run_agent 使用
}
```

### Step 2: 更新 BaseAgent 实现

**文件**: `src/agents/base/agent.ts`

```typescript
export abstract class BaseAgent extends EventEmitter {
  // ... 现有属性 ...
  
  protected persistent: boolean
  protected factory?: AgentFactory

  constructor(config: BaseAgentConfig) {
    super()
    // ... 现有初始化 ...
    this.persistent = config.persistent ?? false
    this.factory = config.factory
  }

  // 修改 saveSession：检查 persistent
  protected async saveSession(): Promise<void> {
    if (!this.persistent) return
    
    const session: Session = {
      currentTask: this.currentTask,
      context: this.extractContext(),
      messages: this.messages.filter((m) => m.role !== 'system'),
      todos: [],
      finishReason: this.lastFinishReason,
    }
    utils.saveSession(this.getSessionPath(), session)
  }

  // 修改 consumePendingQueuedInputs：删除 ephemeral 检查
  private consumePendingQueuedInputs(): number {
    if (this.messageQueue.length === 0) return 0
    const pending = this.messageQueue.splice(0)
    for (const input of pending) {
      this.messages.push({ role: 'user', content: input })
    }
    return pending.length
  }

  // 删除 runEphemeral() 方法
  // 删除 runningEphemeral 属性
}
```

### Step 3: 创建 AgentFactory

**文件**: `src/agents/factory.ts`

```typescript
import type OpenAI from 'openai'
import type { MCPClient } from './base/types.js'
import type { Channel } from '../channel/base.js'
import { MainAgent } from './main/index.js'

export interface AgentFactoryConfig {
  openai: OpenAI
  mcpClient?: MCPClient
  workspaceRoot: string
  model: string
  lightModel: string
}

export interface CreateAgentOptions {
  agentName?: string
  persistent?: boolean
  channel?: Channel
}

export class AgentFactory {
  constructor(private config: AgentFactoryConfig) {}

  createAgent(options: CreateAgentOptions = {}): MainAgent {
    return new MainAgent({
      openai: this.config.openai,
      mcpClient: this.config.mcpClient,
      workspaceRoot: this.config.workspaceRoot,
      model: this.config.model,
      lightModel: this.config.lightModel,
      agentName: options.agentName ?? this.generateAgentName(),
      channel: options.channel,
      persistent: options.persistent ?? false,
      factory: this,
    })
  }

  private generateAgentName(): string {
    const timestamp = Date.now().toString(36)
    return `agent-${timestamp}`
  }
}
```

### Step 4: 添加 run_agent 工具

**文件**: `src/tools/runAgent.ts`

```typescript
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import type { ToolContext, ToolResult } from './index.js'
import { AgentFactory } from '../agents/factory.js'

export const RUN_AGENT_TOOL: ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'run_agent',
    description: `创建临时 Agent 执行任务，静默执行后返回结果。

可用于执行独立的子任务，如：
- 简历生成、职位搜索等独立任务
- 使用特定 skill 执行任务（如 delivery skill 执行投递）

子 Agent 不会影响当前会话历史。`,
    parameters: {
      type: 'object',
      properties: {
        instruction: {
          type: 'string',
          description: '传递给子 Agent 的任务指令',
        },
        skill: {
          type: 'string',
          description: '可选，指定要加载的 skill（如 delivery）',
        },
        timeout_ms: {
          type: 'number',
          description: '超时时间（毫秒），默认 300000 (5分钟)',
        },
      },
      required: ['instruction'],
      additionalProperties: false,
    },
  },
}

export async function executeRunAgent(
  args: Record<string, unknown>,
  context: ToolContext
): Promise<ToolResult> {
  const { instruction, skill, timeout_ms } = args as {
    instruction: string
    skill?: string
    timeout_ms?: number
  }

  const factory = context.factory
  if (!factory) {
    return {
      success: false,
      content: '',
      error: 'AgentFactory 未注入，无法创建子 Agent',
    }
  }

  try {
    // 构建带 skill 的指令
    const fullInstruction = skill
      ? `使用 ${skill} skill 执行以下任务：\n${instruction}`
      : instruction

    // 子 Agent 静默执行（无 channel）
    const subAgent = factory.createAgent()

    const timeout = timeout_ms ?? 300_000
    let timedOut = false
    const result = await Promise.race([
      subAgent.run(fullInstruction).then((value) => {
        if (timedOut) {
          throw new Error('Agent finished after timeout and result was discarded')
        }
        return value
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          timedOut = true
          reject(new Error('Agent timeout'))
        }, timeout)
      ),
    ])

    return {
      success: true,
      content: result,
    }
  } catch (error) {
    return {
      success: false,
      content: '',
      error: `子 Agent 执行失败: ${(error as Error).message}`,
    }
  }
}
```

### Step 4.1: 明确超时语义

`run_agent` 的超时不是“中断 Node.js Promise”那么简单，计划中需要明确以下语义：

1. 超时后，当前工具调用立刻向父 Agent 返回失败。
2. 超时后，子 Agent 的后续结果一律丢弃，不允许再回写到父 Agent 上下文。
3. 第一阶段先实现“协作式超时语义”，即超时后标记子 Agent 结果失效；不承诺立刻杀死底层异步任务。
4. 如果后续发现超时后仍有不可接受的副作用，再追加 BaseAgent 级别的 abort/cancel 机制。

这一步必须写入计划，否则 `Promise.race` 只是在调用方视角超时，实际子任务仍可能继续执行并改写文件。

### Step 5: 更新 MainAgent

**文件**: `src/agents/main/index.ts`

```typescript
// 删除 IDeliveryAgent 接口
// 删除 deliveryAgent 依赖
// 删除 run_delivery_agent 工具
// 删除 spawnAgent 方法

export interface MainAgentConfig extends BaseAgentConfig {
  channel?: Channel
}

export class MainAgent extends BaseAgent {
  constructor(config: MainAgentConfig) {
    super({ ...config, agentName: config.agentName ?? 'main' })
  }

  protected get systemPrompt(): string {
    const skills = this.loadSkill('index')
    const mcpWarning = this.mcpClient ? '' : MCP_NOT_CONNECTED_WARNING
    return `你是 JobClaw 的 Agent，负责用户交互、职位搜索与任务执行。
${mcpWarning}
## 角色职责
- 与用户进行自然语言交互
- 使用 Playwright MCP 工具访问招聘网站
- 通过 run_agent 工具执行独立子任务
- 统一负责向用户发送任务结果与状态通知

## 可用技能索引
${skills}
${RESUME_SYSTEM_PROMPT}
${INTERVIEW_AND_RESUME_PROMPT}
## 可用工具
- run_agent: 创建临时 Agent 执行子任务
- upsert_job: 更新职位信息
- typst_compile: 编译简历
- Playwright MCP 工具: 浏览器操作
- 文件工具: read_file, write_file 等
`
  }

  // getAvailableTools 继承 BaseAgent（已包含 run_agent）
}
```

### Step 5.1: 主 Agent 统一通知

删除 DeliveryAgent 后，通知责任也一并上收给主 Agent：

1. 子 Agent 默认静默执行，不直接发送 channel 消息。
2. 主 Agent 根据 `run_agent` 的工具返回结果决定是否通知用户。
3. 原有 `delivery_start`、`delivery_success`、`delivery_failed`、`delivery_blocked` 整体下线。
4. TUI/Web/Email 只保留主 Agent 统一输出，不再保留专用 Delivery 通知通道。

这样职责边界才是闭合的：子 Agent 只做任务，主 Agent 负责对外表达。

### Step 6: 更新 delivery skill

**文件**: `src/agents/skills/delivery.md`

确保 delivery skill 包含完整的投递流程指引，MainAgent 加载后可执行投递任务。

### Step 7: 更新工具注册

**文件**: `src/tools/index.ts`

```typescript
import { RUN_AGENT_TOOL, executeRunAgent } from './runAgent.js'

export const TOOLS: ChatCompletionTool[] = [
  // ... 现有工具 ...
  RUN_AGENT_TOOL,
]

export async function executeTool(
  name: string, 
  args: Record<string, unknown>, 
  context: ToolContext
): Promise<ToolResult> {
  switch (name) {
    // ... 现有工具 ...
    case 'run_agent':
      return executeRunAgent(args, context)
    default:
      return { success: false, content: '', error: `未知工具: ${name}` }
  }
}
```

### Step 7.1: 本地工具识别改为自动推导

当前 BaseAgent 里 `localTools` 是硬编码数组，这会导致每新增一个本地工具都要改两处，计划中应一并修掉。

建议方案：

1. 由 `src/tools/index.ts` 导出 `LOCAL_TOOL_NAMES`。
2. `executeTool()` 和 `TOOLS` 作为唯一事实来源。
3. BaseAgent 在执行工具时通过 `LOCAL_TOOL_NAMES` 判断是否走本地工具路径，而不是继续维护硬编码数组。
4. `run_agent` 作为本地工具自动纳入，无需额外手动补名单。

这样文档里关于“localTools 列表缺少 run_agent”的问题才能从根上消失，而不是继续打补丁。

### Step 8: 更新调用方

#### 8.1 tui-runner.ts

```typescript
// 在当前进程内初始化工厂实例
const factory = new AgentFactory({
  openai,
  mcpClient,
  workspaceRoot,
  model: config.MODEL_ID,
  lightModel: config.LIGHT_MODEL_ID,
})

// 创建持久化主 Agent
const mainAgent = factory.createAgent({
  persistent: true,
  agentName: 'main',
  channel: tui.tuiChannel,
})
```

#### 8.2 cron.ts

```typescript
export async function runCron(workspaceRoot: string, mode: 'search' | 'digest' = 'search') {
  const factory = new AgentFactory({
    openai,
    mcpClient,
    workspaceRoot,
    model: config.MODEL_ID,
    lightModel: config.LIGHT_MODEL_ID,
  })
  
  if (mode === 'search') {
    const searchAgent = factory.createAgent()
    await searchAgent.run('搜索 targets.md 中所有公司的最新职位...')
  } else {
    const digestAgent = factory.createAgent({ channel })
    await digestAgent.run('分析 jobs.md 中的新增岗位并发送日报汇总...')
  }
}
```

这里必须保留 `mode` 语义，不能把 search 和 digest 强行合并为一次运行内的两个步骤，否则会改变当前 cron 行为。

#### 8.3 server.ts

```typescript
// REST API
app.post('/api/resume/build', async (c) => {
  const factory = new AgentFactory({
    openai,
    mcpClient,
    workspaceRoot,
    model: config.MODEL_ID,
    lightModel: config.LIGHT_MODEL_ID,
  })
  const agent = factory.createAgent()
  agent.run('生成简历').catch(...)
  return c.json({ ok: true })
})
```

如果 server 不能直接访问 `openai/config/mcpClient`，则应在 `createApp()` 或 `startServer()` 时把 factory 显式注入进去，而不是依赖全局单例。

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/agents/factory.ts` | 新建 | AgentFactory 实现 |
| `src/tools/runAgent.ts` | 新建 | run_agent 工具实现 |
| `src/agents/base/types.ts` | 修改 | 添加 persistent 配置 |
| `src/agents/base/agent.ts` | 修改 | 删除 runEphemeral，添加 persistent 支持 |
| `src/agents/main/index.ts` | 修改 | 简化，删除 deliveryAgent 相关代码 |
| `src/agents/delivery/index.ts` | 删除 | 不再需要独立 Agent |
| `src/tools/index.ts` | 修改 | 注册 run_agent 工具 |
| `src/cron.ts` | 修改 | 使用工厂创建临时实例 |
| `src/web/server.ts` | 修改 | 使用工厂创建临时实例 |
| `src/tui-runner.ts` | 修改 | 使用工厂创建持久化 mainAgent |
| `tests/unit/agents/delivery.test.ts` | 删除 | 不再需要 |
| `tests/unit/base.test.ts` | 修改 | 删除 runEphemeral 相关断言，改测 run_agent / queue 行为 |
| `tests/unit/web/server.test.ts` | 修改 | 将 runEphemeral mock 替换为工厂/临时 Agent 调用 |
| `tests/unit/cron*.test.ts` | 新增或修改 | 覆盖 search/digest 两种模式 |

### 删除内容

| 内容 | 说明 |
|------|------|
| `runEphemeral()` 方法 | BaseAgent |
| `runningEphemeral` 属性 | BaseAgent |
| `IDeliveryAgent` 接口 | main/index.ts |
| `run_delivery_agent` 工具 | main/index.ts |
| `spawnAgent()` 方法 | main/index.ts |
| `DeliveryAgent` 类 | 整个文件删除 |
| Delivery 专用 Channel 消息类型 | channel/* |

## Channel 策略

### 规则

1. **主 Agent 有 channel**：TUI/Web 主 Agent 通过工厂创建时传入 channel
2. **子 Agent 静默执行**：不传 channel，执行完毕返回结果
3. **主 Agent 负责通知**：任务状态由主 Agent 根据子任务结果统一决定是否通知

### 投递状态处理

子 Agent 执行投递时：
- 状态通过 `upsert_job` 写入 `data/jobs.md`
- 子 Agent 不直接发送 channel 消息
- 主 Agent 根据 `run_agent` 返回结果、`jobs.md` 变化或后续汇总逻辑统一通知

```
投递流程:
子 Agent → upsert_job → jobs.md
                         ↓
主 Agent ← 读取 jobs.md → 日报/查询响应
```

**删除 DeliveryAgent 的 onToolResult 逻辑**：原有 delivery 专用通知全部下线，由主 Agent 统一表达。

## Session 持久化规则

| Agent 类型 | persistent | session 文件 | 说明 |
|------------|------------|--------------|------|
| TUI/Web 主 Agent | true | `agents/main/session.json` | 持久化对话历史 |
| Cron 临时 Agent | false | 无 | 单次任务 |
| REST API Agent | false | 无 | 单次任务 |
| 子 Agent (run_agent) | false | 无 | 临时任务 |

## 风险评估

### 工厂生命周期

**问题**: `AgentFactory.getInstance()` 依赖全局单例，容易在 cron、test、server 等独立入口中出现未初始化错误。

**解决方案**: 不使用全局 singleton。每个入口显式创建 factory，并通过 `BaseAgentConfig.factory` / `ToolContext.factory` 逐层传递。

### MCP 连接共享

**问题**: 多个 Agent 实例共享 MCP 连接可能导致并发冲突。

**解决方案**: `run_agent` 工具同步等待结果，天然串行执行，无并发问题。

### Delivery Skill 有效性

**问题**: Skill 是否足够指导 Agent 完成投递任务？

**解决方案**: 确保 `skills/delivery.md` 包含完整的投递流程指引。

### 已识别的技术细节

| 问题 | 解决方案 | 文件 |
|------|----------|------|
| `types.ts` 缺少 `persistent` | 添加到 `BaseAgentConfig` | `src/agents/base/types.ts` |
| `run_agent` 无法访问工厂 | 在 `ToolContext` 和 `BaseAgentConfig` 显式注入 `factory` | `src/tools/index.ts` / `src/agents/base/types.ts` |
| `localTools` 硬编码易漏改 | 导出 `LOCAL_TOOL_NAMES`，BaseAgent 自动识别本地工具 | `src/tools/index.ts` / `src/agents/base/agent.ts` |
| `DeliveryAgent.onToolResult` 逻辑 | 删除，状态写入 jobs.md | 删除整个文件 |
| `run_agent` 超时后可能继续产生副作用 | 明确协作式超时语义，必要时追加 abort 机制 | `src/tools/runAgent.ts` / `src/agents/base/agent.ts` |
| cron 原有 mode 语义丢失 | 保留 `search | digest` 双模式 | `src/cron.ts` |

### 测试迁移计划

重构不只是删除 `delivery.test.ts`，还需要同步修复以下测试层：

1. BaseAgent 测试：删掉 `runEphemeral` 状态恢复用例，改为覆盖 `run_agent` 子任务隔离、超时语义、submit 队列消费。
2. Web Server 测试：将 `/api/resume/build`、`/api/resume/review` 的断言从 `runEphemeral` 改成“是否通过工厂创建临时 Agent 并启动任务”。
3. MainAgent 测试：新增 `run_agent` 注入、主 Agent 统一通知、delivery skill 调度路径。
4. Cron 测试：覆盖 `search` 和 `digest` 两种模式，确保行为未退化。

## 预期收益

1. **架构简化**: 只有一个 Agent 类型 (MainAgent)
2. **代码减少**: 删除 DeliveryAgent 类及相关接口
3. **灵活性**: 通过 skill 组合实现不同功能
4. **状态隔离**: 每个实例独立状态，无污染风险
5. **易于扩展**: 新功能通过添加 skill 实现，无需新建 Agent 类型
