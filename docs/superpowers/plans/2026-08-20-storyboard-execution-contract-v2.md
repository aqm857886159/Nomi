# Storyboard Execution Contract v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every storyboard field survive the path from one-sentence brief to canvas node, provider request, production job, review, and export, while keeping the current free planning gate, spend gate, and durable Run model.

**Architecture:** Keep `StoryboardPlan` as the user-editable intent IR, add a single pure compiler that produces a versioned `ShotExecutionContract` plus a field-conservation ledger, and make canvas, production-run, and MCP entry points consume that compiler output. Store the compiled source, reference roles, continuity policy, prompt parts, and request fingerprint on each node/job so a generated asset can always be traced back to the approved shot. Add MCP risk annotations, output schemas, and asynchronous progress/approval behavior around the existing local stdio server rather than creating a second MCP implementation.

**Tech Stack:** TypeScript, Zod, Vitest, Electron IPC, Zustand canvas store, hand-rolled MCP JSON-RPC 2.0 server, existing `ProductionRun` event log and gate model.

---

## Baseline verified against `origin/main`

This plan is based on the fetched `origin/main` at `4e4fb0d0` (2026-08-20 21:56 +08:00), not the older `task/replicate-model-contract-tests` worktree. That baseline already contains `PlanShot.ffDesc`, `PlanShot.lfDesc`, `variationType`, `camIdx`, `staticFeatures`/`dynamicFeatures`, the headless/MCP two-hop first/last-frame path, the pure shot-language kernel, QA verdicts, freeze gates, and `confirm_all` per-shot gates. The remaining work is to carry those existing semantics through the GUI canvas and Production Run paths, unify all routes behind one compiler, and expose MCP output schemas/annotations.

## Current invariants to preserve

- `runStoryboardPlanner` and `propose_storyboard_plan` remain free and do not create paid jobs.
- `create_canvas_nodes` remains one user approval for the complete node/edge batch; nodes are idle until generation is explicitly run.
- Shared character/scene/prop anchors remain the default continuity strategy. Shot-to-shot tail relay is opt-in only.
- `buildPlannedNodeMeta` remains the single model-catalog resolver; no provider-specific model-selection UI is added.
- `ProductionRun` remains the durable source of truth for pause/resume/reconcile/export. MCP is an adapter, not a second run engine.

## Files and responsibilities

- Create `src/workbench/generationCanvas/agent/storyboardExecutionContract.ts`: versioned contract types, Zod schemas, compiler, deterministic hash, and field ledger.
- Create `src/workbench/generationCanvas/agent/storyboardExecutionContract.test.ts`: compiler, continuity, reference-role, and loss-detection tests.
- Modify `src/workbench/generationCanvas/agent/storyboardPlan.ts`: preserve the existing W2/W4 fields and delegate node creation to the compiler instead of adding a second field vocabulary.
- Modify `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts`: persist source/shot/continuity/prompt-part metadata on created nodes and reject compiled-plan loss before writing.
- Modify `src/workbench/generationCanvas/model/generationCanvasTypes.ts`: add typed `StoryboardNodeMeta` (stored under the existing free-form `meta` field).
- Modify `src/workbench/generationCanvas/runner/generationNodeExecutor.ts`, `src/workbench/generationCanvas/model/nodeContext.ts`, and the image/video request builders: use canonical prompt parts and explicit reference roles while retaining the legacy prompt fallback.
- Modify `electron/productionRun/productionRunTypes.ts`: add the missing `shotId`, `shotIndex`, `sourcePlanHash`, `requestFingerprint`, `continuity`, and `referenceRoles` job bindings; bump the run schema and add migration defaults. Keep the existing freeze, sample, QA, and per-shot gates.
- Modify `electron/productionRun/productionRunService.ts` and `electron/productionRun/productionRunDriverOps.ts`: attach jobs from compiled shot bindings, enforce plan-hash equality at the budget gate, and pass the request fingerprint/idempotency key into renderer generation.
- Modify `src/workbench/capability/capabilityApplyHandler.ts`: make `production.plan-storyboard` return the compiled preview and make `production.generate-node` verify the node’s source fingerprint before spending.
- Modify `electron/capabilityCore/mcpProtocol.ts`: add focused preview/status tools where needed, output schemas, accurate annotations, progress/cancellation handling, and stable resource handles; preserve the existing widget and elicitation paths.
- Modify `electron/capabilityCore/mcpProtocol.test.ts` and production/canvas tests: cover schema negotiation, annotation correctness, approval denial, idempotent retries, and field conservation.

### Task 1: Define the canonical shot contract and compiler around the existing W2/W4 fields

**Files:**
- Create: `src/workbench/generationCanvas/agent/storyboardExecutionContract.ts`
- Create: `src/workbench/generationCanvas/agent/storyboardExecutionContract.test.ts`

- [ ] **Step 1: Write failing tests for the contract shape and compiler.**

```ts
it('compiles a video shot without losing first/motion/last-frame intent', () => {
  const result = compileStoryboardPlan({
    schemaVersion: 2,
    planId: 'plan-1',
    title: 'demo',
    anchors: [{ id: 'hero', kind: 'character', name: 'Hero', description: 'red coat', carrier: 'visual' }],
    shots: [{
      shotId: 'shot-1', index: 1, shotKind: 'video', durationSec: 5,
      anchorIds: ['hero'], prompt: 'legacy prompt',
      ffDesc: 'hero stands beside the red door',
      motionDesc: 'hero opens the door and steps through',
      lfDesc: 'door remains open; hero is inside',
      variationType: 'action', camIdx: 2,
      continuity: { mode: 'shared_anchors', firstFramePolicy: 'generated', lastFramePolicy: 'export_tail' },
    }],
  })

  expect(result.losses).toEqual([])
  expect(result.shots[0]).toMatchObject({
    shotId: 'shot-1',
    promptParts: { firstFrame: 'hero stands beside the red door', motion: 'hero opens the door and steps through', lastFrame: 'door remains open; hero is inside' },
    continuity: { mode: 'shared_anchors' },
    referenceRoles: [{ anchorId: 'hero', role: 'character' }],
  })
})

it('rejects an opt-in tail relay that has no predecessor', () => {
  expect(() => compileStoryboardPlan({
    schemaVersion: 2, planId: 'p', title: 'bad', anchors: [],
    shots: [{ shotId: 'shot-2', index: 2, shotKind: 'video', durationSec: 4, anchorIds: [], prompt: 'x',
      continuity: { mode: 'tail_to_head', firstFramePolicy: 'use_previous_tail', lastFramePolicy: 'export_tail' } }],
  })).toThrow('tail_to_head requires inheritFromShotId')
})

it('reports unsupported fields instead of silently dropping them', () => {
  const result = compileStoryboardPlan({
    schemaVersion: 2, planId: 'p', title: 'x', anchors: [],
    shots: [{ shotId: 'shot-1', index: 1, shotKind: 'image', durationSec: 0, anchorIds: [], prompt: 'x',
      lfDesc: 'not applicable to a still image' }],
  })
  expect(result.losses).toContainEqual(expect.objectContaining({ field: 'lfDesc', severity: 'error' }))
})
```

- [ ] **Step 2: Run the focused test to verify it fails.**

Run: `pnpm exec vitest run src/workbench/generationCanvas/agent/storyboardExecutionContract.test.ts`

Expected: FAIL because `compileStoryboardPlan` and the v2 fields do not exist.

- [ ] **Step 3: Implement the minimal versioned contract.**

Use these exact semantic fields (provider-neutral):

```ts
export type ShotContinuity = {
  mode: 'shared_anchors' | 'tail_to_head' | 'explicit_state'
  inheritFromShotId?: string
  firstFramePolicy: 'generated' | 'use_keyframe' | 'use_previous_tail'
  lastFramePolicy: 'none' | 'export_tail'
  stateId?: string
}

export type ShotPromptParts = {
  legacy?: string
  firstFrame?: string
  motion?: string
  lastFrame?: string
  negative?: string
}

export type ShotReferenceRole = {
  anchorId: string
  role: 'character' | 'scene' | 'prop' | 'style'
  assetId?: string
  assetVersion?: string
  stateId?: string
}

export type StoryboardExecutionContract = {
  schemaVersion: 2
  planId: string
  title: string
  planHash: string
  compilerVersion: string
  shots: Array<{
    shotId: string
    index: number
    shotKind: 'image' | 'video'
    durationSec: number
    promptParts: ShotPromptParts
    camera?: { framing?: string; angle?: string; movement?: string; lens?: string }
    variationType?: 'establishing' | 'dialogue' | 'action' | 'reaction' | 'transition' | 'detail'
    camIdx?: number
    continuity: ShotContinuity
    referenceRoles: ShotReferenceRole[]
    modelKey?: string
    modeId?: string
    params: Record<string, unknown>
    requestFingerprint: string
  }>
}

export type FieldLedgerEntry = {
  shotId: string
  field: string
  status: 'preserved' | 'defaulted' | 'not_applicable' | 'error'
  target?: 'node.meta' | 'node.prompt' | 'edge' | 'job' | 'provider_request'
  message?: string
}

export type StoryboardCompileResult = {
  contract: StoryboardExecutionContract
  losses: FieldLedgerEntry[]
  warnings: FieldLedgerEntry[]
  nodes: PlanCreatedNode[]
  edges: PlanCreatedEdge[]
}
```

The compiler must: assign `shotId` for legacy shots as `shot-${index}`; map `anchor.kind` to a reference role; default continuity to `shared_anchors` + `generated`; keep legacy `prompt` as `promptParts.legacy`; reject duplicate shot ids, dangling anchors, invalid predecessor links, and video-only fields on image shots; hash canonical JSON with sorted object keys; and return a loss entry for every input field that is not written to a node, edge, job, or provider request.

- [ ] **Step 4: Run the focused tests to verify they pass.**

Run: `pnpm exec vitest run src/workbench/generationCanvas/agent/storyboardExecutionContract.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract in isolation.**

```bash
git add src/workbench/generationCanvas/agent/storyboardExecutionContract.ts src/workbench/generationCanvas/agent/storyboardExecutionContract.test.ts
git commit -m "feat: add canonical storyboard execution contract"
```

### Task 2: Wire existing `ffDesc`/`lfDesc`/`variationType`/`camIdx` fields through the editable plan

**Files:**
- Modify: `src/workbench/generationCanvas/agent/storyboardPlan.ts`
- Modify: `src/workbench/generationCanvas/agent/storyboardPlan.test.ts`

- [ ] **Step 1: Add failing compatibility tests.**

Test that an old `{ title, anchors, shots: [{ index, durationSec, anchorIds, prompt }] }` parses to v1 defaults, while a v2 shot accepts `shotId`, `ffDesc`, `motionDesc`, `lfDesc`, `camera`, `variationType`, `camIdx`, `continuity`, and `assetRef` without changing existing editor output.

- [ ] **Step 2: Keep the existing Zod fields and add only the missing canonical normalization.**

Keep the current `prompt`, `ffDesc`, `lfDesc`, `variationType`, and `camIdx` fields backward compatible. Normalize them into `promptParts` and continuity metadata in the compiler; do not create a parallel `motionDesc` field unless the editor needs a separately editable motion slot. Do not duplicate compiler logic in the schema parser.

- [ ] **Step 3: Delegate `storyboardPlanToCreateNodesArgs` to the compiler.**

Use compiled `promptParts.firstFrame` for a keyframe node, `promptParts.motion ?? promptParts.legacy` for the video node, and compiler-produced reference roles/continuity metadata for edges. Preserve the existing no-shot-chain default unless `continuity.mode === 'tail_to_head'` and the predecessor has a usable tail-frame path.

- [ ] **Step 4: Run the existing and new storyboard tests.**

Run: `pnpm exec vitest run src/workbench/generationCanvas/agent/storyboardPlan.test.ts src/workbench/generationCanvas/agent/storyboardExecutionContract.test.ts`

Expected: PASS with the pre-existing keyframe/reference-sheet/shot-number tests unchanged.

- [ ] **Step 5: Commit the compatibility layer.**

```bash
git add src/workbench/generationCanvas/agent/storyboardPlan.ts src/workbench/generationCanvas/agent/storyboardPlan.test.ts
git commit -m "feat: preserve storyboard shot semantics through canvas compilation"
```

### Task 3: Persist the contract on canvas nodes and make generation consume it

**Files:**
- Modify: `src/workbench/generationCanvas/model/generationCanvasTypes.ts`
- Modify: `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts`
- Modify: `src/workbench/generationCanvas/model/nodeContext.ts`
- Modify: `src/workbench/generationCanvas/runner/generationNodeExecutor.ts`
- Modify: `src/workbench/generationCanvas/runner/generationNodeExecutor.test.ts`

- [ ] **Step 1: Write failing metadata and request tests.**

Assert that a created shot node contains `storyboard: { planId, planHash, shotId, shotIndex, promptParts, continuity, referenceRoles, requestFingerprint }`; the keyframe node contains the same `shotId` with role `first_frame`; and generation passes the motion prompt plus explicit references while preserving the old prompt fallback for hand-created nodes.

- [ ] **Step 2: Add the typed metadata shape.**

Add `StoryboardNodeMeta` as a TypeScript type and keep `GenerationCanvasNode.meta` as `Record<string, unknown>` for snapshot compatibility. The runtime guard must validate the nested `storyboard` object before reading it.

- [ ] **Step 3: Write compiled metadata at the same approval as node/edge creation.**

In `applyCanvasToolCall`, resolve model defaults first, then attach the compiler’s metadata. If any required ledger entry is `error`, return a tool execution error and create no nodes. Store the canonical `requestFingerprint` before generation so retries can reuse it.

- [ ] **Step 4: Make request assembly role-aware.**

`nodeContext` must concatenate only `promptParts.legacy`/`motion` for the target request and keep static/first/last descriptions in metadata for providers that expose dedicated slots. `generationReferenceResolver` must return references with their declared role; providers that do not support a role receive the asset through the existing generic reference slot and a warning is recorded, never silent loss.

- [ ] **Step 5: Run focused executor and canvas tests.**

Run: `pnpm exec vitest run src/workbench/generationCanvas/agent/applyCanvasToolCall.test.ts src/workbench/generationCanvas/runner/generationNodeExecutor.test.ts src/workbench/generationCanvas/agent/storyboardExecutionContract.test.ts`

Expected: PASS; legacy hand-created nodes still generate exactly as before.

- [ ] **Step 6: Commit the node boundary.**

```bash
git add src/workbench/generationCanvas/model/generationCanvasTypes.ts src/workbench/generationCanvas/agent/applyCanvasToolCall.ts src/workbench/generationCanvas/model/nodeContext.ts src/workbench/generationCanvas/runner/generationNodeExecutor.ts src/workbench/generationCanvas/runner/generationNodeExecutor.test.ts
git commit -m "feat: persist storyboard source and prompt parts on generation nodes"
```

### Task 4: Unify Production Run jobs with the compiled contract

**Files:**
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `electron/productionRun/productionRunReducer.ts`
- Modify: `electron/productionRun/productionRunE2eFixture.test.ts`
- Modify: `electron/productionRun/productionRunDriver.test.ts`
- Modify: `electron/productionRun/productionRunPauseSemantics.test.ts`

- [ ] **Step 1: Add failing plan-attachment tests.**

Cover three cases: attaching a compiled storyboard creates one job per `shotId`; a binding with a different `planHash` is rejected before the budget gate; and retrying the same `commandId`/`requestFingerprint` does not create a second job or provider submission.

- [ ] **Step 2: Extend the persisted job shape and migration.**

Bump `PRODUCTION_RUN_SCHEMA_VERSION` to `2`. Add optional fields to `ProductionJob`: `shotId`, `shotIndex`, `sourcePlanHash`, `requestFingerprint`, `continuity`, and `referenceRoles`. When loading schema v1, leave these fields absent and keep the existing node-based behavior.

- [ ] **Step 3: Attach jobs from the contract, not from an unstructured binding list.**

`plan.attach` must load the storyboard artifact, parse/compile it, compare the submitted `planHash` to the artifact hash, and store the compiled shot metadata in each job. The budget gate summary must show shot count, model, duration, continuity mode, and estimated cost.

- [ ] **Step 4: Pass the fingerprint through the driver.**

`production.generate-node` receives `jobId`, `nodeId`, `shotId`, `sourcePlanHash`, and `requestFingerprint`. Renderer generation must refuse a node whose stored fingerprint or plan hash differs from the job. Provider submission keeps the existing `idempotencyKey` and adds the fingerprint to logs/events.

- [ ] **Step 5: Run production tests and the schema migration test.**

Run: `pnpm exec vitest run electron/productionRun/productionRunE2eFixture.test.ts electron/productionRun/productionRunDriver.test.ts electron/productionRun/productionRunPauseSemantics.test.ts electron/productionRun/productionRunReducer.test.ts`

Expected: PASS; old run fixtures load and remain resumable.

- [ ] **Step 6: Commit the durable-run boundary.**

```bash
git add electron/productionRun/productionRunTypes.ts electron/productionRun/productionRunService.ts electron/productionRun/productionRunDriverOps.ts electron/productionRun/productionRunReducer.ts electron/productionRun/productionRunE2eFixture.test.ts electron/productionRun/productionRunDriver.test.ts electron/productionRun/productionRunPauseSemantics.test.ts
git commit -m "feat: bind production jobs to approved storyboard shots"
```

### Task 5: Wire the existing language validator at both planning boundaries

**Files:**
- Reuse: `electron/capabilityCore/shotLanguage.ts`
- Modify: `src/workbench/generationCanvas/agent/runStoryboardPlanner.ts`
- Modify: `src/workbench/generationCanvas/agent/applyCanvasToolCall.ts`
- Test: `electron/capabilityCore/shotLanguage.test.ts` and the planner/compiler tests

- [ ] **Step 1: Add integration tests for the existing pure validator.**

The pure validator tests already cover mental-state, vague gaze, role-only verbs, branded scene names, and `variationType` focus routing. Add the missing integration assertions that planner output and compiler output both invoke it and return the offending shot/field with a recovery suggestion.

- [ ] **Step 2: Run the validator after planning and after any optimizer rewrite.**

Planning should return a structured warning/error list in the storyboard editor. The approval compiler must run the validator again, so a later rewrite cannot bypass the gate. Errors block compilation; warnings remain visible in the ledger.

- [ ] **Step 3: Run the guard tests and commit.**

Run: `pnpm exec vitest run src/workbench/generationCanvas/agent/shotLanguageGuard.test.ts src/workbench/generationCanvas/agent/storyboardExecutionContract.test.ts`

```bash
git add electron/capabilityCore/shotLanguage.ts electron/capabilityCore/shotLanguage.test.ts src/workbench/generationCanvas/agent/runStoryboardPlanner.ts src/workbench/generationCanvas/agent/applyCanvasToolCall.ts
git commit -m "feat: validate shot language before and after storyboard rewrites"
```

### Task 6: Harden the MCP surface around the contract

**Files:**
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts`
- Modify: `electron/capabilityCore/mcpProgress.ts`
- Modify: `electron/capabilityCore/mcpProtocol.test.ts`
- Modify: `electron/capabilityCore/mcpConfig.ts` only if timeout/approval defaults need updating after measurement

- [ ] **Step 1: Add a read-only preview tool with a stable output schema.**

Expose `nomi_preview_storyboard_execution` with `{ projectId, plan }` input and output `{ planHash, shotCount, shots, ledger, warnings, estimatedCost }`. It must not create nodes or spend credits. Keep `nomi_start_playbook` for durable Run creation and `nomi_decide_gate` for explicit decisions.

- [ ] **Step 2: Add accurate tool annotations.**

Mark project/model/canvas/run/artifact reads as `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`; mark preview as read-only; mark `nomi_generate`, `nomi_control_run`, `nomi_decide_gate`, `nomi_add_nodes`, and `nomi_connect_nodes` as non-read-only; mark delete as `destructiveHint: true`; mark idempotent reads/preview/status operations as `idempotentHint: true`. These hints improve host UX but do not replace the app’s spend and authorization gates.

- [ ] **Step 3: Add `outputSchema` and retain text fallback.**

Every structured tool returns `structuredContent` plus a serialized text block, using stable ids (`runId`, `gateId`, `shotId`, `artifactId`, `requestFingerprint`). Never put provider tokens, absolute local paths, or raw credentials in `structuredContent` or `_meta`.

- [ ] **Step 4: Keep long work asynchronous at the MCP boundary.**

`nomi_start_playbook` returns a durable `runId`/`cursor` quickly; `nomi_subscribe_run` remains the portable polling primitive. When the client supplies `_meta.progressToken`, emit monotonic `notifications/progress`; on `notifications/cancelled`, stop waiting and leave the Run in its durable state. Do not make a provider job depend on the lifetime of one MCP request.

- [ ] **Step 5: Test approval, errors, and idempotency.**

Test: unsupported elicitation denies spend; declined/cancelled approval returns `isError: true` with a recovery action; malformed input is a tool execution error; unknown tool remains a JSON-RPC protocol error; duplicate command/fingerprint is a no-op; progress stops after completion; and annotations/output schemas are present in `tools/list`.

- [ ] **Step 6: Run the MCP suite and commit.**

Run: `pnpm exec vitest run electron/capabilityCore/mcpProtocol.test.ts electron/capabilityCore/mcpConversationJourney.test.ts electron/productionRun/productionGateIdempotency.test.ts`

```bash
git add electron/capabilityCore/mcpProtocol.ts electron/capabilityCore/mcpToolResults.ts electron/capabilityCore/mcpProgress.ts electron/capabilityCore/mcpProtocol.test.ts
git commit -m "feat: expose storyboard preview and harden MCP contracts"
```

### Task 7: Run the gates and perform the real-user journey check

**Files:**
- Test: existing Playwright journey files under `e2e/` plus the smallest new journey fixture under `e2e/production-run/`
- Docs: `docs/research/2026-08-20-video-production-workflow-audit.md`

- [ ] **Step 1: Run the scoped checks.**

Run: `pnpm run check:filesize && pnpm run check:tokens && pnpm run check:i18n && pnpm run lint:ci && pnpm run typecheck && pnpm run test && pnpm run build`

- [ ] **Step 2: Run the real user journey.**

Use the task “一句话做一个 3 镜头产品片”：enter brief → review direction → review storyboard ledger → approve node creation → generate one sample → reject once and patch one shot → approve remaining wave → inspect timeline → export. Verify with screenshots that the user can see the same shot ids, prompts, references, and continuity mode in the storyboard editor, canvas, Run gate, and timeline.

- [ ] **Step 3: Update the audit with measured evidence.**

Record which fields are preserved, defaulted, or blocked; record provider capability gaps (for example no last-frame slot) as explicit warnings; and record the number of approvals and credits spent. Do not claim completion from green tests alone.

- [ ] **Step 4: Commit the verification evidence.**

```bash
git add docs/research/2026-08-20-video-production-workflow-audit.md e2e/production-run
git commit -m "test: verify storyboard contract through production export journey"
```

## Delivery order

Ship Tasks 1–3 first: they eliminate the root “plan fields evaporate” failure without changing provider count or user-facing flow. Ship Tasks 4–5 next: they make durable production runs and language validation use the same contract. Ship Task 6 after the contract is stable: MCP then becomes a thin, safe adapter rather than another workflow implementation. Task 7 is the release gate.
