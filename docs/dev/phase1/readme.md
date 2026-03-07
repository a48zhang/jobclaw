# Phase 1：类型定义与工具层

**目标**：实现 `src/types.ts` 和 `src/tools/index.ts`，这是所有 Agent 的基础。

### 任务清单

#### 1.1 类型定义（`src/types.ts`）

- 从 `openai/resources/chat/completions` 重新导出 `ChatCompletionMessageParam`、`ChatCompletionTool`、`ChatCompletionMessageToolCall`
- 实现 `AgentState` 联合类型：`'idle' | 'running' | 'waiting' | 'error'`
- 实现 `Task` 类型：包含 `id`、`type`（search/deliver）、`payload`、`status`
- 实现 `Session` 类型：与 `session.json` 结构对应，包含 `currentTask`、`context`、`messages`、`todos`

#### 1.Tool 1.2 工具定义（`src/tools/index.ts`）

按 agent-design 3.1，定义六个工具的 OpenAI function calling schema：

- `read_file`：参数 `path`（字符串）、可选 `offset`（分页起始字符位置）
- `write_file`：参数 `path`、`old_string`、`new_string`
- `append_file`：参数 `path`、`content`
- `list_directory`：参数 `path`
- `lock_file`：参数 `path`（目标文件路径）、`holder`（持有者 Agent 名称）
- `unlock_file`：参数 `path`、`holder`

工具说明文字直接向 Agent 解释正确用法（如 `write_file` 说明 old_string 唯一匹配才会替换）。

#### 1.3 工具执行器（`src/tools/index.ts`）

实现 `executeTool(name, args, workspaceRoot)` 函数：

- 所有路径操作均在 `workspaceRoot` 下进行，拒绝路径穿越（`..` 段）
- `read_file`：读取文件，超过 10000 tokens 时截断并在返回中标注剩余大小和分页提示
- `write_file`：验证 `old_string` 在文件中恰好出现一次，否则返回错误信息而不修改文件
- `append_file`：打开文件追加，文件不存在时自动创建
- `list_directory`：返回条目列表（标注文件/目录类型）
- `lock_file`：在 `workspace/.locks/` 下创建 `{filename}.lock` 文件，内容包含持有者和时间戳；若锁已存在且未超过 30 秒则返回失败
- `unlock_file`：验证 `holder` 与锁文件中持有者一致后删除锁文件

#### 1.4 访问边界强制

在 `executeTool` 中根据工具调用方的 `agentName` 限制路径范围：

- 私有路径 `workspace/agents/{name}/`：只有对应 Agent 可写
- 共享路径 `workspace/data/`：所有 Agent 可读，写入前必须持有文件锁
- 拒绝访问 `workspace/agents/` 下其他 Agent 的目录

### 验收标准

各工具函数通过手动调用验证文件读写、截断、锁机制行为正确。
