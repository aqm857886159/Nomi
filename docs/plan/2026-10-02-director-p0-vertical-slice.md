# 3D Director P0 vertical slice

> 状态：🚧 进行中

## Why

The Director AI bar previously recognized camera language locally and applied a plan without the workspace's Agent Runtime. Routing that request through the existing Agent Lane and `director-cinematography` Skill gives the Director a real Skill execution surface while keeping planning, scene mutation, approval, and export on the owners already used by Nomi.

## Goal

One short user sentence should produce a typed one-to-three-shot plan, a whitebox scene, bounded character action clips when requested, editable camera motion and timeline data, and an immediately playable Director preview. The same existing project and MP4 output paths remain the delivery surface.

## Product journey

| User step | What is visible | Existing system owner |
| --- | --- | --- |
| Enter a sentence such as “a character walks forward, then orbit right” | Director AI bar accepts the sentence and shows running status, elapsed time, and cancellation | `AiSceneBar` → `useAiSceneBuilder` |
| Plan | The request is sent through the existing Agent Lane single-shot runtime with the installed `director-cinematography` Skill; the response is a small JSON plan envelope | `runSingleShotAgent` + Skill catalog; no new runtime or tool market |
| Build | The bar reports “preview ready”; the Director viewport shows whitebox objects, any walk/run action track, a camera path with editable keyframes, shot clips, and the timeline | `DirectorPlan` normalizer/compiler → `DirectorStore` |
| Enter preview | The compiled Director camera becomes the active POV, the playhead resets to zero, and the existing Play button is enabled by the non-empty timeline | `setActiveCamera`, existing timeline playback and `DirectorTimeline` |
| Revise one shot | “Second shot slower”, “orbit from the right”, or “keep the target centered” addresses the selected shot; other shot IDs and targets remain unchanged | transient typed plan + one `DirectorStore` history transaction |
| Undo or recover | One Undo removes the local revision; malformed Skill output, unknown targets, and invalid durations show an actionable error while the last playable version stays on screen | existing undo stack + atomic preview application |
| Export | The user can use the existing Director output controls to render MP4 through the existing capture/output path | `useDirectorOutputs` and current MP4 persistence path |

## Scope

- Normalize a natural language prompt into one to three typed shots with stable plan IDs.
- Compile semantic camera actions into the existing Director camera trajectory and timeline contracts.
- Build a whitebox project that the existing Director preview and MP4 output paths can consume.
- Route Director camera language through the existing Agent Lane single-shot runtime and `director-cinematography` Skill before applying the typed plan.
- Apply updates atomically so an invalid plan preserves the last playable project; local shot edits retain stable IDs and one undo boundary.
- On success, hand the existing Director camera to the active POV and reset the playhead so the current Play/export paths are immediately usable.

## Reuse

`DirectorProject`, `DirectorCamera`, `Waypoint`, `TrajectoryClip`, `DirectorStore`, the existing scene renderer/timeline playback, and `useDirectorOutputs` remain the execution and export paths.

## Acceptance

- Repeating the same prompt produces the same plan/entity/shot/motion IDs.
- Push, pull, pan, tilt, orbit, follow, and target switch compile to editable keyframes with `lookAtObjectId`, duration, easing, and validation issues.
- A valid prompt produces a playable whitebox camera track; an invalid update returns an actionable error and the previous project unchanged.
- After a valid update, the compiled Director camera is the active POV and the existing Play button can start the timeline.
- A targeted edit changes only the addressed shot's timing/target/motion while preserving stable identities and one undo boundary.
- A walking/running subject is represented by the existing `ActionClip` track; no parallel animation runtime is introduced.
- Focused Vitest coverage exercises normalization, IDs, compilation, and preservation.

## Success metrics

- The natural-language request reaches the existing Agent Lane single-shot call with the installed `director-cinematography` Skill and is parsed into the typed plan boundary.
- The accepted result contains a playable `DirectorProject` with camera trajectory clips and the existing timeline can evaluate its waypoints.
- Invalid Skill output, invalid targets, or invalid durations leave the last playable project unchanged and return an actionable status.
- Local verification has evidence for focused tests, repository typecheck, targeted lint, and renderer production build; prior PR #960 Quality Gate run 4672 was green, including E2E.

## Non-goals

No new Agent runtime, renderer, timeline, MP4 encoder, generic Agent Builder, or persistence format is introduced.

## Verification and known blockers

- `node_modules/.bin/vitest run src/workbench/generationCanvas/nodes/director/model/directorPlan.test.ts src/workbench/generationCanvas/nodes/director/model/directorStore.test.ts src/workbench/generationCanvas/nodes/director/useAiSceneBuilder.test.ts` → 3 files, 36 tests passed.
- `node scripts/typecheck.mjs` → app, electron, electron-pi, and test-types all passed.
- Targeted ESLint → 0 errors; `node_modules/.bin/vite build --mode production` → 4692 modules transformed, built in 24.04s.
- `node scripts/git-delivery.mjs preflight` → passed with a clean worktree before this documentation-only follow-up.
- The full `node scripts/package-build-stamp.mjs build` remains blocked before compilation by `check:electron-install`: the managed environment's pnpm fallback cannot create `/home/agent/.local/share/pnpm` and then refuses module cleanup without a TTY. No dependency or runtime bypass was used.
