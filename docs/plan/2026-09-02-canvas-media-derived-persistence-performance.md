# Canvas media-reveal performance regression

> 状态：✅ 已交付

## Scope

- Make runtime image/video dimension measurement a non-durable canvas mutation.
- Preserve the in-memory dimensions used for correct rendering and node geometry.
- Add a store regression test for the shared mutation options and retain the media-reveal benchmark as the desktop evidence gate.

## Root cause

`BaseGenerationNode` measured media in `onLoad` / `onLoadedMetadata` and called the ordinary `updateNode` path. Its default options bumped `persistRevision` and emitted a canvas event for every derived measurement. On the M1 branch, the resulting project-save work ran as renderer long tasks during the reveal sequence.

## Not changing

- No budget, sampling, advisory, or benchmark thresholds.
- No user edits, generation results, or explicit resize persistence semantics.
- No provider, Agent, or project hydration behavior.

## Rollback

Revert the scoped media mutation-options change and its regression test. The old behavior returns without changing stored project schema.

## Acceptance

- M/media-reveal no longer schedules saves/events for runtime media measurement.
- Branch benchmark returns to the main control range, with no 185 ms-class long task.
- `pnpm run gates`, full Vitest failure delta against `origin/main`, and `pnpm run check:secrets` pass.
