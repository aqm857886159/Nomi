# Director P0 acceptance record

This note records the local acceptance work for the Director P0 task. It is an evidence record, not a merge or release instruction.

## Passing walks

- `tests/ux/director-timeline-pointer.walk.mjs`: cancel, empty-row seek, and range selection pass against the production `TrackLanes` component. The fixture explicitly resets the document margin so screen pixels map to timeline seconds.
- `tests/ux/director-j2-walk-to-b.walk.mjs`: character path creation and playback pass.
- `tests/ux/director-j3-three-cameras.walk.mjs`: three cameras, POV, recorded camera path, close-up bake, undo, and live playback pass.
- `tests/ux/director-locale-edit.walk.mjs` with `NOMI_DIRECTOR_LOCALE=en`: English cold boot, character creation, and rename commit pass.
- `tests/ux/director-electron.walk.mjs`: real Electron reaches the editor, creates the scene, records a POV camera path through the visible Add Track / POV controls, records an MP4 through the timeline desktop bridge, sends the screenshot to canvas, runs staging capture, and verifies cold-start reopen with durable PNG/MP4 references.
- `tests/ux/director-j4-kneel-stand-look.walk.mjs`: action, standing playback, look-at, and IK bake now pass after the viewport picker guard described below.

## Resolved issues

- The real Electron run is green on the current product route. The old video composer `aria-label="运镜"` chip is intentionally absent from production; the walk now uses the Director timeline's Add Track → POV recording → 录制 MP4 path.
- The IK picker now rejects editor-only mesh-like helpers unless they expose a callable `raycast` method. This prevents Three's Raycaster from calling a missing method while preserving skinned-mesh filtering; `ViewCamera.test.ts` covers the regression.
