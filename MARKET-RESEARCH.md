# Video Editing Engine Market Review

Date: 2026-08-28
Scope: open-source editing cores, media backends, timeline interchange, and AI-agent integration relevant to Nomi (Electron + React + TypeScript).

## Executive decision

There is no single open-source project that can be dropped into Nomi and provide a CapCut-class editor without replacing the application model. The market splits the problem into layers:

```text
timeline semantics / undo / proposals       (application-owned)
media decode, encode, mux, probe              (FFmpeg, MediaBunny, WebCodecs)
composition and effects                      (WebGL/WASM, MLT, GES, libopenshot)
interchange                                  (OpenTimelineIO)
agent control                                (application-owned EditPlan/MCP)
```

The recommended build-vs-buy decision is:

1. Keep Nomi `TimelineState`/`EditPlan` as the only project truth and keep all edits atomic and undoable.
2. Reuse **MediaBunny** (MPL-2.0) for TypeScript media inspection, browser/Electron decode, trim/transcode and muxing where it passes our format tests.
3. Keep **FFmpeg** (LGPL build, with GPL components disabled unless deliberately accepted) as the production worker for broad codec/filter coverage, probing and final export. Nomi already packages FFmpeg/FFprobe installers.
4. Add an OTIO (Apache-2.0) import/export adapter at the boundary. OTIO is a schema and algorithm library, not a renderer.
5. Run a small compositor POC with WebAV or OpenCut WASM for responsive preview. Do not import OpenCut's store, UI, or command graph.
6. Evaluate MLT and libopenshot only behind a JSON worker protocol after P0/P1. They are the only candidates here that resemble a native NLE engine, but both have substantial native packaging and data-model mapping costs.
7. Do not embed Olive (GPL-3.0/alpha), OpenChatCut (AGPL-3.0), or OpenCut classic (archived) code in a proprietary/current Nomi path. Their architecture and agent workflow remain useful references.

This gives a fast capability increase without introducing a second timeline truth source or coupling the Pi Agent/MCPSQ branches to a native editor runtime.

## Method and current status

Repository metadata, source trees, headers and package manifests were inspected through GitHub CLI (`gh api`/`gh search repos`) on 2026-08-28. The source links below point to the files that were checked. GitHub timestamps are current repository metadata, not a promise of release stability.

## At-a-glance matrix

| Project | License observed | What it actually provides | Electron + TypeScript integration | Fit for Nomi |
|---|---|---|---|---|
| [MLT](https://github.com/mltframework/mlt) | LGPL-2.1 (core); some modules/dependencies vary | Native service graph: producers, playlists, multitrack, tractor, filters, transitions, consumers | Native C/C++ worker or Node-API wrapper; ship per-OS plugins and dependencies | Strong native NLE candidate, high integration cost |
| [GStreamer + GES](https://github.com/GStreamer/gstreamer) | Core/GES headers use LGPL/LGPL-2.1; plugins vary | Streaming/media graph; GES adds timeline, layers, tracks, clips and editing commits | Native worker is realistic; direct N-API is expensive; Meson/Cerbero packaging | Good for live/streaming and custom pipelines, not the fastest NLE path |
| [libopenshot](https://github.com/OpenShot/libopenshot) | LGPL-3.0-or-later | C++ Timeline/Clip/Reader/Writer, compositing, effects, curves, retime, audio mixing | Native worker or C++ bridge; CMake + FFmpeg/OpenCV/Qt dependencies | Most feature-rich native library candidate; high packaging and API risk |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | LGPL-2.1+ by default; optional GPL parts | Codec/container/filter/probe libraries and CLI; no timeline/undo model | Existing child-process worker is low cost; use safe argv and progress parsing | Production render/probe foundation, not an editor model |
| [OpenTimelineIO](https://github.com/AcademySoftwareFoundation/OpenTimelineIO) | Apache-2.0 | Timeline/track/clip/time/effect/transition schema, algorithms and adapters | C++/Python process or library; JSON `.otio` boundary is simple | Excellent interchange and validation boundary |
| [Remotion](https://github.com/remotion-dev/remotion) | Custom free/company license; company license may be required | React composition, Player and Node renderer using headless Chromium + FFmpeg | Excellent TS/Electron fit; no mutable NLE timeline/undo | Preview/export layer, not core editor state |
| [Olive](https://github.com/olive-editor/olive) | GPL-3.0 | Full Qt/C++ editor with node graph, sequence, render manager and undo commands | Embedding means embedding the application and GPL obligations | Reference only; README calls it alpha/unstable |
| [WebAV](https://github.com/WebAV-Tech/WebAV) | MIT | WebCodecs clips/sprites/canvas, audio mixing and MP4 output | Very low cost in Electron/browser; TS packages | Useful preview/fast path; incomplete as a professional NLE core |
| [Mediabunny](https://github.com/Vanilagy/mediabunny) | MPL-2.0 | Pure TS demux/mux, WebCodecs encode/decode, conversion, trim, resample | Very low; native/browser/Node support, tree-shakable | Best media-I/O component to validate first; no timeline model |
| [OpenCut main](https://github.com/OpenCut-app/OpenCut) | MIT | Rewrite in Rust/WASM with planned Editor API, plugins, MCP, headless mode | Not ready as a stable embed; Rust/WASM boundary still moving | Roadmap/reference; do not depend on main yet |
| [OpenCut classic](https://github.com/OpenCut-app/opencut-classic) | MIT, archived | Rich TS timeline manager and command/update pipeline | Code can be read, but repository is archived and app-coupled | Capability and algorithm reference only |
| [OpenChatCut](https://github.com/0xsline/OpenChatCut) | AGPL-3.0-or-later | Immutable EditorCore, Remotion/WebGL/FFmpeg, proposal-based MCP/Agent edits | Similar product shape, but AGPL and tightly coupled runtime | Agent protocol reference; do not copy code into Nomi |
| [LosslessCut](https://github.com/mifi/lossless-cut) | GPL-2.0-only | Electron + FFmpeg lossless segment cutting and packaging | Useful packaging/worker patterns | Reference for lossless operations, not compositing |

## Detailed findings

### MLT: closest mature native NLE substrate

MLT's README describes it as an LGPL multimedia framework designed for video editing. The public C API is an object/service graph:

- `mlt_producer` generates audio/video/metadata and exposes speed, in/out points, cuts and attached filters ([header](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_producer.h)).
- `mlt_playlist` is a sequential producer with append/insert/remove/move/reorder/resize/split/mix and blank management ([header](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_playlist.h)).
- `mlt_multitrack` runs producers in parallel; `mlt_tractor` manages multitrack plus a `mlt_field`; `mlt_field` plants filters and transitions ([multitrack](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_multitrack.h), [tractor](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_tractor.h), [field](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_field.h)).
- Transitions are first-class services between A/B tracks ([header](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_transition.h)). MLT also has an XML parser and the `melt` CLI.

**Strengths:** proven multi-track primitives, filters/transitions, hardware/plugin ecosystem, and LGPL core. Shotcut uses the same MLT stack; this is evidence that MLT can support a desktop NLE.

**Costs:** C object lifetime/threading, plugin discovery, FFmpeg/SDL/OpenGL/audio dependencies, profiles and XML semantics, and per-OS native packaging. MLT's playlist index/time model is not Nomi's stable clip-ID/source-window model. A direct store bridge would create a second truth source and make Agent proposals hard to validate.

**Nomi recommendation:** evaluate as a sidecar worker. Serialize a validated Nomi render plan to a small MLT XML/JSON adapter, run `melt` or a dedicated worker, collect progress/errors and compare output against the FFmpeg backend. Do not expose MLT objects to the renderer or Agent.

### GStreamer + GStreamer Editing Services (GES)

The current `GStreamer/gstreamer` repository contains official modules under `subprojects`; the old `GStreamer/gst-editing-services` repository states that GES was merged into the main repository. The core README uses Meson/Ninja and notes that plugin licenses/dependencies vary (some optional plugins are GPL).

GES adds an editing abstraction over the GStreamer graph:

- `GESTimeline` owns layers/tracks and supports load/save URI, add/remove layers/tracks, commit (including synchronous commit), snapping, frame/time conversion and paste/move-layer ([header](https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-editing-services/ges/ges-timeline.h)).
- `GESLayer` owns ordered clips and supports add/remove, interval queries, duration and auto-transition ([header](https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-editing-services/ges/ges-layer.h)).
- `GESClip` supports track elements, effects and split; timeline/source time conversion is explicit ([header](https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-editing-services/ges/ges-clip.h)).

**Strengths:** mature streaming, hardware/device integration, explicit nanosecond timestamps, and an actual editing layer (GES) instead of only a filter graph.

**Costs:** GLib/GObject ownership and signals, broad plugin matrix, Meson/Cerbero cross-platform packaging, and pipeline state/error handling. GES is attractive for capture/live/streaming products, but a Nomi adapter would still have to define IDs, undo, stale revision checks and Agent-safe transactions.

**Nomi recommendation:** reserve for a live-capture or streaming backend. Do not choose it as the first replacement for Nomi's local NLE export path.

### libopenshot: broad native editing API, but heavy integration

The README advertises cross-platform C++ APIs (C++, Python and Ruby), multi-layer compositing, effects, Bézier animation curves, curve-based time mapping, audio mixing/resampling, VST/AU plug-ins, FFmpeg formats/codecs, hardware acceleration and a Qt player. The source tree contains `Timeline`, `Clip`, `ReaderBase`, `WriterBase`, `FFmpegReader`, `FFmpegWriter`, `FrameMapper`, `AnimatedCurve`, effect and audio classes ([source tree](https://github.com/OpenShot/libopenshot/tree/develop/src)).

**Strengths:** closest to a library-shaped NLE core in this survey; many capabilities already exist below the UI, including retime, compositing, effects and audio.

**Costs:** CMake/native ABI, FFmpeg/OpenCV/ImageMagick/OpenMP and optional Qt/audio dependencies; object lifetime and thread model; project formats and APIs are OpenShot-shaped rather than Nomi-shaped. The README also advertises commercial licenses, so license/compliance should be checked with counsel before shipping a proprietary product.

**Nomi recommendation:** candidate for a time-boxed native worker POC after Nomi's render-plan contract is stable. Use a process protocol (JSON request + output artifact + diagnostics), not direct bindings in React/Electron. Only adopt if it demonstrates measurable wins for effects/audio/render parity without forcing its Timeline model into Nomi.

### FFmpeg: indispensable media backend, not a timeline engine

FFmpeg's README lists `libavcodec`, `libavformat`, `libavfilter`, `libavdevice`, `libswresample`, `libswscale` and the `ffmpeg`/`ffprobe` tools ([README](https://github.com/FFmpeg/FFmpeg/blob/master/README.md)). The license file says the default codebase is LGPL-2.1-or-later; enabling GPL parts changes the resulting build to GPL, and `--enable-nonfree` may make a binary unredistributable ([license](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md)).

**Strengths:** format/codec coverage, deterministic filter graphs, hardware encoders, probe metadata, mature CLI and worker isolation. It is already present in Nomi's installer configuration and desktop bridge.

**Limits:** no stable clip IDs, timeline semantics, project model, proposal/undo, or visual preview. Filter graphs become difficult to maintain when they are generated directly from unvalidated Agent output.

**Nomi recommendation:** retain as the production renderer/prober behind a typed `RenderPlan` generated from validated `TimelineState`. Pin/configure a known LGPL build; document any GPL/nonfree codec choices. Never pass untrusted shell strings; use argv arrays and explicit temp directories.

### OpenTimelineIO (OTIO): interoperability, not rendering

OTIO is an Academy Software Foundation project under Apache-2.0. Its C++ API models a `Timeline` containing a `Stack` of `Track`s; tracks contain `Clip`s with `MediaReference`, source ranges, effects, markers and metadata ([timeline](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/src/opentimelineio/timeline.h), [track](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/src/opentimelineio/track.h), [clip](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/src/opentimelineio/clip.h)). It ships C++ and Python bindings, adapters (OTIO JSON/OTIOZ, FCP XML, AAF and others), and trim/range algorithms.

**Strengths:** neutral time/rational model, nested composition, metadata extensibility and interchange ecosystem; permissive license.

**Limits:** no decoder, compositor, audio mixer or final renderer; metadata conventions still need an application contract. OTIO's object graph is not an undo store.

**Nomi recommendation:** add an `otio` import/export adapter around Nomi's canonical state. Preserve Nomi IDs and unsupported fields in namespaced metadata, warn on lossy conversion, and use OTIO as a compatibility artifact for external NLEs/Agent tools.

### Remotion: high-quality React render path with a commercial license boundary

Remotion is TypeScript/React video composition. The renderer package exposes `renderMedia()` and renders frames in a headless browser before stitching/encoding with FFmpeg ([package manifest](https://github.com/remotion-dev/remotion/blob/main/packages/renderer/package.json), [renderer source](https://github.com/remotion-dev/remotion/blob/main/packages/renderer/src/render-media.ts)). Its current license is custom: individuals, non-profits and for-profit organizations up to three employees may use it free; larger for-profit organizations require a company license, and copying/modifying it to sell/relicense a derivative is disallowed ([license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)).

**Strengths:** excellent TS/Electron ergonomics, declarative compositions, browser parity, captions/graphics/templates and a proven render API.

**Limits:** Remotion's `Sequence`/composition tree is not a mutable NLE timeline with ripple edits, source windows, track locking, proposal revisions or native media conforming. Render startup and Chromium memory are material costs.

**Nomi recommendation:** use only as a preview/export adapter for generated compositions or motion graphics if the commercial license is acceptable. Keep the Nomi timeline and convert it into a Remotion composition; never let Remotion state become the project source of truth.

### Olive: architectural reference, not an embeddable core

Olive is a GPL-3.0 C++/Qt application. Its README explicitly labels the current software alpha and highly unstable. The source has a `Sequence` node owning track lists, Qt/OpenGL rendering, a render manager and many undo commands for split/ripple operations ([sequence](https://github.com/olive-editor/olive/blob/master/app/node/project/sequence/sequence.h), [ripple undo](https://github.com/olive-editor/olive/blob/master/app/timeline/timelineundoripple.h), [split undo](https://github.com/olive-editor/olive/blob/master/app/timeline/timelineundosplit.h)).

It demonstrates a capable command/undo architecture, but embedding would mean taking a GPL application with Qt/OpenGL/FFmpeg/OpenColorIO/OpenImageIO dependencies. It is not a safe fast path for Nomi.

### WebAV: WebCodecs compositor and editor primitives

WebAV is MIT and explicitly supports Edge/Chrome and Electron. `@webav/av-cliper` models media as `IClip` (`MP4Clip`, `AudioClip`, `ImgClip`, subtitle clips), attaches temporal/spatial state through sprites, and uses `Combinator` to output MP4. `AVCanvas` provides drag/scale/rotation/time-offset interaction and can capture a `MediaStream` ([README](https://github.com/WebAV-Tech/WebAV/blob/main/README.md), [Combinator](https://github.com/WebAV-Tech/WebAV/blob/main/packages/av-cliper/src/combinator.ts), [AVCanvas](https://github.com/WebAV-Tech/WebAV/blob/main/packages/av-canvas/src/av-canvas.ts)).

**Strengths:** small TS surface, no native build, responsive WebCodecs path, basic multi-sprite audio/video/text compositing and MP4 muxing.

**Limits:** browser codec support, no full NLE command/session model, limited effects/transition ecosystem and no broad native fallback. Long timelines and complex audio require careful memory/backpressure tests.

**Nomi recommendation:** good candidate for a preview/compositor POC and simple local export fallback. Do not replace Nomi's timeline model with sprites.

### Mediabunny: best current TypeScript media-I/O candidate

Mediabunny is a pure TypeScript toolkit under MPL-2.0. Its README claims MP4/MOV/WebM/MKV/HLS/WAVE/MP3 and other formats, WebCodecs hardware acceleration, microsecond precision, streaming I/O, Node/Bun/Deno support and conversion operations such as trim/resample/resize ([README](https://github.com/Vanilagy/mediabunny/blob/main/README.md)). The API exports `Input`, `Output`, `Conversion`, track/sample sinks, `CanvasSource`, audio/video sources and multiple mux formats ([index](https://github.com/Vanilagy/mediabunny/blob/main/src/index.ts)).

**Strengths:** low integration cost, tree-shakable, browser/Electron/Node compatibility, explicit timestamp validation, and a permissive weak-copyleft license. OpenCut classic already uses Mediabunny for media and audio work.

**Limits:** it is not a timeline/editor/transition engine; WebCodecs availability and codec support remain platform-dependent; visual effects still belong in Canvas/WebGL/WASM or FFmpeg.

**Nomi recommendation:** evaluate first for probe, thumbnail/filmstrip, audio decode, frame extraction, trim and mux. Keep FFmpeg as the fallback and production reference until an automated format matrix proves parity.

### OpenCut and OpenChatCut: reference architectures, not drop-in cores

OpenCut's current MIT `main` README says it is being rewritten from the ground up and lists Rust core, Editor API, plugins, MCP and headless mode as the target architecture; it points users to the archived classic version for today's usable app ([README](https://github.com/OpenCut-app/OpenCut/blob/main/README.md)). The classic repository is archived and MIT. Its TypeScript timeline has video/text/audio/graphic/effect track types, stable element IDs, trim/source ranges, retime, effects/masks/keyframes, track mute/visibility, and a `TimelineManager` that routes operations through commands, batch history, preview overlay and commit/discard ([types](https://github.com/opencut-app/opencut-classic/blob/main/apps/web/src/timeline/types.ts), [manager](https://github.com/opencut-app/opencut-classic/blob/main/apps/web/src/core/managers/timeline-manager.ts), [update pipeline](https://github.com/opencut-app/opencut-classic/blob/main/apps/web/src/timeline/update-pipeline.ts)).

OpenChatCut is AGPL-3.0 and has the closest product shape to Nomi: immutable timeline state, an `EditorCore` command layer, Remotion/WebGL/FFmpeg, local projects and proposal-based MCP edit sessions. Its README describes `begin_edit_session -> read/edit draft -> review_edit_session -> atomic apply/one undo`, plus specialized timeline/audio/transcript/caption tools ([README](https://github.com/0xsline/OpenChatCut/blob/main/README.md)).

**Nomi recommendation:** copy the capability inventory, update-rule ideas, render-plan boundaries and proposal protocol concepts. Do not copy application code or make OpenCut/OpenChatCut a runtime dependency. OpenChatCut's AGPL network/source obligations and both projects' application-coupled stores make that especially risky.

## How the market composes the pieces

Observed product patterns:

- Kdenlive and Shotcut use MLT as a native NLE substrate; the application owns project/UI/undo semantics while MLT supplies service graphs, effects and rendering.
- OpenShot owns a C++ library (`libopenshot`) and a separate Qt application.
- Browser/Electron editors increasingly use WebCodecs + Canvas/WebGL/WASM + a JS muxer (WebAV, Mediabunny, OpenCut's WASM direction).
- Remotion-based products make a React composition the render artifact and keep their own editor state outside Remotion.
- OTIO is used for interchange between systems, not as a live rendering core.
- FFmpeg remains the compatibility and final-export escape hatch even when preview uses a browser/GPU path.
- Agent-first editors put all model actions through validated command/proposal layers; they do not let the model mutate a UI store directly.

## Recommended Nomi target architecture

```text
TimelineState (唯一事实源)
  -> pure EditOperations + validator + revision/idempotency
  -> EditPlan / one transaction / one undo
  -> RenderPlan (stable, explicit source windows, effects, audio, captions)
       |-> WebAV/WebGL/WASM preview adapter (optional)
       |-> Mediabunny WebCodecs media I/O adapter (optional fast path)
       |-> FFmpeg worker (production/reference export)
       |-> MLT/libopenshot worker (experimental native backend)
  -> OTIO import/export adapter
  -> Agent/MCP: read -> inspect -> propose -> review -> apply -> verify
```

Hard boundaries:

- React/Zustand and Agent code never hold native MLT/GES/libopenshot objects.
- A backend receives a versioned `RenderPlan`, not the mutable store.
- Preview and export consume the same semantic plan; backend-specific diagnostics are returned to the UI.
- Backend selection is per job and capability-tested, not a hidden fallback that can change output silently.
- The Pi Agent runtime, MCPSQ migration and Electron bridge remain untouched while the renderer evaluation is isolated.

## Phased execution and gates

### P0: contract and parity fixture

- Freeze Nomi timeline fields: stable IDs, half-open frame/time ranges, source window, retime, framing, transitions, audio gain/mute, captions and revision.
- Define `RenderPlan v1` and diagnostics/error codes.
- Build fixtures with cuts, overlays, audio, captions, trim, speed, fades and one transition.
- Acceptance: deterministic plan hash; no backend mutates `TimelineState`.

### P1: reuse low-risk TypeScript media primitives

- Add a MediaBunny adapter for probe, thumbnails, audio decode and simple trim/mux.
- Keep FFmpeg probe/export as the reference and fallback.
- Acceptance: format matrix on Windows/macOS/Linux/Electron; frame-accurate trim; audio/video duration and color checks.

### P2: preview/export parity

- POC WebAV or OpenCut WASM compositor for one clip + overlay + opacity/effect + audio.
- Compare sampled preview frames and exported frames against FFmpeg reference with tolerances.
- Acceptance: no blank frames, bounded memory, cancellation, resource cleanup, and identical timeline semantics.

### P3: native backend spike (only if needed)

- Implement the same `RenderPlan v1` through MLT and libopenshot workers.
- Measure startup, export speed, memory, hardware acceleration, transitions/effects/audio coverage, crash isolation and package size.
- Select a backend only if it beats the TS/FFmpeg combination on a defined workload and has acceptable licensing/compliance.

### P4: capability expansion

- Move/remove/reorder/ripple/split/trim/source window and retime first.
- Then multi-track audio/mixing/ducking, transform/effects/masks/keyframes/transitions, transcript/word timing and caption materialization.
- Every operation is a pure edit operation and can be represented in an `EditPlan`.

### P5: Agent/MCP integration

- Stable controls: `read_timeline`, `inspect_timeline_range`, `propose_edit_plan`, `apply_edit_plan`.
- Semantic reads: transcript, media search, source-range inspection.
- Output/verification: preview plan, export plan, verify render.
- Enforce base revision, stable IDs, idempotency keys, validate-only mode and one Undo per applied plan.

## Decision gates and risks

| Gate | Pass condition | Stop/rollback condition |
|---|---|---|
| License | SPDX inventory and binary notices are acceptable | GPL/AGPL/custom commercial terms cannot be accepted |
| API fit | Adapter can express all P0 operations without hidden state | Backend requires UI/store ownership or lossy fields |
| Parity | Preview/export match the same `RenderPlan` on fixture matrix | Backend output differs or silently drops audio/effects |
| Performance | Measured improvement on representative long/multi-track jobs | Startup/memory/package cost outweighs gain |
| Reliability | Cancellation, crash isolation, retries and temp cleanup are deterministic | Native crash can corrupt project or block renderer |
| Maintenance | Active upstream, pinned version and upgrade test | Archived/unmaintained code becomes a core dependency |

Main risks are native binary distribution, FFmpeg codec licensing, browser WebCodecs variance, audio retime/mixing quality, GPU driver differences and accidental second timeline state. These are why backend experiments must stay behind the versioned plan and process boundary.

## Sources checked

- MLT: [README](https://github.com/mltframework/mlt/blob/master/README.md), [producer](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_producer.h), [playlist](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_playlist.h), [multitrack](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_multitrack.h), [tractor](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_tractor.h), [transition](https://github.com/mltframework/mlt/blob/master/src/framework/mlt_transition.h).
- libopenshot: [README](https://github.com/OpenShot/libopenshot/blob/develop/README.md), [source tree](https://github.com/OpenShot/libopenshot/tree/develop/src).
- GStreamer/GES: [README](https://github.com/GStreamer/gstreamer/blob/main/README.md), [GES timeline](https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-editing-services/ges/ges-timeline.h), [GES clip](https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-editing-services/ges/ges-clip.h), [GES layer](https://github.com/GStreamer/gstreamer/blob/main/subprojects/gst-editing-services/ges/ges-layer.h).
- FFmpeg: [README](https://github.com/FFmpeg/FFmpeg/blob/master/README.md), [license](https://github.com/FFmpeg/FFmpeg/blob/master/LICENSE.md).
- OTIO: [README](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/README.md), [Timeline](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/src/opentimelineio/timeline.h), [Track](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/src/opentimelineio/track.h), [Clip](https://github.com/AcademySoftwareFoundation/OpenTimelineIO/blob/main/src/opentimelineio/clip.h).
- Remotion: [license](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), [renderer package](https://github.com/remotion-dev/remotion/blob/main/packages/renderer/package.json), [renderMedia](https://github.com/remotion-dev/remotion/blob/main/packages/renderer/src/render-media.ts).
- Olive: [README](https://github.com/olive-editor/olive/blob/master/README.md), [Sequence](https://github.com/olive-editor/olive/blob/master/app/node/project/sequence/sequence.h), [ripple undo](https://github.com/olive-editor/olive/blob/master/app/timeline/timelineundoripple.h).
- WebAV: [README](https://github.com/WebAV-Tech/WebAV/blob/main/README.md), [AVCliper](https://github.com/WebAV-Tech/WebAV/tree/main/packages/av-cliper), [Combinator](https://github.com/WebAV-Tech/WebAV/blob/main/packages/av-cliper/src/combinator.ts), [AVCanvas](https://github.com/WebAV-Tech/WebAV/blob/main/packages/av-canvas/src/av-canvas.ts).
- Mediabunny: [README](https://github.com/Vanilagy/mediabunny/blob/main/README.md), [exports](https://github.com/Vanilagy/mediabunny/blob/main/src/index.ts).
- OpenCut: [rewrite README](https://github.com/OpenCut-app/OpenCut/blob/main/README.md), [classic README](https://github.com/opencut-app/opencut-classic/blob/main/README.md), [classic timeline types](https://github.com/opencut-app/opencut-classic/blob/main/apps/web/src/timeline/types.ts), [classic manager](https://github.com/opencut-app/opencut-classic/blob/main/apps/web/src/core/managers/timeline-manager.ts), [classic update pipeline](https://github.com/opencut-app/opencut-classic/blob/main/apps/web/src/timeline/update-pipeline.ts).
- OpenChatCut: [README](https://github.com/0xsline/OpenChatCut/blob/main/README.md), [license](https://github.com/0xsline/OpenChatCut/blob/main/LICENSE).
- LosslessCut: [README](https://github.com/mifi/lossless-cut/blob/master/README.md), [package manifest](https://github.com/mifi/lossless-cut/blob/master/package.json).

This is an engineering fit review, not legal advice. Before distributing binaries, run a complete dependency/license scan and obtain counsel on LGPL linking, FFmpeg codec choices, Remotion's company license and any native backend obligations.
