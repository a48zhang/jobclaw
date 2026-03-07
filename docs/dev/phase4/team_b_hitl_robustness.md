# Phase 4 - Team B: HITL & Robustness

> **目标**: 引入 `EventEmitter` 与 `Promise` 挂起机制，实现 Agent 的人工干预。

---

## 1. 核心任务

### 1.1 `BaseAgent` 架构升级 (`src/agents/base/agent.ts`)
- **变更**: 让 `BaseAgent` 继承自 `EventEmitter`。
- **实现 `requestIntervention`**:
    ```typescript
    private interventionResolve?: (value: string) => void;

    async requestIntervention(prompt: string): Promise<string> {
      // 1. 发送事件，由 TUI 监听并弹出输入框
      this.emit('intervention_required', {
        prompt,
        // 传递 resolve 函数，供外部直接解决 Promise
        resolve: (input: string) => this.resolveIntervention(input)
      });

      // 2. 返回一个新的 Promise 并挂起 ReAct 循环
      return new Promise<string>((resolve) => {
        this.interventionResolve = resolve;
      });
    }

    private resolveIntervention(input: string) {
      this.interventionResolve?.(input);
      this.interventionResolve = undefined;
    }
    ```

### 1.2 系统鲁棒性优化
- **环境深度校验**: 在 `src/env.ts` 中实现对 `targets.md` 是否为空、`userinfo.md` 关键字段是否缺失的深度校验。
- **宽容行解析**: 读取 `jobs.md` 时采用行循环机制，遇到单行损坏时记录 Warn 但不终止全局进程。

---

## 2. 验收标准
- [ ] Agent 执行 `requestIntervention` 时，程序确实“卡住”并等待外部信号。
- [ ] 外部调用 `resolveIntervention(input)` 后，Agent 能获取到 `input` 并继续后续循环。
- [ ] 若环境变量配置错误，系统在进入 TUI 前能给出精准错误报告。
