# Team B: 简历制作技能与智能 SOP (Resume Mastery)

## 1. 开发任务

### 1.1 Typst 编译工具 (`src/tools/typstCompile.ts`)
- **实现**: 调用系统 `typst compile`。
- **环境**: 
    - 增加 `FONT_PATHS` 常量映射，适配 Linux/Codespace 环境。
    - 在 `validateEnv` 阶段若 `typst` 不可用，打印友好错误。
- **参数**: 路径需经过 `normalizeAndValidatePath` 校验，防止路径穿越。

### 1.2 简历 SOP 与 模板集成
- **技能文件**: 更新 `jobclaw-skills.md` 增加 `简历制作技能` 章节。
- **模板位置**: `src/agents/skills/templates/resume.typ`。
- **智能逻辑**: 
    - Agent 需通过 `read_file` 读取 `userinfo.md`。
    - Agent 自主决定是否发起 `requestIntervention` 来优化简历内容（润色环节）。
    - 支持用户通过对话输入“把项目 A 的描述精简到 2 行”，Agent 能相应修改并重新编译。

### 1.3 集成点
- 在 `MainAgent` 中注入简历编译的系统提示。
- 确保生成简历成功后，通过 `eventBus.emit('agent:log', ...)` 通知前端文件已生成。

## 2. 验收标准
1. 在 workspace 下手动创建一个测试 `.typ` 文件，Agent 调用工具能生成 PDF。
2. 简历中的中文字符必须正确渲染。
3. 生成的 PDF 路径应为 `workspace/output/resume.pdf`。
