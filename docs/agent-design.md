# Agent 核心实现方案

## 1. 整体设计

```
┌─────────────────────────────────────────────────────────────┐
│                        BaseAgent                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                 Tool-Driven Loop                     │   │
│  │   Think → Act (Tool Call) → Observe → Think ...     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │   LLM Client  │  │     Tools     │  │   MCP Client  │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ 继承
                 ┌────────────┴────────────┐
                 │                         │
        ┌───────────────┐        ┌───────────────┐
        │  MainAgent    │        │ DeliveryAgent │
        │ (搜索+交互)   │        │  (自动投递)   │
        └───────┬───────┘        └───────────────┘
                │ spawnAgent(deliveryAgent, ...)
                └──────串行，共享 MCP 实例──────▶
```

**两 Agent 架构**：
- **MainAgent**：处理用户交互，同时**直接**通过 Playwright MCP 搜索职位（无独立 SearchAgent）。支持 `runEphemeral()` 被 CronJob 无状态拉起。
- **DeliveryAgent**：专注表单投递，**仅**通过 `spawnAgent` 以子进程形式运行（最多 50 步，独立上下文），永不直接 `run()`。
- **共享 MCP 实例**：两 Agent 共用同一 `mcpClient`（同一浏览器）。`spawnAgent` 串行 `await`，保证不并发操作浏览器。

---

## 2. 类型定义

**文件**: `src/types.ts`

直接从 `openai/resources/chat/completions` 导入标准类型：
- `ChatCompletionMessageParam`：消息类型
- `ChatCompletionTool`：工具定义类型
- `ChatCompletionMessageToolCall`：工具调用类型

业务类型：
- `AgentState`：Agent 运行状态（idle/running/waiting/error）
- `Task`：任务定义
- `Session`：session.json 的结构

---

## 3. Tools 定义

**文件**: `src/tools/index.ts`

### 3.1 文件工具

定义六个本地文件操作工具，遵循 OpenAI function calling 格式：

- `read_file`：读取文件，限制 10k tokens，超出截断
- `write_file`：写入文件
- `append_file`：追加内容到文件末尾
- `list_directory`：列出目录内容
- `lock_file`：获取文件锁，用于共享文件写入前
- `unlock_file`：释放文件锁

### 3.2 工具执行器

`executeTool(name, args)` 函数：
- 根据工具名分发到对应处理逻辑
- `read_file`：拼装路径，检查文件存在，内容过长报错
- `write_file`：写入指定文件.传入old_string和new_string,只有old_string在文件中唯一匹配时替换为new_string
- `append_file`：读取现有内容后追加
- `list_directory`：使用 fs 列出目录条目
- `lock_file`：创建锁文件，记录持有者和时间戳，超时 30 秒自动失效
- `unlock_file`：删除锁文件，验证持有者身份

---

## 4. BaseAgent 实现

**目录**: `src/agents/base/`

### 4.1 文件结构

```
src/agents/base/
├── index.ts              # 导出入口，重新导出所有公共 API
├── agent.ts              # BaseAgent 核心类（约 300 行）
├── types.ts              # 类型定义（MCPClient、AgentSnapshot、BaseAgentConfig）
├── constants.ts          # 常量定义（上下文窗口、压缩阈值等）
└── context-compressor.ts # 上下文压缩模块
```

### 4.2 模块职责

| 模块 | 职责 |
|------|------|
| `agent.ts` | BaseAgent 核心逻辑：主循环、工具调用、会话管理 |
| `types.ts` | MCPClient、AgentSnapshot、BaseAgentConfig 接口定义 |
| `constants.ts` | CONTEXT_WINDOW、COMPRESS_THRESHOLD 等常量 |
| `context-compressor.ts` | ContextCompressor 类：token 计算、消息压缩、摘要生成 |
| `index.ts` | 统一导出，保持向后兼容 |

### 4.3 属性

- `openai`：OpenAI 客户端实例
- `mcpClient`：MCP 客户端
- `systemPrompt`：系统提示词（抽象属性，由子类实现），仅包含角色、职责、记忆文件路径等语义信息
- `agentName`：Agent 名称
- `model`：使用的模型
- `state`：当前运行状态
- `maxIterations`：最大循环次数（默认 50）
- `compressor`：ContextCompressor 实例

### 4.4 方法

#### getAvailableTools()

获取所有可用工具：
1. 收集本地文件工具
2. 如果有 MCP 客户端，获取 MCP 工具并转换为 OpenAI 格式
3. 返回合并后的工具列表

#### executeToolCall(toolCall)

执行工具调用：
1. 解析工具名和参数
2. 本地工具直接调用 executeTool
3. 其他工具通过 MCP 客户端调用
4. **所有 tool call 统一设 2 分钟超时**（`Promise.race` + `AbortController`），超时返回错误字符串
5. 捕获异常并返回错误信息
6. 执行 `onToolResult(toolName, result)` 钩子（若子类实现）

#### onToolResult(toolName, result)

工具执行结果回调钩子，子类可覆盖：
- 默认实现为空
- 用于在工具执行后触发副作用（如发送通知）
- 参数：工具名称、执行结果

#### run(input)

Agent 主循环（交互模式）：

1. 初始化消息列表，加入 system prompt 和 user input
2. 获取可用工具
3. 循环（最多 `maxIterations` 次，默认 50）：
   - 调用 LLM，设置 `tool_choice: 'auto'`
   - 根据 `finish_reason` 决定：
     - `stop`：返回结果
     - `length`：报错
     - `tool_calls`：执行工具调用，将结果加入消息，继续循环
4. 超过最大循环次数时停止，不再重试

#### runEphemeral(initialPrompt, options?)

无状态单次执行模式（BaseAgent 提供，子类无需覆盖）：

- 保存并恢复当前 `messages`，执行完毕后销毁临时上下文，**不读写 `session.json`**
- `options.maxSteps`：最大步数，默认 50；子 Agent 用尽后**不重试**，直接返回结果
- `options.timeoutMs`：整次 ephemeral 运行的超时时间

#### loadSkill(name)

Skill 加载（BaseAgent 提供）：

- 优先读取 `workspace/skills/{name}.md`（用户可编辑）
- 回退到 `src/agents/skills/{name}.md`（代码级默认）
- 统一命名为 `jobclaw-skills.md`，各 SOP 作为文件内的章节

#### getState()

返回当前 Agent 状态的副本。

---

## 4.5 ContextCompressor（上下文压缩模块）

**文件**: `src/agents/base/context-compressor.ts`

独立的压缩模块，通过组合方式与 BaseAgent 配合：

### 接口定义

```typescript
export interface ContextCompressorConfig {
  openai: OpenAI
  summaryModel: string
  keepRecentMessages: number
}

export class ContextCompressor {
  constructor(config: ContextCompressorConfig)
  
  calculateTokens(messages: ChatCompletionMessageParam[]): number
  async checkAndCompress(messages: ChatCompletionMessageParam[]): Promise<ChatCompletionMessageParam[]>
}
```

### 方法说明

#### calculateTokens(messages)

计算消息列表的 token 数：
- 统计每条消息的 content
- 统计 tool_calls 和 tool_call_id
- 使用 gpt-tokenizer 的 encode 函数

#### checkAndCompress(messages)

检查并执行压缩：
- 未达阈值：原样返回
- 超过阈值：调用 compressMessages 压缩后返回

#### compressMessages(messages)

压缩消息历史：
- 保留 system 消息
- 保留最近 keepRecentMessages 条消息
- 中间消息生成摘要替换

#### generateSummary(messages)

调用 LLM 生成摘要：
- 摘要内容：已完成任务、已知事实、待办事项
- 使用 summaryModel（默认 gpt-4o-mini）

---

## 5. 具体 Agent 实现

### 5.1 MainAgent

**目录**: `src/agents/main/`

主 Agent（同时也是"搜索 Agent"）：
- 继承 BaseAgent
- 负责用户交互（交互模式：`run()`）
- **简历制作 (Resume Mastery)**: 负责提取结构化数据、发起交互润色 (HITL)、通过 Typst 编译生成 PDF。遵循 `jobclaw-skills.md` 中的简历制作 SOP。
- **直接**通过 Playwright MCP 工具搜索职位（无独立 SearchAgent），遵循 `jobclaw-skills.md` 中的搜索 SOP
- 通过 `spawnAgent(deliveryAgent, instruction)` 将投递委托给 DeliveryAgent（串行）
- 支持 `runEphemeral(instruction)` 被 CronJob 无状态拉起（Ephemeral 模式）
- `systemPrompt` 通过 `loadSkill('jobclaw-skills')` 加载统一 Skill 文件，内含搜索 SOP 和去重 SOP
- 覆盖 `onToolResult()`：检测 `append_file` 写入 `jobs.md` 时通过 Channel 发送 `new_job` 通知

### 5.2 DeliveryAgent

**目录**: `src/agents/delivery/`

- 继承 BaseAgent
- **仅**通过 `spawnAgent` 以子进程形式运行（`runEphemeral`），永不直接 `run()`
- 最多执行 50 步，用尽后**不重试**，返回当前结果给 MainAgent
- 构造函数接收 MCP 客户端和 Channel
- `systemPrompt` 通过 `loadSkill('jobclaw-skills')` 加载统一 Skill 文件，内含投递 SOP
- 覆盖 `onToolResult(toolName, result)` 方法：
  - 检测 `write_file` 对 `jobs.md` 的状态更新（applied/failed/login_required）
  - 触发对应 Channel 通知（`delivery_success` / `delivery_failed` / `delivery_blocked`）

---

## 6. 记忆机制设计

### 6.1 记忆架构

```
workspace/
├── config.yaml              # Bootstrap 完成标志（首次运行后生成）
├── skills/                  # 用户级 Skill（可覆盖代码默认）
│   └── jobclaw-skills.md    # 统一 Skill 文件（含搜索/去重/投递 SOP）
├── agents/                  # Agent 私有文件
│   ├── main/
│   │   ├── session.json     # 会话记忆（会压缩）
│   │   └── notebook.md      # 笔记本（持久化）
│   └── delivery/
│       ├── session.json     # ephemeral 模式下不读写
│       └── notebook.md      # 笔记本（持久化）
│
└── data/                    # 共享数据（持久化，不压缩）
    ├── userinfo.md          # 用户信息
    ├── targets.md           # 监测目标
    └── jobs.md              # 已投递岗位
```

**文件分类**：

| 文件 | 类型 | 格式 | 压缩 | 说明 |
|------|------|------|------|------|
| session.json | Agent 私有 | JSON | 是 | 会话记忆，达到阈值压缩；ephemeral 模式不读写 |
| notebook.md | Agent 私有 | Markdown | 否 | 笔记本，持久化存储 |
| data/*.md | 共享数据 | Markdown | 否 | 持久化，不压缩 |
| config.yaml | 系统标志位 | YAML | 否 | Bootstrap 完成标志，不含运行时配置 |

---

### 6.2 文件用途

#### session.json（会话记忆）

Agent 的短期会话记忆，存储当前任务上下文和消息历史。JSON 格式，达到 75% token 阈值自动压缩。

#### notebook.md（笔记本）

Agent 的长期笔记本，存储重要知识。永不压缩，持久化存储，Agent 主动写入重要信息，跨会话保留。

---

### 6.3 共享数据文件

- **userinfo.md**：记录用户个人信息，用于投递简历时填写表单
- **targets.md**：记录监测的公司招聘主页和其他信息源
- **jobs.md**：记录已投递岗位及状态

---

### 6.4 读取限制

**工具层强制限制**：

- 单次读取最大 10000 tokens（约 40000 字符）
- 超出限制时截断并提示

**分页读取**：

支持分页读取大文件，返回内容、是否还有更多、总大小。

---

### 6.5 记忆压缩策略

#### 压缩触发

写入 session.json 后计算 token 数，超过 262144 * 75% = 196608 tokens 时触发压缩。

#### 压缩配置

- 上下文窗口：262144 tokens
- 压缩阈值：75%（196608 tokens）
- 压缩后目标：30%（约 78643 tokens）
- `keepRecentMessages`：保留完整消息数量，默认 20

#### 压缩流程

`compressSession(content, agentName, llm)` 函数：

1. 解析 session JSON
2. 提取关键信息（currentTask、todos、context）
3. 调用 LLM 压缩消息历史，保留最近 `keepRecentMessages` 条完整内容，更早的压缩为摘要
4. 合并压缩后的内容返回

#### Token 计算

使用 gpt-tokenizer 的 encode 函数计算 token 数。

---

### 6.6 记忆读写时机

- **启动时**：读取 session.json
- **执行中**：Agent 通过工具读写文件
- **完成后**：更新 session.json，检查是否需要压缩

---

### 6.7 初始化模板

#### session.json

```json
{
  "currentTask": null,
  "context": {},
  "messages": [],
  "todos": []
}
```

#### notebook.md

Agent 用于记录工作中需要长期记录的信息，由 Agent 自行组织内容。

---

### 6.8 记忆安全

**访问边界**：
- Agent 只能访问自己的 `workspace/agents/{name}/` 目录
- Agent 可以读取所有 `workspace/data/` 共享数据
- 工具层限制路径范围