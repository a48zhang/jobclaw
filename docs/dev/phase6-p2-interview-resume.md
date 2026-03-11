# Phase 6 P2：模拟面试 / 简历诊断 / request

最近更新：2026-03-11

## 1. P2 范围

本阶段落四个能力：

1. 新增 `resume-clinic` skill：评价简历并在需要时直接改写简历。
2. 新增 `mock-interview` skill：基于现有资料执行回合式模拟面试，并在结束后统一输出评分与建议。
3. 实现 `request` 交互原语：让 Agent 可以显式向用户请求输入，而不是只靠 prompt 里口头要求。
4. 实现 PDF 简历读取链路：支持用户上传 PDF 简历，并通过 `read_pdf` 提取文本进入评价流程。

## 2. 设计原则

- 先补 `request`，再让交互型 skill 依赖它；不要继续扩散“文档里写 `requestIntervention`，模型却没有同名工具”的状态。
- PDF 解析做成 tool，不做成单独 skill；skill 负责流程，tool 负责二进制文件处理。
- 先以 skill 形态落地，不急着为了这两个能力新建专门 Agent。
- 面试过程只提问、追问、切题，不在中途点评；所有评价统一放在结束后。
- 用户可随时要求结束面试；Agent 也可以在信息充分时主动结束。
- 所有改写类动作优先复用现有 `resume.typ`、`typst_compile` 工具链。

## 3. 新 skill：`resume-clinic`

### 3.1 目标

由 Agent 评价当前简历质量，并在用户要求时直接改写简历内容，输出新的 `resume.typ` / `resume.pdf`。

### 3.2 主要输入

- `workspace/data/userinfo.md`
- `workspace/data/resume.typ`（如存在）
- `workspace/data/uploads/*.pdf`（如用户上传 PDF 简历）
- `workspace/data/targets.md`（可选）
- `workspace/data/jobs.md`（可选）
- 用户直接提供的岗位 JD（优先级最高）

### 3.3 触发语义

以下请求应触发该 skill：

- “评价一下我的简历”
- “帮我改简历”
- “按这个岗位把简历改一下”
- “看看这份简历有什么问题并直接帮我改”

### 3.4 执行流程

1. 读取 `userinfo.md`、`resume.typ`，确认当前简历和原始素材是否存在。
2. 如果用户上传的是 PDF 简历，则优先调用 `read_pdf` 提取文本；提取失败时明确告知“不支持扫描件/OCR 缺失/文件解析失败”等具体原因。
3. 如果同时存在 `resume.typ` 和上传 PDF，优先把 PDF 作为“当前对外版本”，把 `resume.typ` 作为后续改写落地目标。
4. 如果用户给了目标岗位或 JD，则按目标岗位审查；如果没有，则基于已有求职方向给通用审查结果，并允许继续追问岗位目标。
5. 先输出审查报告，不要一上来直接改文件。报告至少包括：
   - 红旗问题
   - 岗位匹配度
   - 项目/实习的量化缺口
   - 会被追问的点
   - 改写策略
6. 若用户要求直接改写，或任务本身明确要求“帮我改”，则修改 `resume.typ`。
7. 改写完成后调用 `typst_compile` 生成新的 PDF。
8. 返回改动摘要，说明改了哪些段落、为什么这样改。

### 3.5 输出要求

- 审查报告必须具体到“哪一段怎么写更好”，不能只说“增加量化数据”。
- 改写结果应尽量保留真实信息，不得编造指标。
- 若关键信息不足，应使用 `request` 请求补充；如果 `request` 尚未可用，则退化为普通追问。
- 对上传 PDF 场景，必须把“提取文本”和“Agent 推断”区分开来；不能把解析失败后的猜测当成简历事实。

### 3.6 验收标准

- 能在不改动架构的前提下由 MainAgent 触发。
- 能输出稳定的“审查报告 + 改写结果/建议”结构。
- 启用改写时，能够产出可编译的 `workspace/output/resume.pdf`。
- 用户上传文本型 PDF 时，能直接进入评价流程，无需先手工粘贴文本。

## 4. PDF 简历读取链路：`read_pdf`

### 4.1 目标

支持用户上传 PDF 简历，并将 PDF 内容转换为 Agent 可读取的文本，供 `resume-clinic` 等能力复用。

### 4.2 为什么做成 tool

- PDF 是二进制文件，现有 `read_file` 只能处理文本文件。
- skill 只能描述流程，不能稳定完成 PDF 解析。
- 这类能力后续也可复用到 JD PDF、作品集 PDF 等其他场景。

### 4.3 MVP 范围

首版支持：

- 文本型 PDF 简历上传
- 文本提取
- 进入简历评价流程

首版不支持：

- OCR 扫描件
- 任意复杂双栏版式的高保真还原
- 把任意 PDF 自动完美转换为 `resume.typ`

### 4.4 开发方案

1. Web 上传入口
   - 新增 `POST /api/resume/upload`
   - 使用 `multipart/form-data`
   - 文件保存到 `workspace/data/uploads/`
   - 返回保存路径、文件名、大小等基础信息

2. 工具层
   - 新增 `src/tools/readPdf.ts`
   - 在 `src/tools/index.ts` 注册 `read_pdf`
   - 参数建议：
     - `path: string`
     - `pages?: number[] | "all"`
     - `max_chars?: number`
     - `include_meta?: boolean`
   - 返回建议：
     - `text`
     - `page_count`
     - `truncated`
     - `meta`

3. 解析策略
   - 首版优先使用纯 JS PDF 解析库
   - 暂不引入系统级 `pdftotext`
   - 暂不引入 OCR

4. 文本清洗
   - 合并异常断行
   - 尽量保留章节边界
   - 在可能的情况下识别联系方式、教育、项目、实习等块

### 4.5 风险与约束

- 双栏 PDF 的文本顺序可能错乱。
- 扫描件无法可靠提取文本。
- 中文 PDF 在某些字体嵌入场景下可能出现乱码或断句异常。

### 4.6 验收标准

- 能上传文本型 PDF 并保存到工作区。
- Agent 能通过 `read_pdf` 获取文本并用于简历评价。
- 解析失败时，返回明确失败原因和下一步建议。

## 5. 新 skill：`mock-interview`

### 5.1 目标

Agent 基于现有信息进行模拟面试。岗位信息是可选输入；如果用户提供目标岗位/JD，则按该岗位定制；否则进行通用技术岗模拟面试。

### 5.2 主要输入

- `workspace/data/userinfo.md`
- `workspace/data/resume.typ`（如存在）
- `workspace/data/targets.md` / `workspace/data/jobs.md`（可选）
- 用户直接提供的岗位 JD（可选，优先级最高）

### 5.3 执行节奏

面试过程可能包括：

- 自我介绍
- 介绍简历上的内容，尤其项目/实习经历
- 深挖简历内容
- 计算机网络、操作系统、数据库等基础知识
- LeetCode / 编程题

但不是每次都必须完整覆盖全部模块。Agent 可以根据用户回答情况调整顺序、增加追问、跳过明显不相关模块。

### 5.4 面试规则

1. 一次只问一个问题。
2. 回答期间不插入分数和大段点评。
3. 每轮只允许非常短的过渡反馈，例如“继续”“这一点我再深挖一下”，不要在中途产出完整分析。
4. 当以下任一条件成立时结束面试：
   - Agent 认为已获取足够信息形成评价；
   - 用户明确要求结束；

### 5.5 结束输出

面试结束后统一输出：

- 总分
- 各子项目得分
  - 自我介绍
  - 项目/实习表达
  - 简历深挖
  - 基础知识
  - 算法/编程
- 全程情况分析
- 推荐答案
  - 仅对答得不好的题或模块给推荐答案，不需要给所有问题都补标准答案
- 改进建议

### 5.6 验收标准

- 能完成多轮问答，并在结束前不产生完整评分报告。
- 报告结构稳定，至少包含总分、分项得分、分析、推荐答案、改进建议。
- 用户说“结束面试”后，Agent 能立即进入总结阶段。

## 6. `request` 能力开发计划

### 6.1 目标

提供一个 LLM 可直接调用的 `request` 工具，用于“向用户请求补充输入并暂停执行”。

### 6.2 为什么要做

当前代码里真实存在的是 `BaseAgent.requestIntervention()`，但模型并没有一个同名工具能调用。这会带来两个问题：

- skill 文档写得再详细，模型也只能“口头上说要问用户”，无法稳定触发统一交互流程。
- Web/TUI/HITL 已经有一套事件链路，但没有被抽象成对模型可见的正式能力。

### 6.3 开发分期

#### Phase A：最小可用版

1. 在 `BaseAgent.getAvailableTools()` 中注入 `request` 工具定义。
2. 工具参数首版定为：
   - `prompt: string`
   - `kind: "text" | "confirm" | "single_select"`
   - `options?: string[]`
   - `timeout_ms?: number`
   - `allow_empty?: boolean`
3. 在 `BaseAgent.executeToolCall()` 中增加 `request` 特判：
   - 不进入通用 `executeTool()`
   - 直接调用 `requestIntervention()`
   - 结果统一返回 JSON 字符串，例如 `{ "answered": true, "input": "..." }`
4. 事件负载增加可选字段：
   - `requestId`
   - `kind`
   - `options`
   - `timeoutMs`
5. 保持现有 `/api/intervention` 与 TUI 逻辑继续可用。

#### Phase B：协议稳定版

1. 为 `intervention:required/resolved` 增加兼容层，旧前端只看 `prompt` 也能工作。
2. Web UI 增加 `confirm` / `single_select` 的渲染。
3. TUI 至少支持：
   - `text` 直接输入
   - `confirm` 映射到 `y/n`
   - `single_select` 回退为带编号的文本输入
4. 为 `request` 响应补充 `requestId`，避免并发请求时串线。

#### Phase C：文档与 skill 迁移

1. 将 skill 文档里的 `requestIntervention` 统一迁移为 `request`。
2. 更新 `docs/SPEC.md`、`docs/agent-design.md`、系统提示，保证术语一致。
3. 约定新写的交互型 skill 一律优先使用 `request`，而不是在 SOP 里写“向用户提问并等待”这种弱约束描述。

### 6.4 测试计划

- `BaseAgent` 单测：
  - `request` 工具已注册
  - request 调用后触发 `intervention:required`
  - 收到用户输入后继续执行
  - 超时返回空值或超时标记
  - ephemeral 模式下也能工作
- Web/TUI 联调：
  - Web 发起输入后任务继续
  - TUI modal 输入后任务继续
  - 旧 payload 不带 `kind/options` 时仍可正常回填

### 6.5 与能力依赖关系

- `resume-clinic` 用 `request` 补充岗位目标、缺失量化信息、是否直接改写。
- `mock-interview` 用 `request` 承载逐轮问答、确认结束、可选收集目标岗位。
- `resume-clinic` 在 PDF 上传场景下用 `read_pdf` 获取简历文本，再视需要用 `request` 追问缺失信息。

## 7. 推荐实施顺序

1. 先做 `request` 最小可用版。
2. 再做 PDF 上传入口和 `read_pdf` 最小可用版。
3. 再补 `resume-clinic` 和 `mock-interview` 两个 skill 文档。
4. 最后补入口路由、提示词微调和测试。

