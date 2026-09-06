# Agent compaction runtime projection

> 状态：🚧 进行中

## Scope

Expose Pi compaction metadata through the existing runtime → Project Agent Host → renderer path. The first slice carries the runtime-owned count on the terminal turn; the renderer only renders the line when the Host has committed a positive count. No local timer, inferred token threshold, fixture-only state, or fabricated summary is allowed.

## Root cause

Pi already records successful `compaction_end` events and returns `RuntimeTurnResult.context.compactions`, but `RuntimeActivityEvent`, `ProjectAgentAsyncResultEnvelope`, `ProjectAgentTurn`, and the renderer projection drop that metadata. The UI therefore cannot distinguish a real compaction from an ordinary running turn and has no honest expand boundary.

## Implementation boundary

- Add a neutral shared context metadata shape to `runtimePort`/`projectAgentContracts` without importing Pi types across layers.
- Thread the metadata through `runAgentTurn` result, Host async result validation/reducer, persistence/replay, and the renderer projection.
- Render `data-agent-compaction-line` only from committed metadata. Keep expand behavior separate until a canonical first-kept-entry boundary is published; do not claim A-04 from a count-only slice.

## Acceptance

- Unit/contract tests reject malformed or negative metadata and preserve it through reducer/replay/restart.
- Real Electron walk triggers a genuine Pi compaction with a bounded fixture, observes the committed line, then cold-restores the same turn.
- `check:boundaries`, `check:filesize`, typecheck, and relevant tests pass.
