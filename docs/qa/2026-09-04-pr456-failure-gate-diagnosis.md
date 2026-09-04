# PR #456 failure-gate diagnosis

Date: 2026-09-04

PR: https://github.com/aqm857886159/Nomi/pull/456  
Head: `codex/main-typecheck-repair-20260904@9ab34aafcefd3c52e5809a337a9124797e410d3a`  
Base: `main@45912ae01a155a3f6592f65368d0ce3d12fc034e`

## Status

No product fix is included in this report. The long local E2E was stopped at the user's request. No check is being claimed green.

## Actual PR checks

From the PR's Quality Gate run `33825807233`:

| Check | Result | Evidence |
| --- | --- | --- |
| Validation Scope | success | completed before the failure |
| Contracts | success | completed before the failure |
| Unit | success | completed before the failure |
| E2E Walkthroughs (Linux) | failure | job `100878159148` |
| Quality Gate | failure | job `100880090686` |
| Workers Builds: nomi | success | completed |

The Quality Gate log is a downstream failure, not the first business failure. Its CI annotation step reported:

```text
CI annotation hygiene failed; inspect outputs/ci-hygiene/ci-annotations.json
CI annotation hygiene: 11 annotations, 10 delegated, 0 allowed, 1 unexpected
Process completed with exit code 1.
```

The one unexpected annotation is the E2E job failure annotation at `.github:109` with `Process completed with exit code 1`. The ten Contracts warnings were already delegated to the existing lint warning budget.

## E2E failure

The Linux E2E log reaches the C9b Phase A baseline and then fails when the new elicitation client opens a session:

```text
C9b Phase A 基线成立：非 elicitation 客户端 → GUI 生成确认卡浮出（探针活，expectAbsent 有意义）
nomi_session_open error= ...
  "errorCode": "lease_invalid",
  "message": "Project session lease is invalid",
  "nextAction": "Open a new project session and retry"
Error: nomi_session_open: ✗ The project connection expired; select the current project again.
    at tests/ux/mcp-l2-journeys.e2e.mjs:39:11
    at tests/ux/mcp-l2-journeys.e2e.mjs:361:28
```

The preceding C9b Phase A steps pass. The failing call is the Phase B call at `tests/ux/mcp-l2-journeys.e2e.mjs:361`.

## Root-cause judgment

High-confidence root cause: the fixture replays a connection-bound selection handle across two MCP transports.

1. The main `mcp` client creates the C9b project and receives `c9bSelectionHandle`.
2. That handle is then passed to a newly spawned `c9bClient`:

   ```js
   c9bClient.callTool('nomi_session_open', {
     projectSelectionHandle: c9bSelectionHandle,
   })
   ```

3. `ProjectSessionAuthority` verifies the selection handle against the receiving connection before issuing a lease.
4. The project-lease contract binds selection handles to the issuing transport's principal/session/nonce. The existing `electron/capabilityCore/projectSessionAuthority.test.ts` test explicitly covers that a created-project selection handle is valid only on the issuing connection.

This is a test/fixture lifecycle error, not evidence that the lease store randomly expired. PR #456 itself changes only `src/workbench/generationCanvas/nodes/useNodeModelAutoSelect.ts` (using hydrated metadata for the provider-switch notice); it does not change project-session or lease code.

## Local verification boundary

The first local attempt failed before the E2E because the fresh worktree had no `dist-electron` output:

```text
Error: Cannot find module .../dist-electron/capabilityCore/nodeKindDomain.js
```

After `pnpm install --frozen-lockfile` and `pnpm run build`, the original E2E reached C7/C8/C9 and was manually stopped before C9b. Therefore the local run did not independently reproduce the CI lease failure; the CI log above is the authoritative failure evidence for this diagnosis.

## Smallest candidate repair (not implemented)

Keep the GUI on the C9b project, but let the new `c9bClient` bootstrap its own current-project selection/lease:

```js
await call(c9bClient, 'nomi_session_open', {
  bootstrap: { mode: 'current_project' },
})
```

An alternative is to create the project through `c9bClient` itself and use the handle returned to that same connection. Either candidate still requires a fresh red/green run; neither is claimed as verified here.

## Required next verification

1. Apply one candidate fixture change only.
2. Run `node tests/ux/mcp-l2-journeys.e2e.mjs` and record the C9b result.
3. Run the relevant Quality Gate workflow checks again.
4. Keep the existing connection-replay unit test green and verify no other journey regresses.

