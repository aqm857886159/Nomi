# Test Surface Audit: Model Integration and Validation Budget

Date: 2026-08-29
Scope: PR #221 plus repository-wide validation selection
Decision: keep behavioral coverage; simplify selection and repeated setup

## Evidence

- Vitest collection: 893 discovered files, 892 collected files, 8,529 tests.
- Repository test-like files: 1,093, including Node tests, desktop journeys,
  walkthroughs, helpers, and non-Vitest E2E scripts.
- PR #221: 295 files across 35 commits. It changes 112 test files with 9,825
  added and 955 removed test lines.
- Largest relevant suites: `electron/providerAdapter/service.test.ts` is 1,582
  lines / 58 tests; `electron/integrationCertification/operationLedger.test.ts`
  is 792 lines / 46 tests; `electron/providerAdapter/certificationMedia.test.ts`
  is 533 lines / 35 tests.
- The capability matrix had no dedicated model-integration certification row;
  the feature was hidden inside the older `settings.onboarding` capability.

## Findings Fixed in This Change

### P0: mixed focused changes could omit related tests

`scripts/test-focused.mjs` previously used an either/or branch: if any direct or
sibling test existed, related tests for other changed source files were not
executed. The runner now selects each source independently and can run direct,
related, and Node tests in the same focused batch. Contract tests cover the
mixed case and prove the runner never invokes full `pnpm run test`.

### P0: the full classifier missed high-risk surfaces

The first classifier draft did not cover all Electron assets/shared code, model
catalog bridges, Vitest/Vite config, UX harnesses, or its own selection scripts.
Those paths could therefore receive fast validation while changing the meaning
of the gate itself. The classifier now treats Electron, model/provider/bridge
paths, build config, test systems, model-integration evals, and gate scripts as
full; empty diffs, deletes, renames, main pushes, and manual runs remain
fail-closed.

### P1: focused-runner contracts were not mandatory

The new runner test existed but `gates:contracts` only called the workflow test.
`check:quality-gate-workflow` now runs both contract files, so a broken selector
cannot be merged merely because the YAML still parses.

### P1: model integration was absent from the capability matrix

`models.integration-certification` now records normal, boundary, failure,
persistence, and J0/J3/J4 journey evidence. This prevents a broad onboarding row
from concealing missing certification coverage.

## Must Keep

| Boundary | Representative evidence | Why it is not redundant |
|---|---|---|
| Credentials and redaction | `electron/catalog/secretsFailClosed.test.ts`, `electron/providerAdapter/vendorHttpRedaction.integration.test.ts` | A leak can occur at storage, transport, error, and IPC boundaries independently. |
| Network and SSRF | `electron/hardenedFetch.test.ts`, `electron/networkHostPolicy.test.ts` | Initial URL, DNS result, redirect, and private artifact policy are different attack surfaces. |
| Certification state | `electron/integrationCertification/service.test.ts`, `promotionJournal.test.ts` | Saving, verifying, promoting, and recovering are separate irreversible transitions. |
| Idempotency and persistence | `operationLedger.test.ts`, `comfyuiIntegrationSession.test.ts` | Duplicate paid submissions and crash recovery need process-level evidence, not only unit mocks. |
| Media truth | `certificationMedia.test.ts`, `electron/export/mediaProbe.test.ts` | HTTP 200, MIME labels, file signatures, decodability, and bounded download size can disagree. |
| Real entry and package identity | `model-integration-no-repo.mjs`, `model-integration-packaged.e2e.mjs`, `packaged-mcp-smoke.e2e.mjs` | In-process tests cannot prove the installed app exposes the same signed MCP boundary. |
| Migration and publication | `candidateLineageLifecycle.test.ts`, `electron/shared/modelPublication.test.ts` | Legacy records and partially verified modes can otherwise become visible after restart. |

## Can Be Focused

- Documentation-only pull requests: contracts run; no invented executable test
  target is required.
- Isolated renderer/source changes outside model, credential, network, provider,
  bridge, and runner paths: run changed tests, sibling tests, then import-related
  tests only where no sibling exists.
- Direct unit-test changes: run that test file. Node tests are restricted to the
  explicit `*.node-test.mjs|cjs` convention so Vitest files are not sent to
  `node --test`.

Fast validation is feedback for ordinary PR iteration. It is not release
evidence and cannot replace full validation at final handoff or on `main`.

## Simplification Candidates

No behavioral test is deleted in this PR because no pair was proven equivalent.
The safe simplifications are structural:

1. Split `electron/providerAdapter/service.test.ts` by reservation, execution,
   promotion, and recovery while reusing the existing
   `tests/serviceReservationRaceFixture.ts`. Keep all 58 behaviors.
2. Extract ledger corruption/atomic-write fixture builders from
   `operationLedger.test.ts`; keep the corruption, compaction, CAS, and restart
   matrix intact.
3. Consolidate the repeated source-reading helper used by 20 structural tests.
   Do not replace those contracts with snapshots; they protect ownership and
   renderer/main boundaries that import-graph selection cannot see.
4. Keep the J3 fault-matrix wrapper as a release grouping, but do not rerun its
   eight suites on every fast PR after the same unit files already passed.

These are maintenance candidates, not permission to mix a broad refactor into
the model-onboarding delivery.

## Remaining External Evidence

The following cannot be honestly added as deterministic local tests without the
external systems. They remain explicit release gates rather than fake passes:

- J1: real BananaRouter/blind-provider discovery and production generation.
- J2: real ComfyUI listener with UI-saved and API workflows, including multiple
  media inputs.
- J4: upgrade from a previous installed version followed by a real production
  call without duplicate submission or credential re-entry.
- WorkBuddy: invocation from the real external host.

Until those resources exist, the release manifest must retain `unverified` or
`partial`; mock, no-spend, and packaged smoke evidence must remain separate.
