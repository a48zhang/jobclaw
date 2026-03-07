# Phase 1b：工具执行器与访问控制

**目标**：实现 `src/tools/index.ts` 中的 `executeTool` 函数，包含文件操作、锁机制和访问边界强制。

---

## 1. 路径安全处理

### 1.1 路径规范化

所有工具操作的路径必须：
- 限制在 `workspaceRoot` 目录内
- 拒绝路径穿越（包含 `..` 段的路径）
- 规范化路径分隔符

### 1.2 锁文件目录

- 锁文件存放于 `workspaceRoot/.locks/` 目录
- 若目录不存在则自动创建

---

## 2. 工具执行器

### 2.1 函数签名

```
executeTool(name: string, args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>

ToolContext:
  - workspaceRoot: string
  - agentName: string

ToolResult:
  - success: boolean
  - content: string
  - error?: string
```

### 2.2 read_file 实现

**输入**：
- `path`: 文件路径
- `offset`: 可选，起始字符位置（默认 0）

**逻辑**：
1. 验证路径安全性
2. 检查文件存在性
3. 读取文件内容
4. 若内容超过 10000 tokens：
   - 截断内容
   - 在返回中标注剩余大小
   - 提供分页提示（建议使用 offset 参数）

**返回**：
- 成功：文件内容（可能截断）
- 失败：错误信息（文件不存在、无权限等）

### 2.3 write_file 实现

**输入**：
- `path`: 文件路径
- `old_string`: 要替换的原始文本
- `new_string`: 替换后的新文本

**逻辑**：
1. 验证路径安全性
2. 读取文件当前内容
3. 统计 `old_string` 出现次数
   - 若为 0：返回错误 "未找到匹配文本"
   - 若大于 1：返回错误 "找到多个匹配，请提供更具体的上下文"
   - 若恰好为 1：执行替换
4. 写入新内容

**返回**：
- 成功：确认替换完成
- 失败：具体错误信息（匹配失败、文件不存在、无权限等）

### 2.4 append_file 实现

**输入**：
- `path`: 文件路径
- `content`: 要追加的内容

**逻辑**：
1. 验证路径安全性
2. 若文件不存在则创建
3. 打开文件并追加内容
4. 追加后关闭文件

**返回**：
- 成功：确认追加完成
- 失败：错误信息（无权限等）

### 2.5 list_directory 实现

**输入**：
- `path`: 目录路径

**逻辑**：
1. 验证路径安全性
2. 检查目录存在性
3. 读取目录条目
4. 标注每个条目是文件还是目录

**返回格式**：
```
[DIR] subdir/
[FILE] file1.txt
[FILE] file2.md
```

### 2.6 lock_file 实现

**输入**：
- `path`: 目标文件路径
- `holder`: 持有者 Agent 名称

**逻辑**：
1. 验证路径安全性
2. 确保锁目录存在
3. 计算锁文件路径：`{locksDir}/{filename}.lock`
4. 若锁文件存在：
   - 读取锁内容（holder、timestamp）
   - 若 holder 相同：返回成功（重入锁）
   - 若未超过 30 秒：返回失败 "文件已被 {holder} 锁定"
   - 若超过 30 秒：覆盖旧锁
5. 创建锁文件，写入 holder 和当前时间戳

**返回**：
- 成功：确认获取锁
- 失败：当前锁持有者和剩余等待时间

### 2.7 unlock_file 实现

**输入**：
- `path`: 目标文件路径
- `holder`: 持有者 Agent 名称

**逻辑**：
1. 验证路径安全性
2. 计算锁文件路径
3. 若锁文件不存在：返回成功（已解锁）
4. 读取锁内容
5. 验证 holder 与锁文件中持有者一致
   - 一致：删除锁文件
   - 不一致：返回错误 "锁由 {actualHolder} 持有，无法释放"

**返回**：
- 成功：确认释放锁
- 失败：holder 不匹配的错误信息

---

## 3. 访问边界强制

### 3.1 路径分类

| 路径模式 | 类型 | 访问规则 |
|----------|------|----------|
| `workspace/agents/{name}/` | 私有路径 | 只有 {name} Agent 可写，其他 Agent 禁止访问 |
| `workspace/data/` | 共享路径 | 所有 Agent 可读，写入前必须持有文件锁 |
| `workspace/.locks/` | 系统路径 | 只有 lock/unlock_file 工具可访问 |

### 3.2 权限检查函数

实现 `checkPathPermission(path, agentName, operation)`：

**参数**：
- `path`: 规范化后的绝对路径
- `agentName`: 调用方 Agent 名称
- `operation`: `'read' | 'write'`

**逻辑**：
1. 若路径匹配 `workspace/agents/{other}/` 且 `{other} !== agentName`：
   - 返回 `denied`，原因：私有路径禁止访问
2. 若路径匹配 `workspace/data/` 且 `operation === 'write'`：
   - 检查是否存在有效锁且 holder === agentName
   - 若无锁或锁 holder 不匹配：返回 `denied`，原因：共享路径写入需要文件锁
3. 若路径匹配 `workspace/.locks/`：
   - 返回 `denied`，原因：系统路径禁止直接访问
4. 其他情况：返回 `allowed`

### 3.3 工具调用集成

在 `executeTool` 开头调用权限检查：
- 若返回 `denied`：立即返回错误，不执行工具逻辑

---

## 测试计划

### T2.1 路径穿越防护测试

**目的**：验证路径穿越攻击被正确拦截。

**测试用例**：

| 输入路径 | 预期结果 |
|----------|----------|
| `../outside.txt` | 拒绝，路径穿越 |
| `subdir/../../outside.txt` | 拒绝，路径穿越 |
| `./normal.txt` | 允许 |
| `subdir/file.txt` | 允许 |
| `..\\outside.txt` | 拒绝，路径穿越（Windows 风格） |

### T2.2 read_file 测试

**测试用例**：

| 场景 | 预期结果 |
|------|----------|
| 读取存在的文件 | 返回文件内容 |
| 读取不存在的文件 | 返回错误 |
| 读取大文件（>10000 tokens） | 返回截断内容和分页提示 |
| 使用 offset 分页读取 | 返回指定位置开始的内容 |
| 读取目录（非文件） | 返回错误 |

### T2.3 write_file 测试

**测试用例**：

| 场景 | 预期结果 |
|------|----------|
| old_string 唯一匹配 | 替换成功 |
| old_string 不存在 | 返回错误，文件不变 |
| old_string 多处匹配 | 返回错误，文件不变 |
| 写入不存在的文件 | 返回错误 |
| old_string 为空字符串 | 返回错误（禁止空匹配） |

### T2.4 append_file 测试

**测试用例**：

| 场景 | 预期结果 |
|------|----------|
| 追加到存在的文件 | 内容追加到末尾 |
| 追加到不存在的文件 | 创建新文件并写入内容 |
| 追加空字符串 | 成功（文件不变） |

### T2.5 list_directory 测试

**测试用例**：

| 场景 | 预期结果 |
|------|----------|
| 列出存在的目录 | 返回条目列表，标注类型 |
| 列出空目录 | 返回空列表 |
| 列出不存在的目录 | 返回错误 |
| 列出文件（非目录） | 返回错误 |

### T2.6 lock_file 测试

**测试用例**：

| 场景 | 预期结果 |
|------|----------|
| 首次获取锁 | 成功，创建锁文件 |
| 同一 holder 再次获取（重入） | 成功 |
| 不同 holder 尝试获取已锁文件 | 失败，返回当前持有者 |
| 锁超时后被其他 holder 获取 | 成功，覆盖旧锁 |
| 锁超时后原 holder 重新获取 | 成功 |

### T2.7 unlock_file 测试

**测试用例**：

| 场景 | 预期结果 |
|------|----------|
| 正确 holder 释放锁 | 成功，锁文件删除 |
| 错误 holder 尝试释放锁 | 失败，返回实际持有者 |
| 释放不存在的锁 | 成功（幂等） |

### T2.8 访问边界测试

**测试用例**：

| Agent | 路径 | 操作 | 预期结果 |
|-------|------|------|----------|
| main | `agents/main/file.txt` | read | 允许 |
| main | `agents/main/file.txt` | write | 允许 |
| search | `agents/main/file.txt` | read | 拒绝 |
| search | `agents/main/file.txt` | write | 拒绝 |
| main | `data/jobs.md` | read | 允许 |
| main | `data/jobs.md` | write（无锁） | 拒绝 |
| main | `data/jobs.md` | write（有锁） | 允许 |
| main | `.locks/jobs.md.lock` | read | 拒绝 |

### T2.9 并发锁测试

**目的**：验证锁机制在并发场景下的正确性。

**步骤**：
1. 两个并发的 lock_file 调用（不同 holder）
2. 验证只有一个成功获取锁
3. 失败方等待锁超时后重试
4. 验证重试成功

**预期结果**：
- 同一时刻只有一个 holder 持有锁
- 锁超时后可被其他 holder 获取

---

## 验收标准

- [ ] 所有工具函数实现完整
- [ ] 路径穿越攻击被正确拦截
- [ ] 文件锁机制工作正常（获取、释放、超时）
- [ ] 访问边界规则严格执行
- [ ] 所有测试用例通过
