# Native multimodal publication checks (Draft)

The branch is submitted for upstream review as a Draft. These are local Windows results, not GitHub Actions results or approval to merge.

## Local push gate remediation

The initial push was rejected before any remote branch was created. The hook compared against the fork's older `origin/main`, so it included upstream documentation already integrated from `upstream/main` as well as this feature.

- `check:filesize`: removed a duplicate type import and a single-use alias; retained the inferred provider-kind return type. No limits were increased.
- `check:no-default-overwrite`: grouped the Google auth fields without moving the existing write location. No baseline exemptions were added.
- `check:tokens`: reused the existing content-flow row primitive for the media capability switches.
- `lint:changed`: all 55 changed source/test files pass with zero errors and no warning increase; editor mocks now use explicit types.
- `check:vocabularies`: passes using the actual `upstream/main` as `VOCAB_BASE_REF` for this shallow clone.
- `check:mockup-contracts`: passes after fetching missing history. The earlier false freshness dates came from a shallow Git boundary; no contract approval dates were changed.
- `check:real-media-fixture`, `check:design-lab --mirrors-only`: pass after restoring tracked files excluded by sparse checkout. No new visual baselines were generated or accepted.
- Push structure/tracked-scan Node tests: 53 passed after restoring the tracked evidence directory.
- `check:prior-art`: passes with the actual reused libraries, source boundaries and official documentation in the PR body.
- Full `pnpm run typecheck`: all five project/test checks pass; the preexisting test-type debt remains at 10, with zero new errors.
- Refreshed independent acceptance: seven files, 41 tests passed after the maintenance edits. The focused live harness suite also passed all 15 tests.

## Remaining failures

The five previously failing scan suites were rerun after restoring fixtures: 762 tests passed, four failed in three unchanged files. Two suites previously failing because of missing sparse files now pass.

- `electron/catalog/multiOutputMapping.test.ts:166`: Windows fixture paths use backslashes while the assertion expects slash-separated strings.
- `src/workbench/generationCanvas/agent/applyCanvasToolCall.singleParse.test.ts:57`: the same Windows path separator mismatch.
- `tests/ux/_launchApp.test.mjs:556` and `:567`: POSIX process-tree expectations conflict with the existing Windows `descendantPids` implementation, which returns an empty list.
- Temp-helper Node tests: 25 passed, one skipped, one failed. `scripts/_test-temp.node-test.mjs:25` cannot create its directory symlink on this Windows host (`EPERM`).

`check:pr-judgement` remains blocked by actual missing acceptance material: no approved board for the added controls, no completed old-install upgrade walkthrough, and no escaped-issue ledger settlement for the contract's `detected_by: user`. The PR explicitly records incomplete evidence. No fake approvals, green checks or ledger closure were added.

## Publishing discipline

The repository explicitly permits an audited push exception when local checks or the host environment block publication (`scripts/claude-hooks/pre-push-check.sh` and `scripts/check-push-bypass.mjs`). Publication uses that path and leaves `.claude/push-bypass.log` at `confirmed=no`. This local log is ignored by Git; the review-visible explanation is this report and the PR body.

The fork's GitHub Actions are disabled, the final branch HEAD includes `[skip actions]`, and no workflow dispatch, retry, preview label or merge queue is requested. A skipped required check may remain pending. This branch must not be described as merge-ready.
