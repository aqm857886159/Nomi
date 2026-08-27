# Nomi Editing Engine Uplift

> 状态：🚧 进行中

## Decision

Use a layered build-and-buy strategy. Keep Nomi's TimelineState and adoption boundary as the only project truth, adopt the OpenChatCut/OpenCut capability vocabulary and transaction patterns, and evaluate external render/NLE backends behind an adapter. Do not embed another editor's store or UI.

## Evidence baseline

- Nomi currently exposes one timeline Agent tool, `arrange_storyboard_to_timeline` (`electron/harness/tools/canvasDescriptors.ts:364`), while capability routing is limited to canvas/storyboard groups (`electron/harness/agentChatPolicy.ts:35-43`).
- Nomi's persisted model is fixed image/video/audio tracks (`src/workbench/timeline/timelineTypes.ts:4-5,41-78`) with separate text clips and optional transition metadata.
- Pure timeline operations already exist for move, remove, split, nudge, and edge resize (`src/workbench/timeline/timelineEdit.ts:93-409`).
- Adoption already commits a complete timeline with one undo and verifies the write (`src/workbench/adoption/adoptionApply.ts:115-141`, `src/workbench/adoption/adoptionStorePorts.ts:38-86`).
- Revision and idempotency keys already exist (`src/workbench/adoption/adoptionProposalKey.ts:26-152`).
- OpenChatCut is TypeScript/React/Electron with Remotion and MCP, but is an AGPL application rather than a standalone editing SDK. Its timeline/reducer and external draft session are reference designs, not drop-in modules.
- OpenCut classic provides an MIT Rust/WASM compositor, while its TypeScript timeline and renderer remain application-coupled. MLT/libopenshot are the external NLE backend candidates; FFmpeg remains a media/render primitive, not a timeline model.

## Scope

In scope: timeline domain model, pure operations, EditPlan validation, preview/apply/undo contracts, renderer adapter, Agent/MCP descriptors, and capability tests.

Out of scope for this stream: Pi Agent runtime, MCPSQ page migration, `electron/main.ts`, preload/bridge ownership, React Flow canvas ownership, and unrelated UI redesign.

## Implemented Control Plane

The first safe slice is now implemented on the integration branch. `canvas-agent` receives five timeline tools in addition to the existing canvas tools:

| Tool | Side effect | Contract |
|---|---:|---|
| `read_timeline` | none | Compact canonical state, source windows, text, transitions, duration, stable revision |
| `inspect_timeline_range` | none | Only clips intersecting `[startFrame, endFrame)` |
| `propose_edit_plan` | none | Validate and preview an atomic P0 plan |
| `apply_edit_plan` | yes | User-approved plan, base-revision CAS, one adoption/undo entry; returns an Agent-bound undo token |
| `undo_timeline_edit` | yes | User-approved undo for the latest Agent plan, guarded by token and expected revision; never changes canvas nodes |

All five calls are routed through `applyCanvasToolCall` only as a compatibility entry point. The actual executor is `src/workbench/timeline/agent/timelineToolCall.ts`; it reads and commits through `workbenchAdoptionPorts`, and delegates operation semantics to the pure kernel. The Agent never receives a Zustand store handle or a renderer/native object.

The current operation vocabulary is intentionally small and executable: `move`, `remove` (optional same-track ripple), `split`, `trim`, `source-window`, and explicit `ripple`. Audio mixing, retime, transitions, effects, masks, keyframes, transcript/word timing, media search, preview/export and render verification are not advertised until their backend and parity tests exist. This avoids the common failure mode of exposing attractive tool names that silently drop fields.

The call sequence is fixed:

```text
read_timeline -> inspect_timeline_range -> propose_edit_plan -> user review
  -> apply_edit_plan (baseRevision CAS) -> preview/export verification
```

`propose_edit_plan` is validate-only and does not write. `apply_edit_plan` rejects stale revisions, applies the complete batch atomically, verifies the landed revision, and leaves the existing adoption undo contract intact. A failed commit attempts the existing compensation path; a second timeline store is never created.

### Revision, replay, and undo safety

- `timelineRevision()` is the canonical content hash for both Agent plans and adoption proposals. It covers normalized tracks, source windows, framing, text, URLs, transitions, and other persisted timeline fields; no second partial revision algorithm is allowed at this boundary.
- Tool results never expose `clip.url` or another local media path to the model provider. The Agent receives stable IDs and a boolean `sourceAvailable`; renderer-side asset resolution remains local.
- `apply_edit_plan` keeps a bounded, process-local registry keyed by active project scope, `planId`, and a stable plan signature. Repeating the same plan in the same project returns the original result without another write or undo entry. Reusing the ID for different content returns `plan_id_conflict`; the same ID in another project is a new plan. This registry is an in-process retry guard, not durable project history, and it is cleared at project ownership transitions.
- Successful apply returns `undoToken` and the landed `revision`. `undo_timeline_edit` requires both values and refuses to run if the timeline changed or another Agent plan superseded the token. User edits therefore cannot be overwritten by a stale Agent undo.
- Apply and Undo require a non-empty active project scope. Read-only inspection and validate-only proposals remain available while a project is hydrating, but no write is accepted until ownership is established.

## Delivery phases

### P0: editing kernel

- Add source-window normalization and invariant validation.
- Support move/reorder/remove/split/trim and optional ripple as pure batch operations.
- Define EditPlan operations, diagnostics, base revision, and idempotency.
- Reuse existing adoption commit/undo instead of adding a second store.

Acceptance: operations are immutable, deterministic, reject stale or invalid IDs, preserve clip/source ranges, and one applied plan creates one undo entry.

### P1: media correctness

- Implement real audio mixing, volume/fades/mute, retime, and source-audio handling.
- Make preview and export consume the same render manifest.
- Validate MP4 output with audio and frame-accurate source windows.

### P2: compositor capability

- Add transform/opacity/blend, effects, masks, keyframes, and real transitions.
- Run a bounded OpenCut-WASM compositor spike behind a renderer interface; keep a deterministic FFmpeg/native export path.

### P3: semantic editing

- Add transcript/word timing, media search, scene/shot analysis, speech rough cut, caption materialization, and music placement.

### P4: Agent and MCP

- Expose stable control tools: `read_timeline`, `inspect_timeline_range`, `propose_edit_plan`, `apply_edit_plan`.
- Add semantic tools: `read_transcript`, `find_transcript`, `search_media`, `inspect_source_range`.
- Add output tools: `preview_edit_plan`, `export_timeline`, `verify_render`.
- Keep low-level operations inside EditPlan rather than granting the Agent direct store access.

## Backend evaluation

Run the same fixture projects through the current renderer, FFmpeg, OpenCut-WASM, MLT, libopenshot, and (where licensing permits) Remotion. Compare source-window accuracy, transitions, audio, seeking, preview latency, export time, memory, Windows packaging, crash recovery, and license obligations. Select a backend only after the fixture matrix passes; no backend becomes a second timeline source.

## Branch and merge contract

- All work lands in independent sibling worktrees and topic branches.
- Timeline kernel changes are limited to `src/workbench/timeline/`, `src/workbench/adoption/`, and focused tests.
- Agent wiring is a separate adapter commit and must not modify Pi runtime or MCPSQ files.
- Renderer experiments stay behind an interface/feature flag until parity tests pass.
- Merge in order: domain contracts, pure operations, adoption integration, renderer adapter, Agent/MCP descriptors, then UI affordances.

## Rollback

Each phase is independently revertible. Before a backend is selected, Nomi can continue using its current renderer and timeline state. A failed backend spike must not alter persisted project data.
