# Production Run Driver

## Goal

Turn `brand.promo` from a durable draft into a Nomi-authoritative, resumable production run. External MCP clients may start and observe a run; Nomi owns direction, storyboard, spend authorization, generation, assembly, and export.

## In scope

- Initialize durable stages, brief and direction artifact at draft creation.
- Pause at an explicit direction gate before any model or paid API call.
- Share one `ProductionRunService` instance between MCP/RPC, stdio, IPC, and app recovery.
- Route planning, per-shot generation, arrangement and export through renderer operations so the existing canvas, task center, spend gate, and export code remain the single execution surface.
- Persist command IDs, expected revisions, job transitions, artifacts, and recovery attention states.
- Add deterministic driver tests for direction approval, planning, contract approval, restart, idempotency, submission-unknown, and export boundaries.

## Explicit non-goals

- No new public batch-generation API; shot jobs are internal orchestration only.
- No new timeline editor or independent clip model.
- No automatic approval of direction, budget, generation, or export.
- No claim that remote inference is local; only project data, keys, and orchestration state are local-first.

## Recovery and safety invariants

1. `createDraft` performs no provider request and creates no job approval.
2. A command is applied once per `commandId`; stale revisions are rejected.
3. Paid work is impossible before an approved gate and a valid hard spend cap.
4. Renderer timeout never implies provider success. A persisted `submitting` job becomes `submission_unknown` on restart and requires reconcile/attention.
5. Artifact paths are project-relative and exposed only through scoped, expiring previews.
6. A headless host can create/read a draft but cannot silently execute paid work without an explicit confirmed path.

## Verification gates

- Focused Vitest for repository/reducer/service/dispatcher/MCP.
- `pnpm run typecheck`, `pnpm run lint:ci`, `pnpm run build`.
- Harness Round 1 and Round 2 artifacts under `.agents/runtime/harness/2026-08-08-production-run-driver/`.
- Real Electron journey: start draft -> open deep link -> approve direction -> review/confirm storyboard -> approve contract -> observe shot events/previews -> approve export -> inspect playable MP4.
- Adversarial review checks payment-before-gate, app-closed behavior, duplicate submission, recovery, path leakage, and cross-run plan contamination.
