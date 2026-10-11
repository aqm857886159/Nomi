# Nomi performance harness repair plan

**Snapshot:** Implementation checklist before commit; immutable UI runs and final delivery receipts are separate.

**Goal:** Repair the measurement/report boundary before adding more journeys. This batch delivers one executable production action (`project.open`), not full-product coverage or a performance improvement.

**Spec:** Independent audit on PR #1172, comment `6104262889`; `docs/evidence/2026-10-10-nomi-user-performance/scenario-matrix-and-budget.md` retains the original budgets. The coordinator authorized implementation, tests and push on the existing branch. Only this line edits it; independent reviewers and the Mac line are read-only.

**Architecture:** Keep `_launchApp.mjs`, the production project/UI schema, and local generated media. A test-only contract owns CLI validation, cell identity, lifecycle status, raw timing validity and aggregation. Each sample gets an isolated profile and fixture; a hot sample primes that same profile before measuring. Browser input and visible-content milestones use one monotonic clock. Unsupported journeys are planned, never environment-blocked implementations.

## Design card

- ★1: Creator opens a known local project from the library: isolated fixture → library card → trusted pointer input → matching project title and visible canvas → canvas ready → independent keyboard receipt → persisted fixture unchanged. Cold process launch is setup, not this action's latency; full P1 remains planned. First batch has no paid or real-account task acceptance.
- ★2: Production project/store owners remain unchanged. Test contract owns measurement validity and coverage disposition. Raw samples are observations, not another business store.
- ★3: Reuse `_launchApp.mjs`, `_shell.mjs`, canvas fixtures and `walkthrough-network-guard.cjs`. Delete partial P/C branches rather than retain two competing action definitions.
- ★4: planned / implemented / executed / passed are separate fields. Missing probe, reload, missing input or bad milestones invalidate a sample. Blocked/empty/incomplete reports exit nonzero; a completed action with missing budget evidence remains inconclusive.
- ★9: Changed Node regressions RED→GREEN, selected contracts/pre-push, independent read-only audit. Real display/Mac/Windows acceptance stays unverified. Rollback by reverting this batch; no production change, merge or publish.

## Task 1 — Deterministic trust boundary

Files: `tests/ux/nomi-user-workflow-performance.node-test.mjs`, new `tests/ux/nomi-user-workflow-contract.mjs`, `scripts/summarize-nomi-user-performance.mjs`.

- [x] Write and run failing regressions: space/equal CLI forms; unknown/empty/non-finite inputs; exclusive evidence writes; missing/replaced probe; action-window long tasks; clock excludes collection; raw-distribution pooling; blocked/empty cannot pass.
- [x] Implement strict parser, sample validation, explicit coverage counters, unique exclusive output, import-safe summarizer. Preserve frame/task arrays and report support counts.
- [x] Run changed tests and syntax/diff checks; keep red and green output as batch evidence.

## Task 2 — Fixtures and one real action

Files: workflow fixture, workflow runner, new test-only browser probe.

- [x] Add failing fixture regressions for total shots 12/48/320, nonempty documents, multiple designs per document, mixed-media groups and result histories.
- [x] Fix fixture counts by actual persisted contents. Agent data is absent until a local fixture drives the production runtime; a label is not behavior.
- [x] Implement `project.open`: pass `fixture.record`, assert known project identity, use production `data-ready`, record trusted input and rAF content milestone, check independent keyboard receipt. Reload/replaced document is invalid in this action; future navigation actions need their own lifecycle probe.
- [x] Isolate every scenario/sample; hot samples prime and return via `_shell.mjs`. Install the existing offline network guard with an empty allowlist and inspect its loaded/error receipt.
- [x] Run the smallest cell and retain actual environment failures without promoting them to execution or acceptance.

## Task 3 — Coverage inventory and evidence

Files: source-linked entry inventory and evidence README/analysis/limitations/design card; this plan replaces unsupported completion checkboxes in the old plan.

- [x] Inventory shell, drawers, document/design actions, node kinds, Agent controls, preview/timeline/export, settings/browser/onboarding and recovery. Stable IDs link source and existing walks; planned/implemented/executed/passed are explicit.
- [x] Plan every-feature solo baselines, pairwise scale/cache/workspace/Agent dimensions, and mandatory higher-order cases for multi-document/multi-plan, grouped media/history, multi-conversation stream/tool, export/save and interruption/recovery. Every case names precondition, input, visible/data assertions and original budget reference.
- [x] Update unsupported evidence claims and distinguish implementation gaps from environment blockers. Do not rewrite historical raw reports.
- [x] Run selected repository gates and request independent read-only review; evidence is in first-batch-verification.md.
- [ ] Commit/push same branch and report the committed-head gates/CI. Delivery state belongs to the final commit receipt, not this pre-commit snapshot; extend the corrected PR body rather than restore old coverage claims.

## Review focus

1. A report with unsupported cells must never claim full coverage or acceptance.
2. Trusted input, browser document identity and content milestone must belong to the same sample.
3. Fixed waits, setup, collection and previous long tasks must not contaminate latency.
4. Cold/hot and unequal-length raw frame arrays must not be mixed or averaged by percentile.
5. Fixture summaries must be computed from persisted content, with no provider dispatch or private data.

Later batches implement the inventory's planned journeys one at a time; this batch deliberately cannot complete full-product acceptance. No independent reviewer may edit this branch.
