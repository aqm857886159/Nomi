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

## Prompt → Playable Video Correspondence

This evaluation measures whether the user's prompt is reflected in the final playable Director preview (and, where exported, its MP4), rather than measuring only whether code, schemas, or tests pass. A green build is necessary evidence for the implementation, but it is not evidence that the requested scene, action, camera, timing, or framing survived the full planning-to-preview path.

### Expected director card

Before running each prompt, create an expected director card. It records the intended **scene**, **objects**, **object actions**, **camera/framing**, **shot count**, **duration**, **motion** (including direction and target switches), and **aspect ratio**. The card is the comparison oracle for the generated typed plan, whitebox scene, camera track, timeline, active POV, and optional MP4. Unspecified details remain unconstrained instead of being scored as failures.

### Correspondence metrics

- **Generation success rate**: accepted typed plan and playable `DirectorProject` divided by valid prompts. A run counts as successful only when the preview has scene content, camera trajectory clips, a timeline, and an active preview camera.
- **Prompt element correspondence**: weighted match between the expected card and the generated preview across scene, objects, actions, camera/framing, duration, motion/direction, target/look-at, shot count, and aspect ratio. Score each constrained field `1` (match), `0.5` (partially preserved or semantically equivalent), or `0` (missing/contradictory), then average the constrained fields.
- **Playable completeness**: the fraction of required preview components present and usable: whitebox scene, object action track when requested, editable camera path, shot clips, timeline duration, active POV, and Play-button startability. Missing any required component is a visible completeness failure even if the plan text looks correct.
- **Local modification accuracy**: for a prompt such as “second shot slower”, compare before/after cards and projects. The addressed shot must receive the requested timing/target/motion change while non-target shot IDs, targets, and tracks remain unchanged; the revision must be undoable in one step.
- **User cost**: record model turns, user corrections, explicit retries, visible waiting time, and clicks from prompt submission to playable preview. This measures whether the one-sentence path remains low-friction; it is not a claim that the current branch has already met a time budget.
- **Failure recoverability**: invalid plan/output, unknown target, or invalid duration must show an actionable error and preserve the prior playable project byte-for-byte at the project boundary. Recovery is scored separately from generation success.

### Proposed P0 prompt corpus

The initial corpus should cover a balanced cross-product of four contexts (**indoor**, **outdoor**, **product**, **character**) and two shot counts (**one-shot** and **three-shot**). Across every context/count cell, include the four required motion families: **push/pull**, **orbit**, **follow**, and **target switch**; vary direction, duration, and at least one Chinese and one English phrasing. This gives a proposed 32-prompt matrix (4 contexts × 2 shot counts × 4 motion families), with examples such as:

- Indoor one-shot: a character walks through a room, slow push in, keep the face centered.
- Outdoor three-shot: establish the street, follow the runner, then orbit right around the second subject.
- Product one-shot: orbit clockwise around a bottle for 4 seconds, then switch target to the label.
- Character three-shot: push in, track beside the actor, and cut to the second character.

Each prompt is annotated with its expected director card before execution. The corpus is an acceptance target and test design; no correspondence score from this matrix has been measured in this PR.

### Suggested P0 thresholds (not yet measured)

These are proposed gates for the first real prompt-corpus run, not reported results:

- generation success rate ≥ **90%** on valid prompts;
- mean prompt element correspondence ≥ **80%** across constrained card fields, with no required scene/camera/shot-count field at `0` on a successful run;
- playable completeness = **100%** for runs counted as generation successes;
- local modification accuracy ≥ **90%**, with stable non-target shot IDs and one-step undo on every passing case;
- failure recoverability = **100%** for deliberately invalid updates;
- user cost reported as median turns, retries, clicks, and elapsed time, with a follow-up decision on the budget after baseline collection rather than inventing a measured latency claim.

The current verification commands and evidence below validate the implementation contracts. They do not substitute for this prompt-to-preview measurement, which remains to be run.

## Non-goals

No new Agent runtime, renderer, timeline, MP4 encoder, generic Agent Builder, or persistence format is introduced.

## Verification and known blockers

- `node_modules/.bin/vitest run src/workbench/generationCanvas/nodes/director/model/directorPlan.test.ts src/workbench/generationCanvas/nodes/director/model/directorStore.test.ts src/workbench/generationCanvas/nodes/director/useAiSceneBuilder.test.ts` → 3 files, 36 tests passed.
- `node scripts/typecheck.mjs` → app, electron, electron-pi, and test-types all passed.
- Targeted ESLint → 0 errors; `node_modules/.bin/vite build --mode production` → 4692 modules transformed, built in 24.04s.
- `node scripts/git-delivery.mjs preflight` → passed with a clean worktree before this documentation-only follow-up.
- The full `node scripts/package-build-stamp.mjs build` remains blocked before compilation by `check:electron-install`: the managed environment's pnpm fallback cannot create `/home/agent/.local/share/pnpm` and then refuses module cleanup without a TTY. No dependency or runtime bypass was used.
