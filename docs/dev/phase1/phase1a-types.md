# Phase 1a：类型定义与工具 Schema

**目标**：实现 `src/types.ts` 类型定义和 `src/tools/index.ts` 中的工具 schema 定义。

---

## 1. 类型定义（`src/types.ts`）

### 1.1 OpenAI 类型重导出

从 `openai/resources/chat/completions` 重新导出以下类型：
- `ChatCompletionMessageParam`
- `ChatCompletionTool`
- `ChatCompletionMessageToolCall`

### 1.2 Agent 状态类型

实现 `AgentState` 联合类型：
- `'idle'` - 空闲
- `'running'` - 运行中
- `'waiting'` - 等待输入
- `'error'` - 错误状态

### 1.3 Task 类型

实现 `Task` 类型：
- `id: string` - 任务唯一标识
- `type: 'search' | 'deliver'` - 任务类型
- `payload: Record<string, unknown>` - 任务负载数据
- `status: 'pending' | 'in_progress' | 'completed' | 'failed'` - 任务状态

### 1.4 Session 类型

实现 `Session` 类型，与 `workspace/agents/{name}/session.json` 结构对应：
- `currentTask: Task | null` - 当前任务
- `context: Record<string, unknown>` - Agent 上下文数据
- `messages: ChatCompletionMessageParam[]` - 消息历史
- `todos: string[]` - 待办事项列表

---

## 2. 工具 Schema 定义（`src/tools/index.ts`）

### 2.1 read_file

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 相对于 workspace 的文件路径 |
| offset | number | 否 | 分页起始字符位置，用于读取大文件 |

工具描述应说明：读取指定路径的文件内容，大文件会报错并提示分页。

### 2.2 write_file

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 相对于 workspace 的文件路径 |
| old_string | string | 是 | 要替换的原始文本（必须唯一匹配） |
| new_string | string | 是 | 替换后的新文本 |

工具描述应说明：只有当 `old_string` 在文件中恰好出现一次时才执行替换，否则返回错误。

### 2.3 append_file

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 相对于 workspace 的文件路径 |
| content | string | 是 | 要追加的内容 |

工具描述应说明：向文件末尾追加内容，文件不存在时自动创建。

### 2.4 list_directory

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 相对于 workspace 的目录路径 |

工具描述应说明：返回目录下的所有条目，标注文件或目录类型。

### 2.5 lock_file

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 要锁定的目标文件路径 |
| holder | string | 是 | 持有者 Agent 名称 |

工具描述应说明：获取文件锁，锁超时时间为 30 秒，已锁定且未超时则返回失败。

### 2.6 unlock_file

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| path | string | 是 | 要解锁的目标文件路径 |
| holder | string | 是 | 持有者 Agent 名称 |

工具描述应说明：释放文件锁，验证持有者身份后才执行。

### 2.7 工具 Schema 导出

导出 `TOOLS: ChatCompletionTool[]` 数组，包含上述六个工具的完整定义。

---

## 测试计划

### T1.1 TypeScript 编译验证

**目的**：验证类型定义语法正确且可被其他模块使用。

**步骤**：
1. 创建测试文件，导入所有类型
2. 声明各类型的变量并赋值
3. 运行 `tsc --noEmit` 检查编译

**预期结果**：
- 无编译错误
- 所有类型可正确导入和使用
- 类型推断正确（如 `AgentState` 只能赋值为四个字面量之一）

### T1.2 Session 类型结构验证

**目的**：验证 `Session` 类型与现有 `session.json` 结构兼容。

**步骤**：
1. 读取 `workspace/agents/main/session.json`
2. 将内容作为 `Session` 类型变量
3. 检查类型兼容性

**预期结果**：
- 现有 JSON 文件结构完全匹配 `Session` 类型
- 无类型错误

### T1.3 工具 Schema 结构验证

**目的**：验证工具 schema 符合 OpenAI function calling 格式。

**步骤**：
1. 导出 `TOOLS` 数组
2. 验证每个工具有 `type: 'function'` 字段
3. 验证每个工具有 `function.name` 和 `function.description`
4. 验证参数 schema 包含正确的 `type`、`properties`、`required`

**预期结果**：
- 所有工具 schema 结构完整
- 参数定义与设计文档一致
- 可直接用于 OpenAI API 调用

### T1.4 工具 Schema JSON 序列化

**目的**：验证工具 schema 可被正确序列化为 JSON。

**步骤**：
1. 将 `TOOLS` 数组序列化为 JSON 字符串
2. 检查序列化结果
3. 反序列化并验证结构完整

**预期结果**：
- JSON 序列化成功
- 无循环引用或其他序列化错误
- 反序列化后数据完整

---

## 验收标准

- [ ] `tsc --noEmit` 无错误
- [ ] 所有类型定义完整且符合设计文档
- [ ] 六个工具 schema 定义完整
- [ ] `TOOLS` 数组可导出使用
