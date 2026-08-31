# Production provider identity and recovery

Date: 2026-08-09
Branch: `codex/production-budget-ux-20260809`

## User failure

The production plan selected `code-newcli-com / gpt-image-2` even though another usable provider exposed the same model. The first job then failed locally with `API key missing: code-newcli-com`, but Production classified every renderer error as `submission_unknown`. The UI consequently asked the user to reconcile a request that never left Nomi and offered no way to replace the unusable provider.

## Root causes

1. Agent-facing model entries deduplicate by bare `modelKey`, so provider identity is lost when two providers expose the same key.
2. Storyboard plan fields and default-model resolution persist `modelKey` without `modelVendor`.
3. `buildPlannedNodeMeta` indexes entries by bare `modelKey`, making catalog order decide the provider.
4. The storyboard provider selector receives `(modelKey, vendor)` but its callback discards `vendor`.
5. Production does not preflight the bound provider/model before contract approval.
6. Production passes an idempotency key to the renderer, but the renderer does not pass it into `runGenerationNode`.
7. Production maps all renderer failures to `submission_unknown`, including definite local preflight failures.
8. A stopped run has reconciliation only; it cannot supersede unsubmitted work, rebind it, and issue a new contract.
9. Production status resolves the active project from a delayed, non-reactive persistence binding, so opening a Run from Task Center can load the durable Run but leave the assistant status panel empty.

## Scope

- Make `(provider, modelKey)` the persisted execution identity through agent models, storyboard plans, created nodes, and Production bindings.
- Make automatic defaults provider-aware and independent of catalog order.
- Preflight Production bindings against the current executable catalog before approval and submission.
- Preserve the Production idempotency key through the actual submission path.
- Distinguish definite `not_dispatched` failures from receipt-unknown failures.
- Add a user-confirmed rebind command that supersedes only unsubmitted or explicitly confirmed-not-dispatched jobs, revokes the old contract, increments the plan version, and creates a fresh contract.
- Reuse the existing Production panel, Nomi model selection logic, and spend-contract dialog for recovery.
- Resolve the Production panel's project from Nomi's reactive desktop-project source so Task Center and MCP deep links visibly open the requested Run.
- Repair the current real run only through the new audited command path; do not retry or edit its durable files manually.

## Out of scope

- Batch-generation product features.
- Editing or timeline work.
- Automatic paid submission after provider replacement.
- Silent failover after a receipt-unknown submission.
- Retrying the current real run before the replacement contract is explicitly approved.

## Safety invariants

- `submission_unknown` is never retried or rebound automatically.
- A local provider/model preflight failure is `not_dispatched`; it must never be presented as receipt-unknown work.
- A receipt-unknown job can be detached only after explicit user acknowledgement.
- A provider/model change always creates a new plan hash, gate, job ids, and approval.
- Previous approval never authorizes replacement jobs.
- Known local preflight failures spend zero and are never labelled receipt-unknown.
- Provider replacement updates both the canvas node metadata and the durable Production binding before a new contract can be approved.
- A contract authorizes the complete executable job set for its plan version, never a hidden subset.
- Dispatch verifies the approved provider/model and current canvas binding immediately before any paid call.
- Every paid submission reserves budget durably before dispatch and cannot exceed the approved hard ceiling.
- Closing a contract review only dismisses it; rejection is a separate explicit action.
- User-provided selling points are unverified claims until independent evidence is attached.

## Recovery UX

Current panel becomes an actionable recovery surface:

```text
Supplier unavailable before submission
code-newcli-com has no usable credential. No provider task was created.

Replacement       APIMart · GPT Image 2
Affected work     16 shots
Next              Review a new contract; generation remains paused

[Use APIMart]
```

If Nomi cannot prove the request stopped before submission, the existing reconciliation decision remains first. Replacement is offered only after the user confirms the old task is absent/detached.

The recommended replacement is not mandatory. The recovery surface also exposes all currently executable provider/model bindings for the affected media kind. Choosing one creates a fresh contract and leaves generation paused; Nomi never silently changes provider after approval.

## Adversarial-review amendments

The first implementation reached a safe replacement contract but is not releasable. The following findings are release blockers:

1. Replacement contracts must cover every executable job in the new plan version; `driveGeneration` must be scoped to exactly that approved set.
2. The renderer must receive the approved provider/model and reject a canvas node whose live binding differs.
3. Production generation must use the durable submission outbox so reservation, unsettled spend, and at-most-once state are authoritative before a paid call.
4. An explicit provider lookup must never fall back to a unique bare model key from another provider.
5. Provider rebind must clear stale provider errors, restore the full node state on failure, and prevent concurrent or partial Run/canvas divergence.
6. Contract dismissal must leave the gate waiting; claims without independent evidence must render as unverified; unknown cost must not be presented as an estimate.
7. Restart recovery must use legal job transitions and reconcile jobs that already have a provider task id instead of silently swallowing transition failures.

## Rollback

- Code rollback is one PR revert.
- Run recovery is append-only: old jobs and gates remain in history as detached/revoked; no event, approval, or artifact is deleted.
- The real run remains unchanged until the replacement action is explicitly invoked in the verified build.

## Acceptance gates

- Duplicate model keys across providers retain both provider identities.
- Storyboard manual provider selection and defaults persist into node metadata and Production jobs.
- Catalog order cannot change the selected provider.
- Unavailable provider/model bindings cannot be approved.
- `API key missing` and equivalent local preflight errors become `not_dispatched`, not `submission_unknown`.
- Receipt-unknown work never switches provider automatically.
- Rebind creates plan v2, revokes v1 gate, detaches old jobs, creates fresh jobs/gate, and waits for approval.
- Production idempotency key reaches `nomi:tasks:run`.
- The user can choose a different executable provider instead of accepting Nomi's recommendation.
- A local unusable-provider failure produces an actionable provider picker, not a duplicate-charge warning.
- Contract approval cannot dispatch a job absent from the visible contract or a provider/model different from the approved binding.
- Budget reservation is persisted before renderer dispatch; insufficient ceiling prevents the call.
- Dismiss/reopen contract, keyboard modal behavior, stale-error cleanup, and waiting-user Task Center state pass real interaction tests.
- Chinese and English real Electron recovery journeys pass and screenshots are inspected.
- A real Task Center navigation opens the replacement contract in the assistant and leaves it unapproved with zero spend.
- `pnpm run gates` passes before commit and PR push.

## Adversarial review checklist

- CTO: no second truth source for model identity or approval.
- Product: the primary action resolves the blocked task instead of sending users to Settings.
- Design: the recovery information is action-oriented, compact, and uses existing components/tokens.
- Frontend: canvas and Run bindings change atomically from the user's perspective and survive reload.
- Backend: status transitions, plan hashes, approvals, and idempotency preserve at-most-once semantics.
- User: it is obvious what failed, whether money may have been spent, what will change, and when generation resumes.
