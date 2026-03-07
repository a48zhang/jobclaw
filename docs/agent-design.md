# Agent 核心实现方案

## 1. 整体设计

```
┌─────────────────────────────────────────────────────────────┐
│                        BaseAgent                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    ReAct Loop                        │   │
│  │   Think → Act (Tool Call) → Observe → Think ...     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │   LLM Client  │  │     Tools     │  │   MCP Client  │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │ 继承
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  MainAgent    │    │ SearchAgent   │    │ DeliveryAgent │
│  (用户交互)    │    │  (职位抓取)   │    │  (自动投递)   │
└───────────────┘    └───────────────┘    └───────────────┘
```

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

定义四个本地文件操作工具，遵循 OpenAI function calling 格式：

- `read_file`：读取文件，限制 10k tokens，超出截断
- `write_file`：写入文件
- `append_file`：追加内容到文件末尾
- `list_directory`：列出目录内容

### 3.2 工具执行器

`executeTool(name, args)` 函数：
- 根据工具名分发到对应处理逻辑
- `read_file`：拼装路径，检查文件存在，内容过长报错
- `write_file`：写入指定文件.传入old_string和new_string,只有old_string在文件中唯一匹配时替换为new_string
- `append_file`：读取现有内容后追加
- `list_directory`：使用 fs 列出目录条目

---

## 4. BaseAgent 实现

**文件**: `src/agents/base.ts`

### 4.1 属性

- `openai`：OpenAI 客户端实例
- `mcpClient`：MCP 客户端
- `systemPrompt`：系统提示词（抽象属性，由子类实现）.自动插入所有可用工具与描述到prompt中
- `agentName`：Agent 名称
- `model`：使用的模型
- `state`：当前运行状态
- `maxIterations`：最大循环次数（默认 50）

### 4.2 方法

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
4. 捕获异常并返回错误信息

#### run(input)

Agent 主循环：

1. 初始化消息列表，加入 system prompt 和 user input
2. 获取可用工具
3. 循环（最多 maxIterations 次）：
   - 调用 LLM，设置 `tool_choice: 'auto'`
   - 根据 `finish_reason` 决定：
     - `stop`：返回结果
     - `length`：报错
     - `tool_calls`：执行工具调用，将结果加入消息，继续循环
4. 超过最大循环次数询问用户是否继续

#### getState()

返回当前 Agent 状态的副本。

---

## 5. 具体 Agent 实现

### 5.1 MainAgent

**文件**: `src/agents/main.ts`

主 Agent：
- 继承 BaseAgent
- 负责用户交互
- 管理任务队列，分发任务到其他 Agent
- 协调 Agent 间通信

### 5.2 SearchAgent

**文件**: `src/agents/search.ts`

- 继承 BaseAgent
- 构造函数接收 MCP 客户端
- 实现 systemPrompt：定义为信息搜集 Agent
- 说明记忆文件路径

### 5.3 DeliveryAgent

**文件**: `src/agents/delivery.ts`

- 继承 BaseAgent
- 构造函数接收 MCP 客户端和 Channel
- 实现 systemPrompt：定义为投递 Agent
- 覆盖 run 方法：调用父类 run 后，通过 Channel 发送通知

---

## 6. 记忆机制设计

### 6.1 记忆架构

```
workspace/
├── agents/                  # Agent 私有文件
│   ├── main/
│   │   ├── session.json     # 会话记忆（会压缩）
│   │   └── notebook.md      # 笔记本（持久化）
│   ├── search/
│   │   ├── session.json
│   │   └── notebook.md
│   └── delivery/
│       ├── session.json
│       └── notebook.md
│
└── data/                    # 共享数据（持久化，不压缩）
    ├── userinfo.md          # 用户信息
    ├── targets.md           # 监测目标
    └── jobs.md              # 已投递岗位
```

**文件分类**：

| 文件 | 类型 | 格式 | 压缩 | 说明 |
|------|------|------|------|------|
| session.json | Agent 私有 | JSON | 是 | 会话记忆，达到阈值压缩 |
| notebook.md | Agent 私有 | Markdown | 否 | 笔记本，持久化存储 |
| data/*.md | 共享数据 | Markdown | 否 | 持久化，不压缩 |

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

#### 压缩流程

`compressSession(content, agentName, llm)` 函数：

1. 解析 session JSON
2. 提取关键信息（currentTask、todos、context）
3. 调用 LLM 压缩消息历史，保留最近 5 条完整内容，更早的压缩为摘要
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