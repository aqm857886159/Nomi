# Production MCP Finalization

## Goal

Ship the Production Run MCP path as a real Nomi feature, not a protocol-only prototype. Codex, Claude Code, and Cursor must be able to connect to the built Nomi, create a non-spending production draft, observe durable progress and safe artifacts, and return the user to the exact Run/artifact in Nomi. Direction, spend, rough-cut, and export gates remain explicit Nomi UI decisions.

The complete acceptance journey is:

`tools/list -> start draft -> subscribe -> open Run -> approve direction -> plan storyboard -> approve contract -> generate/adopt -> assemble -> approve export -> export -> inspect playable MP4`

## Acceptance Result — 2026-08-09

- Built Electron + real MCP stdio journey passed 26 assertions from `initialize` through a playable export.
- The deterministic, no-provider fixture produced a two-second MP4 with H.264 video and AAC audio; `ffprobe` verified both streams and positive duration.
- Restart recovery preserved an in-flight contract without submitting, spending, or duplicating a job.
- MCP Apps host rendering passed 9 assertions in light, dark, and ChatGPT bridge modes: one truthful status, at most one safe preview, and one `在 Nomi 打开` action.
- Focused Production/MCP tests, the full Vitest suite, typecheck, i18n, design-token, control-contract, secret, and file-size gates passed before the final full gate run.
- R16 screenshots are stored under `tests/ux/shots/production-mcp/` at 1440×900 and 900×700, plus MCP host screenshots under `tests/ux/shots/mcp-apps-host/`.

Repeat the two product journeys after `pnpm run build`:

```bash
node tests/ux/production-mcp-journey.e2e.mjs
node tests/ux/mcp-apps-host-render.e2e.mjs
```

## Truthful Product Boundary

- Nomi stores projects, imported media, prompts, credentials, orchestration state, and generated/adopted outputs locally.
- Requests made to configured external model providers still send the task's required inputs to those providers.
- MCP clients may create and observe a production draft. They may not forge trust, approve spend, approve export, publish, delete, or overwrite files.
- No claim of end-to-end completion is allowed until a built Electron app, an actual MCP stdio client, GUI approvals, durable recovery, and a playable export have all been exercised.

## Current Blocking Findings

1. Production tool results emit `structuredContent.nomiRun`, while the MCP Apps widget only ingests `nomiDraft`, leaving production widgets blank.
2. The widget invents `running` for unknown/event-only projections and renders every artifact instead of one latest safe preview.
3. Artifact `nomiUri` is not fully scoped and can collide across Runs.
4. External projections can leak provider URLs or absolute paths through nested free-text fields.
5. RPC request bodies can currently attempt to forge a trusted host identity.
6. Production preview authorization is optional when its query is removed, and `nomi-local://` is not directly loadable by an external MCP host.
7. Cold/warm deep links can lose the requested artifact or be overwritten by a concurrent generic Run load.
8. Existing Codex/Claude registrations point at stale code, and the installed Nomi predates this protocol.
9. Existing driver export evidence is a text fixture named `.mp4`; it does not prove a playable export.
10. There is no deterministic, no-provider Electron Production Run fixture for a repeatable R16 journey.

## Implementation Sequence

### 1. Contract And Focused Failing Tests

- Lock Round 3 hard-fail criteria in the harness.
- Add widget contract tests for the exact production protocol payload, honest status, one latest preview, one CTA, and absence of private data.
- Add security tests for scoped artifact identity, hostile nested text, authoritative external origin, mandatory preview authentication, cursor advancement, and deep-link races.

### 2. Protocol And Projection Repair

- Make the widget ingest the canonical production payload and display one truthful status sentence, one latest preview, and one `在 Nomi 打开` action.
- Project tool-specific production states without fabricating progress.
- Scope artifact URIs by project, Run, and artifact; include the safe URI on the MCP wire.
- Apply a single defensive sanitizer/omission policy to every externally projected free-text field.
- Move caller authority into transport-owned dispatch context; preserve self-declared client names only as audit labels.

### 3. Preview And Deep-Link Repair

- Require an authenticated, expiring, project/Run/artifact-scoped preview handle on the production preview route.
- Use a random profile secret rather than deriving one from a public path.
- Provide a host-loadable preview transport for external MCP Apps while preserving Nomi-local display.
- Store a scoped navigation target and reject stale Run loads so cold/warm links reliably open the exact artifact, even when the panel starts collapsed.

### 4. Deterministic Electron R16 Harness

- Add an E2E-only deterministic renderer/provider fixture that produces locally generated playable media without paid/provider calls.
- Launch the worktree Electron binary with a sanitized temporary profile and project root.
- Start a second `NOMI_MCP_STDIO=1` process and perform real newline JSON-RPC initialization, tool listing, start/get/subscribe/artifact calls.
- Drive all GUI approval gates with Playwright, inspect the latest preview, restart at an in-flight boundary, and confirm recovery does not duplicate submission.
- Verify the final MP4 with `ffprobe`, not only by filename or non-zero byte count.

### 5. Full Gates, Adversarial Review, And Delivery

- Run focused Vitest, full test suite, typecheck, lint, token/i18n/filesize checks, build, and `pnpm run gates`.
- Inspect Electron screenshots at desktop and constrained viewports for overlap, truthful copy, and target selection.
- Run a final adversarial audit covering forged trust, missing/expired/foreign preview handles, provider/path/prompt leakage, duplicate submissions, stale cursors, and app restart.
- Update user/operator docs with exact MCP registration commands and the local-vs-provider data boundary.
- Check secrets and machine-specific paths, then commit only the Production MCP-owned changes and push `main` under the repository worktree rules.

## Hard-Fail Acceptance Criteria

- The exact `nomiRun` frame returned by a real production tool renders in the actual MCP Apps widget.
- The widget shows one truthful sentence, at most one latest safe preview, and exactly one `在 Nomi 打开` action.
- No external payload contains raw prompts, credentials, provider URLs, `file://` URLs, Unix absolute paths, Windows absolute paths, or private contract fields.
- Artifact identities are collision-free across projects and Runs.
- MCP, stdio, and RPC callers cannot self-assign a trusted origin.
- Missing, forged, expired, wrong-scope, and foreign-profile preview handles all fail closed; a valid handle loads in an external Chromium host.
- Suppressed durable events still advance the cursor and are not reread forever.
- Cold-start and warm deep links select the exact Run/artifact with the Production panel initially collapsed or expanded.
- No renderer generation call occurs before explicit contract approval, and no export occurs before explicit export approval.
- Restart never automatically resubmits an ambiguous provider task.
- The built app completes the real stdio + GUI journey and produces an `ffprobe`-valid MP4 using the deterministic no-provider fixture.
- Full repository gates pass and an adversarial reviewer reports no unresolved P0/P1 issue.

## Non-Goals

- Public batch generation APIs.
- A new editing or timeline system.
- Automatic approval of direction, spend, rough cut, export, publication, deletion, or overwrite.
- Paid generation or live-provider calls during deterministic acceptance.
- Video deconstruction and unrelated editing changes already present in this worktree.

## Worktree And Commit Discipline

This worktree is currently detached and contains user-owned video-deconstruction changes. Do not reset, discard, or bulk-stage it. Before any commit, map each changed hunk to the Production MCP scope, establish a valid branch/worktree path, run the full gates from the exact commit candidate, and stage only owned files/hunks. Generated CSS is included only when required by an owned UI change.
