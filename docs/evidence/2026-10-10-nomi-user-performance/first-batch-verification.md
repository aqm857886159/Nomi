# First measurement repair batch — 2026-10-11

This is a harness/fixture repair with one atomic production action, `project.open`. Full P/D/B/C/A/R journeys, production optimization and performance acceptance remain incomplete. The old completion checkboxes and coverage claims have been withdrawn.

## Deterministic regression evidence

`node --test tests/ux/nomi-user-workflow-performance.node-test.mjs`: **28 tests, 28 passed, 0 failed/skipped**. Path-redacted, trailing-whitespace-normalized RED→GREEN log copies are retained in `verification/`: the initial failing run, production group/history normalization, decoded-content readiness, schema2 evidence validation, and final green run. The suite covers both CLI forms, invalid selections, exclusive output, real checkout/temp path redaction, raw window clipping/aggregation, replaced probes, offscreen/transparent content, isolated fixtures/profiles, truthful planned/blocked states and persisted-data assertions. Node lifecycle tests inject drivers; they are not UI execution.

Fixture counts come from persisted data: shots12/48/320, image/video4+2/24+24/160+160, references4/48/320, nonempty drafts, competing plans on one document, mixed groups and history. A new regression calls the production snapshot/result normalization owners; missing group timestamps and absent current-result history previously changed the fixture during opening. The production implementation was not changed.

## Independent review and real-window correction

Read-only reviewer `/root/harness_review` found six important measurement defects: launcher feel checkpoint inside timing, omitted first-frame stall, empty-sample pass claims, durations outside the action end, reload classified as timeout, and offscreen/transparent/outside-stage content. Each was addressed with a failing regression and then a passing run. The review preceded the final repairs; this is not an independent native acceptance receipt.

The first Linux/Xvfb action produced input/visible/ready/keyboard marks but failed persisted correctness. Its failed raw report is preserved. After fixture normalization was repaired, cold/hot card-level trials completed functional checks. A later screenshot inspection strengthened the visible milestone to require a decoded, visible first image. Earlier schema2 samples without that proof remain historical; analysis rejects them rather than mixing their metrics into the current contract. All failed, blocked and superseded raw reports remain intact. The first temporary screenshot was removed by profile cleanup; subsequent screenshots are retained after timing with exclusive filenames.

Current decoded-content run: [immutable raw receipt](raw/nomi-user-workflow-2026-10-11T02-11-17-394Z-38d5ad49-5829-43a5-80b2-748c01ff220b.json). Command: `DISPLAY=:97 node tests/ux/nomi-user-workflow-performance.e2e.mjs --scale small --scenario project.open,D1 --cache cold,hot --runs 5 --warmup 1 --timeout 15000`. Exit2; coverage cells planned4 / implemented2 / executed2 / passed0. Both project.open cells completed1 warm-up+5 measured samples; all12 functional checks and offline guard receipts passed. D1 cold/hot remained planned and did not launch.

| Cell | Visible p95 ms | Ready p95 ms | Frame p95 / p99 ms | Action / frame / task samples | Verdict |
| --- | ---: | ---: | --- | --- | --- |
| small/cold | 809.58 | 809.60 | 33.335 / 100.007 | 5 / 194 / 7 | failed_budget |
| small/hot | 227.46 | 227.46 | 66.70 / 100.133 (unsupported p99) | 5 / 34 / 5 | failed_budget |

These are Linux/Xvfb diagnostics, not a native hardware baseline or before/after performance improvement. No budgets were raised. Earlier decoded-content cold warm-up was invalid due a missing/non-monotonic mark; a diagnostic cold repetition and the final protocol did not reproduce it. The earlier invalid report remains, and future normalization failures now retain their raw probe state for diagnosis. Core runner/contract/probe/fixture hashes in the final raw report match this batch's final files. The persisted-data assertion compares document/plan content, group membership, node result/history identities/URLs and reference endpoints; derived metadata may be normalized by production owners. No performance pass is enabled: main long tasks, CPU action-window distributions and memory/teardown trends are absent, and frame p99 may lack support even after five repetitions.

## Verification scope and environment

- Syntax checks for the runner, contract, probe, fixture, Node test and summarizer, plus `git diff --check`, passed.
- `pnpm run build` exited0; production renderer and Electron artifacts were rebuilt. Subsequent edits only changed the dynamically loaded test harness/docs; production sources stayed unchanged. See `verification/build.log`.
- `check:root-cause-contracts` passed, with 24 door-map entries; unrelated same-name helpers are documented separately in the contract.
- Selected pre-push Contracts on committed head38dd7e312 passed in17.3s, including PR judgement; delivery preflight reported a clean task branch with latest main as ancestor. See verification/pre-push-committed-head.log and verification/delivery-preflight.log. The final documentation-only commit also receives a fresh delivery check. These selected checks do not establish full CI or E2E acceptance.
- Declared Electron43.4.1 archive was verified against the installed package's SHA256 and installed only in ignored node_modules. Debian Xvfb was extracted under `/tmp`, using1280×933 and software rendering. No system install, policy change or paid provider was involved. The existing offline guard must report fetch/http/https/socket/chromium loaded and zero guard errors.

The raw reports identify `0ee67956b`, dirty-tree state and exact runner/contract/probe/fixture hashes because they ran before this batch's commit. They must not be presented as clean runs on a later commit without comparing those hashes. Real Mac/Windows/GPU, packaged release, private media/accounts, Agent streams/tools/concurrency and all-entry baselines remain unverified. The source inventory has88 entry families and17 node kinds;16 pairwise plus5 higher-order cases are plans.
