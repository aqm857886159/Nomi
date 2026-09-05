# T1 editing panel system

> 🚧 进行中

## Scope

- Replace the preview surface with a resizable five-region layout backed by `workbenchStore`.
- Expose layout read/write through the existing reversible local Agent capability surface.
- Make transport controls minimal and move export to the top-right action.
- Add the inspector states and route clip audio edits through `timelineKernel` and the existing undo path.

## Not in scope

- Transition picker implementation (T2 owns the selector).
- New media generation, timeline track design, or changes to the Nomi assistant runtime.
- Removing the generation workspace's legacy resize handle, which remains outside the preview surface.

## Rollback

Revert this branch commit. Layout state is additive and defaults to the existing preview proportions; clip audio writes are validated by the kernel before persistence.

## Acceptance

- `react-resizable-panels` layout has five contract regions, persisted dimensions, collapsible inspector/assistant, presets, and `⌘\\` assistant toggle.
- Pi and MCP layout descriptors share the same contract and reversible receipt.
- Transport contains playback, stepping, timecode, captions, volume, and fullscreen only.
- Inspector edits resolution/quality and clip audio; invalid image audio is rejected by kernel validation.
- Typecheck, build, i18n, lint, focused tests, gates, and an Electron UX screenshot are recorded.
