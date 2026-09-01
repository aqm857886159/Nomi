# M1 round-2 Host/runtime delivery

> 状态：🚧 进行中（Host/runtime 切片已移植进 M1 终装分支；红灯重验与全量 gates 见 docs/qa/2026-09-01-agent-m0-red-lights.md）

## Scope

- Transplant the Host/runtime slice from local ref `46066ed0` into the task branch,
  including the real project Host coordinator, repository/reducer, IPC, Pi runtime
  wiring, and the renderer-facing Host client seams required by those imports.
- Preserve the exact reproduction commands in
  `docs/qa/2026-09-01-agent-m0-red-lights.md`; repair the shared production
  boundaries exercised by those tests.
- Replace the round-1 standalone lifecycle facade with the transplanted Host path
  in the same change.
- Close ephemeral history migration, permission-tier routing, and class-level
  restart/CAS/remount coverage without expanding into M2 semantic projection.

## Explicitly not in scope

- Provider/model expansion, new tools, semantic tool-surface redesign, UI redesign,
  deployment, push, or PR merge.
- Changing red-light test commands, deleting the named tests, or weakening their
  assertions/timeouts.

## Verification gates

- Exact three red-light commands from the QA document.
- `pnpm run typecheck`.
- `pnpm run check:vocabularies` and `pnpm run check:root-cause-contracts`.
- Focused Host/runtime class tests and best-effort relevant gates; network/runtime
  blockers are recorded rather than hidden.

## Rollback

Revert the scoped commits in reverse order. The pre-existing round-1 facade is not
retained as a fallback; the real Host path is the single owner.
