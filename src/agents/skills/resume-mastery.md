# 简历制作技能 SOP (Resume Mastery)
### 场景
当用户要求"生成简历"、"更新简历"或"把项目 X 的描述精简"时，执行此 SOP。

### 步骤
1. **信息读取**: 使用 `read_file` 读取 `data/userinfo.md`，获取姓名、邮箱、工作经历等个人信息。
2. **准备模板**: 使用 `read_file` 读取模板文件作为 Typst 模板基础。若 workspace 中已有 `data/resume.typ` 则优先使用。
3. **内容填充**: 根据 `userinfo.md` 中的信息，将模板内容写入 `data/resume.typ`（使用 `write_file` 或 `append_file`）。
4. **润色确认**（可选）: 若简历内容有模糊或需优化之处，通过 `requestIntervention` 向用户发起询问，例如"项目 A 的描述是否需要精简？"，等待用户确认后再继续。
5. **编译 PDF**: 使用 `typst_compile` 工具，传入 `input_path: "data/resume.typ"` 进行编译，生成 `workspace/output/resume.pdf`。
6. **通知用户**: 编译成功后，告知用户 PDF 已生成在 `output/resume.pdf`。

### 注意事项
- 中文字符必须正确渲染；模板已配置多种中文字体回退（Noto Sans CJK SC 等）。
- 若用户要求修改某一部分（如"精简项目 A 描述到 2 行"），使用 `write_file` 精确替换对应内容，然后重新调用 `typst_compile` 重新编译。
- 生成的 PDF 路径始终为 `workspace/output/resume.pdf`。