# Nomi Comprehensive Test System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn Nomi's existing tests, Electron journeys, evals, and walkthroughs into one anti-false-green system with detailed capability coverage, then use it to test and repair the local application end to end.

**Architecture:** Keep Vitest and Playwright/Electron as the execution engines. Add a small manifest/reporting layer that invokes existing scripts, make journey selection strict, restore current-product J3/J5 and add J2/J4, then run the matrix from deterministic checks through real generation and export. Product defects discovered by execution are repaired in separate red-green commits.

**Tech Stack:** Node.js ESM, TypeScript, Vitest 4, Playwright `_electron`, Electron, ffmpeg/ffprobe, pnpm.

---

## Scope, Non-goals, Rollback, and Acceptance

- **In scope:** coverage inventory, strict runner, current J1–J5, detailed high-risk Electron cases, media validation, local/real generation execution, defect fixes, final gates and visual walkthrough.
- **Not in scope:** a user-facing testing dashboard, replacing Vitest/Playwright, or hiding perceptual review behind brittle pixel snapshots.
- **Rollback:** work is isolated on `codex/full-test-system`; orchestration and each product repair are separate commits. Remove the sibling worktree after the verified branch is pushed to `main`.
- **Acceptance:** zero selected required cases fail; every product module is represented in the matrix; J1–J5 produce checkpoint evidence; at least one real generation and one probed export complete; all discovered product defects are regression-tested and fixed; `pnpm run gates` and release test profile pass; screenshots are inspected manually.

### Task 1: Make Journey Selection Impossible to Fake Green

**Files:**
- Create: `scripts/eval-journey-selection.mjs`
- Create: `scripts/eval-journey-selection.test.mjs`
- Modify: `scripts/eval-journey.mjs`
- Modify: `evals/journeys/index.mjs`

- [ ] **Step 1: Write selection tests that define strict behavior**

```js
import { describe, expect, test } from "vitest";
import { selectJourneys } from "./eval-journey-selection.mjs";

const agent = { id: "j1", needsAgent: true };
const local = { id: "j3", needsAgent: false };

describe("selectJourneys", () => {
  test("CI requires at least one zero-cost journey", () => {
    expect(() => selectJourneys([agent], { ci: true })).toThrow(/zero selected journeys/i);
  });
  test("an explicitly missing id is an error", () => {
    expect(() => selectJourneys([local], { ids: new Set(["missing"]) })).toThrow(/missing/);
  });
  test("returns counts and selected journeys", () => {
    expect(selectJourneys([agent, local], { ci: true })).toMatchObject({ discovered: 2, selected: [local] });
  });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run scripts/eval-journey-selection.test.mjs`

Expected: FAIL because `eval-journey-selection.mjs` does not exist.

- [ ] **Step 3: Implement the strict selector**

```js
export function selectJourneys(journeys, { ids = null, ci = false, smoke = false } = {}) {
  let selected = [...journeys];
  if (ci) selected = selected.filter((journey) => !journey.needsAgent);
  if (smoke) selected = selected.filter((journey) => journey.smoke || !journey.needsAgent);
  if (ids?.size) selected = selected.filter((journey) => ids.has(journey.id));
  if (selected.length === 0) {
    const label = ids?.size ? `missing requested journeys: ${[...ids].join(",")}` : "zero selected journeys";
    throw new Error(label);
  }
  return { discovered: journeys.length, selected };
}
```

Use this function from `evals/journeys/index.mjs`. In `scripts/eval-journey.mjs`, catch selection errors, print discovered/selected counts, and exit nonzero. Delete the current `ci || smoke` zero-case success branch.

- [ ] **Step 4: Verify GREEN and the original reproduction**

Run:

```bash
pnpm vitest run scripts/eval-journey-selection.test.mjs
pnpm run test:journeys
```

Expected: selector tests pass; until Task 4 restores zero-cost journeys, `test:journeys` fails with `zero selected journeys`.

- [ ] **Step 5: Commit**

Commit only the four files with message `test(journey): 禁止零用例空跑假绿`.

### Task 2: Establish the Capability Coverage Source of Truth

**Files:**
- Create: `tests/system/capabilities.json`
- Create: `scripts/test-capability-matrix.mjs`
- Create: `scripts/test-capability-matrix.test.mjs`
- Create: `docs/testing/capability-matrix.md`

- [ ] **Step 1: Write schema-validation tests**

The tests load the JSON and require unique IDs plus `normal`, `boundary`, `failure`, and `persistence` arrays for every `risk: "high"` row. They also require every referenced test file to exist unless the case has an explicit `unsupportedReason`.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run scripts/test-capability-matrix.test.mjs`

Expected: FAIL because the matrix and validator do not exist.

- [ ] **Step 3: Add the initial complete inventory**

Use IDs under these groups: `app`, `projects`, `creation`, `canvas`, `node-text`, `node-image`, `node-video`, `node-audio`, `node-panorama`, `node-whiteboard`, `scene3d`, `models`, `references`, `generation`, `timeline`, `preview`, `export`, `settings`, `skills`, `prompt-library`, `memory`, `browser-capture`, `capability-core`, and `experience`.

Each row stores:

```json
{
  "id": "node-video.mode-switch",
  "group": "node-video",
  "risk": "high",
  "normal": ["src/workbench/generationCanvas/nodes/videoModeState.test.ts"],
  "boundary": [],
  "failure": [],
  "persistence": [],
  "journeys": ["j1-promo", "j4-reference"],
  "unsupportedReason": null
}
```

Populate references by scanning current tests; leave a dimension empty only when the validator/report marks it uncovered. The first report is allowed to be red and becomes the execution backlog.

- [ ] **Step 4: Generate the human-readable report**

`node scripts/test-capability-matrix.mjs --write` writes Markdown grouped by module with covered/uncovered dimensions and exact test paths. `--check` exits nonzero for malformed rows or a missing high-risk dimension in release mode.

- [ ] **Step 5: Verify and commit**

Run the focused Vitest test, `node scripts/test-capability-matrix.mjs --write`, and `git diff --check`. Commit as `test(system): 建立产品能力细粒度覆盖矩阵`.

### Task 3: Add One Manifest-Driven System Runner

**Files:**
- Create: `tests/system/profiles.mjs`
- Create: `scripts/test-system.mjs`
- Create: `scripts/test-system.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Test profile expansion and failure accounting**

Define tests proving `quick`, `ci`, `full-local`, `real-generation`, and `release` expand to ordered commands; a failed command fails the run; a skipped required stage fails release; and JSON/Markdown summaries contain discovered/selected/passed/failed/skipped/unsupported counts.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run scripts/test-system.test.mjs`.

- [ ] **Step 3: Implement runner without duplicating engines**

Profiles call current commands through `spawnSync` with inherited output and capture exit status/duration. Add scripts:

```json
"test:system": "node scripts/test-system.mjs",
"test:system:ci": "node scripts/test-system.mjs ci",
"test:system:full": "node scripts/test-system.mjs full-local",
"test:system:release": "node scripts/test-system.mjs release"
```

Write artifacts to `tests/system/runs/<timestamp>-<profile>/summary.json` and `report.md`; ignore run artifacts in git while retaining an empty `.gitkeep` only if required.

- [ ] **Step 4: Verify quick and CI profiles**

Run focused tests and `pnpm test:system quick`. CI remains red until current J3/J5 are restored; the report must identify that exact stage.

- [ ] **Step 5: Commit**

Commit as `test(system): 统一编排现有测试层与证据报告`.

### Task 4: Restore Current-Product Zero-Cost J3 and J5

**Files:**
- Create: `evals/journeys/j3-first-success.mjs`
- Create: `evals/journeys/j5-edit-export.mjs`
- Create: `evals/journeys/journeyContracts.test.ts`
- Modify: `evals/journeys/index.mjs`
- Modify when a confirmed product defect requires it: the smallest owning source/test file only

- [ ] **Step 1: Encode registry and journey-contract tests**

Require IDs `j1-promo`, `j3-first-success`, and `j5-edit-export` at minimum; require every milestone to have `id`, `title`, and `verify`; require zero-cost journeys to avoid agent/provider calls.

- [ ] **Step 2: Verify RED**

Run: `pnpm vitest run evals/journeys/journeyContracts.test.ts`.

- [ ] **Step 3: Implement J3 against the current UI**

J3 creates an empty project through the standard project-library card, opens Generation, creates the first board using current empty-state controls, adds a node using a visible toolbar/control, selects it, and verifies persisted project/node state plus visible parameters. It does not resurrect the deleted “30 秒体验” UI.

- [ ] **Step 4: Implement J5 against the current UI**

J5 builds a deterministic local project fixture with a node and local media, opens it, edits the prompt, verifies persistence after reload, adds media to timeline, opens Preview and Export, performs a local zero-provider export, and validates the output using `ffprobe`.

- [ ] **Step 5: Run J3/J5 and repair only reproduced product defects**

Run `pnpm eval:journey --only j3-first-success,j5-edit-export`. For each failure, preserve screenshot/state evidence, locate the owner, add a failing regression test, fix root cause, and rerun the journey.

- [ ] **Step 6: Verify CI no longer empty-runs and commit**

Run `pnpm run test:journeys`; expect 2 selected zero-cost journeys and exit zero. Commit journey work and each product fix separately.

### Task 5: Add J2 and J4 with Detailed Reference Contracts

**Files:**
- Create: `evals/journeys/j2-story-styling.mjs`
- Create: `evals/journeys/j4-reference.mjs`
- Modify: `evals/journeys/index.mjs`
- Modify: `evals/journeys/journeyContracts.test.ts`
- Add focused product regression tests beside the owning source when failures appear

- [ ] **Step 1: Extend registry tests to require J1–J5**

Verify RED before adding J2/J4.

- [ ] **Step 2: Implement J2 checkpoints**

Check story input, shot creation, character/scene reference assets, non-empty prompts, reference connections, resolvable model/archetype, and generation-ready state. Record an entity schedule for expected character, scene, and prop appearances.

- [ ] **Step 3: Implement J4 checkpoints**

Use a checked-in small PNG fixture. Verify import/localization, visibility in asset UI, attachment to a node, persistence, outgoing request reference construction at the pre-submit boundary, and generation-ready state without spending.

- [ ] **Step 4: Run agent-backed journeys with the configured local catalog**

Run J1/J2/J4 with one trial. Distinguish infrastructure/provider failures from Nomi failures. Repair all reproducible Nomi failures test-first.

- [ ] **Step 5: Commit**

Commit as `test(journey): 补齐定妆与参考图完整链路` plus separate product-fix commits.

### Task 6: Add Detailed High-Risk Electron Feature Cases

**Files:**
- Create: `tests/ux/detailed-functions.e2e.mjs`
- Create: `tests/ux/helpers/electronFixture.mjs`
- Create: `tests/ux/helpers/evidence.mjs`
- Modify: `tests/system/capabilities.json`
- Add focused unit tests next to source files uncovered by the cases

- [ ] **Step 1: Factor the existing isolated Electron launch into a reusable helper**

The helper always creates temporary user-data/settings/projects directories, dismisses splash, captures screenshots/state on failure, closes the app, and deletes temporary data after evidence copy.

- [ ] **Step 2: Add parameterized detailed cases**

Cover project create/open/reload, workspace tabs, canvas node operations, model/mode changes, stale parameter removal, reference add/remove/limit, generation duplicate-submit guard, Scene3D serialize/reopen, timeline add/reorder/scrub, settings validation, and viewport-edge popovers.

- [ ] **Step 3: Add state and fault variants**

For each high-risk capability run normal, boundary, failure/recovery, and persistence variants. External failures are injected at IPC/provider boundaries; tests assert actionable user state and no corrupt persistence.

- [ ] **Step 4: Run and close every defect**

Run `node tests/ux/detailed-functions.e2e.mjs`; treat each failure under the systematic-debugging workflow and update the matrix only after the regression test is green.

- [ ] **Step 5: Commit in logical slices**

Commit helper/cases separately from each product repair.

### Task 7: Validate Real Generation and Final Media

**Files:**
- Create: `tests/ux/real-generation-export.e2e.mjs`
- Create: `scripts/probe-media.mjs`
- Create: `scripts/probe-media.test.mjs`
- Modify: `tests/system/capabilities.json`

- [ ] **Step 1: Test media-probe parsing with generated fixtures**

Create tiny color/video and silent/audio fixtures during the test using ffmpeg. Assert stream type, duration tolerance, frame availability, and clear failure for corrupt/empty output.

- [ ] **Step 2: Verify RED then implement `probe-media.mjs`**

The script invokes `ffprobe -show_format -show_streams -of json`, validates required streams/duration, and optionally extracts six frames with ffmpeg into the evidence directory.

- [ ] **Step 3: Run one authorized real generation**

Use the configured local catalog and existing spend guard. Record selected model/mode/parameters, outbound reference evidence, provider task ID, polling states, final localized asset, elapsed time, and spend/tokens. Do not print secrets.

- [ ] **Step 4: Put the generated/local fixture on timeline and export**

Open Preview and Export, produce MP4, run the probe, inspect sampled frames, and record audio/shot/reference limitations honestly.

- [ ] **Step 5: Repair reproducible Nomi failures test-first and commit**

External provider instability is documented with evidence and handling tests; Nomi transport, parsing, localization, state, or export defects are fixed.

### Task 8: Full Local Walkthrough, Coverage Closure, and Final Verification

**Files:**
- Modify: `tests/system/capabilities.json`
- Regenerate: `docs/testing/capability-matrix.md`
- Create: `docs/audit/2026-07-14-comprehensive-test-system.md`
- Update: `docs/plan/2026-07-14-comprehensive-test-system.md` checkboxes/results

- [ ] **Step 1: Run diagnostic coverage**

Run `pnpm vitest run --coverage`; record module-level gaps. Add tests for high-risk uncovered behavior, not arbitrary getters or implementation lines.

- [ ] **Step 2: Run the complete deterministic profile**

Run `pnpm test:system full-local`; resolve every failure or prove it is an external unsupported boundary represented in the matrix.

- [ ] **Step 3: Walk the real app manually with the persistent driver**

Build fresh, launch `tests/ux/ui-driver.mjs`, and walk J1–J5 with snap→action→screenshot loops. Open every relevant menu/popover/modal, test constrained window geometry, inspect light/dark states, and quit the driver cleanly.

- [ ] **Step 4: Run release verification**

Run:

```bash
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:dangling-tokens
pnpm run check:archetype-defaults
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run test:e2e
pnpm run test:journeys
pnpm test:system release
```

Read full outputs and require zero failures.

- [ ] **Step 5: Review requirements and artifacts**

Re-read the design acceptance criteria, verify every item against commands/artifacts, run `git diff --check`, inspect the final diff, and ensure no unrelated shared-worktree files entered the branch.

- [ ] **Step 6: Commit, integrate, and push safely**

Commit audit/matrix results. Rebase or cherry-pick onto a fresh sibling worktree pinned to the then-current `origin/main`, rerun gates there, then push `HEAD:main` according to project discipline. Remove temporary worktrees only after push succeeds.
