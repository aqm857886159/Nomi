# Canvas card stacks and friction fixes implementation plan

> 状态：✅ 已交付

## Scope

Replace parallel result-history UIs with one card stack, make group collapse and group-level connections real, and close the F1-F9 friction report on Nomi v0.21.0.

Reference material: the user-provided `Nomi-local.zip` (SHA-256 `8dcf884f6dd357df143b30028294ee009c0ad105d092e3f789c19bf39e310a2a`) was reviewed as untrusted, read-only AGPL source. Its useful mechanisms are reimplemented against the current unified stack; its parallel `duplicateNode` API and image-only stack are not copied.

## Do not change

- Generic clipboard copy/paste semantics.
- Generic persisted edge and group schemas.
- Current Windows icon artwork unless validation proves it invalid.
- Video player controls in the full preview; history scrubbing stays local to the history row.
- Provider/model request contracts.
- Hidden Alt-drag duplication and contributor-only debug launch scripts.

## Work sequence

1. Preserve the completed stable result-stack, clean duplicate data semantics and collapsed-group projection tests.
2. Add RED tests for one shared floating-toolbar duplicate action that calls `duplicateNodeForRegeneration`; do not add a second store API.
3. Add RED component tests for history-video click seek, continuous pointer scrub, focus-visible controls and ArrowLeft/ArrowRight one-second nudges.
4. Add RED project-switch tests: a changed non-empty `projectId` collapses the explorer; same-project rerenders do not overwrite the user's choice.
5. Extend the collapsed-group projection with one derived aggregate edge per persisted group input/output relation. Keep materialized member edges as execution truth and reveal them again when expanded.
6. Add collapsed-card input/output handles and route group-origin/group-target gestures through the existing group link declarations, undo journal and event log.
7. Make aggregate-edge disconnect remove the whole declared group relationship; mode editing remains available only on real member edges.
8. Add deterministic Windows icon verification for PNG/ICO transparency and required sizes; keep the current art when it passes.
9. Run focused tests, source/control/token/i18n/size gates, full typecheck/test/build.
10. Launch the built Electron app against a disposable project and run the complete F1-F9 plus group-port user journeys in light/dark mode, reopen the project, and inspect screenshots.

## Rollback

The change is isolated to canvas projection/store actions and can be reverted as one branch. Persisted `group.collapsed` is optional and already schema-compatible; older builds ignore it.

## Acceptance gate

- Card peeks max at two rear layers for any history size.
- Result switching does not reorder history.
- Historical media actions target the clicked result.
- Duplicate variant has no old output/run state and clones all incoming edges exactly once.
- Collapsed groups preserve node positions and connections across reopen.
- The selected node exposes one visible duplicate-as-variant action in its existing floating toolbar.
- A collapsed group accepts one input or output gesture, renders one aggregate line per relationship, and expansion restores the actual member lines.
- Scrubbing a history video does not select/move the node; click, drag and keyboard all update the exact hovered/focused video.
- Switching to another project collapses the explorer once; staying in the same project preserves the user's expanded state.
- Windows package icons pass transparent-corner and multi-size checks.
- No old image grid or production version strip remains.
- Real Electron screenshots match the approved right-only stack metaphor.
