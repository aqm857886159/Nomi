# Canvas card stacks — approved design

Date: 2026-08-27
Baseline: Nomi v0.21.0 (`origin/main` refreshed through `8f9365ae`)
Status: approved in conversation; expanded after Issue #198 and the user-provided source review

## Problem

Repeated generations and grouped nodes currently use different, space-hungry visual languages. Image history expands into a grid, production video uses a separate strip, ordinary video history is incomplete, and a group remains a large frame even when the user only wants it parked out of the way. Duplicating a node for another creative direction also keeps old results but loses incoming graph context.

## Product decision

Use one physical metaphor—cards stacked behind a cover—while keeping two meanings explicit:

- **Version stack:** multiple media results from one node. Label is “N 版”.
- **Group stack:** multiple nodes collapsed for organization. Label is “N 节点” and carries a group marker.

Only the front card is square and interactive as content. Rear cards protrude to the right; nothing protrudes on the left. One result has no rear card, two results show one, and three or more show exactly two. Count communicates the real total.

Hover may fan the rear corners slightly and reveal a tooltip. Click is the primary action and opens the stack. Keyboard focus must expose the same action.

## Result stack

`NodeResultStack` replaces the image-only grid and the production-only version strip.

- Supports image and video results through `listNodeMediaResults`.
- Keeps history order stable. Choosing an old result updates the current pointer through `rollbackHistory`; it does not reorder the list.
- Opens an anchored tray with bounded rendering. It shows the first 12 entries and an explicit “show more” control.
- Each entry can preview, download, and delete that exact result.
- Deletion uses `deleteAssetResult`, so node history, project metadata, and disk state remain one transaction.
- Video cards use a still thumbnail when available. Hover playback is muted and only one preview is active; full playback uses `NodeMediaPreviewDialog` with native controls.
- Production-shot rerun remains an injected action in the same tray. No second version component survives.

The card corners sit behind the node, outside media content, so actions do not cover the image/video.

## Duplicate as variant

`duplicateNodeForRegeneration` becomes “duplicate as variant” rather than “copy the result card”. It:

- deep-clones editable node configuration, references, meta and size;
- preserves group/category identity and assigns a fresh shot number when required;
- copies every incoming edge to the new node with a new edge id while preserving source, mode, target parameter and order;
- clears result, history, runs, status, progress and error;
- creates the node and edges in one undoable gesture.

Generic clipboard copy/paste remains unchanged because preserving unselected external edges there would be surprising.

The action appears once in the existing selected-node floating toolbar for empty, image, video and panorama nodes. It reuses `duplicateNodeForRegeneration`; no parallel `duplicateNode` store action is introduced. The visible action is preferred over hidden Alt-drag duplication because it is discoverable and does not conflict with canvas movement.

## Collapsed groups

The existing optional `NodeGroup.collapsed` becomes functional.

- Expanded groups retain the current frame and gain one contextual collapse control in the group label.
- Collapsing does not move, merge, regenerate or rewrite member nodes. It only changes projection.
- The collapsed cover sits at the group’s existing top-left member position and derives its thumbnail from the most recently listed media-bearing member; otherwise it uses a neutral node-kind cover.
- Member nodes are hidden while collapsed. Internal edges are hidden. External edges remain projected toward the collapsed cover so graph connectivity is not silently lost.
- Dragging the cover moves all group members. Clicking its rear corner expands the group and restores every member at its persisted position.
- A collapsed group shows “N 节点” and a group marker. It never shows nested version corners; member version stacks return after expansion.

### Aggregate group connections

- The collapsed cover exposes one input handle on the left and one output handle on the right.
- Connecting once creates or reuses the existing persisted `inputLinks` / `outputLinks` declaration and its real `viaGroupId` member edges.
- Projection deduplicates those real edges into one aggregate line per declared relationship while the group is collapsed. It does not replace execution edges or invent a second graph schema.
- Expanding the group removes the visual aggregation and reveals the real member edges.
- Disconnecting the aggregate line removes the complete declared relationship through the existing group-aware disconnect action.
- Aggregate lines have a group relationship label and cannot pretend that one member's edge mode applies to every member.

## History video scrubbing

- A video history row keeps the current thumbnail-first loading behavior.
- Hover or keyboard focus mounts only the active preview and reveals a compact progress control.
- Pointer click seeks immediately; pointer capture plus movement provides continuous scrubbing.
- ArrowLeft and ArrowRight move exactly one second and clamp at the media boundaries.
- Seeking stops event propagation so the canvas does not select, drag or connect a node by accident.
- The control remains visible while focused and exposes current/duration values to assistive technology.

## Project and package behavior

- The project explorer collapses on a real non-empty `projectId` transition. Initial mount and same-project rerenders do not repeatedly override a user's expansion choice.
- Current Windows PNG/ICO artwork remains unchanged when deterministic validation confirms transparent corners and the required multi-size ICO entries. Validation, rather than a visually identical replacement file, closes the issue.

## Interaction and motion

- Front card remains unrotated.
- Rear layers use small positive rotations and spring back on hover/focus.
- Motion is transform/opacity only and respects reduced-motion preferences.
- At canvas zoom levels where full node content is disabled, card corners become a simple count badge rather than mounting media.
- Click targets remain at least the existing compact control size; the visible corner is not the entire hit area.

## Error and safety behavior

- If a historical asset cannot be resolved, keep the entry with an unavailable preview state; do not silently remove it.
- A failed download reports an error and leaves the stack open.
- A failed delete keeps the UI unchanged or restores it through the existing deletion rollback.
- Collapsing or expanding a group persists and participates in undo/redo.
- No history cap deletes data. Rendering is bounded, storage is not.

## Explicit non-goals

- No second copy API and no hidden Alt-drag-only workflow.
- No image-only history grid alongside `NodeResultStack`.
- No first-class persisted group endpoint that would force every renderer, executor and Agent path to learn a second graph schema.
- No image collage generation as part of grouping.
- No contributor-only Windows debug launcher in the product UX scope.

## Acceptance journeys

1. Generate three image versions; see at most two rear corners, open the tray, choose version one without history reorder, download version two, delete version three, reopen the project and see the same state.
2. Generate two ordinary video versions; hover one muted preview, open it in the full viewer, switch current, and download the non-current version.
3. Duplicate a connected image/video node as a variant; confirm incoming reference/keyframe edges are copied, old outputs are absent, and undo removes the new node and copied edges together.
4. Group three nodes, collapse them into one stack, drag the stack, expand it, and confirm all relative positions and external connections remain intact after reopen.
5. Connect one source to a collapsed group and one collapsed group to a target; see one line for each relationship, expand to inspect real member lines, collapse again, then disconnect the aggregate relation in one action.
6. Open a video history row, hover to play, click and drag the progress control, nudge one second with both arrow keys, then move the pointer away without selecting or moving the canvas node.
7. Expand the asset sidebar, switch projects and see it collapsed; reopen it and rerender the same project without having the app close it again.
8. Package for Windows and verify PNG/ICO alpha plus 16/24/32/48/64/128/256 icon entries before inspecting the installed shortcut/window icon.

## Self-review

- No placeholders or alternate implementations remain in scope.
- Version and group meanings are disambiguated by label, marker and expansion behavior.
- Storage history is never truncated merely to protect rendering performance.
- Existing safe asset deletion and full media preview are reused rather than duplicated.
