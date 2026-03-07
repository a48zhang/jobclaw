# BaseAgent 代码重构计划

## 背景

`src/agents/base.ts` 当前 608 行，超过 500 行限制。需要进行模块拆分以满足代码规范要求。

## 目标结构

```
src/agents/
├── base/                     # BaseAgent 核心包
│   ├── index.ts              # 导出入口，重新导出所有公共 API
│   ├── agent.ts              # BaseAgent 核心类（约 300 行）
│   ├── types.ts              # 类型定义（约 70 行）
│   ├── context-compressor.ts # 上下文压缩模块（约 140 行）
│   └── constants.ts          # 常量定义（约 20 行）
├── main/                     # MainAgent
│   └── index.ts
├── search/                   # SearchAgent
│   └── index.ts
└── delivery/                 # DeliveryAgent
    └── index.ts
```

---

## 拆分详情

### 1. `base/constants.ts`（约 20 行）

移出内容：
- `CONTEXT_WINDOW`
- `COMPRESS_THRESHOLD`
- `COMPRESS_TARGET`
- `DEFAULT_KEEP_RECENT_MESSAGES`
- `DEFAULT_MAX_ITERATIONS`

### 2. `base/types.ts`（约 70 行）

移出内容：
- `MCPClient` 接口
- `AgentSnapshot` 接口
- `BaseAgentConfig` 接口

### 3. `base/context-compressor.ts`（约 140 行）

移出内容：
- `ContextCompressor` 类
- `calculateTokens()` 静态方法
- `checkAndCompress()` 方法
- `compressMessages()` 方法
- `generateSummary()` 方法
- `formatMessagesForSummary()` 方法

接口设计：
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
  async compressMessages(messages: ChatCompletionMessageParam[]): Promise<ChatCompletionMessageParam[]>
  protected async generateSummary(messages: ChatCompletionMessageParam[]): Promise<string>
  protected formatMessagesForSummary(messages: ChatCompletionMessageParam[]): string
}
```

### 4. `base/agent.ts`（约 300 行）

保留内容：
- BaseAgent 类核心结构
- 构造函数
- 抽象属性 `systemPrompt`
- `run()` 主循环
- `getState()` 方法
- `getAvailableTools()` 方法
- `executeToolCall()` 方法
- `executeToolCalls()` 方法
- `onToolResult()` 钩子
- `getSessionPath()` 方法
- `loadSession()` 方法
- `saveSession()` 方法
- `extractContext()` 方法
- `restoreContext()` 方法
- `initMessages()` 方法
- `callLLM()` 方法

### 5. `base/index.ts`（约 20 行）

```typescript
// 重新导出所有公共 API
export { BaseAgent } from './agent'
export type { MCPClient, AgentSnapshot, BaseAgentConfig } from './types'
export { ContextCompressor } from './context-compressor'
export * from './constants'
```

---

## 具体 Agent 迁移

### MainAgent

**原位置**：`src/agents/main.ts`
**新位置**：`src/agents/main/index.ts`

### SearchAgent

**原位置**：`src/agents/search.ts`
**新位置**：`src/agents/search/index.ts`

### DeliveryAgent

**原位置**：`src/agents/delivery.ts`
**新位置**：`src/agents/delivery/index.ts`

---

## 执行步骤

1. 创建 `base/` 目录结构
2. 创建 `base/constants.ts`，移出常量
3. 创建 `base/types.ts`，移出类型定义
4. 创建 `base/context-compressor.ts`，实现压缩模块
5. 创建 `base/agent.ts`，重构 BaseAgent 使用压缩模块
6. 创建 `base/index.ts`，统一导出
7. 迁移 `main.ts` → `main/index.ts`
8. 迁移 `search.ts` → `search/index.ts`
9. 迁移 `delivery.ts` → `delivery/index.ts`
10. 删除旧文件
11. 更新测试文件导入路径
12. 运行测试验证

---

## 预期行数

| 文件 | 预期行数 |
|------|----------|
| `base/constants.ts` | ~20 |
| `base/types.ts` | ~70 |
| `base/context-compressor.ts` | ~140 |
| `base/agent.ts` | ~300 |
| `base/index.ts` | ~20 |
| **总计** | ~550 |

所有文件均在 500 行以内。

---

## 注意事项

1. 保持向后兼容：`import { BaseAgent } from './agents/base'` 仍然有效
2. 测试文件需要更新导入路径
3. 压缩模块使用组合模式，而非继承
