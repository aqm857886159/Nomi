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
- Palmier Pro demonstrates a much broader, domain-sliced MCP inventory (timeline/project, media, tracks/clips, captions/transcript, audio/BGM/beat, effects and export), but its GPL-3.0 macOS Swift runtime is not a portable Nomi dependency. Use its catalog to drive staged capability coverage, not its store or project schema.

## Scope

In scope: timeline domain model, pure operations, EditPlan validation, preview/apply/undo contracts, renderer adapter, Agent/MCP descriptors, and capability tests.

Out of scope for this stream: Pi Agent runtime, MCPSQ page migration, `electron/main.ts`, preload/bridge ownership, React Flow canvas ownership, and unrelated UI redesign.

## Implemented Control Plane

The safe control and media-read slices are now implemented on the integration branch. `canvas-agent` receives ten editing tools in addition to the existing canvas tools:

| Tool | Side effect | Contract |
|---|---:|---|
| `read_timeline` | none | Compact canonical state, source windows, text, transitions, duration, stable revision |
| `inspect_timeline_range` | none | Only clips intersecting `[startFrame, endFrame)` |
| `propose_edit_plan` | none | Validate and preview an atomic P0 plan |
| `apply_edit_plan` | yes | User-approved plan, base-revision CAS, one adoption/undo entry; returns an Agent-bound undo token |
| `undo_timeline_edit` | yes | User-approved undo for the latest Agent plan, guarded by token and expected revision; never changes canvas nodes |
| `get_media` | none | Read one active-project asset by stable ID; no local path or URL leaves the renderer |
| `inspect_media` | none | Technical metadata only; it explicitly reports that semantic inspection was not performed |
| `search_media` | none | Project-scoped name/kind search with bounded results and stable IDs |
| `inspect_source_range` | none | Validate a source-frame range and find timeline usages at the current timeline FPS |
| `read_waveform` | none | Locally decode audio into bounded peak/RMS buckets; bytes stay local and failures are explicit |

All ten calls are routed through `applyCanvasToolCall` only as a compatibility entry point. Timeline control uses `src/workbench/timeline/agent/timelineToolCall.ts`; project media reads use the sibling `mediaToolCall.ts`. Timeline writes still commit through `workbenchAdoptionPorts` and delegate operation semantics to the pure kernel. The Agent never receives a Zustand store handle, renderer/native object, local media path, or media bytes.

The current operation vocabulary is intentionally small and executable: `move`, `remove` (optional same-track ripple), `split`, `trim`, `source-window`, and explicit `ripple`. The production FFmpeg path now renders authored same-track `dissolve`/`fade` transitions plus clip-local audio gain, mute, fade-in, and fade-out for standalone audio and embedded video audio. Preview media elements use the same decibel conversion and frame envelope. Project media search, technical inspection, source-range lookup, bounded waveform reads, and project-scoped Agent export job controls (`export_timeline`, `inspect_export_job`, `verify_render`, `cancel_export_job`) are real. Semantic scene/shot analysis, audio crossfade, retime, effects, masks, keyframes, and transcript/word timing remain gated until their backend and parity tests exist. This avoids the common failure mode of exposing attractive tool names that silently drop fields.

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
- Media reads require a non-empty active project too. Asset listing rejects cross-project records; responses are allowlisted and never contain `data.url`, `relativePath`, `absolutePath`, or media bytes. Waveform reads are capped at 256 buckets and 128 MB with bounded read/decode timeouts.

## Delivery phases

### P0: editing kernel

- Add source-window normalization and invariant validation.
- Support move/reorder/remove/split/trim and optional ripple as pure batch operations.
- Define EditPlan operations, diagnostics, base revision, and idempotency.
- Reuse existing adoption commit/undo instead of adding a second store.

Acceptance: operations are immutable, deterministic, reject stale or invalid IDs, preserve clip/source ranges, and one applied plan creates one undo entry.

### P1: media correctness

- Implemented real source-audio mixing plus clip-local `gainDb`, mute, fade-in, and fade-out for audio clips and video source audio. Old projects omit the optional field and keep unity-gain behavior.
- Preview and export share the canonical dB conversion and frame envelope. The Electron manifest strictly validates the resolved contract; malformed audio never silently falls back to WebM.
- A real bundled-FFmpeg integration fixture renders an audio timeline to MP4, verifies AAC with ffprobe, and measures the authored -6 dB center segment. Frame-accurate source-window coverage remains in the existing renderer tests.
- Retime remains outstanding. Preview and export do not yet consume one serialized manifest object; they consume the same persisted clip contract and pure audio semantics.
- Adjacent audio `acrossfade` is deliberately not synthesized from two independent fades. The fixed audio track currently rejects overlap and has no audio-transition entity, so real crossfade belongs in P2 after the model can represent its overlap window.

### P2: compositor capability

- Add a first-class audio-transition/overlap model and render real `acrossfade`; then add transform/opacity/blend, effects, masks, keyframes, and real `match_cut`/`whip_pan` transitions.
- Run a bounded OpenCut-WASM compositor spike behind a renderer interface; keep a deterministic FFmpeg/native export path.

### P3: semantic editing

- Project media search, technical inspection, source-range lookup, and waveform reads are implemented.
- Add transcript/word timing, scene/shot analysis, speech rough cut, caption materialization, and music placement.

### P4: Agent and MCP

- Expose stable control tools: `read_timeline`, `inspect_timeline_range`, `propose_edit_plan`, `apply_edit_plan`.
- Media tools implemented: `get_media`, `inspect_media`, `search_media`, `inspect_source_range`, `read_waveform`.
- Add semantic tools: `read_transcript`, `find_transcript`, scene/shot understanding, and speech-range search.
- Add output tools: `preview_edit_plan`, `export_timeline`, `inspect_export_job`, `verify_render`, and `cancel_export_job`.
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
