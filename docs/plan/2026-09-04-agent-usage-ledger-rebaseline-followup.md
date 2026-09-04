# Agent usage ledger rebaseline follow-up

> 状态：✅ 已交付（follow-up 分支已同步至 `origin/main=53e3ab7c2f38561760a6b7262c76c098929a7c34`；待 PR review）

## Scope

- Rebase the user-value slice from #452 onto the requested base `45912ae01a155a3f6592f65368d0ce3d12fc034e` in an isolated worktree.
- Preserve the Host-owned terminal usage persistence and `ProjectAgentResidentShell` projection; do not rewrite or merge #452.
- Close the approval-receipt project revision gap across the semantic MCP flow, Run-owned gate authority, production Run service, and approval-receipt boundary.

## Reproduction

1. Seal a generation authorization at project revision `12`.
2. Present the server-owned gate challenge and mint a valid receipt for revision `12`.
3. Advance the workspace to revision `13` before `gate.decide` reaches the Run owner.
4. The current Run-owned path compares the receipt only with the sealed envelope, so it accepts the old receipt and durably approves the gate.

The receipt is valid cryptographically and structurally, but stale for the current project document. That is the security failure under test.

## Minimal fix

Resolve the live project revision at the Run-owned authority boundary before issuing a challenge and again immediately before approving the Run. Fail closed when the resolver is unavailable or differs from the sealed authorization revision. Forward the sealed revision in the durable gate command so the production service and `productionRunApprovalReceipt` remain an independent defense when configured.

The same resolver is wired into GUI rework/continuation actions and stdio capability-core assembly. Existing expiry, duplicate, rejection, cancellation, timeout, and network behavior remains explicit and is covered by focused tests.

## Verification boundary

- Focused Vitest slices for the semantic flow, Run-owned authorization, approval receipt/service, and persisted operation/receipt restart readback.
- Focused TypeScript check only; no full test suite, package build, or paid provider canary.
- Root-cause contract check is required before delivery.

## Verification evidence

- C9 red: with only the post-confirmation live-revision assertion temporarily removed, `pnpm exec vitest run electron/productionRun/productionGenerationAuthorizationFlow.test.ts -t "revision drifts after confirmation and before the Run command"` failed because the stale receipt resolved to `approved: true`.
- C9 green: restoring that single assertion made the same command pass (`1 passed`, `8 skipped`). The real fixture seals revision `12`, mutates the live resolver to `13` inside confirmation, and verifies `receipt_invalid`, a waiting gate, and no durable approval.
- Focused green matrix: authorization/receipt `8 files / 92 tests`; Host terminal usage persistence `1`; Host restart readback `2`; Resident usage projection `10`; multishot anchor `6`; multishot create `6`.
- Focused V8 coverage over `mcpSemanticGenerationFlow.ts`, `runOwnedGenerationGateAuthority.ts`, `productionRunApprovalReceipt.ts`, and `productionRunService.ts`: statements `45.70% (202/442)`, branches `43.33% (234/540)`, functions `45.94% (34/74)`, lines `51.74% (193/373)`. The service percentage is diluted by unrelated projection/preview methods included in the same module; the changed receipt/authority modules are `90%+` line coverage and `77%–82%` branch coverage.
- Intentionally uncovered branches: malformed/non-matching sealed gate and receipt guards in `runOwnedGenerationGateAuthority.ts`, request-time expiry, the non-waiting gate path, the public-challenge fallback path in the semantic flow, receipt-scope catch/wrong-field branches, and unrelated service event-wait/artifact-preview/list projection paths. These are residual branches, not claims of full-module coverage.
- Contracts/typecheck: `check:root-cause-contracts` `30/30` plus high-risk boundary pass; `check:docs-index` and `check:doc-status` pass; `electron/tsconfig.json` and `electron/tsconfig.pi.json` pass. No full suite, build, renderer launch, or paid provider was run.
