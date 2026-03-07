# Phase 4 Implementation Plan (Detailed)

> **Note to Claude Team**: This phase transforms the "Engine" into a "Product." Focus on the terminal user experience and system reliability.

---

## 🟢 Track A: Blessed TUI Dashboard (Parallel Target 1)

**Goal**: Build the full-screen interactive dashboard.

### 1.1 Dashboard Layout (`src/web/tui.ts`)
- Use `blessed` and `blessed-contrib` to create a grid layout.
- **Panes**:
    - `Job Monitor`: A table showing `jobs.md` data (Company, Title, Status, Time).
    - `Agent Activity`: A scrollable list of real-time logs (powered by `TUIChannel`).
    - `Stats Panel`: Summary of "Found", "Applied", and "Failed".
    - `Input Box`: For user commands or intervention.

### 1.2 Data Synchronization
- Use `fs.watch` (or a polling mechanism) on `workspace/data/jobs.md` to trigger a table refresh whenever `upsert_job` is called.
- Implement a `TUIChannel` in `src/channel/tui.ts` that implements the `Channel` interface to pipe logs directly into the Blessed activity window.

---

## 🔵 Track B: Human-in-the-Loop & Robustness (Parallel Target 2)

**Goal**: Solve the "Captcha problem" and harden the system.

### 2.1 Intervention Mechanism (`src/agents/base/agent.ts`)
- Implement a `requestIntervention(prompt: string)` method in `BaseAgent`.
- **Logic**: 
    1. Emit an `intervention_required` event to the TUI.
    2. Pause the ReAct loop (wait for a Promise resolution).
    3. TUI pops up a modal asking the user for input (e.g., "Enter the Captcha code seen in the browser").
    4. Pass the input back to the Agent and resume the loop.

### 2.2 System Robustness
- **Strict Environment Validation**: Complete `src/env.ts` to perform deep checks (e.g., test SMTP connection, verify Workspace path existence, check `config.yaml` version) before the TUI starts.
- **Graceful Parsing**: Update any code that reads `jobs.md` to ignore malformed lines and handle duplicate headers gracefully without crashing.

---

## 🛠 Integration Steps
1.  **Refactor `src/index.ts`**: Replace the current basic logger with the `TUI` entry point.
2.  **Pass TUI Context**: Ensure `BaseAgent` and its subclasses have access to the TUI event emitter for interventions.
3.  **Final Cleanup**: Remove all `console.log` statements in favor of `TUIChannel` events to prevent UI corruption.
