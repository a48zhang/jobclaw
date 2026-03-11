# 简历制作技能 SOP (Resume Mastery)
### 场景
当用户要求"生成简历"、"更新简历"或"把项目 X 的描述精简"时，执行此 SOP。

### 步骤
1. **信息读取**: 使用 `read_file` 读取 `data/userinfo.md`，获取姓名、邮箱、工作经历等个人信息。
2. **准备模板**: 使用 `read_file` 读取模板文件作为 Typst 模板基础。若 workspace 中已有 `data/resume.typ` 则优先使用。
3. **内容填充**: 根据 `userinfo.md` 中的信息，将模板内容写入 `data/resume.typ`（使用 `write_file` 或 `append_file`）。
4. **润色确认**（可选）: 若简历内容有模糊或需优化之处，通过 `request` 工具向用户发起询问，例如"项目 A 的描述是否需要精简？"，等待用户确认后再继续。
5. **编译 PDF**: 使用 `typst_compile` 工具，传入 `input_path: "data/resume.typ"` 进行编译，生成 `workspace/output/resume.pdf`。
6. **通知用户**: 编译成功后，告知用户 PDF 已生成在 `output/resume.pdf`。

### 注意事项
- 中文字符必须正确渲染；模板已配置多种中文字体回退（Noto Sans CJK SC 等）。
- 若用户要求修改某一部分（如"精简项目 A 描述到 2 行"），使用 `write_file` 精确替换对应内容，然后重新调用 `typst_compile` 重新编译。
- 生成的 PDF 路径始终为 `workspace/output/resume.pdf`。
- 如果用户信息不全应当进行询问，询问必须逐步进行，不允许一股脑让用户提供很多信息。
- 可以通过与用户多轮交谈的方式获取复杂信息（项目、工作经历等），逐步更新
- 缺失的信息可以在userinfo中标明
- 缺失的信息不得出现在resume产物中，不允许出现“请补充”“某某”等占位符
- 如果学历、联系方式等关键信息缺失应该要求用户先补全，除非用户强烈要求否则不要直接进行typst起草和编译
- 使用 `skills/templates/resume.typ` 作为模板，不允许自己写模板，除非用户要求。
- 你需要积极主动的对简历进行润色，润色前应先询问用户意见。
- 润色包括：根据实际情况为学校部分加上985、211、双一流等tag
- 润色包括：根据实际情况基于star法则优化实习、项目经历等

### typst模板

```typst
// JobClaw Resume Template
// 支持中文字符渲染
// 使用方法：将此模板复制到 workspace/ 目录后按需填写，然后使用 typst_compile 工具编译

#set document(title: "简历")
#set page(
  paper: "a4",
  margin: (top: 1.5cm, bottom: 1.5cm, left: 2cm, right: 2cm),
)
#set text(
  font: (
    "Noto Sans CJK SC",
    "Source Han Sans SC",
    "PingFang SC",
    "Microsoft YaHei",
    "Liberation Sans",
    "Arial",
  ),
  size: 10.5pt,
  lang: "zh",
)
#set par(justify: true, leading: 0.65em)

// ─── 辅助函数 ──────────────────────────────────────────────────────────────

#let section(title) = {
  v(0.5em)
  text(weight: "bold", size: 12pt)[#title]
  line(length: 100%, stroke: 0.5pt + gray)
  v(0.2em)
}

#let entry(title, subtitle: "", date: "", body) = {
  grid(
    columns: (1fr, auto),
    text(weight: "bold")[#title] + if subtitle != "" [ · #subtitle],
    text(fill: gray)[#date],
  )
  body
  v(0.3em)
}

// ─── 基本信息 ───────────────────────────────────────────────────────────────

#align(center)[
  #text(size: 20pt, weight: "bold")[姓名]
  #v(0.2em)
  #text(size: 10pt)[
    邮箱：your@email.com ·
    电话：138-0000-0000 ·
    城市：北京
  ]
]

// ─── 教育背景 ───────────────────────────────────────────────────────────────

#section[教育背景]

#entry(
  "某某大学",
  subtitle: "计算机科学与技术 · 本科",
  date: "2018.09 – 2022.06",
)[
  - GPA：3.8 / 4.0，连续三年获得优秀奖学金。
]

// ─── 工作经历 ───────────────────────────────────────────────────────────────

#section[工作经历]

#entry(
  "某某科技有限公司",
  subtitle: "软件工程师",
  date: "2022.07 – 至今",
)[
  - 负责后端服务开发与维护，使用 TypeScript / Node.js 构建高并发 API。
  - 设计并实现数据处理流水线，日处理数据量超过 1000 万条。
  - 参与前端 React 组件开发，提升页面首屏加载速度 30%。
]

// ─── 项目经历 ───────────────────────────────────────────────────────────────

#section[项目经历]

#entry(
  "JobClaw 自动化求职系统",
  date: "2024.01 – 2024.06",
)[
  - 基于 OpenAI Tool Calling 实现多 Agent 协同工作流，自动完成职位搜索与投递。
  - 使用 Playwright 实现浏览器自动化，支持主流招聘平台。
  - 设计文件锁机制保障多 Agent 并发安全，零数据竞争。
]

// ─── 技能 ───────────────────────────────────────────────────────────────────

#section[技能]

#grid(
  columns: (auto, 1fr),
  gutter: 0.5em,
  [*编程语言*], [TypeScript、Python、Go、Java],
  [*框架与工具*], [Node.js、React、Docker、Kubernetes、Git],
  [*数据库*], [PostgreSQL、MySQL、Redis、MongoDB],
  [*语言能力*], [普通话（母语）、英语（CET-6，流利读写）],
)

```
