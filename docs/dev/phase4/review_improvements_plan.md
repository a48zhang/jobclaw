# Phase 4 Review Improvements Implementation Plan (Revised)

> **修订日期**: 2026-03-08  
> **状态**: ✅ 已完成 (Completed)

---

## 1. 任务计划：日志级别集成 (Log Level Integration) (✅ 已完成)

### 1.1 扩展 `ChannelMessageType` (✅)
### 1.2 扩展 `ToolContext` (✅)
### 1.3 基类 `BaseAgent` 调整 (✅)
### 1.4 工具重构与 TUI 适配 (✅)

---

## 2. 任务计划：HITL 超时机制 (HITL Timeout) (✅ 已完成)

### 2.1 场景化超时逻辑 (✅)
### 2.2 事件协议扩展 (✅)
### 2.3 TUI 模态框联动 (✅)

---

## 3. 验收标准 (✅ 已通过)
...

---

## 4. 执行顺序

1. **第一阶段**: 修改 `BaseAgent` 基类与配置定义（引入 `channel`）。
2. **第二阶段**: 扩展工具上下文与日志转发逻辑，重构 `upsertJob`。
3. **第三阶段**: 实现场景化超时与事件广播机制。
4. **第四阶段**: TUI 界面同步与全流程回归。
