# Phase 3 子计划 Review 报告

> 审查日期: 2026-03-07  
> 审查对象: Team A (MainAgent), Team B (Channel & CronJob), Team C (DeliveryAgent) 实现计划  
> 实现代码分支: `copilot/implement-phase-3-main-agent`, `copilot/implement-delivery-agent`, `copilot/implement-code-for-phase3`

---

## 0. 对 Gemini Review 的评估

Gemini 的 review 提出了以下观点，经核实：

| 观点 | 结论 | 说明 |
|------|------|------|
| MCP 未初始化 | ✅ 正确 | `src/index.ts` 和 `src/cron.ts` 都没有初始化/传递 mcpClient |
| Bootstrap 单次调用问题 | ⚠️ 部分正确 | 确实只调用一次，但 MainAgent.run() 内部是多轮对话。真正问题是：没有验证 bootstrap 是否真正完成 |
| DeliveryAgent 绕过 loadSkill | ✅ 正确 | DeliveryAgent 使用自己的 fs.readFileSync 而非 `this.loadSkill()` |
| 正则脆弱性 | ✅ 正确 | 与我们的发现一致 |

**评价**：Gemini 的核心发现是正确的，我们的 review 遗漏了 MCP 初始化问题。但 Gemini 对 Bootstrap 的描述不够精确。

---

## 1. 总体评价

三个子计划整体质量较高，架构清晰，职责边界明确，测试用例覆盖较全面。但存在一些需要修正的问题和跨团队协调事项。

**实现代码已提交到三个分支，经审查发现以下关键问题**：
1. MCP 客户端未初始化（致命）
2. DeliveryAgent 未使用 BaseAgent.loadSkill()（不一致）
3. Bootstrap 完成验证缺失

---

## 2. Team A (MainAgent) Review

### 2.1 优点

- **架构设计清晰**：交互模式和 Ephemeral 模式区分明确，spawnAgent 机制设计合理
- **接口定义完整**：`IDeliveryAgent`、`MainAgentConfig` 接口定义清晰
- **测试用例全面**：14 个单元测试覆盖了核心场景和边界条件
- **与 SPEC 一致**：职责定义与 SPEC.md 4.2 节描述一致

### 2.2 需要修正的问题

#### P1: T-A-8 实现位置描述不准确

**问题**：T-A-8 描述为"在 BaseAgent 中实现 `runEphemeral`"，但当前 `BaseAgent` 已存在且**没有** `runEphemeral` 方法。需要明确这是**补充实现**而非重新创建。

**当前 BaseAgent 缺失**：
- `runEphemeral(initialPrompt, options?)` 方法
- `loadSkill(name)` 方法
- 工具调用的 2 分钟超时机制

**建议**：将 T-A-8 拆分为更细粒度的任务：
```
T-A-8a: 在 BaseAgent 中补充 runEphemeral(initialPrompt, options?) 方法
T-A-8b: 将 run() 的主循环逻辑抽取为 runMainLoop() 方法
T-A-8c: 为 executeToolCall 添加 2 分钟超时（Promise.race）
```

#### P2: Skill 文件创建依赖未明确

**问题**：T-A-5 需要 `loadSkill('jobclaw-skills')`，但 T-A-12 才创建该文件。依赖顺序需要调整。

**建议**：将 T-A-12 移至 T-A-5 之前，或明确标注"T-A-5 实现时使用空字符串占位，T-A-12 完成后生效"。

#### P3: onToolResult 正则匹配可能失败

**问题**：第 5.5 节的正则 `/\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(https?:\/\/\S+?)\s*\|\s*discovered\s*\|/` 期望 jobs.md 格式严格一致，但 Markdown 表格格式可能有细微差异（如对齐空格）。

**建议**：在 systemPrompt 中明确表格格式规范，并增加格式校验或容错处理。

#### P4: spawnAgent 错误处理过于简单

**问题**：`spawnAgent` 捕获异常后仅返回字符串，MainAgent 的 LLM 需要解析这个字符串才能理解失败原因。

**建议**：考虑返回结构化错误信息，或让 LLM 在 systemPrompt 中明确告知如何解析失败结果。

---

## 2.5 实现代码审查（Team A 分支）

**分支**: `copilot/implement-phase-3-main-agent`

### 代码质量

- ✅ `loadSkill()` 已在 BaseAgent 中实现
- ✅ `runEphemeral()` 已实现，包含超时机制
- ✅ `runMainLoop()` 抽取成功，run() 和 runEphemeral() 共用
- ✅ 工具调用 2 分钟超时已实现

### 问题

**P0: mcpClient 未传递**（与 Gemini 发现一致）

在 `copilot/implement-code-for-phase3` 分支的 `src/index.ts` 中：

```typescript
const deliveryAgent = new DeliveryAgent({
  openai,
  model: process.env.MODEL ?? 'gpt-4o',
  workspaceRoot: WORKSPACE_ROOT,
  // 缺少 mcpClient!
})
```

**后果**：MainAgent 和 DeliveryAgent 都无法使用 Playwright MCP 工具，搜索和投递功能完全无法工作。

**修复**：需要在入口文件中初始化 MCP 客户端并传递给两个 Agent。

---

## 3. Team B (Channel & CronJob) Review

### 3.1 优点

- **Channel 接口设计简洁**：`ChannelMessageType` 枚举完整，`ChannelMessage` 结构清晰
- **CronJob 设计合理**：作为单次任务脚本，由外部调度器触发，职责单一
- **Bootstrap 流程完整**：确保首次运行后 targets.md 不为空

### 3.2 需要修正的问题

#### P1: 文档标题与内容不符

**问题**：文件名是 `team-b-search-agent.md`，标题是 "Team B — Search Agent"，但内容是 **Channel & CronJob 基础设施**。

**建议**：重命名为 `team-b-channel-cron.md`，标题改为 "Phase 3 · Team B — Channel & CronJob 基础设施实现计划"。

#### P2: CronJob 解析 LLM 返回结果不可靠

**问题**：第 3.1 节使用正则 `/发现\s*(\d+)\s*个新职位/` 解析 LLM 返回结果，LLM 输出格式不可控，可能导致解析失败。

```typescript
const countMatch = result.match(/发现\s*(\d+)\s*个新职位/)
const newJobs = countMatch ? parseInt(countMatch[1]) : 0
```

**建议**：
1. 方案 A：在 MainAgent 的 systemPrompt 中要求 LLM 在结尾输出 JSON 格式的结构化结果
2. 方案 B：让 MainAgent 直接统计 jobs.md 中新增的 `discovered` 行数，而非解析文本

#### P3: EmailChannel 未处理 SMTP 连接失败

**问题**：TC-B-04 测试 SMTP 失败时不抛出异常，但 `EmailChannel` 构造函数需要检查配置完整性。如果 SMTP 配置缺失，应在启动时 fail fast。

**建议**：在 `EmailChannel` 构造函数中验证必需配置：
```typescript
constructor(private config: EmailChannelConfig) {
  if (!config.smtpHost || !config.smtpPort || !config.user || !config.password || !config.to) {
    throw new Error('EmailChannel 缺少必需的 SMTP 配置')
  }
}
```

#### P4: T-B-4 移除 node-cron 未确认

**问题**：计划移除 `node-cron` 依赖，但未检查 `package.json` 中是否已有该依赖。

**验证**：当前 `package.json` 不包含 `node-cron`，T-B-4 可简化为"安装 nodemailer 依赖"。

### 3.3 实现代码审查（Team B 分支）

**分支**: `copilot/implement-code-for-phase3`

#### 问题

**P1: Bootstrap 完成验证缺失**

```typescript
if (needsBootstrap(WORKSPACE_ROOT)) {
  console.log('[JobClaw] 首次启动，进入初始化引导流程...')
  const result = await mainAgent.run(BOOTSTRAP_PROMPT)
  console.log('\n[JobClaw] 引导完成:', result)
  return  // 程序退出
}
```

**问题**：
- `mainAgent.run()` 执行一次后直接退出
- 如果用户在对话中未能完成所有配置（targets.md、userinfo.md），下次启动会重新开始
- 没有验证 `config.yaml` 是否真正被写入

**修复建议**：
```typescript
while (needsBootstrap(WORKSPACE_ROOT)) {
  await mainAgent.run(BOOTSTRAP_PROMPT)
  if (!needsBootstrap(WORKSPACE_ROOT)) {
    console.log('[JobClaw] 初始化完成')
  } else {
    console.log('[JobClaw] 配置未完成，请继续...')
  }
}
```

**P2: 环境变量处理不当**

```typescript
smtpHost: process.env.SMTP_HOST!,  // 使用非空断言
```

如果环境变量缺失，会抛出 `TypeError: Cannot read properties of undefined`。

**修复建议**：
```typescript
function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`缺少环境变量: ${name}`)
  return value
}
```

---

## 4. Team C (DeliveryAgent) Review

### 4.1 优点

- **投递流程设计完整**：从读取 jobs.md 到更新状态的全流程覆盖
- **通知机制合理**：`onToolResult` 钩子设计巧妙，时机正确
- **错误处理全面**：覆盖了登录失败、表单填写失败、锁超时等场景

### 4.2 需要修正的问题

#### P1: deliveredUrls 与 jobs.md 状态冗余

**问题**：T-C-6 设计了 `deliveredUrls: Set<string>` 用于跨会话保存已投递 URL，但实际状态已存储在 `jobs.md` 中。这种双重状态可能导致不一致。

**建议**：
- 如果目的是避免重投，应在 SOP 中明确"读取 jobs.md 时跳过非 discovered 状态"
- 删除 `deliveredUrls` 的维护，减少状态管理复杂度

#### P2: write_file ToolResult.content 未确认

**问题**：第 6 节提到需要核查 `write_file` 的 `ToolResult.content` 是否包含 `new_string`。这是一个关键依赖，需要先确认再实现。

**当前状态**：需要检查 `src/tools/writeFile.ts` 实现。

```typescript
// 建议的 write_file 返回格式
return { success: true, content: newString }
```

#### P3: delivery_start 通知时机不理想

**问题**：第 6.1 节承认 `delivery_start` 在 `browser_navigate` 结果返回后才发送，时序上比"开始投递"稍晚。

**建议**：接受这一限制，因为 `onToolResult` 是 post-hook，无法在工具调用前执行。如果需要精确的"开始投递"时机，可考虑：
1. 在 systemPrompt 中让 LLM 在 navigate 前先发送一个标记
2. 或放弃 `delivery_start` 通知，仅保留结果通知

#### P4: Skill 文件协调

**问题**：T-C-9 需要在 `jobclaw-skills.md` 中填充"投递职位 SOP"章节，但该文件由 Team A 的 T-A-12 创建。需要明确协调：

**建议**：
- Team A 先创建骨架文件（各章节占位）
- Team C 填充"投递职位 SOP"章节
- 或 Team C 独立提交该章节内容，Team A 合并

### 4.3 实现代码审查（Team C 分支）

**分支**: `copilot/implement-delivery-agent`

#### 问题

**P0: 未使用 BaseAgent.loadSkill()**（与 Gemini 发现一致）

```typescript
// DeliveryAgent 中的实现
const defaultSkillsPath = path.resolve(import.meta.dir, '../skills/jobclaw-skills.md')
const overridePath = path.resolve(this.workspaceRoot, 'skills', 'jobclaw-skills.md')

if (fs.existsSync(overridePath)) {
  skillContent = fs.readFileSync(overridePath, 'utf-8')
} else if (fs.existsSync(defaultSkillsPath)) {
  skillContent = fs.readFileSync(defaultSkillsPath, 'utf-8')
}
```

MainAgent 使用 `this.loadSkill('jobclaw-skills')`，而 DeliveryAgent 自己实现了文件读取逻辑。这导致：
1. 代码重复
2. 行为可能不一致（路径解析方式不同）
3. 违反 DRY 原则

**修复**：改为 `this.loadSkill('jobclaw-skills')`，将 SOP 内容内嵌到 systemPrompt 中。

**P0: mcpClient 未传递**

DeliveryAgent 构造函数接收 config，但没有 mcpClient 字段传入：
```typescript
const deliveryAgent = new DeliveryAgent({
  openai,
  model: process.env.MODEL ?? 'gpt-4o',
  workspaceRoot: WORKSPACE_ROOT,
  // 缺少 mcpClient!
})
```

**后果**：无法使用 Playwright MCP 工具进行表单填写。

---

## 5. 跨团队一致性检查

### 5.1 Channel 消息类型 ✅

三个团队的 `ChannelMessageType` 定义一致：
- `new_job`
- `delivery_start`
- `delivery_success`
- `delivery_failed`
- `delivery_blocked`
- `cron_complete`

### 5.2 jobs.md 格式 ✅

Team A 和 Team C 对 jobs.md 的表格格式定义一致：
```
| 公司 | 职位 | 链接 | 状态 | 投递时间 |
```

状态值一致：`discovered` / `applied` / `failed` / `login_required`

### 5.3 文件锁机制 ✅

两边的 lock/unlock 约定一致：`lock_file` → 操作 → `unlock_file`

### 5.4 ToolResult 类型 ⚠️

**问题**：Team C 依赖 `write_file` 返回 `new_string`，需要确认当前实现是否符合预期。

**建议**：Team B（负责 tools）或独立团队需要验证 `ToolResult.content` 的语义，并统一文档说明。

### 5.5 BaseAgent 方法补充 ⚠️

Team A 的 T-A-8、T-A-11 需要在 BaseAgent 中补充方法，这将影响所有子类。

**建议**：这些改动应该作为 Phase 3 的前置任务，由一个团队（建议 Team A）统一完成并合并，其他团队再基于新 BaseAgent 开发。

---

## 6. 实现顺序建议

建议按以下顺序实施，减少团队间的阻塞：

```
Phase 3.0 (前置):
├── T-A-11: BaseAgent.loadSkill()
├── T-A-8: BaseAgent.runEphemeral() + tool call timeout
└── T-B-1: Channel 接口定义（最高优先级）

Phase 3.1 (可并行):
├── Team A:
│   ├── T-A-12: 创建 jobclaw-skills.md 骨架
│   ├── T-A-1 ~ T-A-7, T-A-9 ~ T-A-10: MainAgent 实现
│   └── T-A-13 ~ T-A-14: 测试
│
├── Team B:
│   ├── T-B-2 ~ T-B-3: EmailChannel 实现
│   ├── T-B-5: cron.ts 实现
│   └── T-B-6 ~ T-B-8: Bootstrap + 测试
│
└── Team C:
    ├── T-C-1 ~ T-C-4: DeliveryAgent 骨架
    ├── T-C-9: 填充 jobclaw-skills.md 投递 SOP 章节
    ├── T-C-5 ~ T-C-6: onToolResult + context
    └── T-C-7 ~ T-C-8: ToolResult 确认 + 测试
```

---

## 7. 总结

### 7.1 计划文档评级

| 团队 | 评级 | 主要修正项 |
|------|------|-----------|
| Team A | B+ | T-A-8 拆分、Skill 依赖顺序、正则容错 |
| Team B | B | 文档标题修正、CronJob 结果解析改进 |
| Team C | B+ | deliveredUrls 冗余、ToolResult 确认、Skill 协调 |

**整体评级**: B+

### 7.2 实现代码评级

| 团队 | 评级 | 关键问题 |
|------|------|---------|
| Team A | B | mcpClient 未传入（依赖入口文件修复） |
| Team B | C | Bootstrap 单次调用、环境变量处理、mcpClient 未初始化 |
| Team C | C | 未使用 loadSkill()、mcpClient 未传入 |

**致命问题**：MCP 客户端在所有入口点都未初始化，导致核心功能（搜索、投递）完全无法工作。

### 7.3 必须修复项（合并前）

1. **入口文件**：初始化 MCP 客户端并传递给所有 Agent
2. **DeliveryAgent**：改用 `this.loadSkill()` 加载 SOP
3. **Bootstrap**：循环直到 config.yaml 被写入
4. **环境变量**：添加启动时检查，缺失时给出明确错误

### 7.4 Gemini Review 评价

Gemini 的 review **核心观点正确**，我们遗漏了 MCP 初始化问题。但 Gemini 对 Bootstrap 的描述不够精确：
- 问题不是"单次调用后退出"，而是"没有验证 bootstrap 是否真正完成"
- MainAgent.run() 内部是多轮对话，可以完成配置
- 真正需要的是：循环检查 config.yaml 是否被写入

三个子计划在架构层面与 SPEC 和 agent-design 保持一致，主要问题集中在实现细节和跨团队协调。建议按照第 6 节的顺序实施，并在 Phase 3.0 完成后进行一次接口对齐确认。
