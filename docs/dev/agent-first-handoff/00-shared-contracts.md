# Shared Contracts

> 历史说明：本文件属于历史交接包，主要记录当时约定的共享契约。  
> 其中部分契约已在代码中演化，不应直接视为当前事实源。

本文件是并行开发期间的唯一共享契约。

不同 Agent 可以自由实现，但接口概念、命名和事件语义应优先遵守本文件。

## 1. 目录约定

```text
src/
  runtime/
  agents/
  memory/
  domain/
  infra/
    store/
    workspace/
    mcp/
  tools/
  web/
```

## 2. 核心对象

### 2.1 AgentSession

代表用户面向的长期主会话。

建议字段：

```ts
interface AgentSession {
  id: string
  agentName: string
  profile: 'main'
  createdAt: string
  updatedAt: string
  state: 'idle' | 'running' | 'waiting_input' | 'error'
  lastMessageAt?: string
}
```

### 2.2 DelegatedRun

代表主 Agent 派生出来的一次子 Agent 执行。

```ts
interface DelegatedRun {
  id: string
  parentSessionId: string
  profile: 'search' | 'delivery' | 'resume' | 'review'
  state: 'queued' | 'running' | 'waiting_input' | 'completed' | 'failed' | 'cancelled'
  instruction: string
  createdAt: string
  updatedAt: string
  resultSummary?: string
  error?: string
}
```

### 2.3 InterventionRecord

```ts
interface InterventionRecord {
  id: string
  ownerType: 'session' | 'delegated_run'
  ownerId: string
  kind: 'text' | 'confirm' | 'single_select'
  prompt: string
  options?: string[]
  status: 'pending' | 'resolved' | 'timeout' | 'cancelled'
  createdAt: string
  updatedAt: string
  input?: string
  allowEmpty?: boolean
  timeoutMs?: number
}
```

## 3. Agent Profile

所有 Agent 必须通过 profile 定义能力边界。

```ts
interface AgentProfile {
  name: 'main' | 'search' | 'delivery' | 'resume' | 'review'
  systemPromptSections: string[]
  allowedTools: string[]
  readableRoots: string[]
  writableRoots: string[]
  allowBrowser: boolean
  allowNotifications: boolean
  allowAdminTools: boolean
  allowDelegationTo: AgentProfile['name'][]
}
```

## 4. Capability Policy

```ts
interface CapabilityDecision {
  allowed: boolean
  reason?: string
}

interface CapabilityPolicy {
  canUseTool(profile: AgentProfile, toolName: string): CapabilityDecision
  canReadPath(profile: AgentProfile, relativePath: string): CapabilityDecision
  canWritePath(profile: AgentProfile, relativePath: string): CapabilityDecision
}
```

## 5. Tool Runtime Contract

```ts
interface ToolCallContext {
  sessionId: string
  delegatedRunId?: string
  profile: AgentProfile
  workspaceRoot: string
  signal?: AbortSignal
  emit: (event: RuntimeEvent) => void
}

interface ToolResultPayload {
  ok: boolean
  summary: string
  data?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}
```

## 6. Memory Contract

### 6.1 Conversation Memory

```ts
interface ConversationMemory {
  sessionId: string
  summary: string
  recentMessages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>
}
```

### 6.2 User Facts

```ts
interface UserFacts {
  version: number
  targetRoles: string[]
  targetLocations: string[]
  seniority?: string
  skills: string[]
  constraints: string[]
  sourceRefs: string[]
}
```

### 6.3 Job Record

```ts
interface JobRecord {
  id: string
  company: string
  title: string
  url: string
  status: 'discovered' | 'favorite' | 'applied' | 'failed' | 'login_required'
  discoveredAt: string
  updatedAt: string
  fitSummary?: string
  notes?: string
}
```

## 7. Event Contract

统一事件格式：

```ts
interface RuntimeEvent {
  id: string
  type: string
  timestamp: string
  sessionId?: string
  delegatedRunId?: string
  agentName?: string
  payload: Record<string, unknown>
}
```

推荐事件名：

- `session.state_changed`
- `session.output_chunk`
- `delegation.created`
- `delegation.state_changed`
- `delegation.completed`
- `tool.started`
- `tool.finished`
- `intervention.requested`
- `intervention.resolved`
- `memory.updated`
- `runtime.warning`
- `runtime.error`

## 8. Workspace 约定

结构化事实源建议放在：

- `workspace/state/session/`
- `workspace/state/delegation/`
- `workspace/state/interventions/`
- `workspace/state/jobs/`
- `workspace/state/user/`
- `workspace/state/artifacts/`

Markdown 视图保留：

- `workspace/data/userinfo.md`
- `workspace/data/targets.md`
- `workspace/data/jobs.md`

## 9. 并行开发规则

- 不允许私自扩展事件名而不更新本文件
- 不允许修改 profile 名称而不更新本文件
- 不允许绕过 capability policy 直接在业务代码里放行高风险能力
- 如果发现契约不够用，应先修改文档，再落代码
