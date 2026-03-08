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
