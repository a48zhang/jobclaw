# Review Fixes Plan

> Created: 2026-03-31
> Priority: P0 (blocking merge) + P1 (should fix before merge)

## Context

After a 4-reviewer parallel code review of all uncommitted changes in the jobclaw repository, 4 Critical issues and several Important issues were identified that block merging. This plan addresses all of them.

## P0 — Blocking Issues (Must Fix Before Merge)

### C1: `intervention-manager.ts` — timeout sweep logic is inverted

**File:** `src/runtime/intervention-manager.ts:208`

**Problem:** The comparison `Date.parse(record.createdAt) + record.timeoutMs > now` is backwards. It skips records whose deadline has passed (should be timed out) and processes records whose deadline is still in the future. The entire timeout-sweep mechanism is dead code.

**Fix:**
```typescript
// BEFORE (broken):
if (Date.parse(record.createdAt) + record.timeoutMs > now) continue

// AFTER (correct):
if (Date.now() < Date.parse(record.createdAt) + record.timeoutMs) continue
```

**Verification:** `grep -n "timeoutMs > now\|Date.now() <" src/runtime/intervention-manager.ts`

---

### C2: `shell.ts` — `AbortSignal` not forwarded to `spawn()`

**File:** `src/tools/shell.ts:104`

**Problem:** `options.signal` (the `AbortSignal` from `ToolContext`) is never passed to `spawn()`. The abort handler only calls `terminateChildProcess()` asynchronously. If the abort fires between `spawn()` returning and the abort listener being registered, the signal is silently ignored.

**Fix:** Add `signal: options.signal` to the `spawn()` options object.

```typescript
// At line ~104 in executeShellProcess():
const child = spawn(file, args, {
  cwd: options.cwd,
  detached: os.platform() !== 'win32',
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  signal: options.signal,  // ← ADD THIS
})
```

**Verification:** `grep -n "signal: options.signal" src/tools/shell.ts`

---

### C3: `update_workspace_context` tool missing from documentation

**Files:** `docs/SPEC.md` (section 7), `docs/agent-design.md` (section 2.3)

**Problem:** This tool is implemented (`src/tools/index.ts:221-251`), used in skills (`search-jobs.md`, `bootstrap.md`), referenced in MainAgent system prompt, but absent from the authoritative tool lists in SPEC.md and agent-design.md.

**Fix — `docs/SPEC.md`:**
Add to the section 7 tool list (after `read_file` / before `write_file`):
```
- `update_workspace_context` — 在对话中维护 targets.md / userinfo.md，支持增量去重合并；source 字段标注触发来源（chat / agent）。
```

**Fix — `docs/agent-design.md`:**
Add to section 2.3 tool list (after the existing tools):
```
- `update_workspace_context`：增量维护 targets.md / userinfo.md。执行去重合并（基于 company + url 精确去重），保留已有笔记，source 字段记录触发来源。
```

**Verification:** `grep "update_workspace_context" docs/SPEC.md docs/agent-design.md`

---

### C4: `MarkdownMessage.tsx` — `window.marked` / `window.DOMPurify` not available

**Files:** `frontend/src/components/MarkdownMessage.tsx:12-15`, `package.json`

**Problem:** The old frontend loaded `marked` and `DOMPurify` via `<script>` tags in `public/index.html` (deleted vendor files). The new React frontend accesses them as `window.marked` and `window.DOMPurify`, but neither library is installed or bundled.

**Fix:**

Step 1 — Install dependencies:
```bash
npm install marked isomorphic-dompurify
npm install --save-dev @types/marked  # if needed
```

Step 2 — Update `MarkdownMessage.tsx`:
```typescript
import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

// Configure marked for safe output
marked.setOptions({ breaks: true, gfm: true })

function renderMessageHtml(text: string): string {
  const raw = marked.parse(text) as string
  return DOMPurify.sanitize(raw)
}
```

Step 3 — Remove `window.marked` / `window.DOMPurify` fallback references.

**Verification:**
- `grep "window.marked\|window.DOMPurify" frontend/src/` returns nothing
- `grep "from 'marked'\|from 'isomorphic-dompurify'" frontend/src/` finds the imports
- `grep "marked\|dompurify" package.json` finds the new dependencies

---

## P1 — Should Fix Before Merge

### I1: capability policy enforcement not tested
**Files:** `tests/unit/runtime/workspace-context-service.test.ts`, `tests/unit/tools/updateWorkspaceContext.test.ts`

Add tests that pass a `capabilityPolicy` with a denying rule for `data/targets.md` and assert that `service.update()` throws.

### I2: shell tool timeout not tested
**File:** `tests/unit/tools/shell.test.ts`

Add a test that runs a command with `timeout: 100` (e.g., `sleep 5`) and asserts `result.success === false` with an error message containing `'超时'`.

### I3: `requiresReview` not asserted in tool test
**File:** `tests/unit/tools/updateWorkspaceContext.test.ts`

Add `expect(payload.requiresReview).toBe(true)` after the `skippedConflicts === 1` assertion. Add a second test case with no conflicts where `requiresReview` should be `false`.

### I4: `search-jobs.md` and MainAgent system prompt write path inconsistency
**Files:** `src/agents/skills/search-jobs.md:10`, `src/agents/main/index.ts:73`

Change references from `data/jobs.md` to `state/jobs/jobs.json` (via `upsert_job` tool) in both files.

### I5: `eventBus.ts` event name consistency
**File:** `src/eventBus.ts:91, 329, 411`

Verify that the `EventBusMap` interface, `toLegacyEvent` switch, and actual `emit()` calls all use the same event name for workspace context updates.

---

## P2 — Nice to Have (Can Land After Merge)

### Minor frontend issues
- Fix `useLegacyAppBridge` effect dependency array
- Clarify `vite.config.ts` CSS output path
- Add `doc-editor` CSS class
- Consider `vite dev` script for faster iteration

### Minor backend issues
- Fix `atomicWriteText` temp file UUID instead of pid+Date.now()
- Fix `findPending` silent ambiguity resolution
- Improve `shell` stdout empty handling

### Minor test issues
- Add single-section update tests
- Add abort test race condition mitigation
- Fix resume-profile-fallback hardcoded sleep
- Add E2E chat input test
- Fix `base.test.ts` streaming mock

---

## Verification Commands

```bash
# TypeScript compilation
npx tsc --noEmit

# All unit tests
npx vitest run --coverage

# Specific file tests
npx vitest run src/runtime/intervention-manager.test.ts
npx vitest run src/tools/shell.test.ts
npx vitest run src/tools/updateWorkspaceContext.test.ts

# Documentation checks
grep "update_workspace_context" docs/SPEC.md
grep "update_workspace_context" docs/agent-design.md
grep "state/jobs/jobs.json" src/agents/skills/search-jobs.md

# Frontend checks
grep "window.marked\|window.DOMPurify" frontend/src/
grep "from 'marked'\|from 'isomorphic-dompurify'" frontend/src/
```
