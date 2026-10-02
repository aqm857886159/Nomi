# Director real-user journey protocol

This is the human portion of the Director goal-alignment evaluation. It is a protocol, not a measured result. Run it with a fresh project and record the exact case ID, prompt, commit SHA, run ID, and evidence paths.

## Setup

- Use the real Nomi Electron app and the existing Director entry point.
- Select one target case from `prompt-cases.v1.json`; do not paraphrase the prompt during the run.
- Start a timer before submitting the prompt. Prepare a screenshot directory and a report input JSON for `scripts/eval-director.mjs report`.
- If the Runtime/Lane, Skill, Tool, MCP connection, model, or media asset is unavailable, stop and record `blocked` with the exact owner and error. Do not replace it with a mock and call the journey passed.

## Journey and observations

| Step | Tester action | Observe and record | Pass condition |
|---|---|---|---|
| 1. Input | Submit the target prompt once | Prompt, run ID, commit, model/runtime path | The submitted text exactly matches the case |
| 2. Generate | Wait for generation to finish | Error/retry state, Director card, elapsed time | The app reports a completed generation or an explicit recoverable failure |
| 3. Whitebox | Inspect the Director viewport before playing | Scene, required object(s), object labels/placement, aspect guide | The whitebox scene contains the required scene and object elements |
| 4. Play | Click Play | Preview, object motion, camera motion, playhead, duration | Playback starts and the requested object/action and camera motion are visible |
| 5. Timeline | Inspect shot strip, timeline, and camera path | Shot count/order, timing, camera path/waypoints | The strip/timeline/path represent the expected Director card |
| 6. Local edit | Change only the requested local target (for example, the mug or the camera move) | Before/after screenshots, unrelated scene/timing/camera state | The requested target changes and unrelated state remains stable |
| 7. Replay | Play the edited result again | Edit persistence, playback, recoverability | The edited scene replays without losing the last good state |
| 8. Export/hand-off | Use the existing export or "send to canvas" hand-off | Output handle/node, aspect, duration, error state | Export/hand-off is reachable and reports a durable result or explicit blocker |

## Marking rules

- **Pass** only when all required elements are observed and the local edit/replay/export steps complete for the target case.
- **Fail** when the app completes but the prompt is not represented, a required motion/surface is missing, the edit changes unrelated state, or the result cannot be replayed.
- **Blocked** when a required environment or existing owner is unavailable (for example, no authorized model, missing media, or app launch failure). Preserve the error text.
- **Unverified** when automated checks pass but the tester could not inspect the real user-visible path. Never convert this to pass from unit-test output.

## Evidence record

Capture at minimum: generation/card, whitebox viewport, playing preview, timeline/camera path, post-edit replay, and export/hand-off. Store screenshots/video under the run evidence directory and reference them in the report. The report separates automated checks from human judgments; a human judgment includes a 0–4 score and a short note tied to the rubric dimension.

## Runtime/Skill/Tool boundary

The tester observes the existing `electron/agentLane/` Runtime/Lane and the existing Director/AI Skill/Tool path. This protocol does not ask the tester to invoke a new skill, MCP server, or provider. Tool calls and errors are evidence; they are not permission to bypass the existing approval or lease contracts.
