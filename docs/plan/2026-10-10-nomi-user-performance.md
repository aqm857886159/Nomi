# Nomi User Workflow Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Build a repeatable real-user Electron/Playwright performance measurement path for project, document, storyboard, mixed-media canvas and Agent combinations, then make the smallest shared-boundary fix justified by baseline evidence.

**Architecture:** Keep the existing canvas benchmark and launch/fixture owners. Add one cross-surface workflow runner that emits redacted raw JSON with explicit cache/scale/Agent-state dimensions, then rank bottlenecks from the same samples. Production changes are allowed only at the earliest shared rendering or lifecycle boundary proved by the trace; no paid model calls or benchmark-only shortcuts.

**Tech Stack:** Electron 43.4.1, Playwright, CDP Performance/Memory, existing Nomi fixture/project schema, Node ESM, repository gates.

**Spec:** `docs/evidence/2026-10-10-nomi-user-performance/scenario-matrix-and-budget.md`, `docs/evidence/2026-10-10-nomi-user-performance/design-card.md`

## Global Constraints

- Fixed small/typical/heavy scales, cold/hot cache states, one warm-up plus five measured runs per cell.
- Report input-to-visible, interactive-ready, frame p95/p99, dropped frames, long tasks, renderer/main CPU, memory trend, and model/network wait separately.
- Synthetic stream/tool fixtures are explicitly labelled and must never trigger paid generation.
- Preserve all raw samples and never relax a budget after seeing a result.
- Re-test correctness, cancel/fail/recover and repeated open/close after every fix.
- Do not commit private assets, credentials, or absolute machine paths.

## Review Focus

- Cold and hot paths must not be mixed in one aggregate; test both in the workflow runner.
- Agent stream/tool wait must not be mistaken for UI blocking; test fixed local fixtures and split fields.
- Heavy mixed media must not be replaced with image-only data; test image/video counts and active media.
- Closing/reopening must release renderer/media resources; test residual process, listener and memory trend.
- A slow host sample must remain visible in raw evidence; test noise labelling without turning it into a pass.

### Task 1: Baseline evidence and runner skeleton

**Files:**
- Create: `tests/ux/nomi-user-workflow-performance.e2e.mjs`
- Create: `tests/ux/fixtures/nomi-user-workflow-fixture.mjs`
- Create: `docs/evidence/2026-10-10-nomi-user-performance/raw/.gitkeep`
- Modify: `package.json` (add a named command only if the existing command table has no equivalent)

- [ ] Write the fixture contract and scale validation tests for document/plan/shot/media counts.
- [ ] Run the fixture contract test and verify it fails before implementation.
- [ ] Implement fixture generation from the existing project schema, with synthetic Agent stream/tool timers and no provider dispatch.
- [ ] Add runner probes for visible/interactive boundaries, frame intervals, long tasks, CDP CPU/heap/DOM, Electron working set and main/renderer separation.
- [ ] Implement cold/hot and warm-up/run loops, preserving every sample and redacting paths.
- [ ] Run the smallest baseline cell and save raw JSON before changing production code.

### Task 2: Complete user-action matrix

**Files:**
- Modify: `tests/ux/nomi-user-workflow-performance.e2e.mjs`
- Modify: `tests/ux/fixtures/nomi-user-workflow-fixture.mjs`
- Create: `tests/ux/nomi-user-workflow-performance.node-test.mjs`

- [ ] Add P/D/B/C actions using real selectors and existing launch helpers.
- [ ] Add A1–A4 synthetic idle/stream/tool-running combinations with fixed waits and cancellation/failure paths.
- [ ] Add R1/R2 repeated open/close and resource residual assertions.
- [ ] Run small and typical matrix cells; verify output schema and no paid/provider call.

### Task 3: Baseline analysis and bottleneck ranking

**Files:**
- Create: `scripts/summarize-nomi-user-performance.mjs`
- Create: `docs/evidence/2026-10-10-nomi-user-performance/analysis.md`
- Create: `docs/evidence/2026-10-10-nomi-user-performance/limitations.md`

- [ ] Summarize median/p95/p99 and classify UI blocking vs wait-only time.
- [ ] Rank bottlenecks by user impact, reproducibility and shared-boundary leverage.
- [ ] Record current main/PR #1014 overlap and leave a status comment on #1014 before production edits.

### Task 4: Smallest shared-boundary remediation

**Files:**
- Modify only the production file(s) identified by Task 3 and their existing tests.
- Create: `docs/fixes/YYYY-MM-DD-<root-cause>.root-cause.json` when the baseline proves a recurring production defect.

- [ ] Reproduce the selected bottleneck with the smallest deterministic fixture.
- [ ] Run `node scripts/door-map.mjs <symbol-or-file>` and record every equivalent entry point.
- [ ] Add a failing reported-case test and a class-level regression test.
- [ ] Implement the minimal shared-boundary fix; remove obsolete path in the same commit.
- [ ] Run before/after under identical matrix settings and re-run cancellation/failure/recovery/R1/R2.

### Task 5: Independent verification and draft PR

**Files:**
- Modify: `docs/evidence/2026-10-10-nomi-user-performance/analysis.md`
- Modify: `docs/evidence/2026-10-10-nomi-user-performance/limitations.md`
- Modify: `docs/evidence/2026-10-10-nomi-user-performance/design-card.md`

- [ ] Run repository gates selected by the changed paths, plus the workflow runner and focused functional walks.
- [ ] Have an independent line/command review the design card and raw before/after evidence.
- [ ] Commit locally, push the task branch if network permits, and create a draft PR.
- [ ] Comment on PR #1014 with scope, commit, covered scenarios, actual numbers, commands, evidence links and blockers.
- [ ] If push/PR/comment is blocked, preserve the local commit and report the exact error.

