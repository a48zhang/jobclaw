# Workstream C: Memory And Data

> 历史说明：本文件属于历史交接包，描述的是当时的实现拆分计划，不等同于当前代码状态。

本工作流负责把长期事实从聊天历史中拆出来，并建立结构化事实源。

## 1. 目标

让系统具备长期记忆、事实恢复、结构化查询和 Markdown 视图导出能力。

## 2. 交付内容

- `ConversationStore`
- `UserFactsStore`
- `JobStore`
- `ArtifactStore`
- `InterventionStore`
- Markdown exporters

## 3. 建议写入范围

- `src/memory/**`
- `src/domain/**`
- `src/infra/store/**`
- `src/infra/workspace/**`

## 4. 不应主动改动

- `src/web/**`
- `src/agents/**`
- `src/tools/**`

## 5. 详细任务

### 5.1 Conversation Memory

- 将对话摘要从消息列表中拆出来
- 存储：
  - summary
  - recent messages
  - last activity

### 5.2 User Facts

- 从 `userinfo.md` 提取和维护结构化事实
- 支持 sourceRefs
- 允许后续增量更新

### 5.3 Job Facts

- 建立结构化 `JobRecord`
- 支持 discovered/applied/failed 等状态
- 支持 fitSummary、notes

### 5.4 Artifact Store

- 记录上传 PDF
- 记录生成的 resume pdf、resume typ
- 管理元数据而不只看文件路径

### 5.5 Intervention Store

- 保存 pending intervention
- 保存 resolved input
- 支持重启恢复

### 5.6 Markdown Exporters

- `jobs.md` 由结构化数据导出
- `userinfo.md` 和 `targets.md` 可保留人工编辑入口
- 不再把 Markdown 作为唯一事实源

## 6. 实现约束

- 新结构化数据要可序列化、可迁移
- Markdown 导出必须幂等
- Memory 层不依赖 Web 逻辑

## 7. 完成标准

- 重启后可恢复 user facts、job facts、pending intervention
- `jobs.md` 能从结构化数据稳定导出
- 主 Agent 不再只能从消息历史推断长期事实

## 8. 测试要求

- store CRUD 测试
- 从旧 markdown 导入测试
- Markdown 导出快照测试
- intervention 恢复测试
- artifact metadata 测试

## 9. 验证步骤

1. 准备 `userinfo.md`、`jobs.md`
2. 执行导入
3. 确认结构化 facts 正确
4. 修改结构化 job 数据
5. 导出 `jobs.md`
6. 重启后再次读取并比对一致性
