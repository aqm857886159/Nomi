# Agent usage ledger rebaseline follow-up

> 状态：✅ 已交付（follow-up 分支已同步至 `origin/main=91af6c9a96ca729b7af1610810e994782e6c3aae`；待 PR review）

## Scope

- Rebase the user-value slice from #452 onto the requested base in an isolated worktree, then merge the later `origin/main` updates without rewriting remote history.
- Preserve the Host-owned terminal usage persistence and non-UI contract evidence; keep `ProjectAgentResidentShell` UI behavior out of this PR until an image2-confirmed follow-up.
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
- Fresh V8 run on the merged `origin/main=91af6c9a96ca729b7af1610810e994782e6c3aae` tree: 6 files, `61 passed / 74 skipped`; repository-level selected-file summary remains `48.94% statements (762/1557)`, `42.16% branches (600/1423)`. This is explicitly not the scoped gate and is not claimed as 100%.
- The machine-readable scoped receipt is recorded in `docs/qa/2026-09-04-pr460-scoped-coverage-receipt.md`. It reports 100% statements and branches for the changed production spans: semantic generation gate `9/9, 13/13`; approval receipt boundary `24/24, 38/38`; Run-owned changed spans `13/13`; production service changed command span `13/13, 17/17`; Host usage reducer `5/5, 4/4`; Host state usage branch `1/1`; usage validator `4/4`; and the enclosing async-result mutation statement containing the new usage field `1/1`.
- Uncovered items are only pre-existing, unchanged branches outside the receipt: the Run-owned display fallback at line 80 and legacy shot/display conditionals, unrelated `productionRunService` projection/driver/recovery branches, and the rest of the large Host execution/reducer/state files. They are not hidden by `exclude`; they are outside the changed-function spans, with owners `runOwnedGenerationGateAuthority` display coverage, `productionRunService` projection/driver owners, and `projectAgentHost` lifecycle owners for a later PR. The `ProjectAgentResidentShell.tsx` UI projection is intentionally absent from the PR and is owned by a separate image2-confirmed UI PR.
- Contracts/typecheck: `check:root-cause-contracts` `30/30` plus high-risk boundary pass; `check:docs-index` and `check:doc-status` pass; `electron/tsconfig.json` and `electron/tsconfig.pi.json` pass. No full suite, build, renderer launch, or paid provider was run.
