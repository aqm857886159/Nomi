# MCP AI Generation Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one real, recoverable MCP AI-generation path that plans, previews, gates, submits exactly one provider job, persists an Artifact, and records proposal-ready provenance without exposing the later adopt/timeline mutation in this slice or introducing a second Run, Asset, or Timeline owner.

**Architecture:** Keep the existing `electron/runtime.ts` provider-neutral task boundary and `electron/productionRun/` durable Run as the owners. Add a hash-pinned, built-in module catalog and a pure `PlanCandidate → ExecutionContract` compiler; the P3 external MCP host and tests use the same contract and receipt. The Nomi right-side Agent is a P4 adapter to this dispatcher, not a second execution path. The first path is one shot/one provider job; it does not insert into the timeline automatically. Timeline/EditorDocument migration and renderer work are separate later plans.

**Tech Stack:** Electron main process, TypeScript, Zod, Vitest, existing MCP stdio/dispatcher, existing ProductionRun repository/service/outbox, existing runtime `runTask`, Playwright/Node journey harness.

---

## Scope and non-goals

This plan is deliberately limited to P0–P3 of the unified runtime design. It must produce a working, testable slice on its own.

Included:

- canonical ownership/rollout documentation;
- typed module and execution-contract schemas;
- capability and tool allowlist preflight;
- host-authored generation plan submission;
- deterministic preview and one typed spend gate;
- one-shot generation through the existing runtime/ProductionRun;
- durable progress, restart/reconcile, idempotency and Artifact persistence;
- proposal-ready Artifact provenance; reversible adopt/timeline mutation is a later P5 gate;
- zero-credit, fake-provider and one explicitly labelled real-provider smoke tests;
- six-role and adversarial review evidence for this slice.

Deferred:

- full `EditorDocument`/Timeline v2 migration;
- a new `GenerationJob` or `AssetRegistry` type;
- local interview editing and full Editor Workbench UI;
- multi-shot continuity, audio/captions/export;
- HyperFrames/Remotion production renderers;
- arbitrary remote code or runtime Skill installation;
- `brand.promo`/`drama.short` as execution prerequisites.

## File map and ownership

| Path | Responsibility in this slice |
|---|---|
| `docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md` | Chinese canonical implementation plan; absorbs the pasted 1726-line plan and supersedes its old ordering |
| `docs/superpowers/specs/2026-08-22-runtime-ownership-adr.md` | Ownership and naming decision (`ProductionContract` vs `ExecutionContract`) |
| `docs/audit/2026-08-22-agent-runtime-source-review.md` | Pinned, read-only Codex/Pi source audit (`5431c5ddf4d2dc5bdfeb0fc22c4b07f724f7a6fb`); informs E0/E1 aliases, never a second execution plan |
| `electron/capabilityCore/moduleManifest.ts` | Zod schema and pure validation for registered modules |
| `electron/capabilityCore/moduleRegistry.ts` | Immutable per-run module catalog snapshot and allowlist resolution |
| `electron/capabilityCore/moduleCatalogBootstrap.ts` | Explicit built-in module registration and test reset; no runtime network install |
| `electron/capabilityCore/skillEvidenceResolver.ts` | P3-only hash-pinned built-in Skill evidence; user-root/markdown fallback is never an authority |
| `electron/skills/skillExecutionEvidence.ts` | Add an explicit P3 strict mode; missing/unfingerprinted refs fail closed (legacy routes remain outside P3) |
| `electron/skills/skillStore.ts` | P3 resolver bypass/allowlist boundary; user-root discovery cannot grant module authority |
| `electron/capabilityCore/executionContract.ts` | `PlanCandidate → ExecutionContractV1` pure compiler, canonical hash and field ledger |
| `electron/capabilityCore/generationContext.ts` | Project-scoped, read-only planning packet |
| `electron/capabilityCore/generationRuntimeAdapter.ts` | Explicit `ExecutionContract → ResolvedTaskRequestV1 → submit/poll/reconcile` adapter; the only P3 provider path |
| `electron/capabilityCore/generationSingleShot.ts` | Orchestration for the one-shot lifecycle; never calls the legacy driver |
| `electron/capabilityCore/mcpGenerationTools.ts` | Typed MCP tool handlers and stage-aware visibility |
| `electron/capabilityCore/mcpToolExposure.ts` | Per-session/run exposure state and server-side stage authorization |
| `electron/capabilityCore/externalAgentControlPlane.ts` | Thin E0/E1 alias adapter; delegates to the existing semantic dispatcher and Run projection, never a new owner |
| `electron/capabilityCore/mcpGenerationPolicy.ts` | Single owner for `NOMI_MCP_GENERATION_SINGLE_SHOT_V1` default-off policy and kill switch |
| `electron/capabilityCore/projectLease.ts` | Main-process project-selection handle + lease issuer/verifier/revoker and scope hash; no host-supplied project authority |
| `electron/capabilityCore/projectLeaseStore.ts` | Shared durable lease/revocation records for stdio, GUI and restart; no process-local authority |
| `electron/capabilityCore/approvalReceipt.ts` | Main-process human-approval challenge/receipt issuer + verifier; durable one-time consume is owned by gate/WAL CAS |
| `electron/productionRun/productionExecutionBinding.ts` | Strict binding/runtime-envelope validation used by reducer, repository and IPC |
| `electron/productionRun/productionRunMigrations.ts` | Schema-version 1 → 2 legacy read/migration fixture; no destructive rewrite |
| `electron/productionRun/productionRunTypes.ts` | Existing Run/Job/Gate/Approval/Artifact types; add typed P3 binding, gate target and provenance fields without a new owner |
| `electron/productionRun/productionRunReducer.ts` | Enforce binding, gate and Artifact/Proposal invariants at the command boundary |
| `electron/productionRun/productionRunRepository.ts` | Validate/migrate persisted records and atomically append commands/events |
| `electron/productionRun/productionRunLock.ts` | Per-run single-writer lock/CAS guard for concurrent MCP/RPC draft and submit commands |
| `electron/productionRun/productionRunService.ts` | Existing durable command/gate/job owner; add contract-aware methods only |
| `electron/productionRun/productionRunIpc.ts` | Existing validation boundary; reject forged contract/approval fields |
| `electron/productionRun/productionRunResume.ts` | **Create** the route for `generation.single-shot` recovery to reconcile; keep legacy driver out of P3 restart/read paths |
| `electron/productionRun/productionRunDriverOps.ts` | Legacy driver isolation only; P3 tests that its arrange/export path is never entered |
| `electron/productionRun/productionRunRuntime.ts` | Shared contract-aware runtime/service seam if the existing service needs a narrow adapter; not a second Run owner |
| `electron/productionRun/productionRunRuntimeEnvelope.ts` | **Create** the durable job sidecar envelope/replay reader owned by ProductionRun; keyed by immutable project generation + runId/jobId/runtimeTaskId |
| `electron/productionRun/productionRunIntentLog.ts` | Run-owned prepare/commit intent WAL and replay/compensation across Run, budget, envelope and asset files |
| `electron/productionRun/approvalPolicy.ts` | Derive gate kind, cost scope and approval target from the sealed contract; never trust host estimates |
| `electron/productionRun/productionRunArtifactOperations.ts` | Existing Artifact command adapter; extend it over the reducer/repository and Asset store, never create a parallel Artifact owner |
| `electron/productionRun/productionRunProjectionSanitizer.ts` | Expose contract/receipt/artifact provenance without secrets or absolute paths |
| `electron/productionRun/submissionOutbox.ts` | Existing provider-submit/reconcile helper; P3 binds it to Run-owned intent records rather than its process-local inflight map |
| `electron/productionRun/productionPlaybooks.ts` | Register `generation.single-shot` with minimal stages and no legacy direction/arrange/export driver |
| `electron/productionRun/productionRunState.ts` | Replay/migration/snapshot readers for schema-v2 binding and receipt fields |
| `electron/spendGrant.ts` | Existing main-process spend grant; mint only from the typed Nomi gate and bind to shot/attempt |
| `electron/tasks/taskResultQuery.ts` | Existing poll/rebuild adapter; persist the exact provider/model/task payload needed for restart |
| `electron/assets/projectAssetStore.ts` | Resolve immutable asset content hash/state and deterministic materialization key; own the materialization receipt sidecar under the Run path |
| `electron/projects/repository.ts` | CAS/read wrapper over `workspace/workspaceRepository.ts`; it is not an independent project-revision owner |
| `electron/capabilityCore/mcpToolCatalog.ts` | Build metadata for `context → submit → preview → request_gate → decide_gate → start → observe → artifact/proposal`; keep `nomi_generate` explicitly legacy |
| `electron/capabilityCore/dispatcher.ts` | Route semantic tools to the same service/runtime, never to a second provider path |
| `electron/capabilityCore/mcpProtocol.ts` | Static MCP advertisement plus structured error/receipt output; server-side stage auth is the hard gate |
| `electron/capabilityCore/mcpStdioServer.ts` | Pass authenticated project scope/lease and the same service into stdio dispatch |
| `electron/capabilityCore/rpcServer.ts` | Pass authenticated project scope/lease and the same service into GUI/headless RPC |
| `electron/capabilityCore/host.ts` | Issue/verify project-scoped local host lease; no argument-only project authorization |
| `electron/capabilityCore/mcpResultEnrichLive.ts` | Keep live MCP receipt/progress projection aligned with sanitized Run projection |
| `electron/preload.ts` | Extend the existing IPC exposure for a server-issued approval challenge/decision; never expose a spend grant |
| `src/desktop/bridge.ts` | Extend the existing desktop bridge type for the approval challenge/decision receipt |
| `electron/capabilityCore/moduleManifest.test.ts` | Schema/allowlist/adversarial tests |
| `electron/capabilityCore/skillEvidenceResolver.test.ts` | Built-in provenance, body-hash and malicious user-root rejection |
| `electron/capabilityCore/executionContract.test.ts` | Compiler, hash and no-loss tests |
| `electron/capabilityCore/generationSingleShot.test.ts` | Fake-provider lifecycle and idempotency tests |
| `electron/capabilityCore/generationRuntimeAdapter.test.ts` | Contract-to-runtime mapping, durable request envelope and reconcile tests |
| `electron/productionRun/productionRunRuntimeEnvelope.test.ts` | Envelope persistence, replay and crash-window tests |
| `electron/capabilityCore/mcpGenerationTools.test.ts` | Tool schema, stage visibility and forged-input tests |
| `electron/capabilityCore/externalAgentControlPlane.test.ts` | E0 alias schema, operation correlation, atomic snapshot/cursor and E1 reject-state tests |
| `electron/capabilityCore/mcpGenerationPolicy.test.ts` | Flag-off static advertisement/disabled response and legacy-route preservation |
| `electron/productionRun/productionRunGate.test.ts` | Gate/approval target, revision, scope and legacy-driver isolation tests |
| `electron/capabilityCore/approvalReceipt.test.ts` | One-time human receipt, replay, wrong challenge and forged actor tests |
| `electron/capabilityCore/projectLease.test.ts` | Expiry, signature/handle, scope and concurrent draft-key tests |
| `electron/capabilityCore/projectLeaseStore.test.ts` | Cross-process issue/verify/revoke/restart and stale lease recovery |
| `electron/productionRun/productionRunIntentLog.test.ts` | Intent commit markers, crash matrix and idempotent replay |
| `electron/productionRun/productionRunResume.test.ts` | P3 restart branch versus legacy driver regression tests |
| `electron/capabilityCore/nomiMcpGenerationSingleShot.test.ts` | Real in-process MCP round trip with zero-credit provider |
| `tests/ux/mcp-generation-single-shot.e2e.mjs` | Real Electron stdio journey and reconnect evidence |
| `tests/ux/mcp-generation-single-shot.real-provider.mjs` | Explicit opt-in provider smoke; never runs in zero-credit CI |
| `docs/audit/2026-08-22-mcp-generation-phase-evidence.md` | PhaseEvidence, six-role verdicts, adversarial verdict and rollback reference |

The existing `electron/runtime.ts`, `electron/productionRun/`, Asset store and current Canvas/Timeline remain owners. A new file may add an adapter or projection, but may not create a second persistent owner.

---

## External control-plane addendum (E0/E1; not a second execution plan)

The Codex/Pi source study adds a protocol projection, not another runtime. The
original PR document is audited at fixed commit
`5431c5ddf4d2dc5bdfeb0fc22c4b07f724f7a6fb`; the local evidence summary is
`docs/audit/2026-08-22-agent-runtime-source-review.md`;
the following rules are the only parts admitted into this implementation plan.

### E0 — read/context/draft projection (before the P3 checkpoint)

E0 is zero-credit and zero-provider. `session/open` binds an authenticated
`ProjectLease` from the main-process `projectLease.ts`/`projectLeaseStore.ts`;
the host only forwards the bootstrap and is not the issuer. `projectId` and
`trust:'trusted'` are never accepted from client input. `operationId` is a
correlation/projection identifier stored in the existing Run intent/event
records, not a second operation database. For P3 it maps one-to-one to
`{immutableProjectUuid, projectGeneration, projectId, runId, contractHash?,
shotId?, runtimeTaskId?, attempt?}` and does
not support fork or multiple Runs.

The phase policy is explicit: before the P0/P2 checkpoints are passed, any
write-like E0 call (including `operation/plan`) returns `phase_not_ready` and
does not append a Run/job/gate. After those design/compiler checkpoints, the
zero-credit E0 path may persist the sealed contract, authorization-required job
and pending gate described below, but it still cannot reserve budget, mint a
grant, submit a provider request or materialize an Asset. E1 remains disabled
until the P3 checkpoint passes.

The E0 aliases are deliberately narrow:

These names are versioned aliases dispatched through the existing MCP
`tools/call`/Capability Core path (and the same GUI/headless dispatcher); they
are not an unnegotiated second JSON-RPC protocol. `tools/list` may advertise the
static schemas, while server-side stage/lease policy remains authoritative.
The slash names below are conceptual lifecycle labels, not wire tool names. The
wire catalog uses valid typed names: `nomi_session_open`,
`nomi_operation_create`, `nomi_submit_generation_plan`, `nomi_preview_execution`,
`nomi_operation_read`, `nomi_subscribe_run`, `nomi_request_generation_gate`,
`nomi_decide_generation_gate`, `nomi_start_generation`, `nomi_cancel_generation`,
`nomi_reconcile_generation` and `nomi_steer_generation`; each maps through the
same dispatcher and has one schema/version. Gate request/decision are canonical
typed calls in this catalog; E0 advertises them disabled and E1 enables them
only after P3.

The following is the closed name-to-owner registry. Names in the first column
are the only P3 wire names; the second column is the sole semantic owner. The
compatibility names in the last column are never aliases for a P3 request: they
remain legacy-only and return `legacy_path_forbidden` when presented with a P3
lease, operation, contract, gate or generation binding.

| Wire name | Semantic owner | Compatibility/legacy name |
|---|---|---|
| `nomi_get_generation_context` | read-only `context/read` | — |
| `nomi_session_open` | session/lease binder | — |
| `nomi_operation_create` | deterministic draft owner | — |
| `nomi_submit_generation_plan` | sealed contract/job/gate owner | — |
| `nomi_preview_execution` | local preview resolver | — |
| `nomi_operation_read` | Run/Artifact projection owner | `nomi_get_generation`, `nomi_get_run` |
| `nomi_subscribe_run` | RunEvent projection owner | `production.events` |
| `nomi_request_generation_gate` / `nomi_decide_generation_gate` | gate/receipt owner | `nomi_decide_gate`, `production.decide-gate` |
| `nomi_start_generation` | P3 runtime adapter | `nomi_start_playbook`, `production.start` |
| `nomi_cancel_generation` | `operation/interrupt` / Run-owned cancel | `nomi_control_run`, `production.control` |
| `nomi_reconcile_generation` | `operation/reconcile` / Run-owned reconcile | `nomi_control_run`, `production.control` |
| `nomi_steer_generation` | pre-seal candidate CAS | `nomi_generate` |
| `nomi_get_artifact` / `nomi_propose_adopt_artifact` | existing Artifact/Proposal owner | — |

The compatibility names may remain visible for migration telemetry, but they
must not fall through to a generic dispatcher or infer the P3 namespace from
payload resemblance. This table is shared by the MCP catalog, GUI/headless
dispatcher and direct IPC tests.

`nomi_get_artifact` and `nomi_propose_adopt_artifact` are reserved post-P5
static names in this slice: they are not in the E0/E1 effective scope and a
direct call returns `not_ready`/`feature_disabled` until the later Artifact/
Proposal checkpoint. A fresh lease cannot promote either name early.

`initialize` remains the MCP protocol handshake. After it succeeds,
`nomi_session_open` is the single project-session binding tool—not a second
initialize extension—and returns:

```ts
type ExternalSessionProjectionBase = {
  protocolVersion: 1
  sessionId: string
  leaseHandle: string
  immutableProjectUuid: string
  projectGeneration: number
  projectId: string
  expiresAt: string
  audience: 'nomi-mcp'
  serverNonce: string
}
type ExternalSessionProjection =
  | (ExternalSessionProjectionBase & {
      phase: 'schema_only'
      effectiveScope: Array<'context' | 'read' | 'events'>
    })
  | (ExternalSessionProjectionBase & {
      phase: 'e0_zero_credit'
      effectiveScope: Array<'context' | 'create' | 'plan' | 'preview' | 'read' | 'events'>
    })
  | (ExternalSessionProjectionBase & {
      phase: 'e1_paid'
      effectiveScope: Array<'context' | 'create' | 'plan' | 'preview' | 'read' | 'events' | 'gate_request' | 'gate_decide' | 'start' | 'cancel' | 'reconcile' | 'steer'>
    })
  | (ExternalSessionProjectionBase & {
      phase: 'closed'
      closeReason: 'lease_invalid' | 'project_scope_changed' | 'expired'
      effectiveScope: []
    })
```

`ExternalSessionProjection` is the local TypeScript spelling of the shared
`ExternalSessionProjectionV1` wire codec; it is not a second version or
validator. The same closed variants and exact scope arrays are used by the
Chinese plan, design spec and ADR.

`effectiveScope` is server-derived from the current phase and lease. Before
the P0/P2 checkpoints (or when the flag is off), the effective phase remains
`schema_only`, write-like calls return `phase_not_ready` or `feature_disabled`
respectively, and `operation/create`/`operation/plan` are not writable. After
P0/P2, `e0_zero_credit` adds `create`/`plan`/`preview`; only `e1_paid` adds paid
controls. `sessionId`/`projectId` are derived from either the signed selection
handle or a server-owned bootstrap resolver for an already registered client,
never accepted from the host. The connection binds one session/lease; duplicate
initialize, rebind, version downgrade or unknown fields fail closed. A headless
client may bootstrap the handle through a main-process/GUI or pre-registered local
challenge-response ceremony; a bearer token is transport authentication only,
never an issuer. The bootstrap request carries no project path or projectId.

The main process creates a fresh 256-bit `serverNonce` per connection and stores
only its MACed binding to `handle.sessionNonce`, the lease nonce and the
transport connection id (`NonceBindingV1`). Every post-open alias must present
that binding; copying a handle or lease to another transport cannot recreate it.
When a lease expires or is revoked, the resolver rejects every subsequent alias
with `lease_invalid`/`project_scope_changed`, closes the session and publishes
an empty `effectiveScope`; a cached projection is never authority. Reopen must
complete a new initialize/session-open ceremony.

| External lifecycle | Canonical Nomi path | E0 rule |
|---|---|---|
| `session/open` | initialize + verified lease | no spend authority |
| `context/read` | `nomi_get_generation_context` (read adapter) | read only; server fixes `createDraft=false` and the host cannot supply a mode |
| `operation/create` | `nomi_operation_create` → `createGenerationSingleShotDraft` | creates/reuses deterministic draft Run only; no job/gate/provider; separate from the read adapter |
| `operation/plan` | `nomi_submit_generation_plan` | seals the contract and atomically creates the existing authorization-required ProductionJob + `generation_submit` gate; still zero provider/spend |
| `plan/preview` | `nomi_preview_execution` | Nomi-derived cost/model only |
| `operation/read` | `nomi_operation_read` (delegates to the existing Run/Artifact read owner) | sanitized projection; no second read store |
| `operation/events` | `nomi_subscribe_run(afterCursor)` | existing per-Run `RunEvent.cursor` |

`operation/start` is **not** an E0 alias for planning. It is reserved for E1
and maps only to `nomi_start_generation` after the canonical gate/receipt,
reservation, prepared envelope, spend-grant and outbox checks. E0 does not expose
commit, interrupt or steer; those calls return typed `not_ready`/`contract_sealed`
errors rather than inventing a second permission path.

Snapshots and events come from one read service: return
`{snapshot, snapshotCursor, events, nextCursor}` from the same Run projection
boundary, or retry if the cursor changed between reads. Events are aliases of
durable `RunEvent` records (`eventId`, `cursor`, `runRevision`, `causationId`,
`correlationId`, `attemptId`), are emitted only after the fact commit, and never
carry secrets, absolute paths or opaque grants. `operation/completed` is emitted
only after materialization/artifact commit; `submission_unknown` and
`needs_attention` never become completed.
The external cursor is an opaque, signed encoding of the per-Run event cursor
(it may wrap an internal numeric cursor); clients must not submit a guessed
global integer or use a cursor from another Run.

### E1 — committed operation aliases (only after the P3 checkpoint)

E1 may expose these aliases through the same typed dispatcher and feature flag:

- `operation/start` → `nomi_start_generation({runId, contractHash})`; the server
  derives idempotency and requires a fresh lease plus consumed
  `HumanApprovalReceipt`, `generation_submit` target match, reservation,
  prepared envelope, one bound grant and the `generationRuntimeAdapter` path.
- `operation/interrupt` → explicit `nomi_cancel_generation`; before submit it
  releases the reservation, after submit it calls provider cancel/reconcile, and
  unknown remains `submission_unknown`/`needs_attention`.
- `operation/steer` → only a pre-seal candidate revision with CAS/new draft;
  creating the human challenge seals the candidate. Gate-pending, receipt-consumed,
  sealed, submitted and unknown states return `contract_sealed`/
  `operation_not_steerable`; the user must replan into a new draft/gate. It never
  patches prompt, model, cost, idempotency, providerTaskId or an in-flight challenge.

E1 still has one operation ↔ one single-shot Run ↔ one shot/ProductionJob /
RuntimeTask. It uses `productionRunIntentLog`, `productionRunRuntimeEnvelope`,
`submissionOutbox`, materialization receipts and `productionRunResume`; no new
EventStore, Operation DB, lane store or provider runner is introduced.

### Internal AgentLoopPort (P4/P6 only)

The Pi `AgentLoopPort` shape is a future internal adapter for the Nomi right-side
Agent. It is not a P3 dependency and cannot write Project/Timeline/ProductionRun
directly. The source study is informative; links must be pinned to audited
commits before implementation, and Pi Harness documentation is not treated as
shipped durability until a code/test audit proves it.

---

## Task 0: Establish the canonical Chinese plan and baseline

**Files:**

- Create: `docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md`
- Create: `docs/superpowers/specs/2026-08-22-runtime-ownership-adr.md`
- Create: `electron/capabilityCore/mcpGenerationPolicy.ts` (single feature-flag/kill-switch owner)
- Test: `electron/capabilityCore/mcpGenerationPolicy.test.ts`
- Test/evidence: `docs/audit/2026-08-22-mcp-generation-phase-evidence.md`

- [ ] **Step 1: Record a clean baseline before changing code**

Run in the clean sibling worktree:

```bash
git rev-parse HEAD origin/main
pnpm run typecheck
pnpm run test
```

Expected: the commit and command output are copied into the phase evidence; the current dirty shared worktree is not used as evidence.

- [ ] **Step 1a: Record the current execution-path blockers**

The baseline evidence must explicitly record these facts before any implementation:

```text
runtime.runTask is the provider request boundary, but its async task cache is process-local;
productionRunDriverOps still owns the legacy production.generate-node → arrange → export path;
submissionOutbox exists but is not the P3 dispatcher by default;
ProductionJob writes are accepted by reducer/repository/IPC casts without executionBinding validation;
ProductionGate/Approval do not yet have the P3 target/revision/cost fields;
LocalAssetRecord has stable identity but no immutable version/stateId contract;
DispatchContext carries origin, not an authenticated project lease;
safe Run/Artifact projections do not yet expose contract/receipt provenance.
```

If any implementation step does not name how it closes one of these gaps, it is not allowed into P3.

The evidence must also mark two compatibility facts explicitly: the existing
`nomi_generate` path is currently a paid, Canvas-writing compatibility route
(not read-only), and the new semantic tools are a separate feature-flagged
path. Disabling the flag must disable only the new path; it must not silently
change the old route's semantics. The flag is named
`NOMI_MCP_GENERATION_SINGLE_SHOT_V1`, defaults off until P3 evidence passes,
has one owner in the main-process capability policy, and has a tested kill
switch that leaves existing runs readable and does not cancel in-flight
legacy work.

The concrete owner is the new `electron/capabilityCore/mcpGenerationPolicy.ts`:
it reads `NOMI_MCP_GENERATION_SINGLE_SHOT_V1` once per main-process policy
snapshot, defaults to `off`, and exposes `isSingleShotEnabled()` only to the
semantic dispatcher and human-confirmation path. When off, `tools/list` keeps
the compatibility advertisement for schema discovery but every new semantic
call returns a structured `feature_disabled` result with a Nomi deep link;
the legacy `nomi_generate` advertisement and behavior are unchanged. The
kill-switch test proves existing Runs remain readable and in-flight legacy
work is untouched. The right-side Agent adapter uses the same policy owner,
not a second environment-variable check.

The policy exposes an explicit phase, not just a boolean:

| policy phase | flag | allowed new calls | write/spend rule |
|---|---|---|---|
| `schema_only` | off | schema/read aliases | all write-like calls → `feature_disabled` |
| `e0_zero_credit` | on | context/create/plan/preview/read/events | before P0/P2 evidence, write-like calls → `phase_not_ready`; after P0/P2, plan may write sealed contract + pending job/gate only |
| `e1_paid` | on | E0 calls plus gate/start/cancel/reconcile/steer | only after P3 evidence; receipt/reservation/grant/provider rules apply |

Error precedence is `feature_disabled` (flag off) → `phase_not_ready` (phase
not reached) → `not_ready` (E1 before P3) → lease/contract/gate validation. This
prevents the flag and checkpoint prose from describing two different gates.

Schema rollback is separate from the flag: while the flag is off, legacy
`brand.promo`/`nomi_generate` writes continue through their v1-compatible
projection until an old-reader fixture proves it can read a v2 record. New v2
fields are read-compatible but are never materialized by a normal read; a
separate maintenance migration command may append a v2 record after a
verified backup/receipt. A flag-off legacy-write/read fixture is required
before a global schema bump. A running
semantic P3 Run is not abandoned when the flag is killed: it becomes
read-only for new commands and continues only `poll/reconcile/materialize`
through the pinned adapter, with a visible `feature_disabled` next action;
no new provider submission is allowed.

- [ ] **Step 2: Write the ownership ADR**

The ADR must contain this explicit table and reject any implementation that adds a second owner:

```text
ProductionContract = run/job-set business, budget and approval envelope
ExecutionContract  = one operation/shot compiled execution binding
ProductionRun      = durable events, gates, jobs, outbox and recovery
RuntimeTask        = provider-neutral execution boundary
Asset store        = asset identity, bytes, materialization and lease
MCP/UI/Canvas      = transport or projection, never an independent truth source
```

It must also state that `GenerationJob` is a domain phrase for the existing `ProductionJob`/runtime task, not permission to create a parallel table.

The ADR must settle the following before code starts:

```text
Run creation: `context/read` calls `nomi_get_generation_context` with a
read-only intent and never creates a Run. `operation/create` calls the separate
`nomi_operation_create` adapter; when its optional runId is absent it uses a deterministic draft key
`generation.single-shot:{immutableProjectUuid}:{projectGeneration}:{lease.sessionId}:{selectionHash}:{draftNonce}`
and an atomic repository command to create/reuse a `generation.single-shot`
draft Run
through the existing ProductionRun service. Register that playbook in
`productionPlaybooks.ts` with a minimal brief + generation stage and an
explicit `initialGate: null`/no-direction-gate definition (extend the current
playbook type instead of inventing a hidden special case);
the generic `brand.promo` create path must not be reused. There is no second
draft store.

P3 gate: one combined `generation_submit` gate covers plan review, derived
budget and provider-submit authorization. `artifact_adopt` and reversible
adoption are later P5 gates; P3 records proposal-ready provenance only and does
not expose an adopt command.

Project scope: every new MCP tool receives an authenticated project lease in
DispatchContext (stdio and GUI use the same service and receipt). A projectId
in tool arguments never grants scope by itself.

Human-approval seam: the main process owns a `HumanApprovalChallenge` and
`HumanApprovalReceipt`. The closed `HumanApprovalChallengeV1` contains
`{version,challengeId,nonce,gateId,contractHash,projectRevision,costScope,
pricingSnapshotHash,reservationPreview,issuedAt,expiresAt,immutableProjectUuid,
projectGeneration,audience,mac}`. The signed/MACed fields are always present,
but only the redacted `reservationPreview` is shown to a human; internal binding
fields are never supplied by the host. A challenge contains a one-time nonce,
gateId, contractHash, projectRevision, costScope, expiry and a sanitized review packet;
the receipt is the canonical `HumanApprovalReceiptV1` with
`version/keyId/algorithm/issuer/receiptId/challengeId/handoffId/immutableProjectUuid/
projectGeneration/revocationEpoch/projectId/runId/gateId/contractHash/targetHash/
projectRevision/costScope/pricingSnapshotHash/humanActor/gestureAttestation/
receiptNonce/audience/issuedAt/expiresAt/mac`; its one-time consume is a durable
gate/WAL CAS, not a transport callback. `approvalReceipt.ts` is the only
issuer/verifier; the durable consume is owned by the gate/WAL reducer. `mcpProtocol.ts`, `mcpStdioServer.ts`, `rpcServer.ts` and the
renderer/preload bridge may request an elicitation or show the packet, but may
not manufacture a receipt. `generation_submit` consumes the receipt
atomically; replay, wrong challenge, expired receipt or a transport option such
as the legacy boolean `spendConfirmed` is rejected. The `humanActor` on a new
Approval is copied from the verified receipt; the lease's
`leasePrincipal`/host actor supplies scope only, not human identity or approval.
The project-selection/root-of-trust handle used to issue a lease is signed by
the main process/GUI project picker against the app-owned project registry;
there is no ACL/path fallback. A global bearer token plus an arbitrary
projectId/path is never sufficient.
An external MCP `elicitation/create` response (for example
`{action:'accept', content.confirm:true}`) is only a request to show/complete the
challenge; it is not human proof. **The default confirmation surface is a
separately registered, attested client whose identity and user binding are
verified by `approvalReceipt.ts`; one verified accept mints the receipt directly
and does not open a second Nomi prompt.** Without that attestation the response
returns `human_approval_required` with a project-scoped handoff/deep link; Nomi
GUI answers the same challenge once and the original request resumes. The
connection action establishes client identity, a read-only current-project lease
may be reused for context/preview, and the first `generation_submit` confirmation
atomically upgrades scope and consumes the receipt. Neither path accepts raw
`confirm`/`approved`/`spendConfirmed` as authority.

`GestureAttestationV1` is a closed, server-verified union rather than an
arbitrary object:

```ts
type GestureAttestationV1 =
  | { kind: 'main_process_gesture'; issuer: 'nomi-main'; keyId: string; challengeId: string; decision: 'accept' | 'reject'; webContentsId: number; frameId: number; origin: string; gestureNonce: string; issuedAt: string; expiresAt: string; mac: string }
  | { kind: 'registered_client_signature'; issuer: 'attested-client-registry'; keyId: string; clientId: string; challengeId: string; decision: 'accept' | 'reject'; audience: 'nomi-mcp'; gestureNonce: string; issuedAt: string; expiresAt: string; signature: string }
```

The `decision` is inside the signed/MACed canonical bytes; `reject` and timeout
can never mint a receipt. `recipientBinding` and `recipientProof` are also
closed values, not arbitrary strings: they identify a registered
`webContentsId/frameId/origin` or an attested-client public key, and carry a
fresh one-time channel nonce, challenge hash, issued/expiry timestamps and a
main-process MAC. The verifier derives `humanActor` and refuses a proof from a
different renderer, client, connection or project generation.

`humanActor` is derived from the registered window/client or main-process user
session. Host-supplied actor names, booleans, renderer IDs, stale nonces or
unknown attestation kinds are rejected before receipt minting; the registered
WebContents/frame/origin and one-time challenge nonce are checked at the IPC
boundary.

The pending challenge is durable before the transport request is sent. The
Run-owned intent log records `generation.gate.challenge` with
`challengeId/nonce/contractHash/projectId/runId/expiresAt/payloadHash` and a
prepare/commit/abort status; `approvalReceipt.ts` replays it after a main-process
restart and never reuses a nonce. A restart before acceptance re-exposes the
same unexpired challenge (or returns an expired `nextAction`), while a restart
after acceptance replays the one-time receipt consumption. The elicitation
transport is therefore a projection of a durable challenge, not the state
owner.

Lease seam: `projectLease.ts` is the only main-process issuer/verifier for a
`ProjectSelectionHandleV1`. The handle is a signed/MACed record containing
`{version:1, keyId, algorithm:'HMAC-SHA256', issuer:'nomi-main', handleId, immutableProjectUuid, projectGeneration,
canonicalRootDigest, manifestDigest, audience:'nomi-mcp', sessionNonce,
issuedAt, expiresAt, revocationEpoch, scopeSet, mac}`. Its key ring lives in
app-owned storage/OS keychain; neither the project directory, an MCP host, nor
a renderer can mint or rotate a key. `session/open` accepts this handle or the
closed server-owned `bootstrap:'current_project'` request for an already
registered client; both derive `sessionId`/`projectId` in the main process. A
global bearer token and arbitrary projectId/path cannot create it. Headless mode
must use a one-time main-process or pre-registered local-client challenge
response; an environment token is transport authentication only.

`ProjectLeaseV1` includes `{version:1,keyId,algorithm:'HMAC-SHA256',issuer:'nomi-main',projectId,
immutableProjectUuid,projectGeneration,canonicalRootDigest,manifestDigest,
audience:'nomi-mcp',leasePrincipal,sessionId,issuedAt,expiresAt,nonce,scopeSet,
scopeHash,revocationEpoch,connectionNonce,mac}`;
there is no ambiguous client-selected `signatureOrHandle` field. `host.ts` only forwards
an authenticated bootstrap to the main-process issuer; it is not a trust root.
`projectLeaseStore.ts` uses an appData/OS-keychain store for the authoritative
key ring, project-generation and revocation epoch; the project-local
`.nomi/leases/<projectId>/<sessionId>.jsonl` is only a MACed mirror/audit record
and can never revive a deleted or restored project. Every record is checked
against the current project identity. The store uses the shared per-project lock/CAS,
monotonic fencing/revocation epoch and directory fsync; a checksum alone or an
unlocked atomic replace is not sufficient. At every semantic dispatch,
`projectLease.ts` re-resolves a no-follow canonical realpath and the current
manifest/project-generation digest before allowing a command, using the
registry-selected root identity/opened directory handle (or equivalent
openat-style no-follow operation) so validation and write share one inode
boundary. Delete/recreate,
rename, symlink substitution, manifest change, stale epoch or revoked handle
returns `project_scope_changed` and never writes the new path.
The store exposes `issue`, `verify`, `revoke`, `replay` and TTL/stale-owner
checks. `session/open` binds the returned `serverNonce` to the connection;
subsequent aliases must present that connection binding, so a copied
`leaseHandle` cannot be replayed from another transport. The signed handle and
revocation record are therefore shared across stdio, GUI and a restarted main
process, not a main-process-only Map. Every dispatcher, reducer and IPC entry
verifies it.
The draft key is persisted
on the Run and indexed by `draftKey`; create/reuse is one locked command, so
restart and concurrent stdio/GUI calls resolve the same
`(immutableProjectUuid, projectGeneration, sessionId, selectionHash, draftNonce)`
to one Run rather than relying on an in-memory map.

Schema migration: PRODUCTION_RUN_SCHEMA_VERSION moves from 1 to 2 with
strict legacy readers, an explicit maintenance migration command and
fixtures; normal read/list/rebuild/startup paths never copy, back up,
rewrite, or advance state. No destructive rewrite or physical deletion is
part of this slice. `productionRunState.ts`, snapshot readers and the safe
projection types must read both v1 and v2; if
the old binary cannot read v2, migration is deferred behind the flag and a
restore fixture is required before writing v2.

Spend authorization: the approved contract causes the main process to mint an
existing `spendGrant` only after the durable `generation_submit` receipt is
written. The grant is bound to `(runId, contractHash, shotId, attempt)` and
the runtime request carries only its opaque grantId/nodeId; the host cannot
mint or supply a grant. A missing/expired/foreign grant is fail-closed.

Contract hashes: `contractHash` is computed over an immutable pre-submit
domain only (source/module/project/input/capability/output/policy intent),
excluding gateId, approvalHash, runtimeTaskId, providerTaskId, status and
receipts. `requestFingerprint` is a second immutable hash over the resolved
`ResolvedTaskRequestV1`; mutable runtime IDs/status are stored in the envelope and
receipts, never fed back into `contractHash`.

Gate/job order: plan submission atomically creates one authorization-required
ProductionJob with its binding and puts its jobId on the generation_submit
gate. P3 maps that gate to the existing `scope: 'budget_envelope'` and the
new `gateKind: 'generation_submit'`; the reducer requires both fields and
branches before legacy gate-id hooks. Gate approval then creates the
Approval/receipt and only then permits the adapter to prepare/submit. No gate
can authorize an empty job set.
For P3, `generation_submit.targetHash === contractHash`; the old `planHash`
field may be retained only as a legacy projection and never authorizes this
path. Use a non-colliding constant prefix such as
`gate-generation-single-shot-v1:` so the current `gate-contract-v*` hooks
cannot accidentally enter `driveGeneration`.

Provider recovery: the selected module must declare `submitIdempotency`,
`queryByTaskId`, `reconcile` and (when offered) `cancel` capabilities. The
adapter persists the canonical provider request, idempotency header/key,
provider/model mapping and the response-to-`providerTaskId` extractor before
polling. If a provider cannot query/reconcile an interrupted submission, the
compiler returns `blocked` and no paid P3 contract is admitted. Provider
fallback is resolved before sealing; one logical contract has one provider
adapter invocation, and a fallback is a new contract/gate rather than a
hidden second HTTP submit.

Lease: `projectLease.ts` (main process) issues a short-lived project lease only
after the authenticated local GUI/stdio bootstrap has presented a verified
project-selection handle, and persists its MACed handle plus revocation state
in the shared lease store; `host.ts` only forwards the bootstrap. `mcpStdioServer.ts`, `rpcServer.ts` and the
dispatcher verify project, leasePrincipal, session, expiry and scopeHash on every new
semantic call. A lease from a different process or after restart is accepted
only if its signature/handle verifies against that store.

Recovery authority is separate from a disconnected host lease: once a Run has
an approved contract, reservation and durable provider attempt, the pinned
`productionRunResume` adapter may poll/reconcile/materialize under a
Run-owned internal authority after the external lease expires. External
context/submit/start/adopt calls still require a fresh verified lease. This
prevents a legitimate background job from becoming unrecoverable while
preventing an expired host from issuing new paid or project-write commands.
```

- [ ] **Step 3: Rewrite the Chinese plan’s execution order**

The canonical plan must put these phases in order:

```text
P0 baseline/ownership
P1 runtime + module + asset boundary
P2 ExecutionContract compiler
P3 MCP single-shot generation
P4 recovery/controlled expansion
P5 editor Adopt Proposal
P6 renderer/dynamic modules
P7 full Editor/workflow productization
```

Preserve the original plan’s user paths, QA, audio, MotionGraphic, J1–J11 and review sections, but mark them as later phases where they depend on P3/P5. The English design file is cited as an absorbed design note, not a second execution entry.

- [ ] **Step 4: Add phase exit/rollback rules to the Chinese plan**

Every phase must specify:

```text
entry evidence → files changed → zero/paid boundary → tests → user-visible evidence → exit verdict → rollbackRef
```

No provider call or persistent migration is allowed in Task 0.

- [ ] **Step 5: Run document self-review**

Run:

```bash
rg -n "TBD|FIXME|exact path to be recorded|implementation placeholder|eventually" docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md | rg -v "rg -n|Expected:"
```

Expected: no vague implementation placeholder remains; any use of “later” names a phase and an entry condition. Commit the document/ADR/evidence skeleton separately from code.

- [ ] **Step 6: Pass the first architecture checkpoint**

Run a short six-role checkpoint and an adversarial design pass over the blocker list. P0 findings (second owner, legacy driver side effect, missing durable provider identity, forged gate or missing project scope) block all code work. Store the verdict in the phase evidence before starting Task 1.

The same checkpoint is repeated at the end of P2 and P3. The project-wide
verification set for every checkpoint includes `check:filesize`,
`check:tokens`, `check:i18n`, `lint:ci`, `typecheck`, `test`, `build`, and the
relevant zero-credit MCP journey; a passing unit-test subset is not an exit
verdict.

## Task 1: Define the module contract and registry (zero credit)

**Files:**

- Create: `electron/capabilityCore/moduleManifest.ts`
- Create: `electron/capabilityCore/moduleRegistry.ts`
- Create: `electron/capabilityCore/moduleCatalogBootstrap.ts`
- Test: `electron/capabilityCore/moduleManifest.test.ts`
- Test: `electron/capabilityCore/moduleRegistry.test.ts`
- Test: `electron/capabilityCore/moduleCatalogBootstrap.test.ts`

- [ ] **Step 1: Write failing schema tests**

Cover these cases before implementation:

```ts
it('accepts a hash-pinned built-in module with explicit effects and tools')
it('rejects an unknown kind, empty hash, unknown tool or empty executor')
it('rejects a Skill-only module that claims paid/project-write effects')
it('rejects arbitrary shell/fs/network tools for a knowledge or check module')
it('does not activate a tool merely because its name appears in Skill text')
it('rejects a module whose cardinality is not one provider job and one artifact for the single-shot route')
it('rejects a paid module without submit idempotency, task query and reconcile capabilities')
it('rejects a single-shot module whose destination is timeline, canvas or export')
it('does not load a module by running a network install or arbitrary inline code')
it('does not let the legacy fingerprint cache turn a new single-shot submit into an unreceipted cache hit')
```

- [ ] **Step 2: Implement the closed module schema**

Use a discriminated Zod contract with:

```ts
kind: 'workflow' | 'route' | 'check' | 'renderer' | 'connector' | 'knowledge'
sideEffectClass: 'read' | 'propose' | 'paid' | 'project_write' | 'publish'
id, version, contentHash, inputs, outputs, requiredCapabilities,
allowedTools, allowedCommands, validatorRefs, executorRef, executorDigest,
validatorDigests,
approvalPolicy, retryPolicy, cachePolicy, cardinality, destination,
providerRecoveryCapabilities
```

The parser must reject unknown keys (`.strict()`), paths, credentials and inline executable code.

Use these concrete TypeScript names so later tasks cannot drift:

```ts
export type SideEffectClass = 'read' | 'propose' | 'paid' | 'project_write' | 'publish'
export type ArtifactContract = { kind: string; schemaVersion: number; required: boolean }
export type ApprovalPolicy = { required: boolean; gateKind?: 'generation_plan_review' | 'generation_submit' | 'artifact_adopt' }
export type RetryPolicy = { scope: 'pure_check' | 'compile' | 'provider_reconcile' | 'provider_resubmit'; idempotencyRequired: boolean }
export type CachePolicy = 'bypass' | 'durable_hit_only'
export type Cardinality = { providerJobs: 1; artifacts: 1 }
export type ModuleDestination = 'project_asset' | 'canvas' | 'timeline' | 'export'
export type ProviderRecoveryCapability = 'submitIdempotency' | 'queryByTaskId' | 'reconcile' | 'cancel'
export type ModuleCatalogSnapshot = { catalogVersion: string; contentHash: string; modules: ModuleManifest[] }
export type ResolvedModule = { manifest: ModuleManifest; snapshotHash: string }
```

- [ ] **Step 3: Implement immutable catalog snapshots**

Expose pure functions with these signatures:

```ts
registerBuiltInModule(module: ModuleManifest): void
snapshotModuleCatalog(): ModuleCatalogSnapshot
resolveModule(snapshot: ModuleCatalogSnapshot, id: string, version: string): ResolvedModule
assertModuleInvocation(snapshot: ModuleCatalogSnapshot, moduleId: string, tool: string, effect: SideEffectClass): void
bootstrapBuiltInModules(): void
resetModuleCatalogForTests(): void
```

`contentHash` covers the canonical manifest and the registry snapshot also pins
`executorDigest`/`validatorDigests`; changing implementation bytes changes the
snapshot hash and invalidates the old contract. A resolved provider profile/account
scope is included in the capability snapshot and request fingerprint, so an
account switch cannot reuse an old provider idempotency key. A Run captures the
snapshot once; later registry changes affect only a new Run. The bootstrap registers the
signed/in-repository `generation.single-shot` module with
`cardinality: { providerJobs: 1, artifacts: 1 }`, `destination: 'project_asset'`,
`executorRef: 'generationRuntimeAdapter.v1'` and
`approvalPolicy.gateKind: 'generation_submit'`. Registry registration is
explicit and test-resettable; no model, Skill or MCP request may register a
remote module during a Run. For this module `sideEffectClass: 'paid'` covers
the provider submission; deterministic local materialization and Artifact
registration are idempotent runtime settlement, not Timeline/Canvas apply.
They still require the project lease and are included in the receipt.

The manifest must declare `providerRecoveryCapabilities` for every paid
executor: `submitIdempotency`, `queryByTaskId` and `reconcile` are required for
P3; `cancel` is optional but its absence is surfaced in the review packet.
Provider/model fallback is resolved before the module snapshot is sealed. A
single logical contract cannot silently try a second provider route inside
`runTask`; a fallback is a new candidate/contract and gate.

The P3 module operation is closed to this explicit allowlist:
`image_generation → image`, `text_to_video → video` and
`image_to_video → video`. The compiler rejects `text`, `custom`, multipart,
process/script executors or any other task kind/executor until that branch has
the same main-process spend-grant, idempotency, reconciliation and
materialization assertions. The adapter repeats the mapping immediately before
dispatch, so a host cannot smuggle a free/custom route into a paid single-shot
contract.
For P3, `providerJobs: 1` means one generation-provider submission and one
provider idempotency key, not merely one logical node. Reference localization,
upload or download may produce separate bounded transport events; they are not
counted as a second provider generation job, but each event must have its own
lease, idempotency key, receipt and restart/reconcile evidence. Automatic route
fallback inside `runtime.runTask` is disabled for this module; a 403/timeout
becomes a typed result or `needs_attention`. Any alternate provider is a new
candidate, contract and human gate. The fake provider test counts generation
submit calls separately from asset-transport calls and must observe exactly `0`
generation submits before approval and `1` after start.
The built-in module sets `cachePolicy: 'bypass'` for the legacy process-local
fingerprint cache; duplicate starts are served from the durable Run/receipt,
not an unrecorded cache hit. A future cache-aware module must persist an
explicit `cache_hit` settlement and Artifact receipt before it can be admitted.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm exec vitest run electron/capabilityCore/moduleManifest.test.ts electron/capabilityCore/moduleRegistry.test.ts electron/capabilityCore/moduleCatalogBootstrap.test.ts
```

Expected: PASS, including all fail-closed cases. Commit only the module contract/registry files and tests.

## Task 2: Compile a PlanCandidate into an ExecutionContract

**Files:**

- Create: `electron/capabilityCore/executionContract.ts`
- Create: `electron/capabilityCore/skillEvidenceResolver.ts`
- Modify: `electron/skills/skillExecutionEvidence.ts` (P3 strict mode only)
- Modify: `electron/skills/skillStore.ts` (P3 boundary only; no legacy semantic change)
- Test: `electron/capabilityCore/executionContract.test.ts`
- Test: `electron/capabilityCore/skillEvidenceResolver.test.ts`
- Create: `electron/productionRun/productionExecutionBinding.ts`
- Create: `electron/productionRun/productionRunMigrations.ts`
- Create: `electron/productionRun/productionRunIntentLog.ts`
- Create: `electron/productionRun/productionRunLock.ts`
- Create: `electron/productionRun/productionRunRuntimeEnvelope.ts`
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunState.ts`
- Modify: `electron/productionRun/productionRunReducer.ts`
- Modify: `electron/productionRun/productionRunRepository.ts`
- Modify: `electron/productionRun/productionRunIpc.ts`
- Test: `electron/productionRun/productionStoryboardBinding.test.ts` (new contract binding cases)
- Test: `electron/productionRun/productionExecutionBinding.test.ts`
- Test: `electron/productionRun/productionRunMigrations.test.ts`
- Test: `electron/productionRun/productionRunIntentLog.test.ts`
- Test: `electron/productionRun/productionRunLock.test.ts`
- Test: `electron/productionRun/productionRunRuntimeEnvelope.test.ts`
- Test: `electron/productionRun/productionRunState.test.ts`

- [ ] **Step 1: Write failing compiler tests**

The tests must prove:

```ts
it('compiles the same input and registry snapshot to the same canonical hash')
it('retains every prompt, asset, model and output field in the ledger')
it('records dropped fields and warnings when capability resolution is explicit')
it('rejects stale asset versions, foreign projects and unknown module versions')
it('rejects host fields approved, providerTaskId, assetId and qualityPass')
it('changes the contract hash when an input asset version or capability changes')
it('rejects params with unknown keys, oversized strings or unbounded objects')
it('forces the single-shot destination to project_asset and cardinality to 1/1')
it('derives cost and provider/model from the Nomi resolver, never from host estimatedCost')
it('rejects a forged text/custom task kind or unaudited executor that could bypass the paid grant guard')
it('uses a stable generation_context source for a prompt-only candidate and a hashed asset source when a reference is present')
it('captures the real loaded/applied Skill body hash and selected sections in evidence')
it('fails closed when a declared Skill ref is missing instead of writing version: declared')
it('rejects host-supplied system/instruction prompt parts; only the hash-pinned module/Nomi resolver may author stage policy text')
it('rejects a user-root or markdown-only Skill and never emits declared provenance')
it('changes the module snapshot hash when executor or validator implementation digests change')
it('binds provider profile/account scope into the resolved capability and request fingerprint')
```

- [ ] **Step 2: Add the typed contract**

The schema must contain:

```ts
contractVersion: 1
contractId: string
contractHash: string // SHA-256 of the immutable pre-submit domain
source: { kind: 'generation_context' | 'asset' | 'storyboard', artifactId, version, hash }
operation: { kind, shotId, module: { id, version, contentHash } }
project: { projectId, immutableProjectUuid, projectGeneration, revision }
moduleCatalogSnapshot: { catalogVersion: string, contentHash: string }
inputs: { promptParts, assetRefs, params }
capabilitySnapshot
outputs: { artifactKinds, destination, cardinality: { providerJobs: 1, artifacts: 1 } }
policy: { gateKind, maxSpend, costScope, policySnapshotHash }
execution: { requestFingerprint, providerIdempotencyKey, providerRecoveryCapabilities }
skillEvidence: SkillEvidenceV1[]
ledger: FieldLedgerEntry[]
warnings: string[]
```

```ts
type SkillEvidenceCommonV1 = {
  registryRef: string
  version: string
  bodyHash: string
  registrySnapshotHash: string
  issuer: 'nomi-skill-resolver'
  keyId: string
  hashAlgorithm: 'sha256'
  sourceKind: 'builtin_registry'
  selectedSections: Array<{ startByte: number; endByte: number; hash: string }>
  stage: 'context' | 'plan' | 'provider' | 'materialize'
}
type SkillEvidenceV1 =
  | (SkillEvidenceCommonV1 & { state: 'discovered' })
  | (SkillEvidenceCommonV1 & { state: 'loaded'; inputHash: string })
  | (SkillEvidenceCommonV1 & { state: 'applied'; inputHash: string; promptAssemblyHash: string; outputArtifactIds?: string[] })
```

`SkillEvidenceV1` is resolver-issued, not a host assertion: every hash uses
`sha256` over canonical UTF-8 body bytes, `registryRef` resolves inside one
immutable built-in registry snapshot (`registrySnapshotHash`/commit), and each
selected section carries a bounded byte-range/hash pair. `inputHash` is required
for `loaded|applied`, `promptAssemblyHash` is required for `applied`, and
`outputArtifactIds` is required for `materialize`; unknown keys, paths, env/cwd/
user-root refs, symlinks and missing bodies fail closed. The resolver captures
the final stage prompt bytes before applying it and signs the evidence with its
issuer/key id; no legacy loader may silently downgrade it to `declared`.

For a prompt-only P3 candidate, `source` is the stable synthetic
`{ kind: 'generation_context', artifactId: runId, version: 1, hash: contextHash }`;
with a reference it is the server-resolved asset/storyboard source. The host
cannot invent a source hash.

`contractHash` is produced last: validate and normalize the complete
immutable domain, canonicalize sorted keys, hash it, then attach the hash to
the compiled contract. The domain includes `operation.shotId`, the captured
module-catalog hash and `policySnapshotHash`; it excludes
gate/approval/runtime/provider IDs, status, receipts and the opaque spend
grant. Every binding, gate and tool compares this exact field rather than
recomputing a hash from a mutable envelope.

For this slice, `outputs` is not merely descriptive: the compiler must reject
anything other than exactly one provider job, exactly one materialized
artifact and `destination: 'project_asset'`. Timeline, Canvas and export
destinations are valid in later contracts, not silently downgraded here.
The uniqueness key is `(immutableProjectUuid, projectGeneration, runId,
contractHash, shotId)`; retries and restarts may update the same attempt/receipt
but may not create a second provider job or Artifact under that key. Cross-Run
content reuse requires an explicit signed Artifact handoff; equal contract/shot
hashes never imply a shared provider task or Artifact.

Define the input and ledger types in the same file before implementing the compiler:

```ts
export type PlanCandidate = {
  // projectId/immutable identity are derived from the authenticated lease;
  // the host cannot submit a project scope field.
  baseRevision: number
  operation: { kind: 'image_generation' | 'text_to_video' | 'image_to_video'; moduleId: string; moduleVersion: string }
  promptParts: PromptPart[]
  assetRefs: Array<{ assetId: string; role: string; version?: number; required?: boolean }>
  params: Record<string, unknown> // parsed by a strict, size-bounded module schema
  requestedDestination: 'project_asset' | 'canvas' | 'timeline' | 'export'
}
export type PromptPart = {
  role: 'user' | 'negative' // system/instruction are compiler/module-owned, never host input
  text: string
  sourceKind: 'host_candidate' | 'asset_caption' | 'module_builtin'
}
export type FieldLedgerEntry = {
  path: string
  source: 'candidate' | 'module-default' | 'capability-resolver' | 'user-override'
  target: 'contract' | 'provider' | 'artifact'
  status: 'retained' | 'dropped' | 'defaulted' | 'warning'
  reason?: string
}
```

Input authority is explicit: the host may propose user-level prompt text,
semantic asset roles, an optional observed version and desired parameters; the
server resolves/validates `assetId`, version, `stateId`, `contentHash`,
`materializationStatus`, `required`, project revision, source, provider/model,
cost, cardinality, destination and Skill hashes. A forged `stateId`,
`required: false` on a required reference, foreign asset or untrusted
`PromptPart.sourceKind` is rejected or recorded as a dropped field; it cannot enter
the sealed contract. Host-provided version/required values are assertions that
must match the server snapshot; state/content/materialization/final-required
fields are server-derived. Host-supplied `system` or policy-bearing
`instruction` text is never inserted into the stage system prompt; it is either
rejected or normalized to a user-level candidate field with a ledger warning.
Only the hash-pinned registered module and Nomi resolver can author policy/system
sections; the host supplies user-level intent only. Host `system`/`instruction`
text never reaches the final stage prompt. The ledger records each server-derived
replacement.

Use a canonical JSON serializer with sorted object keys and a SHA-256 hash. Do not use `JSON.stringify` on an unvalidated object as the contract hash.

The compiler writes two explicit domains: `contractHash` covers only the
immutable pre-submit fields (source, module, project revision, resolved
inputs/capabilities, output/cardinality and policy intent); `requestFingerprint`
covers the resolved `TaskRequest`. `gateId`, `approvalHash`, `runtimeTaskId`,
`providerTaskId`, status, budget settlement and receipts are mutable bindings
stored beside the contract, never inside the hash domain. A gate therefore can
target a contract before a runtime task exists, and a restart can update
runtime IDs without invalidating the approved contract.

Asset refs are resolved against the existing project asset store before
compilation. The resolver records `{ assetId, version, stateId, contentHash,
materializationStatus }`; for the first slice `stateId === contentHash` is an
invariant (the immutable local content hash) and a content change invalidates
the candidate. No second
AssetRegistry is introduced. The MCP dispatch context also carries an
authenticated V1 `ProjectLease` with
`immutableProjectUuid/projectGeneration/canonicalRootDigest/manifestDigest`,
`leasePrincipal/sessionId/connectionNonce`, `scopeSet/revocationEpoch` and an
app-keyed `LeaseV1.mac` for both stdio and GUI paths; a client-supplied
`projectId` cannot create or widen that lease. Each dispatch revalidates the
project identity and no-follow canonical path before a write.

- [ ] **Step 3: Bind existing ProductionJob without creating GenerationJob**

Add a schema-validated `executionBinding` to the existing job metadata path.
It remains optional only for legacy v1 records; the P3
`generation.plan.submit` command requires it:

```ts
type ExecutionBinding = {
  contractHash: string
  shotId: string
  moduleRef: { id: string; version: string; contentHash: string }
  inputAssetRefs: Array<{ assetId: string; version: number; stateId: string; contentHash: string }>
  requestFingerprint: string
  providerIdempotencyKey: string // exact server-derived key; no second key domain
  capabilitySnapshotHash: string
  cardinality: { providerJobs: 1; artifacts: 1 }
  destination: 'project_asset'
  runtimeTaskId?: string // server-assigned at prepare; never supplied by host
  runtimeEnvelopeRef?: { relativePath: string; schemaVersion: number; hash: string }
  runtimeEnvelopeHash?: string // attached after gate during local prepare; providerTaskId/status are sidecar fields
  fencingEpoch?: number // Run-owned monotonic sidecar binding, not part of contractHash
  envelopeState: 'unprepared' | 'prepared' | 'submitted' | 'unknown' | 'settled'
}
```

Define the durable runtime envelope before any provider call:

```ts
type RuntimeTaskEnvelope = {
  runtimeTaskId: string
  contractHash: string
  preparedTaskRequest: ResolvedTaskRequestV1
  requestFingerprint: string
  providerId: string
  accountId: string
  profileId: string
  tenantScope: string
  endpoint: string
  model: string
  // `requestFingerprint` is the sole canonical request hash; legacy
  // `providerRequestFingerprint` projections, if read, must equal it byte-for-byte.
  providerIdempotencyKey: string // the sole server-derived idempotency key
  providerRecoveryCapabilities: Array<'submitIdempotency' | 'queryByTaskId' | 'reconcile' | 'cancel'>
  providerTaskId?: string
  fencingEpoch: number
  recoveryAdapterId: string
  status: 'prepared' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'submission_unknown' | 'cancelled'
  submissionDisposition: 'not_attempted' | 'definitely_not_submitted' | 'unknown' | 'submitted'
}

// This is the only request shape that may cross the sealed P3 provider boundary.
// It is a server-derived discriminated union with additionalProperties:false;
// host `TaskRequest.extras`, headers, scripts, process/multipart routes and
// arbitrary provider fields do not exist in this type.
type ResolvedTaskRequestV1 =
  | { kind: 'image_generation'; model: string; prompt: string; negativePrompt?: string; inputAssetRefs: Array<{ assetId: string; version: number; stateId: string; contentHash: string; role: 'reference' | 'style' }>; width: number; height: number; steps: number; seed?: number }
  | { kind: 'text_to_video'; model: string; prompt: string; negativePrompt?: string; inputAssetRefs: Array<{ assetId: string; version: number; stateId: string; contentHash: string; role: 'reference' | 'style' }>; width: number; height: number; durationSeconds: number; fps: number; seed?: number }
  | { kind: 'image_to_video'; model: string; prompt: string; negativePrompt?: string; inputAssetRefs: Array<{ assetId: string; version: number; stateId: string; contentHash: string; role: 'reference' | 'style' }>; width: number; height: number; durationSeconds: number; fps: number; seed?: number }
// The module validator owns bounded numeric/string limits for each variant;
// unknown keys are rejected at compiler, reducer, provider and IPC boundaries.
```

At `generation.plan.submit`, `runtimeEnvelopeHash` is intentionally absent and
`envelopeState` is `unprepared`: the contract/job/gate can be created without
pretending that a provider request already exists. After the verified human
receipt and durable reservation, `generationRuntimeAdapter.prepare` resolves
the local canonical request (still zero network/provider calls), writes the
ProductionRun-owned envelope, and atomically attaches its
`runtimeEnvelopeHash`/`envelopeState: 'prepared'` to the binding. Only then can
the grant be consumed and `start` dispatch. A missing or mismatched envelope at
that point is `needs_attention`, never a placeholder hash.

The WAL and envelope persist only project-ACL-protected prompt/asset references
and a redacted prepared request; credentials, authorization headers, provider
secrets and opaque grants are forbidden in both files and have a scan test.

The envelope is a ProductionRun-owned sidecar, not an in-memory runtime
cache: `productionRunRuntimeEnvelope.ts` stores it under the existing
`productionRunPaths(projectDir, runId).dir/jobs/<jobId>/envelope.json` path,
keyed by `{ runId, jobId, runtimeTaskId, contractHash }`, and emits an
event/reference in the same WAL. The `ProductionJob` binding contains the
sidecar reference and runtimeTaskId once allocated; restart reads exactly that
sidecar by jobId/contractHash and verifies its checksum before polling. A
missing, duplicate or mismatched envelope is `needs_attention`, never rebuilt
from a host request.

The persisted envelope's `preparedTaskRequest` is the canonical,
grant-redacted request. The adapter creates an ephemeral
`dispatchTaskRequest` with the main-process grantId immediately before
`runTask`; that copy is never persisted or hashed. The provider adapter must
map the request to one idempotency header/key, return a stable provider task
identifier or a typed `definitely_not_submitted` disposition, and support
`queryByTaskId`/`reconcile` for an interrupted request. Missing required
capabilities fail closed at compile/preflight. A crash after provider accept
but before Nomi stores the response is a mandatory test case.

`job.add`, `plan.attach` and their IPC/repository equivalents must validate
the binding and envelope at the command boundary; direct record casts are
removed. Old records remain readable through an explicit
`compatibility: 'legacy'` projection and schema-v2 migration fixture, but new
paid jobs cannot be created without the binding. A legacy record is never
admitted to the P3 adapter. Existing `brand.promo`/legacy `plan.attach` keeps
an explicit compatibility branch with its old schema and driver semantics;
the new semantic path uses a distinct `generation.plan.submit` command that
always carries the binding. This prevents a global “binding required” change
from silently breaking old runs while preventing old records from entering
the new adapter.

`productionRunMigrations.ts` bumps `PRODUCTION_RUN_SCHEMA_VERSION` from `1` to
`2`, validates every migrated event before append, preserves the original
event bytes and snapshot checksum (the current `RunEvent` has no separate hash
field) and records a migration receipt. A malformed legacy record becomes
`needs_attention` with a repair action; it is not silently upgraded or
submitted.
The parser must surface malformed/partial JSONL or snapshot data as a typed
`migration_parse_error` receipt; it may not stop at the previous valid line and
pretend the Run is healthy. Fixtures cover a half-written event, truncated
snapshot and flag-off legacy read/write.

Because the current repository is append-only but not a complete
read-modify-write lock across MCP/RPC callers, the new atomic draft/plan
commands must use a per-run single-writer lock (or an equivalent CAS-backed
lock file) around read → validate → append. A concurrent context/submit call
must return the existing receipt or a revision conflict, never a second Run,
Job or gate.
The lock record carries owner/session, acquiredAt, heartbeat and TTL; a
restart reclaims only an expired owner after checking its last durable intent,
and a live owner is never stolen. Release is idempotent. The host and GUI
processes use the same lock directory/service, and stale-lock/crash recovery is
covered by a test rather than relying on an in-memory mutex.

The repository must add a durable uniqueness index for `draftKey` and
`(immutableProjectUuid, projectGeneration, runId, contractHash, shotId)` in the
same append/WAL boundary. A different
commandId with the same key returns the original Run/job/gate/receipt; a
different contractHash creates no replacement under the sealed Run and
returns a typed revision/conflict result. Gate decision, approval receipt,
reservation and grant binding use an outbox/WAL or replayable intent record so
crashes between any two files cannot mint a second receipt or grant. Recovery
replays idempotently before exposing the Run.

The concrete WAL owner is `productionRunIntentLog.ts`; it reuses
`productionRunPaths(projectDir, runId).dir` and writes
`.nomi/runs/<runId>/intents.ndjson` records of
`{intentId,runId,kind,key,payloadHash,status:'prepared'|'committed'|'aborted',
createdAt,committedAt?,seq,prevHash,fencingEpoch,keyId,mac}`. The MAC key is
app-owned (key rotation keeps old keys verification-only); a plain SHA checksum
is only an accident detector and is not an authority boundary. The protocol is
prepare+fsync(file+parent directory) → apply each side file idempotently →
commit marker+fsync → project the event. Replay of an uncommitted intent
resumes or compensates by kind; it never treats a missing commit marker as
success. Any MAC/sequence/fencing gap, duplicate commit or stale writer becomes
`migration_parse_error`/`needs_attention` without truncating, backing up or
rewriting the source log.

Runtime envelopes, outbox claims and materialization receipts are evidence
sidecars, not a second state machine. Each carries the same `intentId`,
`fencingEpoch`, `payloadHash` and commit marker; the Run reducer/WAL event is
the sole authority for status, providerTaskId and asset identity. A newer or
conflicting sidecar cannot promote a Run to success; it is quarantined as
`needs_attention`. Crash fixtures cover approval written before event,
reservation before grant, provider accepted before response, materialization
rename before receipt and artifact.add before projection.

- [ ] **Step 4: Verify field conservation**

```bash
pnpm exec vitest run electron/capabilityCore/executionContract.test.ts electron/productionRun/productionStoryboardBinding.test.ts electron/productionRun/productionExecutionBinding.test.ts electron/productionRun/productionRunMigrations.test.ts
```

Expected: PASS; no provider call occurs in these tests. Commit the pure compiler and binding independently.

The Skill provenance test must intercept the actual stage system-prompt assembly
(not only inspect a manifest): every `loaded`/`applied` ref in the prompt must
have a matching body hash, source, selected sections and stage in
`skillEvidence`; removing a ref must fail compilation before a candidate or
receipt is persisted. A `declared` placeholder is a test failure.

Before starting P1, also run the P0 policy/ownership tests:

```bash
pnpm exec vitest run electron/capabilityCore/approvalReceipt.test.ts electron/capabilityCore/projectLease.test.ts electron/capabilityCore/mcpGenerationPolicy.test.ts electron/productionRun/productionRunResume.test.ts
```

Expected: forged/replayed receipts, expired or cross-project leases, flag-off
semantic calls, duplicate draft keys and P3 legacy-driver recovery bypasses
all fail closed. No provider call is permitted in this checkpoint.

## Task 3: Add the read-only generation context and host planning tools

**Files:**

- Create: `electron/capabilityCore/generationContext.ts`
- Create: `electron/capabilityCore/mcpGenerationTools.ts`
- Create: `electron/capabilityCore/mcpToolExposure.ts`
- Create: `electron/capabilityCore/externalAgentControlPlane.ts` (E0 aliases only; E1 handlers remain feature-gated)
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpStdioServer.ts`
- Modify: `electron/capabilityCore/rpcServer.ts`
- Modify: `electron/capabilityCore/host.ts`
- Modify: `electron/capabilityCore/mcpGenerationPolicy.ts`
- Modify: `electron/capabilityCore/rendererBridge.ts` (thin GUI challenge transport; no gate writes)
- Create: `electron/capabilityCore/projectLease.ts`
- Create: `electron/capabilityCore/projectLeaseStore.ts`
- Modify: `electron/capabilityCore/mcpResultEnrichLive.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/projects/repository.ts` (persist/read projectRevision and CAS)
- Modify: `electron/workspace/workspaceRepository.ts` (existing project revision increment/CAS owner)
- Create: `electron/productionRun/productionRunResume.ts`
- Modify: `electron/productionRun/productionPlaybooks.ts`
- Modify: `electron/productionRun/productionRunRepository.ts`
- Modify: `electron/productionRun/productionRunLock.ts`
- Modify: `electron/productionRun/productionRunState.ts`
- Modify: `electron/productionRun/productionRunIntentLog.ts`
- Modify: `electron/productionRun/productionRunRuntimeEnvelope.ts` (created in Task 2; add gate/start/replay wiring)
- Modify: `electron/productionRun/productionRunTypes.ts` (draft key/nextAction projection only)
- Modify: `electron/productionRun/productionRunProjectionSanitizer.ts`
- Modify: `electron/assets/projectAssetStore.ts`
- Test: `electron/capabilityCore/mcpGenerationTools.test.ts`
- Test: `electron/capabilityCore/externalAgentControlPlane.test.ts`
- Test: `electron/productionRun/productionPlaybooks.test.ts`
- Test: `electron/productionRun/productionRunRepository.test.ts`
- Test: `electron/projects/repository.test.ts`
- Test: `electron/workspace/workspaceRepository.test.ts`
- Test: `electron/productionRun/productionRunLock.test.ts`
- Test: `electron/productionRun/productionRunState.test.ts`
- Test: `electron/productionRun/productionRunRuntimeEnvelope.test.ts` (restart between prepare and poll)

- [ ] **Step 1: Write failing tool-contract tests**

Test that:

```ts
it('returns project revision, asset summaries, module snapshot and capability options without writing')
it('accepts a PlanCandidate but rejects approved/providerTaskId/assetId/qualityPass fields')
it('returns a deterministic candidate hash and structured warnings')
it('does not call runTask for context, submit or preview')
it('rejects a projectId different from the authenticated MCP lease')
it('keeps context/read read-only even when runId is absent')
it('creates or reuses exactly one generation.single-shot draft Run only through operation/create')
it('does not create a job/gate or the legacy direction gate during context/read or operation/create')
it('reuses the same draft for the same session/selection/draftNonce under concurrency')
it('returns the original submit receipt when commandIds differ but run/contract/shot key matches')
it('rejects a submit after the captured module catalog snapshot has changed')
it('uses the same sanitized receipt projection in stdio and GUI dispatch')
it('rejects start before the generation_submit gate even when a client sees the static schema')
it('rejects semantic calls from host/dispatcher without a verified project lease')
it('persists draftKey and resolves the same Run after process restart')
it('rejects an expired, foreign or invalidly signed/handled ProjectLease')
it('rejects a machine-wide bearer token plus an arbitrary projectId/path without a signed project-selection handle')
it('keeps leasePrincipal/host actor distinct from humanActor and requires GUI gesture attestation for receipt')
it('does not expose the internal productionRunResume command through MCP, renderer or direct IPC')
it('does not expose generation.single-shot through the legacy nomi_start_playbook enum')
it('maps operation/create to draft context and operation/plan to sealed contract + authorization-required job/gate with zero provider/spend')
it('returns phase_not_ready for context/create/plan before P0/P2 and appends no Run/job/gate')
it('rejects a forged projectId or trust value in session/open and derives both from the verified lease')
it('binds one operationId to one Run/shot/job/task and rejects a second Run or conflicting replay')
it('returns snapshot, snapshotCursor, events and nextCursor from one read boundary without cursor TOCTOU')
it('reconnects afterCursor without dropping or duplicating RunEvents')
it('maps only allowlisted RunEvent types to the closed external event union and strips secrets/unbound events')
it('returns typed not_ready for E0 start/interrupt/steer and never reaches the legacy driver')
it('keeps get_run/get_events/readProjection/readFull/listFull/listProjections/rebuild/startup side-effect free on malformed WAL or snapshot and returns typed needs_attention')
it('returns legacy_path_forbidden for production.control, production.decide-gate, old MCP catalog names and direct renderer/stdio routes')
```

The alias adapter has a closed typed boundary (implemented in
`externalAgentControlPlane.ts`, not a new store):

```ts
type ExternalAliasRequest =
  | { alias: 'session/open'; version: 1; projectSelectionHandle?: string; bootstrap?: { mode: 'current_project'; clientSessionNonce: string } }
  | { alias: 'context/read'; version: 1; leaseHandle: string; serverNonce: string; runId?: string }
  | { alias: 'operation/create'; version: 1; leaseHandle: string; serverNonce: string; operationId: string; runId?: string; draftNonce?: string }
  | { alias: 'operation/plan'; version: 1; leaseHandle: string; serverNonce: string; operationId: string; runId: string; candidate: PlanCandidate }
  | { alias: 'plan/preview'; version: 1; leaseHandle: string; serverNonce: string; operationId: string; runId: string; contractHash: string; handoff?: OperationHandoffV1 }
  | { alias: 'operation/read'; version: 1; leaseHandle: string; serverNonce: string; operationId: string; runId: string; contractHash?: string; handoff?: OperationHandoffV1 }
  | { alias: 'operation/events'; version: 1; leaseHandle: string; serverNonce: string; operationId: string; runId: string; afterCursor?: string; handoff?: OperationHandoffV1 }
  | { alias: 'operation/start'; version: 1; leaseHandle: string; serverNonce: string; operationId: string; runId: string; contractHash: string; handoff?: OperationHandoffV1; actionNonce: string }
  | { alias: 'operation/interrupt'; version: 1; leaseHandle: string; serverNonce: string; operationId: string; runId: string; contractHash: string; handoff?: OperationHandoffV1; actionNonce: string }
  | { alias: 'operation/steer'; version: 1; leaseHandle: string; serverNonce: string; operationId: string; runId: string; baseRevision: number; candidate: PlanCandidate; handoff?: OperationHandoffV1; actionNonce: string }

// Gate calls are canonical typed tools in the same wire catalog, not additional
// slash-alias variants and never a fallback to production.decide-gate.
type GenerationGateRequestV1 = {
  version: 1
  leaseHandle: string
  serverNonce: string
  operationId: string
  runId: string
  contractHash: string
}
type GenerationGateDecisionV1 = {
  version: 1
  leaseHandle: string
  serverNonce: string
  operationId: string
  runId: string
  receiptId: string
  handoff: HumanApprovalHandoffV1
}
type OperationHandoffV1 = {
  version: 1
  keyId: string
  algorithm: 'HMAC-SHA256' | 'Ed25519'
  issuer: 'nomi-main'
  handoffId: string
  recipientBinding: { kind: 'web_contents'; webContentsId: number; frameId: number; origin: string } | { kind: 'attested_client'; clientId: string; keyId: string }
  recipientProof: { channelNonce: string; operationId: string; challengeHash: string; issuedAt: string; expiresAt: string; macOrSignature: string }
  operationId: string
  immutableProjectUuid: string
  projectGeneration: number
  runId: string
  scopes: 'read' | 'control'
  audience: 'nomi-mcp'
  issuedAt: string
  expiresAt: string
  oneTimeNonce: string
  mac: string
}

// The owner session may omit `handoff`; another session must provide this exact
// server-issued record. `actionNonce` is a fresh server challenge for every
// start/interrupt/steer and is consumed together with the Run CAS, so a copied
// lease or replayed cancel cannot control a different attempt.
// `nomi_request_generation_gate` and `nomi_decide_generation_gate` validate
// these exact schemas. In schema_only/e0_zero_credit both return a typed
// phase/feature error and append no reservation, receipt or grant; in e1_paid
// decide additionally requires the recipient/channel proof in the handoff.
// Every non-handshake variant also carries the server-issued connection nonce
// from `nomi_session_open`; it is not a host-generated bearer field.
// `actionNonce` for start/interrupt/steer is returned by the server as part of
// the current operation projection/challenge; a caller cannot choose it.
type ExternalOperationProjection = {
  operationId: string
  immutableProjectUuid: string
  projectGeneration: number
  projectId: string
  runId: string
  contractHash?: string
  shotId?: string
  runtimeTaskId?: string
  attempt?: number
  projectRevision: number
  status: 'draft' | 'awaiting_contract' | 'awaiting_gate' | 'running' |
    'submission_unknown' | 'needs_attention' | 'artifact_ready' | 'adopt_proposed' |
    'completed' | 'failed' | 'cancelled' | 'interrupted'
  nextAction?: ExternalNextAction
}
type ExternalNextAction =
  | 'create_operation' | 'submit_plan' | 'await_human_approval'
  | 'start_generation' | 'poll' | 'reconcile' | 'retry_pure_check'
  | 'new_draft' | 'adopt_proposal' | 'inspect_artifact' | 'none'
type ExternalErrorCode =
  | 'feature_disabled' | 'phase_not_ready' | 'not_ready' | 'lease_invalid'
  | 'project_scope_changed' | 'contract_invalid' | 'catalog_snapshot_stale'
  | 'gate_required' | 'human_approval_required' | 'approval_invalid' | 'stale_preview'
  | 'cost_unknown' | 'provider_unavailable' | 'submission_unknown' | 'stale_revision'
  | 'asset_missing' | 'materialization_failed' | 'migration_parse_error'
  | 'contract_sealed' | 'operation_not_steerable' | 'new_draft_required'
  | 'legacy_path_forbidden' | 'internal_error'
type ExternalEventBase = {
  eventId: string
  cursor: string
  runRevision: number
  correlationId: string
}

`ExternalOperationProjection`, `ExternalEventProjection`, `ExternalErrorCode`
and `ExternalEventBase` are local aliases for the shared
`ExternalOperationProjectionV1`, `ExternalEventProjectionV1`,
`ExternalErrorCodeV1` and `ExternalEventBaseV1` registries. Their versioned
codecs, bounds and discriminated `type`→`data` mapping are defined once; no
document or adapter may generate a second unversioned wire schema.

type ExternalEventProjection =
  | (ExternalEventBase & { type: 'operation.started'; data: { kind: 'started'; stageId: string } })
  | (ExternalEventBase & { type: 'operation.progress'; data: { kind: 'progress'; stageId: string; completed: number; total?: number } })
  | (ExternalEventBase & { type: 'operation.completed'; data: { kind: 'status'; status: 'completed' } })
  | (ExternalEventBase & { type: 'operation.failed'; data: { kind: 'error'; errorCode: ExternalErrorCode; nextAction: ExternalNextAction } })
  | (ExternalEventBase & { type: 'operation.interrupted'; data: { kind: 'status'; status: 'interrupted' | 'cancelled' } })
  | (ExternalEventBase & { type: 'run.status.changed'; data: { kind: 'status'; status: ExternalOperationProjection['status']; nextAction?: ExternalNextAction } })
  | (ExternalEventBase & { type: 'artifact.ready'; data: { kind: 'artifact'; artifactId: string } })
  | (ExternalEventBase & { type: 'needs_attention'; data: { kind: 'error'; errorCode: ExternalErrorCode; nextAction: ExternalNextAction } })
```

There is no independently accepted `ExternalEventData` bag: `data` is selected
by the `type` discriminator above. `stageId`, identifiers and strings have the
same bounded UTF-8 limits as the wire validator; unknown keys, an unknown
`errorCode`/`nextAction`, or a mismatched `type`/`data.kind` pair is rejected.
The adapter decodes an opaque cursor only after checking its connection/run
binding. The wire shape is `CursorV1{keyId,immutableProjectUuid,projectGeneration,
projectId,runId,snapshotGeneration,numericCursor,expiresAt,mac}`; `projectId` is
server-derived display data, while immutable UUID/generation are the authority;
legacy bare integers, foreign runs, malformed or
expired cursors fail closed and are never passed to the legacy events endpoint.

`operationId` is normalized and persisted as the existing Run intent
`operationRef`/`RunEvent.correlationId`; the unique index is
`(immutableProjectUuid, projectGeneration, operationId) → runId` and is owned by
`ProductionRunRepository`; it stores the owning
`leasePrincipal/sessionId/audience` plus read/control scopes. Same-project access
is not implicitly shared: another session needs an explicit signed handoff, and
an expired/revoked lease cannot read or control the operation. Cross-session access
uses a closed `OperationHandoffV1{version,keyId,algorithm,issuer,handoffId,
recipientBinding,recipientProof,operationId,immutableProjectUuid,projectGeneration,
runId,scopes:'read'|'control',audience,issuedAt,expiresAt,oneTimeNonce,mac}`;
the main process verifies the handoff recipient, channel nonce and current
revocation epoch before resolving the operation. A `RunEvent` without
a matching operation binding is not exposed through this adapter. A conflicting
replay is rejected; the same request returns the original projection. The validator is
discriminated by `alias`, so an E0 request cannot smuggle E1 fields or a host
supplied status/cursor/cost/grant.

The resolver obtains `playbookNamespace` and the owner session from the
authenticated connection/lease record, never from `ExternalAliasRequest`.
Same-session read/control may omit `handoff` only when the stored owner and
scope match; a different session must present `OperationHandoffV1` with
`recipientProof` bound to this `serverNonce`. `actionNonce` is issued by the
same resolver, consumed atomically with the Run fencing CAS, and is not a
user-supplied actor or approval field.

The projection is a view, not a second state machine: `draft`/`awaiting_contract`/
`awaiting_gate`/`running` map directly from the Run stage; materialization plus
`artifact.add` maps to `artifact_ready` and only then may emit
`operation.completed`; a terminal typed provider error maps to `failed`, a
confirmed user/provider cancellation maps to `cancelled`/`interrupted`, and
`submission_unknown` always remains `submission_unknown`/`needs_attention`.
Unknown internal statuses are rejected rather than invented in the external union.
The adapter maps the actual existing `MEANINGFUL_EVENT_TYPES` (not invented
event names) to the closed union: `run.created` → `operation.started`;
`run.status.changed`, `run.stage.changed`, `stage.updated` and `job.ready` →
`operation.progress`/`run.status.changed`; `gate.*` → awaiting-gate status;
`artifact.ready` → `artifact.ready`; and `job.submission_unknown` or
`job.needs_attention` → `needs_attention`. `artifact.add` is a command whose
reducer emits `artifact.ready`, not a raw event accepted by this adapter.
Unbound, unknown or secret-bearing raw events are filtered and never forwarded.

- [ ] **Step 2: Implement read context and deterministic draft adapters**

`nomi_get_generation_context` is the read-only `context/read` adapter. It accepts
the authenticated lease and an optional existing `runId`; it resolves the
project-scoped schema, assets, module snapshot and capabilities without creating
a Run, appending an event, calling `runTask`, uploading an asset or contacting a
provider. Its internal request is always `createDraft:false`, a server-owned
constant that is not part of the host schema.

`nomi_operation_create` is the separate `operation/create` adapter. It accepts
the lease, operation correlation and optional opaque `draftNonce`; the nonce is
server-issued or normalized to a bounded per-session value (with a draft quota
and expiry), never an unbounded host-controlled random namespace. It computes
`selectionHash` from normalized context and atomically creates/reuses the
deterministic key
`generation.single-shot:{immutableProjectUuid}:{projectGeneration}:{lease.sessionId}:{selectionHash}:{draftNonce}`
through `productionRuns.createGenerationSingleShotDraft`. This is the only
adapter allowed to use `createDraft:true`; sharing resolver code is fine, but
sharing a write-capable request branch is not.
The Run event revision and the project document revision are different
values: `electron/workspace/workspaceRepository.ts` is the owner of
`projectRevision`; `projects/repository.ts` exposes the CAS wrapper, and the
draft/contract/gate stores both. A project save or Canvas/Timeline mutation
increments `projectRevision`; an old contract/receipt then fails CAS even if
the Run event revision is unchanged.
The default nonce reuses the session's active draft; rotating it explicitly
starts a new candidate. The new playbook registration in
`productionPlaybooks.ts` requires only a minimal brief. `operation/create`
returns the persisted draft Run—no Job, contract or Gate exists until submit,
and no legacy direction gate is created. `context/read` may return an existing
`runId` only when the caller explicitly supplies one; it never appends. Return
only project-scoped, serializable data; project assets, Canvas/Timeline and
provider state remain untouched:

```ts
type GenerationContextResponse = {
  schemaVersion,
  projectId,
  projectRevision,
  selectedAssetRefs,
  moduleCatalogHash,
  moduleCatalogVersion,
  modules,
  capabilityProfiles,
  planningInputSchema,
  costPolicy,
} & (
  | { mode: 'read'; runId?: string; nextAction: 'create_operation' | 'submit_plan' }
  | { mode: 'draft_created'; runId: string; nextAction: 'submit_plan' }
)
```

`context/read` returns `mode:'read'`; when no existing `runId` is requested its
next action is `create_operation`, never `submit_plan`. Only
`operation/create` returns `mode:'draft_created'` with a durable `runId` that
may be passed to `nomi_submit_generation_plan`.

`generation.single-shot` is a dedicated `creationEntry: 'generation.operation.create'`
playbook. It is filtered out of the legacy `nomi_start_playbook` enum and
generic `production.start` input; those legacy surfaces return a typed
`legacy_path_forbidden` result rather than creating a direction gate or
entering the old driver. `nomi_operation_create` is the only P3 draft-creation
entry; `nomi_get_generation_context` is read-only.

`moduleCatalogHash` and `moduleCatalogVersion` are persisted on the draft Run
and copied into the PlanCandidate. The complete immutable snapshot payload is
also persisted in a content-addressed catalog store (or the Run sidecar) with
its checksum; a hash alone is not enough to recover an old module after
restart. Submit resolves modules only from that captured snapshot; a registry refresh between context and submit yields
`catalog_snapshot_stale`/`new_draft_required`, never a silently changed
contract. The snapshot payload is hash-pinned and included in
`contractHash`/provenance.

Do not return absolute filesystem paths, API keys or opaque provider URLs as the only artifact reference.

The registered `generation.single-shot` playbook has this minimal stage
contract and does not inherit `brand.promo`'s direction/assemble/export hooks:

```text
context      -> draft / submit_plan
plan.submit  -> plan_submitted / await_human_approval
receipt      -> ready_to_submit / start_generation
dispatch     -> running
settle       -> artifact_ready | submission_unknown | needs_attention
proposal     -> adopt_proposed (no project write in P3)
```

The stage IDs, transitions and `draftKey` are persisted and replayed. Unknown
P3 stage/status combinations fail to `needs_attention`; they never fall back
to the legacy production driver.
The playbook is marked `creationEntry: 'generation.operation.create'`; generic
`production.start`/`createDraft`, `production.control` (including resume/cancel),
`production.decide-gate`, `nomi_start_playbook` and `nomi_generate` reject it
with `legacy_path_forbidden` rather than applying the brand direction gate. A
regression test proves the only creation path is `nomi_operation_create` and that direct generic start,
control, decide-gate, renderer IPC and stdio calls
cannot create a P3 Run.
The route classifier checks the authenticated playbook/semantic namespace before
the method name: once the request is `generation.single-shot`, every legacy MCP,
renderer, stdio and generic `production.*` route reaches this same rejection
resolver. Legacy compatibility is permitted only in its explicitly separate
legacy namespace; no route infers P3 from a bare `projectId`, `runId` or old
`gateId`, and an alias miss cannot fall back to `nomi_generate` or a generic
dispatcher.

The P3 stage is projected onto existing status enums; no parallel status enum
is introduced:

| P3 stage | `ProductionRun.status` | `ProductionStage.status` | `ProductionJob.status` |
|---|---|---|---|
| `context` | `draft` | `pending` | none |
| `plan.submit` | `awaiting_contract` | `awaiting_gate` | `authorization_required` |
| human receipt | `ready` | `awaiting_gate` | `authorized` |
| `dispatch` | `running` | `running` | `submit_intent_persisted` → `submitting` → `provider_accepted`/`polling` |
| `settle` | `running` or `needs_attention` | `completed`/`needs_attention` | `ready`/`submission_unknown`/`needs_attention` |
| `proposal` | `running` (P3 keeps the existing legal transition; P5 may adopt/close it) | `completed` | `ready` |

The durable `stageId`/`nextAction` projection carries the semantic P3 labels;
reducer transitions validate both columns. `submission_unknown` and
`needs_attention` never map to `completed`, and P3 does not force an illegal
`running → ready` transition. Legacy statuses cannot enter the P3 adapter
without a matching `generation.single-shot` stage.

`productionRunService.readProjection` must be side-effect free for this slice:
it only reads/replays the projection. Recovery is an explicit
`productionRunResume.resume(capability)` internal main-process command;
it is never exposed to MCP/renderer callers. External
`nomi_reconcile_generation` still requires a fresh lease and the sealed Run
binding. The existing
`resumeUnfinishedRuns` first classifies the playbook and completely skips its
legacy scan/status rewrites for `generation.single-shot`; it delegates only to
`productionRunResume` reconciliation. It never runs, mutates status for, or
calls `driveGeneration` while reading or recovering a P3 projection.

- [ ] **Step 3: Implement `nomi_submit_generation_plan` and `nomi_preview_execution`**

Both call the pure compiler. They persist a draft candidate/preview through the existing Run/artifact service, but they do not reserve spend, call a provider or mutate the project.

The preview must show selected/rejected model candidates, legal duration/ratio/reference resolution, estimated cost, warnings and `contractHash`.

`nomi_submit_generation_plan` requires the returned `runId` and persists the
candidate/contract as a Run event/projection. In one locked repository command
(`generation.plan.submit`) it atomically creates the one
authorization-required `ProductionJob` with its binding and binds its jobId to
the `generation_submit` gate; a second submit for the same `(runId,
contractHash)` returns the original receipt, while a different contract needs
a new draft/nonce. `nomi_preview_execution` reports
Nomi-derived cost, module/cardinality and all capability warnings; it rejects
host-supplied `estimatedCost`, provider task IDs, asset IDs, approval and
quality verdicts instead of copying them. P3 uses one typed
`generation_submit` gate combining plan review, budget and provider-submit
authorization; there is no hidden second MCP approval.

The accepted candidate schema has `additionalProperties: false`, at most 8
prompt parts (64 KiB total UTF-8), 8 asset refs, and a bounded params object
(depth 4, 64 keys, 64 KiB serialized). `estimatedCost` is not an accepted
candidate field; a host-supplied value is a structured validation error. Cost
and model options are derived by Nomi's resolver and recorded in the preview.

All semantic tools share this discriminated error envelope and closed code registry;
they do not invent separate `forbidden`/`needs_user_action` payloads:

```ts
type McpGenerationError = {
  ok: false
  errorCode:
    | 'feature_disabled' | 'phase_not_ready' | 'not_ready'
    | 'lease_invalid' | 'contract_invalid' | 'catalog_snapshot_stale'
    | 'gate_required' | 'approval_invalid' | 'human_approval_required'
    | 'contract_sealed' | 'operation_not_steerable' | 'new_draft_required'
    | 'cost_unknown' | 'provider_unavailable' | 'submission_unknown'
    | 'stale_revision' | 'stale_preview' | 'asset_missing'
    | 'materialization_failed' | 'migration_parse_error'
    | 'legacy_path_forbidden' | 'project_scope_changed' | 'internal_error'
  summary: string
  evidenceRefs: string[]
  nextAction: string
  retryScope?: 'none' | 'pure_check' | 'reconcile' | 'new_draft' | 'human_action'
  costImpact?: { estimated: number | 'unknown'; reserved: number | 'unknown' }
}
```

Code precedence is deterministic: `feature_disabled` wins when the kill switch
is off; otherwise an E0 write before its checkpoint returns `phase_not_ready`;
an E1 call before P3 returns `not_ready`; lease/contract/gate validation then
uses `lease_invalid`/`contract_invalid`/`gate_required`. Steering a sealed or
challenge-pending contract returns `contract_sealed` plus
`operation_not_steerable`/`new_draft_required`; missing attestation returns
`human_approval_required`; malformed WAL returns `migration_parse_error` and
never silently repairs a read.

Context, compile, preview and gate resolution are deterministic/local-only in
P3: tests spy on network, upload, provider and `runTask` calls and require all
zero before the human receipt. Any model-assisted resolver or remote asset
analysis is a separately declared capability and blocks this slice unless it
is included in the same preflight/cost gate.

- [ ] **Step 4: Implement stage-aware visibility**

P3 keeps `tools/list` as a compatibility/static advertisement: a client may
see the semantic start/poll/cancel schemas before approval, but
`mcpToolExposure.ts` and dispatcher-side authorization reject start until the
exact gate is approved and return a structured `not_ready` or
`legacy_path_forbidden`
result. This is deliberate; P3 does not claim hidden stage-aware discovery or
`tools/list_changed`. A later phase may make the list Run-aware, but a stale
client can never turn advertisement into permission. A module catalog refresh
may update the next Run but cannot change an existing draft hash.

Extend the sanitized Run projection with contract hash, gate/receipt IDs,
artifact provenance and next action, while continuing to redact secrets,
absolute paths and provider credentials. Stdio and GUI must call the same
service and produce the same receipt shape. The `dispatcher` itself calls
`requireProjectLease` for every semantic method (not just its stdio/RPC
callers); `host.ts` and `mcpResultEnrichLive.ts` cannot become bypass routes.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm exec vitest run electron/capabilityCore/mcpGenerationTools.test.ts electron/capabilityCore/productionRunCore.test.ts
```

Expected: PASS with `runTask` call count equal to zero.

## Task 4: Implement the typed gate and one-shot durable submission

**Files:**

- Create: `electron/capabilityCore/generationSingleShot.ts`
- Create: `electron/capabilityCore/generationRuntimeAdapter.ts`
- Create: `electron/capabilityCore/approvalReceipt.ts`
- Modify: `electron/capabilityCore/mcpGenerationPolicy.ts` (same flag owner; no second env read)
- Modify: `electron/capabilityCore/host.ts`
- Modify: `electron/capabilityCore/mcpStdioServer.ts`
- Modify: `electron/capabilityCore/rpcServer.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/productionRunRuntime.ts`
- Modify: `electron/productionRun/approvalPolicy.ts`
- Modify: `electron/productionRun/budgetLedger.ts`
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunReducer.ts`
- Modify: `electron/productionRun/productionRunRepository.ts`
- Modify: `electron/productionRun/productionRunLock.ts`
- Modify: `electron/productionRun/productionRunState.ts`
- Modify: `electron/productionRun/productionRunIntentLog.ts`
- Modify: `electron/productionRun/productionRunIpc.ts`
- Modify: `electron/productionRun/submissionOutbox.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts` (isolation only; no legacy behavior change in this slice)
- Modify: `electron/productionRun/productionRunResume.ts` (extend the Task 3 recovery seam; do not create a second owner)
- Modify: `electron/productionRun/productionRunRuntimeEnvelope.ts` (durable prepared-request sidecar and replay/WAL owner)
- Modify: `electron/assets/projectAssetStore.ts` (deterministic materialization sink/receipt)
- Modify: `electron/runtime.ts`
- Modify: `electron/catalog/profileHttpRequest.ts`
- Modify: `electron/catalog/assetLocalization.ts`
- Modify: `electron/catalog/imageRouteFallback.ts` (disable hidden P3 fallback; preserve legacy behavior)
- Modify: `electron/tasks/taskResultQuery.ts`
- Modify: `electron/spendGrant.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/mcpProtocol.ts`
- Modify: `electron/capabilityCore/mcpResultEnrichLive.ts`
- Modify: `electron/capabilityCore/rendererBridge.ts` (GUI challenge transport only)
- Modify: `electron/capabilityCore/mcpProgress.ts` (classify `nomi_start_generation` as long-running and preserve cursor/reconnect semantics)
- Test: `electron/capabilityCore/generationSingleShot.test.ts`
- Test: `electron/capabilityCore/generationRuntimeAdapter.test.ts`
- Test: `electron/productionRun/submissionOutbox.test.ts`
- Test: `electron/productionRun/productionRunGate.test.ts`
- Test: `electron/productionRun/budgetLedger.test.ts`
- Test: `electron/capabilityCore/approvalReceipt.test.ts`
- Test: `electron/capabilityCore/externalAgentControlPlane.test.ts` (E1 start/interrupt/steer aliases and state matrix)
- Test: `electron/capabilityCore/projectLease.test.ts`
- Test: `electron/capabilityCore/projectLeaseStore.test.ts`
- Test: `electron/productionRun/productionRunIntentLog.test.ts`
- Test: `electron/productionRun/productionRunLock.test.ts`
- Test: `electron/productionRun/productionRunState.test.ts`
- Test: `electron/productionRun/productionRunResume.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

The fake provider must record every submit and return controllable poll outcomes. Test:

```ts
it('does not submit before the exact generation gate for the exact contract hash')
it('operation/start rejects without a consumed HumanApprovalReceipt, reservation, envelope, grant or outbox claim')
it('does not treat an external elicitation {action: accept, confirm: true} as human approval without GUI/attested-client proof')
it('operation/steer permits only pre-seal candidate CAS and requires a new draft after challenge creation')
it('operation/interrupt uses durable cancel/reconcile and preserves submission_unknown across restart')
it('rejects a generation_submit gate with no bound authorization-required job')
it('rejects a gate whose job binding has a different contract/project/shot or non-authorization status')
it('creates one job/gate binding atomically and records approvalId before submit')
it('submits once for one idempotency key')
it('returns the original receipt for a duplicate start')
it('persists providerTaskId before polling')
it('marks submission_unknown and reconciles instead of blindly resubmitting')
it('restarts and resumes the same ProductionJob')
it('rejects expired approval, stale revision and cross-project contract')
it('creates an Artifact only after verified materialization')
it('never calls production.generate-node, production.arrange or production.export')
it('calls runtime.runTask exactly once after the durable request envelope is written')
it('does not blindly resubmit when the provider outcome is unknown')
it('mints a spend grant only after a Nomi-issued HumanApprovalReceipt')
it('rejects a lease actor, approved:true field or external elicitation accept without GUI/attested proof')
it('rejects a replayed, expired or wrong-challenge HumanApprovalReceipt at reducer/repository level')
it('re-resolves price/account/policy at receipt consume and returns stale_preview after a preview revision')
it('recovers a generation.single-shot Run without entering the legacy driver')
it('skips legacy resume status rewrites before reconciling a generation.single-shot Run')
it('reconciles a crash after provider accept before providerTaskId persistence')
it('does not re-mint a consumed attempt after restart unless reconcile proves definitely_not_submitted')
it('redacts credentials, headers and opaque grants from the durable envelope/WAL')
it('rejects cancel/start interleavings with a stale fencing epoch and ignores late callbacks')
it('rejects direct IPC/stdio resume and keeps every read/list/rebuild path side-effect free')
it('streams progress and resumes the same cursor for nomi_start_generation after reconnect')
```

- [ ] **Step 2: Add `nomi_request_generation_gate` and `nomi_decide_generation_gate`**

The decision must bind:

```ts
immutableProjectUuid + projectGeneration + projectId + runId + gateKind +
targetHash + projectRevision + pricingSnapshotHash + costScope + humanActor +
receiptId + receiptNonce + expiresAt
```

`nomi_request_generation_gate` reads `targetHash`, project revision, cost scope
and expiry from the sealed Run and verified lease and creates one challenge. It
does not approve or reserve anything. The explicit human response is delivered
through the Nomi GUI challenge bridge (or a pre-registered attested client);
MCP `elicitation/create` can only carry the challenge and is never sufficient
proof. Only after the main process verifies the gesture/attestation may it mint
the server-issued receipt, which `nomi_decide_generation_gate({ receiptId })`
then consumes.
The lease supplies project scope and session, not human approval identity. The
handler ignores or rejects any client-supplied provider task, asset id, quality
verdict or boolean approval. Repeating the same request/decision returns the
original challenge/receipt. The durable uniqueness key is
`(runId, contractHash, gateKind, projectRevision, costScope)`; a pending
unexpired challenge is re-shown, an expired one is marked expired and a new
request receives a fresh nonce only after the old record is closed.

The tool cannot directly turn a model's `approved` argument into an Approval.
`mcpProtocol`/GUI invokes the existing typed human-elicitation surface with a
`HumanApprovalChallenge` owned by `approvalReceipt.ts`. The challenge contains
the exact contract hash, gateId, resolved model, reference summary, derived
cost, reservationPreview, one-time nonce and expiry. An external MCP
`elicitation/create` response—including `{action:'accept', content.confirm:true}`—
never mints authority. Only a verified Nomi GUI/main-process gesture or a
pre-registered, cryptographically attested client response causes the main
process to mint a server-side `HumanApprovalReceipt`; the reducer and
repository consume that receipt once and copy its `humanActor`. `McpInvokeOptions`,
the legacy `spendConfirmed` boolean, the leasePrincipal and tool arguments cannot
stand in for the receipt. Replay, wrong challenge, expiry or a receipt from a
different project is rejected at the reducer/repository boundary, not only in
the MCP transport. Reject/timeout/disconnect leaves the Run in its existing
`draft` or `needs_attention` status with `nextAction: 'await_human_approval'`,
a resumable deep link and no spend grant; this slice does not invent a
parallel Run status enum.

The challenge shows a derived `reservationPreview` (amount/currency/expiry)
only; it does not contain a live `reservationId`. At request and again at
attested receipt consumption, the main process re-resolves the current
provider/account/profile, price, currency, rounding, policy revision and
`maxSpend`. The receipt and reservation persist a `pricingSnapshotHash`; any
change from the preview returns `stale_preview`, closes the old challenge and
requires a new one. Actual reservation must remain within the sealed cap. On
accept, receipt consumption, durable reservation creation and Approval event
are one replayable repository intent. Only after that intent is committed can
the grant binding and provider envelope be created. A rejected/expired
challenge therefore has no reservation to leak.

The protocol sequence is concrete and shared by stdio/RPC/GUI. The request tool
starts the challenge; the decision tool only consumes the receipt, so a model
cannot call a decision endpoint before a human response:

```text
nomi_request_generation_gate
→ main process creates HumanApprovalChallenge and persists challengeId/nonce
→ transport sends the challenge (MCP elicitation is display/transport only; GUI or attested client is the trust boundary)
→ human accept/reject returns through a verified GUI gesture or signed attested handoff
→ approvalReceipt.ts verifies challenge, humanActor and scope, mints one receipt
→ nomi_decide_generation_gate({ receiptId })
→ dispatcher calls durable gate.decide with receiptId only
→ reducer/repository atomically consumes receipt + writes Approval/reservation
```

`HumanApprovalHandoffV1` is the only cross-channel answer envelope:
`{version,keyId,algorithm,issuer,handoffId,recipientBinding,recipientProof,
challengeId,contractHash,targetHash,projectRevision,immutableProjectUuid,
projectGeneration,revocationEpoch,audience,issuedAt,expiresAt,oneTimeNonce,mac}`.
Its closed proof fields are:

```ts
recipientBinding:
  | { kind: 'web_contents'; webContentsId: number; frameId: number; origin: string }
  | { kind: 'attested_client'; clientId: string; keyId: string }
recipientProof: {
  channelNonce: string
  challengeHash: string
  issuedAt: string
  expiresAt: string
  macOrSignature: string
}
```

The binding names a registered WebContents/frame/origin or attested-client key;
the proof is fresh, one-time and channel-bound, and its canonical bytes cover
the recipient, challenge, channel nonce and time window. `receiptId` is an opaque handle
to the MACed durable receipt record, not an authority by itself. Main-process
lookup requires the same handoff recipient and connection proof, so a leaked
handle cannot be consumed from another host or renderer.

`mcpProtocol.ts`/`rpcServer.ts` must expose a typed
`requestHumanApproval(challenge): Promise<HumanApprovalReceiptHandle>` seam;
the GUI may answer from a different renderer/session only with the signed,
project-scoped handoff handle issued for that challenge; it cannot substitute a
new lease or humanActor. `nomi_decide_generation_gate` accepts only that receiptId;
the old `McpInvokeOptions.spendConfirmed` path is not reused for this tool.
Disconnect/timeout leaves the challenge pending/expired and returns the shared
error envelope, never an implicit accept.

The decision call verifies the still-valid challenge/handoff and sealed target;
its authentication input is the main-process signed handoff/receipt, not a new
host-supplied lease. It therefore does not reject an otherwise valid human
response merely because the originating host lease expired while the elicitation
was open. A fresh lease is required for new context/submit/start/adopt calls;
recovery uses the Run-owned authority described above.

Extend `ProductionGate`/`Approval` and their reducer/repository schemas with
`projectId`, `runId`, `gateKind`, `targetHash`, `projectRevision`, `costScope`,
`humanActor`, `receiptNonce` and expiry;
`nomi_decide_generation_gate` dispatches the existing durable `gate.decide`
command with those exact fields plus a verified, one-time
`humanApprovalReceiptId`. There is no MCP-only approval side channel. The
renderer/preload confirmation bridge only transports the challenge and the
user's accept/reject action; it never accepts a spend grant or writes a gate
itself.
The new `generation_submit` kind is deliberately distinct from legacy gate
contracts that re-kick `driveGeneration`; the reducer/service must not call
the legacy driver for this kind. A regression test covers a gate decision with
the same `planHash` shape as the old path and proves no arrange/export/timeline
event is emitted. Because the current service also has gateId-based hooks, the
implementation must add an explicit command/gate-kind branch before those
hooks (and reserve a non-colliding P3 gate ID prefix), not merely add a field
to `ProductionGate`.

- [ ] **Step 3: Add the explicit P3 runtime adapter and `nomi_start_generation`**

Implement `generationRuntimeAdapter.ts` with the following seam:

```ts
buildTaskRequest(contract: ExecutionContractV1): ResolvedTaskRequestV1
prepare(contract): Promise<RuntimeTaskEnvelope>
submit(envelope): Promise<SubmissionReceipt>
poll(envelope): Promise<RuntimeTaskResult>
reconcile(envelope): Promise<{
  disposition: 'found' | 'not_found' | 'unknown'
  providerTaskId?: string
  taskState?: ProviderTaskState
  resultFingerprint?: string
}>
cancel(envelope): Promise<CancelledReceipt>
```

The adapter persists the provider-neutral request envelope before calling
`runtime.runTask`, maps the canonical request to one provider idempotency key
and idempotency header, persists `providerTaskId` before polling, and uses a
provider adapter implementing the sealed module's query/reconcile contract.
It blocks the capability when restart rehydration is not possible. It must
never call
`productionRunDriverOps.driveGeneration`,
`requestRenderer('production.arrange')` or
`requestRenderer('production.export')`. The new single-shot service entry and
`generation_submit` command are the only P3 write path; an explicit regression
test spies on all three legacy calls.

`generationRuntimeAdapter` allocates a server-side `runtimeTaskId` before
preparing the envelope and passes that ID plus the sealed idempotency key to a
new typed `runTask` options/context overload. `runTask` must honor that supplied
runtime identity and return a typed mapping containing any upstream/provider
IDs; it may not generate a second canonical runtime ID inside the call. The
crash-before-response test asserts that the persisted envelope ID and provider
query identity remain linked.

Materialization ownership is explicit: the P3 adapter supplies the existing
runtime localization path with the deterministic materialization key and
receipt sink. `runtime.runTask` may not silently call a second random-UUID
`writeAsset`; its returned `TaskResult` must reference the one
`projectAssetStore` materialization receipt. If the current
`buildProfileTaskResult` path cannot accept that sink, P3 is blocked until it
is changed to return a provider result plus a single deterministic
materialization operation. A crash after provider success, after local rename
or before `artifact.add` must replay the same receipt and never orphan or
duplicate the asset.

The provider adapter contract is typed and closed. It may not accept the
generic host-facing `TaskRequest.extras` as an authority channel:

```ts
type PreparedProviderRequestV1 = {
  immutableProjectUuid: string
  projectGeneration: number
  projectId: string
  runId: string
  contractHash: string
  shotId: string
  moduleRef: string
  runtimeTaskId: string
  providerId: string
  accountId: string
  profileId: string
  tenantScope: string
  endpoint: string
  model: string
  requestFingerprint: string
  providerIdempotencyKey: string
  attempt: number
  fencingEpoch: number
  resolvedTaskRequest: ResolvedTaskRequestV1
}
type ProviderTaskState =
  | 'queued' | 'submitted' | 'running' | 'succeeded' | 'failed'
  | 'cancelled' | 'unknown'
type GenerationProviderAdapter = {
  submit(input: PreparedProviderRequestV1): Promise<{
    disposition: 'submitted' | 'definitely_not_submitted' | 'unknown'
    providerTaskId?: string
    responseFingerprint?: string
  }>
  queryByTaskId(input: Pick<PreparedProviderRequestV1, 'immutableProjectUuid' | 'projectGeneration' | 'projectId' | 'runId' | 'contractHash' | 'shotId' | 'moduleRef' | 'runtimeTaskId' | 'providerId' | 'accountId' | 'profileId' | 'tenantScope' | 'endpoint' | 'model' | 'requestFingerprint' | 'providerIdempotencyKey' | 'attempt' | 'fencingEpoch'> & { providerTaskId: string }): Promise<ProviderTaskState>
  reconcile(input: Pick<PreparedProviderRequestV1, 'immutableProjectUuid' | 'projectGeneration' | 'projectId' | 'runId' | 'contractHash' | 'shotId' | 'moduleRef' | 'runtimeTaskId' | 'providerId' | 'accountId' | 'profileId' | 'tenantScope' | 'endpoint' | 'model' | 'requestFingerprint' | 'providerIdempotencyKey' | 'attempt' | 'fencingEpoch'>): Promise<{
    disposition: 'found' | 'not_found' | 'unknown'
    providerTaskId?: string
    taskState?: ProviderTaskState
    resultFingerprint?: string
  }>
  cancel?(input: Pick<PreparedProviderRequestV1, 'immutableProjectUuid' | 'projectGeneration' | 'projectId' | 'runId' | 'contractHash' | 'shotId' | 'moduleRef' | 'runtimeTaskId' | 'providerId' | 'accountId' | 'profileId' | 'tenantScope' | 'endpoint' | 'model' | 'requestFingerprint' | 'providerIdempotencyKey' | 'attempt' | 'fencingEpoch'> & { providerTaskId: string }): Promise<'cancelled' | 'unsupported' | 'unknown'>
  verifyCallback(input: ProviderCallbackEnvelopeV1): Promise<{ disposition: 'duplicate' | 'callback_conflict' | 'rejected' | 'accepted'; resultFingerprint?: string }>
}

type ProviderCallbackEnvelopeV1 = {
  version: 1
  audience: 'nomi-provider-callback'
  providerId: string
  accountId: string
  profileId: string
  tenantScope: string
  endpoint: string
  model: string
  immutableProjectUuid: string
  projectGeneration: number
  projectId: string
  runId: string
  contractHash: string
  shotId: string
  moduleRef: string
  runtimeTaskId: string
  providerTaskId: string
  attempt: number
  fencingEpoch: number
  state: ProviderTaskState
  requestFingerprint: string
  payloadHash: string
  resultFingerprint?: string
  issuedAt: string
  expiresAt: string
  nonce: string
  auth:
    | { kind: 'hmac'; algorithm: 'HMAC-SHA256'; keyId: string; issuer: string; mac: string }
    | { kind: 'signature'; algorithm: 'Ed25519'; keyId: string; issuer: string; signature: string }
}
```

`ProviderCallbackEnvelopeV1` is authenticated over one canonical UTF-8 byte
domain: `nomi.provider-callback.v1\0` plus sorted, length-prefixed fields from
`version` through `nonce`, including `auth.kind/algorithm/keyId/issuer` and
excluding only the `auth.mac`/`auth.signature` value. The selected
`auth.keyId` is the only key identity; there is no second top-level key field.
The verifier checks `audience`, issuer, timestamp window and a durable
`(immutableProjectUuid, projectGeneration, projectId, runId, contractHash, shotId,
moduleRef, providerId, accountId, profileId, tenantScope, endpoint, providerTaskId, nonce,
payloadHash)` replay CAS before looking up a task. Nonces are scoped to this full
namespace; a same nonce in another project is not a duplicate. `ProviderTaskState` transitions are closed and
monotonic for an attempt; a conflicting payload/result is `callback_conflict`,
never a duplicate.

The idempotency namespace includes immutable project generation, Run/contract/shot,
provider, account/profile, tenant and endpoint; `H(projectId, contractHash,
shotId, moduleRef)` alone is not a valid P3 key. `ProviderIdempotencyKeyV1` is
`base64url(sha256("nomi.provider-idempotency.v1\\0" + canonicalUtf8(tuple)))`,
where `canonicalUtf8` is NFC-normalized UTF-8 with length-prefixed, sorted fields
and bounded values for
`{immutableProjectUuid,projectGeneration,projectId,runId,contractHash,shotId,
moduleRef,providerId,accountId,profileId,tenantScope,endpoint,model}`. This
versioned test-vector formula is the only derivation; adapters may not invent a
delimiter-based variant. Submit, query, reconcile, cancel and result verification
must carry the same identity and fencing epoch. The adapter persists the provider request fingerprint and idempotency key
before submit, extracts `providerTaskId` from the typed response, and records
the response before polling. If the provider has no query/reconcile contract,
the module preflight returns `blocked`. `runTask` route fallback is resolved in
the sealed module snapshot; one logical P3 job may not issue a second HTTP
submit from inside a fallback branch. A crash after provider acceptance and
before response persistence must recover through `reconcile`, not a new
`submit`. A `found` response persists the returned providerTaskId/result
fingerprint, transitions the envelope from `submission_unknown` to
`submitted`/`running`, and only then calls `queryByTaskId`; `not_found` is
retained as unknown until the provider's documented retention window closes,
and never authorizes an unreviewed second submit.
Any generic `idempotencyKey` spelling in a legacy envelope/WAL projection is a
read-only compatibility alias for this exact `providerIdempotencyKey`; it may not
be supplied by a host, derive a second key, or be accepted by the provider adapter.
Provider responses are authenticated to the same account/profile/endpoint and
must pass request/result fingerprint, byte-length, MIME/magic-byte and content
hash checks before materialization. Provider URLs are untrusted: redirects,
private-network targets and DNS-rebinding changes are rejected by the bounded
fetch policy; a failed check becomes `needs_attention`, never an Artifact.
P3 also bypasses the process-local `runTaskWithIdempotency`/cache wrapper and
forbids active-project fallback, custom scripts, multipart/process routes and
hidden 403/404/405 resubmission at the sealed runtime boundary.

Cancel and start share the Run-owned fencing CAS: `operation/interrupt` writes a
cancel intent that atomically increments `fencingEpoch` and invalidates any
uncommitted submit claim; a concurrent start can proceed only if it observes
the new epoch and a still-valid gate/reservation. Provider callbacks include
the epoch/attempt and late callbacks from an older epoch are rejected. Cancel
and reconcile use the same provider/account/task namespace and idempotency key;
an old cancel cannot cancel a later attempt or turn `submission_unknown` into
success. Interleaving tests cover cancel before submit, after `submit.prepared`,
after provider accept, during reconcile and after restart.

`verifyCallback` validates `ProviderCallbackEnvelopeV1` (provider signature/key,
timestamp/nonce, canonical payload and full sealed namespace) before any task
lookup; a foreign account/project, stale timestamp or unbound providerTaskId is
rejected. Provider callbacks/poll results are first authenticated and resolved against
the sealed binding namespace `{immutableProjectUuid, projectGeneration, projectId,
runId, contractHash, shotId, runtimeTaskId, providerId, accountId, profileId,
tenantScope, endpoint}`; only then may the reducer use replay key
`{immutableProjectUuid, projectGeneration, runId, contractHash, providerId,
accountId, profileId, tenantScope, endpoint, providerTaskId, requestFingerprint,
state, attempt, fencingEpoch, payloadHash, resultFingerprint}`. A foreign or
unbound callback is rejected before state lookup. The same key with a different
payload/result is `callback_conflict`, not a duplicate. The reducer accepts only
monotonic state progression for that attempt; duplicate or late/regressive
callbacks return the original receipt and cannot repeat `artifact.add` or budget
settlement.

The adapter is the explicit wiring point for `submissionOutbox`: it appends a
durable `submit.prepared` intent to
`path.join(productionRunPaths(projectDir, runId).dir, 'intents.ndjson')`, claims
the outbox item with the contract's idempotency key, records the provider
response/`providerTaskId`, and appends a `submit.reconciled` or
`submission_unknown` intent. The Run intent log is the durable outbox claim
owner; the existing helper's process-local `inflight` map is only an
optimization and is never consulted for recovery. Merely importing the
existing helper is not sufficient; the test must restart between
`submit.prepared` and polling and prove that the same envelope is recovered.
The claim is a persisted record (contractHash, requestFingerprint,
idempotencyKey, attempt, disposition, lease/owner and timestamps), not the
current process-local `inflight` Map. Replay reconstructs the claim before any
dispatch; `submitted`/`unknown` claims call `reconcile` first, and a claim with
no provider response is retried only when the adapter can prove
`definitely_not_submitted`. A cross-process crash fixture covers the window
after provider acceptance and before providerTaskId persistence.

After the verified human receipt is consumed, the main process first writes a
durable Nomi-derived budget reservation. It then locally prepares and persists
the canonical envelope (`binding.attachEnvelope`, with zero network/provider
calls), sets `envelopeState: 'prepared'`, and only then calls a contract-aware
wrapper around the existing spend grant:

```ts
mintGenerationSpendGrant({
  immutableProjectUuid, projectGeneration, runId, projectId, contractHash, shotId, attempt,
  maxAttemptsPerJob: policy.maxAttemptsPerJob, // one shot maps one node to one ProductionJob
  reservationId,
})
```

`mintSpendGrant` remains a legacy/ephemeral compatibility primitive and is not
the P3 authority. `mintGenerationSpendGrant` must first append a durable,
MACed `generation_grant_bound` intent carrying the sealed context
`(immutableProjectUuid, projectGeneration, runId, projectId, contractHash,
shotId, attempt, reservationId, fencingEpoch)`; `consumeGenerationSpendGrant`
then performs the one-time CAS immediately before dispatch. A bare
`grantId/nodeId` from another Run is rejected. The main
process records one `grant_consumed` ledger entry. The opaque `grantId` is
wrapped in an ephemeral `DispatchTaskRequestV1 = ResolvedTaskRequestV1 &
{ grantId: string }` immediately before dispatch;
it is never accepted from the host, included in `contractHash`, or treated as
durable proof. `requestFingerprint` and `runtimeEnvelopeHash` are calculated
from the canonical request with the opaque grant field removed; the persisted
envelope stores that canonical request plus a redacted `grantBinding`, not the
grantId. After a restart, the adapter may rehydrate the same durable grant
binding only when the same sealed approval, attempt, project generation and
reservation are still valid; it may never mint a new grant for
`submission_unknown` without reconciliation.
`budgetLedger.ts` adds a typed `generation_grant_bound` entry containing the
non-secret context and reservationId; replay of that entry is idempotent and a
foreign run/contract/node or reused attempt is rejected.
The dispatch claim also persists `grant_consumed`/`provider_dispatch_started`
before the network call. After a restart, an already-consumed attempt is
treated as `unknown` until provider idempotency/reconcile proves
`definitely_not_submitted`; a valid approval alone never permits re-minting.
`runtime.runTask` receives a sealed dispatch context
`{ runId, contractHash, shotId, attempt, grantId, grantDisposition: 'consumed' }`.
Its existing image/video branch must verify that the matching durable consume
claim exists but must not call `assertAndConsumeSpendGrant` a second time. A
missing/mismatched claim fails closed. The test asserts exactly one grant
consumption for one provider attempt, including restart/reconcile paths.
Provider transport adapters must receive the sealed idempotency key in their
request header/body mapping; if an existing mapping cannot carry it, that
module is not admitted to P3 rather than silently using a non-idempotent
fallback.

Budget transitions are durable and tied to the same attempt:

```text
reserved → grant_bound → submitted/running → settled(success)
                              ├────────────→ released(definitely_not_submitted)
                              └────────────→ unsettled(submission_unknown)
cancelled before submit      → released
provider failure after submit→ settled(provider_failure) per receipt
```

`budgetLedger.ts` owns these transitions and rejects duplicate settle/release
or a new reservation for an unsettled attempt. Unknown remains visible and
blocks blind retry until reconciliation supplies a provider disposition.

The complete redacted `preparedTaskRequest` (including negative prompt,
dimensions, steps, model parameters, reference bindings and extras) is
persisted in the envelope. The exact restart query is derived from the closed
`PreparedProviderRequestV1` identity for `fetchTaskResult`:
`{ taskId: providerTaskId, providerId, accountId, profileId, tenantScope,
endpoint, model, attempt, fencingEpoch, preparedTaskRequest }` only when a
verified `providerTaskId` is already persisted. If it is absent, recovery uses
the sealed provider-idempotency namespace and `reconcile`; the local
`runtimeTaskId` is never sent as a provider task id.
plus the request fingerprint; it must not reconstruct a request from
prompt/model alone or query a provider task in another account namespace.
The server-allocated `runtimeTaskId` is the immutable canonical runtime
identity and remains the envelope key for every restart. A returned
`TaskResult.id` is recorded as `upstreamTaskId` (and a provider response as
`providerTaskId`); it never replaces `runtimeTaskId`. Synchronous and queued
responses both pass through this one poll/reconcile seam, never a second IPC
shortcut.
The adapter keeps the existing terminal/status enum and adds a typed
`submissionDisposition: 'not_attempted' | 'definitely_not_submitted' | 'unknown' | 'submitted'`
sidecar. Only `definitely_not_submitted` may use a new attempt, and only after
an explicit retry decision; `unknown` maps to the existing
`submission_unknown` status. Existing `SubmissionNotDispatchedError` retry
behavior is narrowed to the definitely-not-sent case so a lost response
cannot double-charge.

`nomi_start_generation` accepts only `runId`, `contractHash` (and an optional
echo of the server-derived idempotency key) plus authenticated project scope.
The compiler derives the versioned provider key from the complete namespace
`ProviderIdempotencyKeyV1({immutableProjectUuid, projectGeneration, projectId,
runId, contractHash, shotId, moduleRef, providerId, accountId, profileId,
tenantScope, endpoint, model})`;
any host-provided key must exactly match or is
rejected. It loads the sealed contract,
verifies the exact gate/revision, then uses the provider/model/params/cost
mapping sealed in the contract snapshot (the reservation was created as part
of the gate receipt consumption). The current catalog is checked only for
compatibility; a changed/removed module or capability returns
`catalog_snapshot_stale`/`blocked` and cannot silently re-resolve. Arbitrary
provider/model/prompt,
host cost or providerTaskId fields are rejected. `SubmissionOutboxRequest` is
updated to carry the sealed `contractHash`, `requestFingerprint`, reservation
and resolved cost ledger; host `costCeiling`/`planHash` values are not used as
authorization inputs.

Restart/read recovery is explicit: `productionRunResume.ts` recognizes the
`generation.single-shot` playbook and dispatches prepared/submitted/running or
`submission_unknown` envelopes to `generationRuntimeAdapter.reconcile` and
`fetchTaskResult`. It must not call `resumeUnfinishedRuns`' legacy
`driveGeneration`, arrange or export path for this playbook. Legacy runs keep
their existing driver branch. Every P3 read/list/replay entry
(`readProjection`, `readFull`, `listFull`, `listProjections`, `readEvents`,
artifact/resource reads, rebuild and startup inspection) must be side-effect
free: malformed data returns `migration_parse_error`/`needs_attention` without
backup, rewrite, status mutation or provider start. Recovery is callable only
by a private main-process `ResumeCapability` issued by the scheduler and bound
to `immutableProjectUuid/projectGeneration/canonicalRootDigest/manifestDigest`,
run/playbook/adapter digest and fencing epoch; external `nomi_reconcile_generation` is the only
public seam and requires a fresh lease. The capability is an opaque main-process
`Symbol`/closure held in a `WeakMap`, never a JSON/string token accepted from
IPC/MCP. Its checked metadata is
`ResumeCapabilityV1{version,issuer:'productionRunResume',immutableProjectUuid,
projectGeneration,canonicalRootDigest,manifestDigest,runId,playbook,adapterDigest,
fencingEpoch,audience:'main-recovery-worker',nonce,expiresAt,mac}`; a project
generation/root mismatch only yields `needs_attention` and cannot materialize.
The scheduler issues one capability per recovery attempt; it is not a reusable
bearer. Each use performs an atomic Run-owned CAS on
`(immutableProjectUuid,projectGeneration,runId,fencingEpoch,nonce)` and advances
the epoch before any poll/reconcile/materialize side effect. The worker must
commit a second CAS with the same identity after the side effect and retire the
capability; a crash or mismatch becomes `needs_attention`, never an implicit
retry. A reused nonce, expired capability, stale epoch or concurrent worker
loses the CAS and is quarantined. No serialized form can be replayed by a
renderer, MCP host or stdio caller.
Regression tests cover app restart,
every read/list entry, delayed callback and a P3 run whose old gateId shape
looks like a legacy contract, plus direct IPC/stdio attempts to invoke resume.

- [ ] **Step 4: Add poll, cancel and reconcile projections**

Expose typed tools `nomi_operation_read`, `nomi_cancel_generation` and
`nomi_reconcile_generation` (plus the existing `nomi_subscribe_run` event
projection). Each accepts only `{ runId, contractHash }` and the authenticated
lease, with `nomi_cancel_generation` requiring an explicit user action.
Use the existing Run event cursor and job state. Client disconnect is not
cancellation. Explicit cancel produces a durable cancelled receipt; unknown
provider outcome remains recoverable and blocks blind retry. Reconciliation
must consult the persisted `providerTaskId`/request fingerprint before any
resubmit, and a `submission_unknown` record remains visible to the user with a
structured `nextAction`.

- [ ] **Step 5: Run focused tests and commit**

```bash
pnpm exec vitest run electron/capabilityCore/generationSingleShot.test.ts electron/capabilityCore/generationRuntimeAdapter.test.ts electron/productionRun/submissionOutbox.test.ts electron/productionRun/productionRunService.test.ts electron/productionRun/productionRunGate.test.ts
```

Expected: PASS; fake provider submit count is exactly one on the success path.

## Task 5: Persist the Artifact and record proposal-ready provenance

**Files:**

- Modify: `electron/productionRun/productionRunArtifactOperations.ts` (extend the existing adapter; no second owner)
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/productionRun/productionRunReducer.ts`
- Modify: `electron/productionRun/productionRunRepository.ts`
- Modify: `electron/productionRun/productionRunService.ts`
- Modify: `electron/productionRun/productionRunProjectionSanitizer.ts`
- Modify: `electron/capabilityCore/mcpGenerationTools.ts`
- Test: `electron/capabilityCore/generationSingleShot.test.ts`
- Test: `electron/productionRun/productionArtifactContract.test.ts`
- Test: `electron/assets/projectAssetStore.test.ts`
- Test: `electron/productionRun/productionRunResume.test.ts`

- [ ] **Step 1: Write failing Artifact tests**

Prove that an Artifact contains the exact contract hash, input asset versions, provider/model mapping, local materialization hash, preview derivative and Run/job receipt; a missing derivative or mismatched hash is `blocked`, not `completed`.

Extend the `ProductionArtifact.status` union with `blocked` and the shared
error envelope `{ errorCode, summary, evidenceRefs, nextAction }`; do not use
an undocumented status string or silently call a missing derivative
`completed`.
Materialization uses deterministic key
`{immutableProjectUuid}:{projectGeneration}:{runId}:{contractHash}:{shotId}:{contentHash}` and a
`materializing`/`ready` receipt, so a crash after download cannot create a
second local asset. The one-shot validator rejects more than one materialized
asset for the same `(immutableProjectUuid, projectGeneration, runId,
contractHash, shotId, contentHash)`; equal content in a different Run is not an
implicit dedupe.

The existing Asset store must expose an idempotent
`prepareMaterialization(key, contentHash)` / `commitMaterialization(receipt)`
seam. It writes to a temporary local file, fsyncs, atomically renames, then
records the durable materialization receipt before `artifact.add`. The receipt
is owned by `projectAssetStore.ts` and persisted at
`path.join(productionRunPaths(projectDir, runId).dir, 'materializations.ndjson')`
with `{key, immutableProjectUuid, projectGeneration, runId, contractHash, shotId,
runtimeTaskId, contentHash, assetId, status,
intentId, fencingEpoch, seq, keyId, mac, commitMarker, payloadHash}`; a per-run
lock/CAS protects concurrent prepare/commit. The deterministic uniqueness key is
`(immutableProjectUuid, projectGeneration, runId, contractHash, shotId, contentHash)`;
it intentionally includes `runId`, so equal content in another Run is not an
implicit dedupe. A duplicate runtime allocation within that Run cannot create a
second local file; cross-Run reuse requires an explicit signed Artifact handoff.
The receipt is only a projection of the MACed Run intent commit. A missing,
tampered or out-of-order receipt is `needs_attention`, never accepted as an
independent success fact.
A restart
first looks up the deterministic key and resumes/finishes that receipt rather
than calling `writeAsset` with a random UUID. The runtime localization path
must use this same seam and return the resulting assetId; there is no second
adapter-side download/write. A crash at each boundary and a duplicate
materialization are required tests. The `(runId, deterministicKey)` lock is
shared by GUI/stdio processes, carries owner/heartbeat/TTL, reclaims only a
stale owner after intent replay, and never allows two concurrent downloads or
renames for one key.

Extend the existing `ProductionArtifact` with a discriminated
`executionProvenance` projection containing `contractHash`, input asset
`version/stateId/contentHash`, provider/model and parameter mapping,
`materializationHash`, preview derivative reference and the runtime/approval
receipt IDs. `artifact.add` validates this projection at reducer and repository
boundaries; it cannot be supplied as an unverified host assertion.

- [ ] **Step 2: Verify the P3 Artifact projection**

Expose the durable local Artifact projection and proposal-ready provenance
through the existing `nomi_operation_read`/Run projection. This is a read-only
assertion that the materialization receipt, contract hash and preview metadata
survive restart; it is not a new `nomi_get_artifact` owner.

- [ ] **Step 3: Record the P5 hand-off boundary**

Do not implement `nomi_get_artifact` or `nomi_propose_adopt_artifact` in this
slice. They remain reserved static names and return `not_ready`/`feature_disabled`
until the later Artifact/Proposal checkpoint. P3 may record proposal-ready
provenance (`artifactId`, `artifactVersion`, `contractHash`, `baseRevision` and
receipt references) in the existing Run projection, but it must not persist an
AdoptProposal, mutate Canvas/Timeline, or create a second proposal owner.

- [ ] **Step 4: Run focused tests and commit**

```bash
pnpm exec vitest run electron/productionRun/productionArtifactContract.test.ts electron/capabilityCore/generationSingleShot.test.ts
```

Expected: PASS; no timeline mutation is observable in this task.

## Task 6: Exercise the full MCP journey with zero-credit and real-host evidence

**Files:**

- Create: `electron/capabilityCore/nomiMcpGenerationSingleShot.test.ts`
- Create: `tests/ux/mcp-generation-single-shot.e2e.mjs`
- Create: `tests/ux/mcp-generation-single-shot.real-provider.mjs`
- Modify: `tests/ux/helpers/*` only if the existing MCP harness lacks a typed reconnect helper
- Create: `docs/audit/2026-08-22-mcp-generation-phase-evidence.md`

- [ ] **Step 1: Add the in-process MCP contract journey**

The journey must execute:

```text
initialize
→ tools/list
→ nomi_session_open (verified project-selection handle)
→ nomi_get_generation_context
→ nomi_operation_create
→ nomi_submit_generation_plan
→ nomi_preview_execution
→ nomi_request_generation_gate → GUI/main-process challenge + attested accept
→ main process mints HumanApprovalReceipt → nomi_decide_generation_gate({ receiptId })
→ nomi_start_generation
→ nomi_operation_read / nomi_subscribe_run
```

`nomi_get_artifact` and `nomi_propose_adopt_artifact` are post-P5 follow-up
tools, not part of this P3 journey or its effective scope; they are covered by
the later Artifact/Proposal checkpoint after this single-shot gate is proven.

The same harness must also exercise the E0 alias projection without spending:
`session/open → operation/create → operation/plan → plan/preview → operation/read →
operation/events`. `operation/plan` may persist the sealed contract, authorization-
required job and pending gate, but it must not submit a provider request or consume
budget. E1 aliases (`operation/start|interrupt|steer`) are covered by focused tests
and are not enabled by this E0-only run.

Assertions must include providerCalls `0` before the gate, `1` after start, one Artifact, one receipt and no automatic timeline write. The Nomi right-side Agent parity adapter is explicitly P4: it must submit the same `PlanCandidate` to this dispatcher and then produce the same contract/receipt, but is not a P3 exit requirement and must not be implemented by calling the legacy canvas generation path.

- [ ] **Step 2: Add fault-injection cases**

Run the same journey with concurrent context/submit calls, process restart,
delayed callback, duplicate callback, 503, definitely-not-submitted,
unknown outcome and expired gate. Each result must have `errorCode`, human
summary, evidence reference and `nextAction`; no concurrent run may create a
second job/gate or spend grant.

- [ ] **Step 3: Add the real Electron stdio path**

The Playwright/Node harness may click/type/select/approve through the documented surface only. It must not call filesystem APIs, provider SDKs or private IPC to forge success. Record tool names, request ids, progress, artifact resource and screenshot evidence.

- [ ] **Step 4: Run zero-credit and existing gates**

```bash
pnpm exec vitest run electron/capabilityCore/nomiMcpGenerationSingleShot.test.ts
node tests/ux/mcp-generation-single-shot.e2e.mjs
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run typecheck
pnpm run lint:ci
pnpm run test
pnpm run build
```

Expected: zero-credit journey passes in CI; the real-provider command refuses
to run unless all four `NOMI_REAL_*` values, the feature flag, an allowlisted
provider/model and a finite cost ceiling are present. It writes provider,
model, reservation/settlement receipt and raw call count to PhaseEvidence. A
mock-only pass is not called media completion. The real smoke is allowed only
after the P3 review checkpoint and must stop if the cost resolver returns
unknown; missing credentials is an explicit `blocked`, not a green skip.

Only after the P3 six-role/adversarial checkpoint passes, run the separately
authorized smoke (never as part of zero-credit CI):

```bash
NOMI_REAL_PROVIDER=1 NOMI_REAL_PROVIDER_NAME=<allowlisted-provider> NOMI_REAL_MODEL=<allowlisted-model> NOMI_REAL_COST_CEILING=<decimal> NOMI_MCP_GENERATION_SINGLE_SHOT_V1=1 node tests/ux/mcp-generation-single-shot.real-provider.mjs
```

## Task 7: Phase review, rollback and handoff

**Files:**

- Modify: `docs/audit/2026-08-22-mcp-generation-phase-evidence.md`
- Create: `docs/audit/2026-08-22-mcp-generation-six-role-review.md`
- Create: `docs/audit/2026-08-22-mcp-generation-adversarial-review.md`

- [ ] **Step 1: Fill PhaseEvidence**

Record commit SHA, baseline/input hashes, every command and exit code, MCP journey artifacts, screenshots/media, known risks, feature flag and rollback reference.

PhaseEvidence must include separate verdicts for P0 baseline, P1 module/asset,
P2 compiler and P3 MCP generation. Each verdict records the six-role review
and adversarial review that happened before the next paid or persistent
boundary; a final review cannot retroactively approve a skipped checkpoint.

- [ ] **Step 2: Run the six-role review**

Each role must use the same record shape
`{role, question, finding, severity, evidenceRefs, requiredAction, verdict}`
and give concrete P0/P1/P2 findings or an evidence-backed pass. “Looks good”
without a test/resource reference is not a pass. The roles are CTO (ownership
and invariants), PM (user path/decision load/cost), design (single coherent
control surface), frontend (state/progress/reconnect accessibility), backend
(schema/lease/budget/idempotency/recovery) and real user (task completion and
failure comprehension).

- [ ] **Step 3: Run the independent adversarial review**

The reviewer must attempt forged approval, stale contract, duplicate submission,
cross-project access, malicious Skill text, missing asset, unknown provider,
direct IPC/host bypass, missing/foreign spend grant, concurrent draft/submit,
crash between materialization and `artifact.add`, old v1 reader against a v2
record and a lost provider response. Any successful bypass or second charge
blocks the phase.

- [ ] **Step 4: Apply the stop rule**

Do not begin the next phase if any of these occur: duplicate provider charge, provider call before approval, cross-project mutation, unrecoverable Artifact loss, stale approval accepted, or mock-only evidence presented as real generation.

- [ ] **Step 5: Commit the phase as one reviewable delivery**

The commit must contain only the files in this plan and its evidence. The next plan (P4/P5 recovery expansion and clipping-area Agent Adopt) starts only after this phase has a `passed` verdict.

---

## Definition of done for this plan

An external MCP host can complete one project-scoped generation from context
to durable Artifact and receive proposal-ready provenance (reversible adopt and
timeline apply are explicitly P5); the host cannot bypass Nomi’s gate, budget
or project scope; a restart or duplicate callback cannot create a second
provider submission; and all six-role/adversarial evidence is present. No
full editor migration is required for this plan.

## Explicit rollback

The semantic MCP tools are behind a named feature flag with an owner, default
and kill-switch test. On failure, disable only that flag and leave the
existing `nomi_generate` compatibility path explicitly classified as its
current paid/Canvas-writing legacy route; do not relabel it read-only and do
not route new semantic calls through it. Keep old Run records and assets
untouched. Do not delete old routes, rewrite project assets, migrate Timeline
data or remove the compatibility path until a later, separately reviewed plan
has a copy-on-write migration, restore command and real rollback evidence.
