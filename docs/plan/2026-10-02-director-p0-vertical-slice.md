# 3D Director P0 vertical slice

## Scope

- Normalize a natural language prompt into one to three typed shots with stable plan IDs.
- Compile semantic camera actions into the existing Director camera trajectory and timeline contracts.
- Build a whitebox project that the existing Director preview and MP4 output paths can consume.
- Apply updates atomically so an invalid plan preserves the last playable project.

## Reuse

`DirectorProject`, `DirectorCamera`, `Waypoint`, `TrajectoryClip`, `DirectorStore`, the existing scene renderer/timeline playback, and `useDirectorOutputs` remain the execution and export paths.

## Acceptance

- Repeating the same prompt produces the same plan/entity/shot/motion IDs.
- Push, pull, pan, tilt, orbit, follow, and target switch compile to editable keyframes with `lookAtObjectId`, duration, easing, and validation issues.
- A valid prompt produces a playable whitebox camera track; an invalid update returns an actionable error and the previous project unchanged.
- Focused Vitest coverage exercises normalization, IDs, compilation, and preservation.

## Non-goals

No new renderer, timeline, MP4 encoder, or persistence format is introduced.
