# Storyboard Agent canonical `patch_shots` follow-up evidence

Date: 2026-09-04
Branch: `codex/storyboard-agent-canonical-followup-20260904`
PR: #462 (open; not merged)
Baseline synchronized into this branch: `origin/main=0c173173` (includes #461); local synchronization commit before this follow-up: `4e542ea1`.

## Scope

This follow-up is limited to the production canonical storyboard path and its tests/evidence:

`nomi_canvas_plan` → `args.operation=patch_shots` → MCP semantic adapter → verified project-session `canvas.write` RPC → renderer preload bridge → `handleCapabilityApply('canvas.write')` → `executeCanonicalCanvasPlanPatch` → live canvas-write evidence/admission → normal proposal transaction → storyboard store persistence and Project Agent proposal receipt.

The canonical operation is never exposed as a bare `patch_shots` tool. No `window.__nomiStoryboardPatchPreview`, static projection, anchor-row UI, parameter-bar UI, CSS, or visual design implementation is included.

The direct MCP route is approved by MCP elicitation when the client supports it and Nomi is open. It deliberately does not forge `hostApprovalId`/`hostActionHash`: those fields are reserved for an actually Host-claimed Project Agent turn. The durable receipt still records the canonical proposal, binding, revisions, hashes, and reconciliation result.

## H/B/E/T/N matrix

| Gate | Production-shaped evidence | Result |
|---|---|---|
| H — happy task | Real Electron app startup + persisted project hydration + real MCP stdio initialize/session lease + `nomi_canvas_plan` with `operation=patch_shots`, selected index `2`, `promptAppend`, and `aspectRatio` | PASS: 15 assertions; only row 2 changed; untouched fields survived |
| B — boundaries | Bad captured revision; unknown operation; renderer unavailable/timeout; MCP approve denial; injected `ECONNRESET` transport failure | PASS: no mutation/receipt preparation on stale or denial; invalid operation and transport failures return fail-closed errors |
| E — evidence | Disk-backed project payload, committed proposal receipt, receipt/result proposal id match, cold Electron restart/readback | PASS: receipt lifecycle `committed`, revision 2, prepare revision 1 → commit revision 2, restart sees same patch and receipt |
| T — test classification | Unit tests use injected protocol/renderer seams; integration uses real stores/admission/receipt service; Electron journey uses actual app/preload/MCP/RPC production path | Exact commands and classification below |
| N — non-regression | Final branch diff checked against UI/CSS/visual denylist and legacy direct-tool/probe strings | PASS after staging/commit; exact output recorded below |

## Scoped V8 coverage receipt

Coverage target is only the changed canonical production functions, not unrelated legacy branches in large bridge containers:

- `src/workbench/capability/canonicalCanvasPlanPatch.ts`
- `src/workbench/generationCanvas/agent/storyboardPatchShots.ts`

Exact command:

```text
pnpm exec vitest run src/workbench/capability/canonicalCanvasPlanPatch.test.ts src/workbench/generationCanvas/agent/storyboardPatchShots.test.ts src/workbench/generationCanvas/agent/storyboardPatchShots.integration.test.ts --coverage --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=json-summary --coverage.include=src/workbench/capability/canonicalCanvasPlanPatch.ts --coverage.include=src/workbench/generationCanvas/agent/storyboardPatchShots.ts --coverage.thresholds.statements=100 --coverage.thresholds.branches=100
```

Raw command output:

```text
Test Files  3 passed (3)
Tests       10 passed (10)

% Coverage report from v8
Statements   : 100% ( 56/56 )
Branches     : 100% ( 32/32 )
Functions    : 100% ( 12/12 )
Lines        : 100% ( 50/50 )
```

Raw `coverage/coverage-summary.json` receipt for the scoped files:

```json
{
  "total": {"lines":{"total":50,"covered":50,"skipped":0,"pct":100},"statements":{"total":56,"covered":56,"skipped":0,"pct":100},"functions":{"total":12,"covered":12,"skipped":0,"pct":100},"branches":{"total":32,"covered":32,"skipped":0,"pct":100}},
  "src/workbench/capability/canonicalCanvasPlanPatch.ts": {"lines":{"total":13,"covered":13,"skipped":0,"pct":100},"functions":{"total":2,"covered":2,"skipped":0,"pct":100},"statements":{"total":13,"covered":13,"skipped":0,"pct":100},"branches":{"total":6,"covered":6,"skipped":0,"pct":100}},
  "src/workbench/generationCanvas/agent/storyboardPatchShots.ts": {"lines":{"total":37,"covered":37,"skipped":0,"pct":100},"functions":{"total":10,"covered":10,"skipped":0,"pct":100},"statements":{"total":43,"covered":43,"skipped":0,"pct":100},"branches":{"total":26,"covered":26,"skipped":0,"pct":100}}
}
```

The initial red gate, before the added resolver/handler coverage cases, was the same V8 threshold command scoped only to `storyboardPatchShots.ts`: Statements `65.11% (28/43)`, Branches `57.69% (15/26)`, with uncovered lines `37, 50-51, 57-60`. The expanded tests then made the same threshold green.

## Host planner compatibility scoped V8 receipt

The existing real main-interception test exposed a regression in the changed
`executeProjectAgentTurn` dispatch predicate: the old renderer-owned
`propose_storyboard_plan` alias stopped reaching the planner callback after the
canonical `nomi_canvas_plan` operation check was added. The first compatibility
fix restored the legacy alias. A follow-up red test then showed that
`nomi_canvas_plan` is an MCP semantic surface and is not a registry alias, so a
registry-only capability check made its canonical branch unreachable. The
minimal second fix admits that explicit canonical tool name only for the same
guarded storyboard operations (`propose_storyboard_plan` and `patch_shots`).

The regression test is a real `ProjectAgentExecutionCoordinator` run, not a
direct helper/probe. It asserts the emitted production tool-call sequence is
exactly `propose_storyboard_plan` (legacy), `nomi_canvas_plan` with
`operation=patch_shots` (canonical), then a malformed-args legacy case for the
object-shape guard. The real Electron MCP journey above remains the evidence
for actual `nomi_canvas_plan` → `patch_shots` canvas mutation; this unit
coverage test only isolates the Host dispatch compatibility predicate.

Exact scoped V8 command:

```text
coverage_dir=$(mktemp -d /tmp/nomi-project-agent-turn-v8-final.XXXXXX)
pnpm exec vitest run electron/capabilityCore/canvasReadCapturedSnapshotFlow.test.ts electron/projectAgentHost/projectAgentExecutionCoordinator.test.ts --coverage --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --coverage.include=electron/projectAgentHost/projectAgentTurnExecution.ts --coverage.reportsDirectory="$coverage_dir"
```

Raw command output:

```text
Test Files  2 passed (2)
Tests       69 passed (69)

% Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
All files          |   81.05 |    62.58 |   73.33 |   84.52 |
...rnExecution.ts  |   81.05 |    62.58 |   73.33 |   84.52 | ...35,569,578,669
-------------------|---------|----------|---------|---------|-------------------
Statements   : 81.05% ( 231/285 )
Branches     : 62.58% ( 184/294 )
Functions    : 73.33% ( 22/30 )
Lines        : 84.52% ( 213/252 )
```

The whole-file result above is recorded as context only: it includes unrelated
legacy dispatcher branches and is not claimed as changed-function coverage.
The raw `coverage-final.json` receipt was
`/tmp/nomi-project-agent-turn-v8-final.Y4PtzQ/coverage-final.json`, with the
following line-scoped extraction for the changed predicate at lines 173–187:

```json
{
  "source": "electron/projectAgentHost/projectAgentTurnExecution.ts",
  "scope": "lines 173-187: changed canonical/legacy renderer-owned storyboard dispatch predicate",
  "statements": {"total": 2, "covered": 2, "pct": 100},
  "branchArms": {"total": 11, "covered": 11, "pct": 100},
  "containingFunctions": [
    {"name": "executeProjectAgentTurn", "executions": 63},
    {"name": "(anonymous_6)", "executions": 58}
  ]
}
```

The line-scoped receipt is computed from V8's raw statement/branch maps; no
coverage exclusion or baseline update is used. The exact compatibility test
also passed independently with `1 passed | 66 skipped`, and the focused
canonical/compatibility suite passed after this addition.

## Real Electron journey

Exact commands:

```text
pnpm run build
node tests/ux/storyboard-agent-canonical-patch.e2e.mjs
```

Build result: PASS. Electron install identity checks `13/13`; renderer and Electron bundles built successfully (only existing dynamic-import/chunk-size warnings).

Journey result: PASS — `STORYBOARD CANONICAL PATCH PASS: 15 assertions`.

The journey proves the real path, rather than a helper/projection:

1. Launches Electron with an isolated user-data/settings/projects/capability root and opens the real `dist/index.html#/studio?projectId=...` route.
2. Reads the seeded project through `window.nomiDesktop.projects.readAsync`; confirms surface and Project Agent preload bridges exist.
3. Starts the real in-Electron MCP stdio client, initializes with elicitation capability, opens `current_project`, and receives a verified lease.
4. Calls the actual public tool `nomi_canvas_plan` with `operation: "patch_shots"`, `select: {kind:"indexes", indexes:[2]}`, and `patch: {promptAppend:"雨天", aspectRatio:"9:16"}`. The journey observed one real elicitation approval before the write.
5. Verifies the real project side effect on disk: row 2 prompt becomes `选中镜头：跟拍，雨天`, aspect ratio becomes `9:16`, row 1/row 3 remain unchanged, and selected-row `durationSec`, `subtitle`, and `params.quality` remain unchanged.
6. Verifies the actual disk receipt and then closes/relaunches Electron. The cold restart reads back the patched storyboard and the same committed receipt.

Raw receipt emitted by that Electron run:

```json
{
  "schemaVersion": 2,
  "binding": {"projectId":"storyboard-canonical-patch-e2e","immutableProjectUuid":"6b0f4a39-1ae4-4e1e-8b2e-0b9460a67a51","projectGeneration":1},
  "revision": 2,
  "lifecycle": "committed",
  "proposalId": "mcp-canvas-plan:b2d87da8-5ded-4c0d-ba14-8c48500bb102",
  "operationId": "proposal-commit:mcp-canvas-plan:b2d87da8-5ded-4c0d-ba14-8c48500bb102",
  "proposal": {"proposalId":"mcp-canvas-plan:b2d87da8-5ded-4c0d-ba14-8c48500bb102","summary":"patch_shots","stepLabels":["patch_shots"],"compensation":[],"watchNodes":[],"reconciliationOk":true},
  "proposalHash": "073bb3eceeb1be37d0bb261db5a86f02283bf27b44321741091f926a5633b7c1",
  "operations": [
    {"operationId":"proposal-prepare:mcp-canvas-plan:b2d87da8-5ded-4c0d-ba14-8c48500bb102","requestHash":"44349ec8d3de41149c7f75656cb61838d859f965aa311b1392f4e76b8399e84a","appliedRevision":1},
    {"operationId":"proposal-commit:mcp-canvas-plan:b2d87da8-5ded-4c0d-ba14-8c48500bb102","requestHash":"03ca7a58b5ec946827b040c6ce44e441643be7e264d95637c7d4e4be5b5dcff7","appliedRevision":2}
  ],
  "updatedAt": "2026-09-04T07:27:27.114Z",
  "journalHash": "45f035ae81472888169051be6d49cc9e1ad5a2614404b8558751f122290ac6b3"
}
```

## Boundary and test commands

Unit/mock-only (no Electron window and no provider):

```text
pnpm exec vitest run electron/capabilityCore/mcpStoryboardPatchConfirm.test.ts electron/capabilityCore/mcpPlanConfirm.test.ts electron/capabilityCore/mcpCanvasDocumentSurface.test.ts electron/capabilityCore/rendererBridge.test.ts
```

Result: `Test Files 4 passed (4)`, `Tests 23 passed (23)`. This covers MCP preview/elicitation approval, denial, injected network failure (`ECONNRESET`), existing renderer unavailable/timeout, and canonical tool/schema/unknown-operation guards.

Real-store integration (not full Electron):

```text
pnpm exec vitest run src/workbench/capability/canonicalCanvasPlanPatch.test.ts src/workbench/generationCanvas/agent/storyboardPatchShots.test.ts src/workbench/generationCanvas/agent/storyboardPatchShots.integration.test.ts --coverage --coverage.provider=v8 --coverage.reporter=text --coverage.reporter=json-summary --coverage.include=src/workbench/capability/canonicalCanvasPlanPatch.ts --coverage.include=src/workbench/generationCanvas/agent/storyboardPatchShots.ts --coverage.thresholds.statements=100 --coverage.thresholds.branches=100
```

Result: `Test Files 3 passed (3)`, `Tests 10 passed (10)`, 100% scoped receipt above. This uses the real storyboard/store/persistence and disk receipt service, while the integration receipt coordinator is a test seam rather than a full Host runtime.

Boundary mapping: bad captured revision is the integration test `rejects a bad captured revision before receipt preparation or plan mutation`; unknown operation is the real MCP adapter/schema test `routes the real storyboard task through nomi_canvas_plan and its semantic operation`; unavailable/timeout is `rendererBridge.test.ts`; approve/deny/network are `mcpStoryboardPatchConfirm.test.ts`. No test calls a provider. The Electron journey uses `--no-proxy-server`, makes no generation/provider request, and consumes no quota. Its `ECONNRESET` case is injected at the transport seam, so provider/network certification remains out of scope.

## Final diff/non-UI check

The final diff is restricted to canonical production bridge/handler code, canonical storyboard tests, the Electron journey, and this evidence document. The UI/visual denylist check is:

```text
git diff --name-only origin/main...HEAD | rg '(^|/)(src/ui/|.*\\.(css|scss|less)$)|StoryboardShotTable\\.tsx$|ProjectAgentResidentShell\\.tsx$|NomiStudioApp\\.tsx$' && exit 1 || echo 'UI/CSS/visual denylist: clean'
```

The legacy-entry check is:

```text
git diff origin/main...HEAD -- . ':!docs/qa/2026-09-04-storyboard-agent-canonical-followup.md' | rg "toolName\\s*[:=]\\s*['\"]patch_shots['\"]|callTool\\(['\"]patch_shots['\"]|window\\.__nomiStoryboardPatchPreview" && exit 1 || echo 'legacy direct tool/preview probe: clean'
```

No physical Electron canary, full repository typecheck, or all-repository coverage claim is made here. The delivered gate is the scoped V8 target plus the CI-safe real Electron journey and the focused boundary suites above.
