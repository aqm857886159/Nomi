# External Agent Single-Approval Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Claude/Codex/WorkBuddy 成为正常生产流程的唯一用户审批入口，Nomi 负责执行、持久化、审计、预览和故障接管，同时把用户可见审批压缩为方向、剧本/分镜、生产合同、最终粗剪/导出四个高杠杆节点。

**Architecture:** 保留 ProductionRun 内部的 script/storyboard/contract/sample/shot/QA/export 状态和事件，但新增统一的 gate decision policy：外部 MCP 与 Nomi UI 都调用同一个 service command。外部 Agent 通过 elicitation-first 取得真人决定后调用 `nomi_decide_gate`；Nomi UI 只展示“已由外部 Agent 确认”的只读状态，只有外部连接不可用或用户主动接管时才显示本地确认控件。剧本仍是明确审阅点；分镜随后单独做版本审阅，因为它依赖已批准剧本才能生成。冻结与 QA 变为自动内部门，粗剪和导出由 `nomi_approve_rough_cut` 一次确认完成。

**Tech Stack:** Electron + React + TypeScript + Vitest + MCP stdio/elicitation + ProductionRun repository/events + existing trajectory recorder.

---

### Task 1: Define visible approval policy without deleting internal contracts

**Files:**
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `src/workbench/production/productionRunView.ts`
- Test: `electron/productionRun/productionApprovalPolicy.test.ts`

- [x] **Step 1: Write the failing policy tests**

Add tests asserting:

```ts
expect(visibleApprovalFor('direction')).toBe('creative_lock')
expect(visibleApprovalFor('script')).toBe('creative_lock')
expect(visibleApprovalFor('storyboard')).toBe('creative_lock')
expect(visibleApprovalFor('contract')).toBe('production_lock')
expect(visibleApprovalFor('freeze')).toBe('automatic')
expect(visibleApprovalFor('shot')).toBe('conditional_sample_or_exception')
expect(visibleApprovalFor('qa')).toBe('automatic')
expect(visibleApprovalFor('export')).toBe('final_cut')
```

Also assert that `confirm_all` keeps per-shot gates while the default external policy does not create per-shot user prompts after the sample has passed.

- [x] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm vitest run electron/productionRun/productionApprovalPolicy.test.ts
```

Expected: FAIL because no shared visible approval policy exists.

- [x] **Step 3: Implement the policy as a pure shared function**

Add a typed policy mapping with these rules:

```ts
type VisibleApproval =
  | 'creative_lock'
  | 'production_lock'
  | 'automatic'
  | 'conditional_sample_or_exception'
  | 'final_cut'

export function visibleApprovalFor(stage: string): VisibleApproval {
  if (stage === 'direction' || stage === 'script' || stage === 'storyboard') return 'creative_lock'
  if (stage === 'contract') return 'production_lock'
  if (stage === 'freeze' || stage === 'qa') return 'automatic'
  if (stage === 'shot') return 'conditional_sample_or_exception'
  if (stage === 'export') return 'final_cut'
  return 'automatic'
}
```

Keep the durable gates and artifact events unchanged; this function only controls what the user sees and when the driver asks the user.

- [x] **Step 4: Add the Nomi view projection for external approval**

When `run.origin.host` is `claude`, `codex`, `cursor`, or another external host and the gate has an external approval event, return a read-only view with `primaryAction: null` and a takeover target. Do not render a second approval button for the same gate.

- [x] **Step 5: Run focused tests**

```bash
pnpm vitest run electron/productionRun/productionApprovalPolicy.test.ts src/workbench/production/productionRunView.test.ts
```

Expected: PASS.

---

### Task 2: Make `nomi_decide_gate` generic and elicitation-first

**Files:**
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts`
- Test: `electron/capabilityCore/mcpExternalGateJourney.test.ts`

- [x] **Step 1: Write the failing external gate test**

Create a journey where an external `codex` client calls `nomi_decide_gate` for:

```text
gate-contract-v1
gate-shot-v1-<job>
gate-sample-v1
gate-export-v1
```

The test must first observe `elicitation/create`, reply `accept`, then assert one durable `gate.decided` event per gate. It must also assert that the dispatcher rejects a decision without a prior accepted elicitation and that repeated calls with the same `expectedRevision` are idempotent.

- [x] **Step 2: Run the test to verify the current restriction fails**

```bash
pnpm vitest run electron/capabilityCore/mcpExternalGateJourney.test.ts
```

Expected: FAIL with the current “This production gate must be decided in Nomi” restriction.

- [x] **Step 3: Replace the creative-only whitelist with a gate policy check**

Use one dispatcher method for all user-decision gates. The method must validate:

```ts
assert projectId/runId/gateId identifiers
assert gate.status === 'waiting'
assert expectedRevision === run.revision
assert decision === 'approved' || decision === 'rejected'
assert protocol elicitation accepted for external calls
```

Keep irreversible protection: no tool may approve a gate without the protocol layer recording the human `elicitation` acceptance. The decision payload must include `actor`, `surface`, `elicitationId`, and the gate/artifact version/hash.

- [x] **Step 4: Make elicitation copy describe the actual object**

Return gate-specific summaries:

```text
creative_lock: review direction + script + storyboard
production_lock: authorize providers/models/budget
sample_or_shot: approve the representative shot or flagged job
final_cut: approve rough cut and export
```

The MCP result must include a safe Nomi deep link and preview artifact IDs, but the external client remains the decision surface.

- [x] **Step 5: Run MCP focused tests**

```bash
pnpm vitest run electron/capabilityCore/mcpExternalGateJourney.test.ts electron/capabilityCore/mcpConversationJourney.test.ts
```

Expected: PASS with contract, shot, sample, and export decisions all made externally.

---

### Task 3: Keep provenance-safe script/storyboard review without duplicate Nomi prompts

**Files:**
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/mcpToolResults.ts`
- Test: `electron/capabilityCore/mcpCreativeLockJourney.test.ts`

- [x] **Step 1: Write the external artifact review tests**

The external journey submits an external script and storyboard, reads both versions, and performs one Agent-side elicitation per artifact version. This is intentionally two creative decisions: storyboard planning is blocked until the script is approved, so collapsing them would either approve an unseen storyboard or remove the designed script review point.

```text
artifact.reviewed(script, approved)
artifact.reviewed(storyboard, approved)
gate.decided(creative_lock, approved)
```

No second storyboard confirmation may be requested after the combined decision.

- [x] **Step 2: Implement the shared artifact review seam**

`nomi_review_artifact` is elicitation-first and uses the existing CAS/revision path. There is no second Nomi confirmation for the same artifact; the internal `artifact.adopted` event remains the durable provenance record.

- [ ] **Step 3: Make revision requests return one actionable change surface**

When the user asks for changes, return the affected artifact IDs and stale dependants. Do not regenerate assets or create jobs until the next creative lock is approved.

- [x] **Step 4: Run the focused external journey**

```bash
pnpm vitest run electron/capabilityCore/mcpCreativeLockJourney.test.ts
```

Expected: PASS. The final rough-cut/export confirmation is covered by `nomi_approve_rough_cut`.

---

### Task 4: Keep Nomi confirmation as read-only status and explicit takeover

**Files:**
- Modify: `src/workbench/production/productionRunView.ts`
- Modify: `src/workbench/production/useProductionStatus.ts`
- Modify: `src/workbench/production/ProductionRunCard.tsx`
- Modify: `electron/productionRun/productionRunService.ts`
- Test: `src/workbench/production/productionExternalApprovalView.test.ts`

- [x] **Step 1: Write the failing view test**

For an externally approved contract gate, assert:

```ts
expect(view.primaryAction).toBeNull()
expect(view.externalApproval).toMatchObject({ actor: 'codex', decision: 'approved' })
expect(view.takeoverAction).toBe('takeover-run')
```

For an external run with no elicitation-capable client, assert the Nomi fallback action remains available.

- [x] **Step 2: Implement the projection and UI copy**

Show a compact status line such as “已由 Codex 确认 · 14:32 · v1”。Do not display a duplicate confirm modal. Add a clearly secondary “在 Nomi 中接管” action only when the external host is disconnected, the run is in `needs_attention`, or the user explicitly asks to take over.

- [x] **Step 3: Test takeover and CAS behavior**

After takeover, a stale external `nomi_decide_gate` call must fail with a revision conflict; the Nomi decision must be the only accepted next decision.

- [x] **Step 4: Run UI projection tests**

```bash
pnpm vitest run src/workbench/production/productionExternalApprovalView.test.ts src/workbench/production/productionRunView.test.ts
```

Expected: PASS.

---

### Task 5: Build a true external-only blackbox journey

**Files:**
- Modify: `scripts/real-mcp-review-only.mjs`
- Create: `tests/production/external-agent-single-surface.test.mjs`
- Modify: `scripts/productionTrajectoryContract.mjs`
- Create: `docs/evals/2026-08-21-external-agent-single-surface.md`

- [x] **Step 1: Add a red blackbox contract**

Reject a trajectory if an external run has a normal-path `desktop-click` approval for direction, script, storyboard, contract, sample, shot, rough-cut, or export. The only permitted desktop interaction is explicit takeover or provider-recovery inspection.

- [x] **Step 2: Change the real harness to use MCP elicitation for every visible gate**

The harness must call `nomi_get_run`, inspect the waiting gate, answer the host `elicitation/create`, call `nomi_decide_gate`, then assert the durable event. It must not query Nomi DOM buttons for normal approvals.

- [x] **Step 3: Keep the Nomi GUI path as a separate regression**

The existing GUI journey remains as a second test for Nomi-origin runs and takeover mode; it must not be used as evidence for external-only UX.

- [x] **Step 4: Validate the trajectory**

```bash
pnpm vitest run tests/production/external-agent-single-surface.test.mjs tests/production/production-trajectory-contract.test.mjs
```

Expected: the external-only contract passes and any accidental Nomi GUI approval fails loudly.

---

### Task 6: Re-run a real 30-second film with the correct surface

**Files:**
- Modify: `scripts/real-mcp-review-only.mjs`
- Create: `docs/evals/2026-08-21-external-agent-single-surface-real-film.md`
- Output: isolated project `.nomi/runs/<runId>`, trajectory JSONL, exported MP4, frame/audio analysis

- [ ] **Step 1: Run the external-only blackbox with real provider media**

Use the real model catalog and provider keys. Creative, contract, sample, shot, rough-cut, and export decisions must all come from MCP elicitation. Do not use handwritten run/artifact JSON or low-level `generate` calls.

- [ ] **Step 2: Verify durable project evidence**

Require direction/script/storyboard artifact versions, external approval actor/surface, canvas node IDs, providerTaskIds, job lineage, QA verdicts, and export artifact in the same Nomi project.

- [ ] **Step 3: Analyze the actual MP4**

Run:

```bash
node scripts/analyze-real-film.mjs \
  --film /absolute/path/export.mp4 \
  --run /absolute/path/project/.nomi/runs/<runId> \
  --out /absolute/path/evals/real-30s/frame-analysis
```

Inspect with `view_image`:

- shot contact sheet;
- all cut boundaries;
- audio waveform;
- subtitle overlays.

Acceptance gates:

```text
duration 28–32s
video + audio streams present
subtitle stream/burn-in ends <= video duration
all cut boundary frames have no white/black exposure
at least two authored non-cut transitions are visible
providerTaskId trace rate = 100%
normal-path desktop-click approvals = 0
trajectory root-cause iteration recorded
```

- [ ] **Step 4: Record failures honestly and iterate**

If any gate fails, record the root cause, patch the narrowest shared layer, add a red regression, rebuild, and rerun the external-only journey. Do not reuse a failing export as evidence of success.

---

### Task 7: Full verification and handoff

**Files:**
- Update: `docs/evals/2026-08-21-external-agent-single-surface.md`

- [ ] **Step 1: Run focused tests**

```bash
pnpm vitest run \
  electron/capabilityCore/mcpExternalGateJourney.test.ts \
  electron/capabilityCore/mcpCreativeLockJourney.test.ts \
  src/workbench/production/productionExternalApprovalView.test.ts \
  tests/production/external-agent-single-surface.test.mjs \
  tests/production/production-trajectory-contract.test.mjs
```

- [ ] **Step 2: Run project gates**

```bash
pnpm run typecheck
pnpm run test
pnpm build
```

- [ ] **Step 3: Check the final user-visible contract**

The report must explicitly state:

```text
normal external Agent approvals: Agent desktop only
Nomi GUI approvals: takeover/Nomi-origin only
internal ProductionRun events: retained for audit and recovery
real MP4 evidence: linked by absolute path
```
