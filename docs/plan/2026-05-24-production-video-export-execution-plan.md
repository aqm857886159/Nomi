# Nomi Production Video Export Implementation Plan

> 裁决：已被现行持久化导出任务与统一导出引擎取代；证据：`electron/export/exportJobManager.ts:53-84`、`docs/plan/2026-06-14-export-engine-unification.md:72-86`。

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** 把 Nomi 的视频导出从当前过渡型 `Canvas → MediaRecorder WebM → FFmpeg MP4` 升级为分阶段工业化的本地桌面导出系统：P0 可商业试用、P1 真正生产可用、P2 高级创作能力。

**Architecture:** 采用 `NomiRenderManifest → persistent ExportJob → ExportPlanner → FFmpeg / optional Remotion / fallback backend`。FFmpeg 是桌面 MP4 主后端；Remotion 只作为复杂视觉层（模板、字幕动效、贴纸、AI overlay、React/CSS 动画）的后端，不替代普通剪辑导出。

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, native FFmpeg via `@ffmpeg-installer/ffmpeg`, optional Remotion spike via `remotion`, `@remotion/renderer`, `@remotion/bundler` after license approval.

---

## 0. 当前基线

已完成并提交：

- `electron/export/ffmpegRunner.ts`
  - `exportDimensionsForPreset()` 已支持真实画幅：`9:16 → 1080x1920`，`1:1 → 1080x1080`。
- `electron/runtime.ts`
  - MP4 export payload 已接收 `aspectRatio`。
  - `showExportInFolder()` 已限制只能打开当前项目 `exports/` 下的文件。
- `electron/main.ts` / `electron/preload.ts` / `src/desktop/bridge.ts`
  - `show-in-folder` 不再接受 renderer 任意 absolute path。
- `src/workbench/export/exportApi.ts`
  - 导出时传递当前预览画幅。
- `docs/architecture/nomi-production-video-export-architecture-2026-05-24.md`
  - 已写入 CTO 级目标架构。

验证命令：

```bash
npm test -- --run electron/export/ffmpegRunner.test.ts
npm run build:electron
npm run build:renderer
```

---

## 1. 设计边界

### 1.1 必须坚持

1. Renderer/UI 不做生产级最终导出引擎。
2. 每次导出都从 immutable manifest snapshot 开始。
3. 导出必须是 job：有 job id、status、progress、log、cancel、cleanup、result。
4. 默认 MP4 后端是 native FFmpeg。
5. Remotion 只负责复杂视觉层：模板、字幕动效、贴纸、AI overlay、React/CSS 动画。
6. 简单剪辑、基础音频、trim/concat/filtergraph 优先走 FFmpeg，不走 Chromium 截帧。
7. 所有主进程路径操作都使用 project-relative path，不接受 renderer arbitrary absolute path。
8. 输出必须 atomic：`.partial.mp4` 成功后 rename。

### 1.2 暂不做

- 不做专业调色。
- 不做硬件编码器选择 UI。
- 不做手写 FFmpeg 参数输入。
- 不做 Remotion 作为唯一导出底座。
- 不在 P0 承诺完整多轨音频混音 UI，但 P0 必须探测媒体 metadata、记录 `hasAudio`，并让 manifest/planner/command builder 明确支持 `preserve | mute` 的设计边界。

### 1.3 工业化分级和上线门槛

把本计划按三阶段执行，不再把“架构骨架”直接称为工业级完成态。

#### P0：可商业试用（必须先完成，才能对外承诺稳定 MP4 导出）

- Immutable manifest snapshot。
- Job manager + progress + cancel + logs。
- Job manifest/log/result 落盘；即使第一版只允许 one active export，也必须能在重启后看到最近 job 的 manifest、状态、错误和输出路径。
- Atomic output：`*.partial.mp4` 成功后 rename。
- 移除完整 WebM ArrayBuffer IPC；过渡期最多允许受控 temp/chunk input。
- MP4/H.264/yuv420p/faststart。
- `ffprobe`/media metadata：duration、dimensions、fps、codec、hasAudio。
- 明确的错误分类：missing asset、bad codec/unsupported media、permission denied、disk full/no space、cancelled。
- 5s、60s、3min、10min smoke；packaged mac arm64/x64 smoke；Windows smoke before public claim。

#### P1：真正生产可用

- FFmpeg filtergraph 支持 image/video 基础多轨合成：图片时长、视频 trim、缩放/裁切/黑底、层级顺序。
- Source audio preserve / mute / AAC output。
- 基础音频 filtergraph：delay、fade、amix；多轨 UI 可后置，但导出模型不能推翻。
- Job recovery/readback：用户能看到最近导出失败原因和结果文件。
- 更完整的 asset validation 和错误 copy。

#### P2：高级创作能力

- Remotion/headless frame render。
- 字幕动效、贴纸、模板、AI overlay。
- 多画幅批量导出。
- 队列、重试、后台任务恢复。

### 1.4 P0 hard gates

这些 gate 不通过，不允许把功能称为“稳定长视频导出”：

1. Renderer 不再通过 IPC 一次性发送完整 WebM bytes。
2. 每个 job 至少落盘 `manifest.json`、`job.json`、`export.log`。
3. 取消导出清理 temp input 和 partial output，不留下坏 MP4。
4. 3 分钟 mixed image/video 导出稳定；10 分钟 smoke 不爆内存。
5. 输出文件由 FFmpeg probe 验证尺寸、duration、pix_fmt、faststart。

---

## 2. 最终目录结构

目标新增/改造：

```text
electron/export/
  exportTypes.ts              # job/status/profile/shared main-process types
  exportPaths.ts              # project exports/cache/temp path helpers
  exportManifest.ts           # manifest schema, validation, serialization
  exportJobManager.ts         # queue, status, events, cancel, cleanup
  exportJobStore.ts           # persist manifest/job/log/result under project cache
  exportTempInput.ts          # controlled chunk/temp input; no full WebM IPC
  mediaProbe.ts               # ffprobe/FFmpeg metadata for video/audio planning
  exportPlanner.ts            # choose ffmpeg-direct/filtergraph/remotion/fallback
  ffmpegCommandBuilder.ts     # FFmpeg args by plan/profile
  ffmpegFiltergraph.ts        # image/video/audio filtergraph compiler
  ffmpegProgress.ts           # parse -progress/stderr into percent/stage
  ffmpegRunner.ts             # spawn, cancel, logs, partial output, result
  remotion/
    remotionTypes.ts          # Remotion backend-specific types
    remotionBundle.ts         # bundle/serve composition entry
    remotionComposition.tsx   # spike composition consuming manifest props
    remotionRenderer.ts       # renderMedia wrapper and progress bridge

src/workbench/export/
  exportTypes.ts              # renderer-facing request/result/event types
  renderManifest.ts           # TimelineState -> NomiRenderManifestV1 snapshot
  exportApi.ts                # start/cancel/subscribe bridge
  ExportDialog.tsx            # later UI; not first priority
  ExportProgressPanel.tsx     # progress/result/error/cancel UI

src/workbench/timeline/
  timelineTypes.ts            # remains thin in P0, but export capability gaps are explicit
```

---

## 3. Milestone 1 — Manifest contract

### Task 1: Add shared export domain types

**Objective:** 建立 production export 的类型边界，不再让 WebM bytes payload 成为核心协议。

**Files:**

- Create: `electron/export/exportTypes.ts`
- Modify: `src/workbench/export/exportTypes.ts`
- Test: `electron/export/exportTypes.test.ts`

**Implementation:**

Create main-process types:

```ts
export type ExportAspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '3:4' | '4:3' | '21:9';
export type ExportResolution = '720p' | '1080p' | 'source';
export type ExportQuality = 'small' | 'standard' | 'high';
export type ExportPreset = 'publish' | 'edit' | 'share' | 'webm';

export type ExportJobStatus =
  | 'queued'
  | 'preparing'
  | 'planning'
  | 'rendering'
  | 'encoding'
  | 'muxing'
  | 'finalizing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type ExportStage = Exclude<ExportJobStatus, 'queued' | 'succeeded' | 'failed' | 'cancelled'>;

export type ExportProfile = {
  preset: Exclude<ExportPreset, 'webm'>;
  container: 'mp4';
  videoCodec: 'h264';
  audioCodec: 'aac' | 'none';
  width: number;
  height: number;
  fps: number;
  pixelFormat: 'yuv420p';
  quality: ExportQuality;
};
```

**Verification:**

```bash
npm run build:electron
```

Expected: TypeScript passes.

**Commit:**

```bash
git add electron/export/exportTypes.ts src/workbench/export/exportTypes.ts electron/export/exportTypes.test.ts
git commit -m "feat(export): add production export domain types"
```

---

### Task 2: Add manifest schema and validation

**Objective:** 定义 `NomiRenderManifestV1`，使导出从 immutable snapshot 开始。

**Files:**

- Create: `electron/export/exportManifest.ts`
- Create: `electron/export/exportManifest.test.ts`

**Implementation:**

Use plain TypeScript guards first; do not introduce new schema dependency unless needed.

Required shape:

```ts
export type NomiRenderManifestV1 = {
  version: 1;
  projectId: string;
  createdAt: string;
  timeline: {
    fps: number;
    durationFrames: number;
    range: { startFrame: number; endFrame: number };
    tracks: NomiRenderTrack[];
  };
  profile: ExportProfile;
  assets: Record<string, NomiRenderAsset>;
  diagnostics?: { warnings: string[] };
};

export type NomiRenderAsset = {
  id: string;
  kind: 'image' | 'video' | 'audio';
  absolutePath: string;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  audioCodec?: string;
  hasAudio?: boolean;
};
```

Add helpers:

```ts
export function assertValidManifest(value: unknown): asserts value is NomiRenderManifestV1
export function serializeManifest(manifest: NomiRenderManifestV1): string
export function parseManifestJson(json: string): NomiRenderManifestV1
```

Validation rules:

- `version === 1`
- non-empty `projectId`
- `fps` integer `>= 1 && <= 120`
- dimensions positive and even
- `range.endFrame >= range.startFrame`
- every clip `endFrame > startFrame`
- every asset path is absolute in main process manifest
- media assets may omit probe metadata only before `mediaProbe` runs; planner must fail clearly if required metadata is missing
- if an asset has `hasAudio: true`, manifest preserves that fact even when current export profile chooses `audioCodec: 'none'`

**Tests:**

- accepts valid minimal manifest
- rejects odd width/height
- rejects empty projectId
- rejects clip with invalid range
- rejects relative asset path
- accepts video asset with `hasAudio: true` metadata
- rejects planner-required metadata when missing in production planning tests

**Verification:**

```bash
npm test -- --run electron/export/exportManifest.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/exportManifest.ts electron/export/exportManifest.test.ts
git commit -m "feat(export): define render manifest schema"
```

---

### Task 3: Build renderer manifest snapshot from current timeline

**Objective:** 把现有 `TimelineState` 转为 manifest-like request，先支持当前 image/video tracks，同时显式记录当前时间轴模型的能力缺口，不在 manifest 里假装已经有完整多轨/音频/字幕编辑模型。

**Files:**

- Create: `src/workbench/export/renderManifest.ts`
- Create: `src/workbench/export/renderManifest.test.ts`
- Modify: `src/workbench/export/exportTypes.ts`

**Implementation:**

Add:

```ts
export function buildRenderManifestRequest(options: {
  projectId: string;
  timeline: TimelineState;
  aspectRatio: PreviewAspectRatio;
  resolution: Exclude<ExportResolution, 'source'>;
  quality: ExportQuality;
  preset: Exclude<ExportPreset, 'webm'>;
}): RendererRenderManifestRequest
```

Renderer request may still contain asset URLs, because main process must resolve/validate local project asset paths.

Rules:

- compute duration via existing timeline math
- profile dimensions use same dimension rules as `exportDimensionsForPreset`
- clips preserve `startFrame`, `endFrame`, `sourceStartFrame`, `sourceEndFrame` if present
- include `audioCodec: 'none'` for current P0 default
- include `exportCapabilities`/diagnostics that say current editor model only has image/video clips; audio/text/overlay/effect/keyframe are not yet first-class timeline entities
- do not create fake audio/text tracks unless source model actually contains them

**Tests:**

- 9:16 creates `1080x1920`
- empty timeline creates duration 0 and validation warning
- video clip preserves source offsets
- diagnostics expose thin timeline model limitations
- source assets can carry `hasAudio` once media probe data is available

**Verification:**

```bash
npm test -- --run src/workbench/export/renderManifest.test.ts
npm run build:renderer
```

**Commit:**

```bash
git add src/workbench/export/renderManifest.ts src/workbench/export/renderManifest.test.ts src/workbench/export/exportTypes.ts
git commit -m "feat(export): snapshot timeline into render manifest request"
```

---

## 4. Milestone 2 — Safe paths, persistent jobs, and P0 WebM IPC removal

### Task 4: Add export path helper module

**Objective:** 集中处理 project exports/cache/temp path，避免路径逻辑散在 runtime/main/runner。

**Files:**

- Create: `electron/export/exportPaths.ts`
- Create: `electron/export/exportPaths.test.ts`
- Modify: `electron/export/ffmpegRunner.ts`
- Modify: `electron/runtime.ts`

**Implementation:**

Add helpers:

```ts
export function ensureExportDirs(projectDir: string): { exportsDir: string; cacheDir: string }
export function createExportTempDir(projectDir: string, jobId: string): string
export function createSafeOutputPaths(options: {
  projectDir: string;
  outputName?: string;
  extension: 'mp4' | 'webm';
}): { finalPath: string; partialPath: string; relativeFinalPath: string }
export function assertProjectExportRelativePath(relativePath: string): string
```

Rules:

- output lives in `projectDir/exports`
- temp lives in `projectDir/cache/export-<jobId>`
- output basename sanitized
- partial output is `*.partial.mp4`
- relative path must start with `exports/` and not contain `..`

**Verification:**

```bash
npm test -- --run electron/export/exportPaths.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/exportPaths.ts electron/export/exportPaths.test.ts electron/export/ffmpegRunner.ts electron/runtime.ts
git commit -m "feat(export): centralize export path safety"
```

---

### Task 5: Implement ExportJobManager skeleton

**Objective:** 把导出变成 job 模型，先不改变用户 UI 行为。

**Files:**

- Create: `electron/export/exportJobManager.ts`
- Create: `electron/export/exportJobStore.ts`
- Create: `electron/export/exportJobManager.test.ts`
- Create: `electron/export/exportJobStore.test.ts`

**Implementation:**

Add class:

```ts
export class ExportJobManager {
  createJob(input: CreateExportJobInput): ExportJobSnapshot
  getJob(jobId: string): ExportJobSnapshot | null
  listJobs(projectId?: string): ExportJobSnapshot[]
  updateJob(jobId: string, patch: ExportJobPatch): ExportJobSnapshot
  failJob(jobId: string, error: unknown): ExportJobSnapshot
  completeJob(jobId: string, result: ExportJobResult): ExportJobSnapshot
  cancelJob(jobId: string): Promise<ExportJobSnapshot>
  onEvent(listener: (event: ExportJobEvent) => void): () => void
}
```

Initial constraints:

- one active export at a time; if another starts, return clear error
- in-memory state is allowed only as hot runtime cache; every job must also persist under `projectDir/cache/export-<jobId>/`
- persist `manifest.json`, `job.json`, `export.log`, and final `result.json`/`error.json`
- emit events on status/progress/result/error
- cancellation sets a flag even before runner integration
- expose readback for recent job snapshots so restart/failure review is possible

**Tests:**

- creates queued job
- emits event on status update
- rejects concurrent active jobs
- marks job cancelled
- stores failure message
- writes manifest/job/log/result files under the job temp dir
- can load a persisted failed job snapshot for post-crash review

**Verification:**

```bash
npm test -- --run electron/export/exportJobManager.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/exportJobManager.ts electron/export/exportJobStore.ts electron/export/exportJobManager.test.ts electron/export/exportJobStore.test.ts
git commit -m "feat(export): add persistent export job manager"
```

---

### Task 6: Wire export IPC to job protocol

**Objective:** 新增 job IPC，不立刻删除旧 `startTimelineMp4Export()`，保持兼容。

**Files:**

- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop/bridge.ts`
- Modify: `src/workbench/export/exportApi.ts`
- Test: `electron/export/exportJobIpc.test.ts` if practical; otherwise cover with manager/unit tests.

**IPC:**

```text
nomi:exports:start-job       -> { jobId }
nomi:exports:status          -> ExportJobSnapshot
nomi:exports:cancel          -> { ok: true }
nomi:exports:event           -> renderer event channel
```

Preload API:

```ts
exports: {
  startJob(payload): Promise<{ jobId: string }>
  status(jobId): Promise<ExportJobSnapshot>
  cancel(jobId): Promise<{ ok: boolean }>
  onEvent(callback): () => void
}
```

**Verification:**

```bash
npm run build:electron
npm run build:renderer
```

**Commit:**

```bash
git add electron/main.ts electron/preload.ts src/desktop/bridge.ts src/workbench/export/exportApi.ts
git commit -m "feat(export): expose export job IPC"
```

---

### Task 6A: Remove full WebM ArrayBuffer IPC as P0 gate

**Objective:** 过渡期先消除最大内存风险：不再把完整 WebM bytes 通过 IPC 传输。

**Files:**

- Modify: `src/workbench/export/exportApi.ts`
- Modify: `electron/runtime.ts`
- Modify: `electron/export/ffmpegRunner.ts`
- Create: `electron/export/exportTempInput.ts`
- Tests as practical.

**Implementation options:**

Preferred transition approach:

1. Job starts and main process returns a temp input token/path under project cache.
2. Renderer writes WebM chunks or final Blob to that temp path through controlled IPC.
3. Main process starts FFmpeg from temp input path.

IPC must not accept arbitrary paths from renderer. Use:

```text
nomi:exports:write-temp-input({ jobId, chunk })
nomi:exports:finish-temp-input({ jobId })
```

If chunk streaming is too large for this task, accept a short-term `Blob → ArrayBuffer` only within chunked writes, not one giant export payload.

**P0 gate:** This task must be completed before any claim of stable long-video export. The old `webmBytes` one-shot payload must either be deleted or hidden behind test-only/fallback code that is not used by MP4 export.

**Verification:**

- Export a 1 min timeline and confirm main process never receives `webmBytes` as one payload.
- Unit test rejects writes for unknown jobId.
- Unit test rejects writes after cancel.

**Commit:**

```bash
git add src/workbench/export/exportApi.ts electron/runtime.ts electron/export/ffmpegRunner.ts electron/export/exportTempInput.ts
git commit -m "feat(export): replace full webm ipc payload with job temp input"
```

---


## 5. Milestone 3 — FFmpeg runner productionization and real filtergraph contract

### Task 7: Extract FFmpeg command builder

**Objective:** 把 FFmpeg args 从 runner 中抽出来，支持 profile-driven output，并为真实 filtergraph 编译器留出明确 contract。

**Files:**

- Create: `electron/export/ffmpegCommandBuilder.ts`
- Create: `electron/export/ffmpegCommandBuilder.test.ts`
- Modify: `electron/export/ffmpegRunner.ts`

**Implementation:**

Add:

```ts
export type FfmpegTranscodePlan = {
  inputPath: string;
  outputPath: string;
  profile: ExportProfile;
  noAudio: boolean;
};

export function buildWebmToMp4Args(plan: FfmpegTranscodePlan): string[]
```

Args must include:

- `-y`
- `-i input`
- `-an` while audioCodec is `none`
- true scale/pad/format filter
- `-r fps`
- `-c:v libx264`
- `-preset medium`
- CRF by quality
- `-movflags +faststart`
- partial output path

**Verification:**

```bash
npm test -- --run electron/export/ffmpegCommandBuilder.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/ffmpegCommandBuilder.ts electron/export/ffmpegCommandBuilder.test.ts electron/export/ffmpegRunner.ts
git commit -m "feat(export): build ffmpeg commands from export profile"
```

---

### Task 7A: Define FFmpeg filtergraph compiler contract

**Objective:** 把 placeholder 的 `ffmpeg-filtergraph` 变成可实施 contract，覆盖 P1 真正剪片所需的 image/video/audio 基础合成。

**Files:**

- Create: `electron/export/ffmpegFiltergraph.ts`
- Create: `electron/export/ffmpegFiltergraph.test.ts`
- Modify: `electron/export/ffmpegCommandBuilder.ts`

**Implementation:**

Add pure compiler functions first; runner integration can follow after tests pass.

Required supported cases:

- image clip duration: generate looped/still input or filter segment with explicit frame duration
- video trim: honor `sourceStartFrame/sourceEndFrame`
- scale/crop/pad: output exactly profile width/height with black background when needed
- layer order: deterministic bottom-to-top track ordering
- gaps: fill with black/silence instead of producing undefined frames
- missing asset: fail before FFmpeg spawn with classified error
- audio P1 contract: source preserve/mute, delay, fade, amix; implementation may initially mark multi-track audio unsupported but the types/tests must lock the intended shape

**Tests:**

- builds filtergraph for one image clip with 5s duration
- builds trim/scale graph for one video clip
- preserves layer order for two overlapping visual clips
- emits black background for timeline gaps
- classifies missing asset before spawn
- has skipped/TODO test for audio delay/fade/amix contract if not implemented in P0

**Verification:**

```bash
npm test -- --run electron/export/ffmpegFiltergraph.test.ts electron/export/ffmpegCommandBuilder.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/ffmpegFiltergraph.ts electron/export/ffmpegFiltergraph.test.ts electron/export/ffmpegCommandBuilder.ts electron/export/ffmpegCommandBuilder.test.ts
git commit -m "feat(export): define ffmpeg filtergraph compiler contract"
```

---

### Task 8: Add FFmpeg progress parser

**Objective:** 支持真实 encoding progress，而不是固定跳到 86%。

**Files:**

- Create: `electron/export/ffmpegProgress.ts`
- Create: `electron/export/ffmpegProgress.test.ts`
- Modify: `electron/export/ffmpegCommandBuilder.ts`

**Implementation:**

Prefer FFmpeg progress mode:

```text
-progress pipe:2
-nostats
```

Parser handles lines:

```text
frame=123
fps=45.1
out_time_ms=4100000
speed=1.2x
progress=continue
```

Add:

```ts
export function parseFfmpegProgressChunk(chunk: string): Partial<FfmpegProgress>
export function progressFromOutTime(outTimeMs: number, durationMs: number): number
```

**Tests:**

- parses frame/fps/out_time_ms/speed
- computes percent clamped 0..1
- handles partial chunks gracefully

**Verification:**

```bash
npm test -- --run electron/export/ffmpegProgress.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/ffmpegProgress.ts electron/export/ffmpegProgress.test.ts electron/export/ffmpegCommandBuilder.ts
git commit -m "feat(export): parse ffmpeg progress"
```

---

### Task 9: Add cancel, logs, and atomic output to ffmpegRunner

**Objective:** 让 FFmpeg runner 可取消、可 debug、不会留下成功态破损文件。

**Files:**

- Modify: `electron/export/ffmpegRunner.ts`
- Modify: `electron/export/ffmpegRunner.test.ts`

**Implementation:**

Extend options:

```ts
export type TranscodeWebmToMp4Options = {
  ...
  jobId?: string;
  durationMs?: number;
  signal?: AbortSignal;
  onProgress?: (progress: FfmpegProgressEvent) => void;
  stderrLogPath?: string;
};
```

Runner behavior:

- write output to `.partial.mp4`
- append stderr/progress to log file
- on abort: kill child process, remove partial output, throw `ExportCancelledError`
- on success: rename partial to final path
- cap in-memory stderr summary to prevent huge memory usage

**Tests:**

- success renames partial to final
- failure removes partial and keeps log
- abort kills mocked process and rejects with cancelled error
- progress callback receives parsed percent

**Verification:**

```bash
npm test -- --run electron/export/ffmpegRunner.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/ffmpegRunner.ts electron/export/ffmpegRunner.test.ts
git commit -m "feat(export): make ffmpeg runner cancellable and atomic"
```

---

## 6. Milestone 4 — Media probe and audio-ready FFmpeg path (P0/P1 gate)

### Task 9A: Probe media metadata with ffprobe or FFmpeg

**Objective:** 为音频/视频 direct planning 做资产 metadata 基础。

**Files:**

- Create: `electron/export/mediaProbe.ts`
- Create: `electron/export/mediaProbe.test.ts`
- Modify: `electron/export/exportManifest.ts`

**Implementation:**

Use bundled FFmpeg package if ffprobe unavailable; if adding ffprobe package is required, make it separate decision.

Metadata:

- durationSeconds
- width/height
- video codec
- audio codec
- hasAudio
- sampleRate/channels if available

**Verification:**

```bash
npm test -- --run electron/export/mediaProbe.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/mediaProbe.ts electron/export/mediaProbe.test.ts electron/export/exportManifest.ts
git commit -m "feat(export): probe source media metadata"
```

---

### Task 9B: Add audio fields and silent/AAC planning

**Objective:** 从 manifest 到 FFmpeg command builder 预留音频路径，P0 明确支持 mute/silent，P1 支持 source audio preserve and AAC output，避免后续推翻导出设计。

**Files:**

- Modify: `electron/export/exportTypes.ts`
- Modify: `electron/export/exportManifest.ts`
- Modify: `electron/export/ffmpegCommandBuilder.ts`
- Modify: tests.

**Implementation:**

Current P0 behavior may remain default `audioCodec: 'none'` and `-an`, but the model must distinguish:

- `audioMode: 'mute'` → `-an`
- `audioMode: 'preserve-source'` → P1 route, requires `hasAudio`/codec/duration metadata and emits AAC MP4 args
- `audioMode: 'mixdown'` → P1/P2 route, requires filtergraph support

Add tests proving:

- when `audioMode: 'mute'`, args include `-an`
- when `audioMode: 'preserve-source'`, command builder adds `-c:a aac -b:a 192k` and fails clearly if source has no audio metadata
- UI can still hide audio choices in P0, but manifest/planner cannot collapse all assets to silent forever

**Verification:**

```bash
npm test -- --run electron/export
npm run build:electron
```

**Commit:**

```bash
git add electron/export/exportTypes.ts electron/export/exportManifest.ts electron/export/ffmpegCommandBuilder.ts electron/export/*.test.ts
git commit -m "feat(export): make export profiles audio-ready"
```


---

## 7. Milestone 5 — Planner and migration off WebM promise path

### Task 10: Add export planner skeleton

**Objective:** 为 FFmpeg direct/filtergraph/Remotion/fallback 建立可扩展选择器。

**Files:**

- Create: `electron/export/exportPlanner.ts`
- Create: `electron/export/exportPlanner.test.ts`

**Implementation:**

Initial planner:

```ts
export type ExportBackend =
  | 'ffmpeg-webm-transcode'
  | 'ffmpeg-direct'
  | 'ffmpeg-filtergraph'
  | 'remotion-frame-render'
  | 'webm-fallback';

export function planExport(manifest: NomiRenderManifestV1): ExportPlan
```

Initial rules:

- current manifest from existing timeline uses `ffmpeg-webm-transcode` while migration is incomplete
- if tracks include text/overlay/effect requiring React rendering, choose `remotion-frame-render`
- if simple video cuts only, choose `ffmpeg-direct` placeholder
- if image/video basic composition, choose `ffmpeg-filtergraph` placeholder

**Verification:**

```bash
npm test -- --run electron/export/exportPlanner.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/exportPlanner.ts electron/export/exportPlanner.test.ts
git commit -m "feat(export): add render backend planner"
```

---

### Task 11: Route current export through job manager

**Objective:** 用户点击导出后进入 job flow；内部暂时仍可使用 WebM transition backend，但 UI/API 已切到 job model。

**Files:**

- Modify: `src/workbench/export/exportApi.ts`
- Modify: `src/workbench/preview/TimelinePreview.tsx`
- Modify: `electron/runtime.ts`
- Modify: `electron/main.ts`

**Implementation:**

Renderer flow:

```text
buildRenderManifestRequest()
  → desktop.exports.startJob()
  → subscribe nomi:exports:event
  → show progress/result/error
```

Main flow:

```text
startJob(payload)
  → create job
  → resolve projectDir/assets
  → validate manifest
  → plan export
  → run current transcode backend
  → complete/fail/cancel job
```

Do not remove old `nomi:exports:start` until job path is verified.

**Verification:**

```bash
npm test
npm run build:electron
npm run build:renderer
```

Manual smoke:

1. Start app.
2. Create/open project.
3. Add image or video to timeline.
4. Export MP4.
5. Observe progress events.
6. Confirm file appears in `exports/`.
7. Confirm “show in folder” works.

**Commit:**

```bash
git add src/workbench/export/exportApi.ts src/workbench/preview/TimelinePreview.tsx electron/runtime.ts electron/main.ts
git commit -m "feat(export): route mp4 export through job manager"
```

---

## 8. Milestone 6 — Remotion spike backend (P2; defer until P0/P1 gates pass)

> Do this only after license/commercial approval and after P0 WebM IPC removal, persistent jobs, media probe, and FFmpeg filtergraph contract are in place. Remotion is not plain MIT; company license may be required depending on Nomi's legal entity/size/use.

### Task 13: Add Remotion dependency behind spike flag

**Objective:** 引入 Remotion spike，但默认不开启，不影响主导出路径。

**Files:**

- Modify: `package.json`
- Modify: lockfile (`pnpm-lock.yaml` or npm lock if present)
- Create: `electron/export/remotion/remotionTypes.ts`

**Command:**

```bash
pnpm add remotion @remotion/renderer @remotion/bundler
```

If package manager lock is npm-only in current checkout, use the repo's existing package manager policy from `package.json`: `pnpm@10.8.1`.

**Feature flag:**

```ts
export function isRemotionExportEnabled(): boolean {
  return process.env.NOMI_REMOTION_EXPORT === '1';
}
```

**Verification:**

```bash
npm run build:electron
npm run build:renderer
```

**Commit:**

```bash
git add package.json pnpm-lock.yaml electron/export/remotion/remotionTypes.ts
git commit -m "chore(export): add remotion spike dependencies"
```

---

### Task 14: Create Remotion composition consuming manifest props

**Objective:** 建立最小 Remotion renderer：图片、视频、文字，验证 Nomi manifest 可以驱动 React 视频渲染。

**Files:**

- Create: `electron/export/remotion/remotionComposition.tsx`
- Create: `electron/export/remotion/remotionComposition.test.ts` if extract pure mapping helpers.

**Implementation:**

Composition props:

```ts
export type NomiRemotionCompositionProps = {
  manifest: NomiRenderManifestV1;
};
```

Initial support:

- background black
- image clips with contain/cover
- video clips with start/end offsets
- text clips basic absolute positioning
- no audio for first spike

Keep pure mapping helpers testable without launching Chromium.

**Verification:**

```bash
npm run build:electron
```

**Commit:**

```bash
git add electron/export/remotion/remotionComposition.tsx electron/export/remotion/remotionComposition.test.ts
git commit -m "feat(export): add remotion manifest composition"
```

---

### Task 15: Implement remotionRenderer wrapper

**Objective:** 用 `@remotion/renderer` 包一层 Nomi backend，接入 job progress/cancel/result。

**Files:**

- Create: `electron/export/remotion/remotionBundle.ts`
- Create: `electron/export/remotion/remotionRenderer.ts`
- Create: `electron/export/remotion/remotionRenderer.test.ts` with mocks.
- Modify: `electron/export/exportPlanner.ts`

**Implementation:**

Wrapper:

```ts
export async function renderWithRemotion(options: {
  manifest: NomiRenderManifestV1;
  outputPath: string;
  tempDir: string;
  signal?: AbortSignal;
  onProgress?: (event: ExportProgressEvent) => void;
}): Promise<ExportJobResult>
```

Use:

- `selectComposition()`
- `renderMedia()`
- `codec: 'h264'`
- `pixelFormat: 'yuv420p'`
- `outputLocation: partialPath`
- progress callbacks mapped to `rendering`/`encoding`

Cancel:

- wire AbortSignal to Remotion cancellation if available in current API
- otherwise terminate spawned Chromium/render promise through documented cancel API or process cleanup

**Verification:**

```bash
NOMI_REMOTION_EXPORT=1 npm run build:electron
```

Manual spike:

```bash
NOMI_REMOTION_EXPORT=1 npm run dev
```

Export a 5-second image+text manifest.

**Commit:**

```bash
git add electron/export/remotion electron/export/exportPlanner.ts
git commit -m "feat(export): add remotion frame-render backend spike"
```

---

### Task 16: Add planner route for Remotion-required manifests

**Objective:** 当 manifest 包含 text/overlay/template/effects 时，planner 选择 Remotion backend；普通剪辑仍走 FFmpeg。

**Files:**

- Modify: `electron/export/exportPlanner.ts`
- Modify: `electron/export/exportPlanner.test.ts`
- Modify: `electron/export/exportJobManager.ts` or runtime orchestration file.

**Rules:**

```ts
if (manifest.timeline.tracks.some(track => track.type === 'text' || track.type === 'overlay')) {
  return { backend: 'remotion-frame-render', manifest };
}
```

But if `NOMI_REMOTION_EXPORT !== '1'`, fail gracefully:

```text
该项目包含需要视觉渲染后端的图层；当前 Remotion 导出后端未启用。
```

**Verification:**

```bash
npm test -- --run electron/export/exportPlanner.test.ts
npm run build:electron
```

**Commit:**

```bash
git add electron/export/exportPlanner.ts electron/export/exportPlanner.test.ts
git commit -m "feat(export): route visual manifests to remotion backend"
```

---

## 9. Milestone 7 — User-facing progress, cancel, result

### Task 17: Add export progress panel

**Objective:** 替代 toast-only 导出体验，展示 job progress、stage、cancel、result。

**Files:**

- Create: `src/workbench/export/ExportProgressPanel.tsx`
- Create: `src/workbench/export/ExportProgressPanel.test.tsx` if test setup supports React; otherwise test pure copy helpers.
- Modify: `src/workbench/preview/TimelinePreview.tsx`
- Modify: `src/workbench/export/exportCopy.ts`

**UI states:**

- preparing
- planning
- rendering
- encoding
- finalizing
- succeeded
- failed
- cancelled

Actions:

- Cancel while active
- Open folder when succeeded
- Copy path
- Retry if failed

**Verification:**

```bash
npm test -- --run src/workbench/export/exportCopy.test.ts
npm run build:renderer
```

Manual:

- Start export.
- Confirm progress panel appears.
- Cancel export.
- Confirm status becomes cancelled and partial file is removed.

**Commit:**

```bash
git add src/workbench/export/ExportProgressPanel.tsx src/workbench/export/exportCopy.ts src/workbench/preview/TimelinePreview.tsx
git commit -m "feat(export): show job progress and cancellation UI"
```

---

### Task 18: Add minimal ExportDialog

**Objective:** 提供生产级但不复杂的导出入口：用途、分辨率、质量、保存位置说明。

**Files:**

- Create: `src/workbench/export/ExportDialog.tsx`
- Modify: `src/workbench/preview/TimelinePreview.tsx`
- Modify: `src/workbench/export/exportCopy.ts`
- Test: `src/workbench/export/exportCopy.test.ts`

**Options:**

- preset: 标准发布 / 继续剪辑 / 轻量分享
- resolution: 720p / 1080p
- quality: 小体积 / 标准 / 高质量
- explicit copy: 当前版本不含音频 unless audio pipeline enabled

Do not expose codec internals.

**Verification:**

```bash
npm test -- --run src/workbench/export/exportCopy.test.ts
npm run build:renderer
```

**Commit:**

```bash
git add src/workbench/export/ExportDialog.tsx src/workbench/export/exportCopy.ts src/workbench/export/exportCopy.test.ts src/workbench/preview/TimelinePreview.tsx
git commit -m "feat(export): add focused export settings dialog"
```

---

---

## 10. Milestone 8 — Testing and release hardening

### Task 21: Add export acceptance fixtures

**Objective:** 建立可重复导出测试素材和测试矩阵。

**Files:**

- Create: `tests/fixtures/export/README.md`
- Create: `tests/fixtures/export/create-fixtures.mjs`
- Create: `electron/export/exportAcceptance.test.ts`

**Fixtures:**

- 1s black MP4
- 1s color bars MP4 if generated by FFmpeg
- small PNG
- invalid media file

Keep fixtures tiny or generated on test setup.

**Verification:**

```bash
npm test -- --run electron/export/exportAcceptance.test.ts
```

**Commit:**

```bash
git add tests/fixtures/export electron/export/exportAcceptance.test.ts
git commit -m "test(export): add video export acceptance fixtures"
```

---

### Task 22: Add long-form manual QA checklist

**Objective:** 把长视频/打包/跨平台验证写成 release checklist，不假装全自动覆盖。

**Files:**

- Create: `docs/qa/video-export-release-checklist.md`
- Modify: `docs/architecture/nomi-production-video-export-architecture-2026-05-24.md`

**Checklist:**

- 5s image-only
- 60s video-only
- 3min mixed image/video
- 10min smoke export
- cancel during rendering
- cancel during encoding
- missing asset
- disk full / permission failure if practical
- packaged mac arm64
- packaged mac x64
- Windows smoke

**Verification:**

Docs only.

**Commit:**

```bash
git add docs/qa/video-export-release-checklist.md docs/architecture/nomi-production-video-export-architecture-2026-05-24.md
git commit -m "docs(export): add video export release checklist"
```

---

## 11. Global verification before merging milestone groups

Run after each milestone:

```bash
npm test
npm run build:electron
npm run build:renderer
```

Run before release branch:

```bash
npm run build
npm run dist:mac:dir
```

Manual smoke:

```bash
npm run dev
```

Check:

1. Open existing project.
2. Add image/video to timeline.
3. Export 16:9 1080p.
4. Export 9:16 1080p.
5. Cancel mid-export.
6. Trigger missing asset failure.
7. Open output folder.
8. Verify `exports/*.mp4` dimensions with FFmpeg:

```bash
ffmpeg -i "path/to/export.mp4" 2>&1 | grep -E "Video:|Duration"
```

---

## 12. Execution order summary

Recommended order after feedback adjustment:

### P0 — 可商业试用 gate

1. `exportTypes.ts`
2. `exportManifest.ts` with asset metadata / `hasAudio` fields
3. renderer `renderManifest.ts` with explicit thin-timeline diagnostics
4. `exportPaths.ts`
5. persistent `ExportJobManager` + `exportJobStore.ts`
6. job IPC
7. **remove full WebM ArrayBuffer IPC** via `exportTempInput.ts` chunk/temp input
8. `mediaProbe.ts` for duration/dimensions/fps/codec/hasAudio
9. `ffmpegCommandBuilder.ts` with H.264/yuv420p/faststart and mute audio mode
10. `ffmpegProgress.ts`
11. cancellable/atomic `ffmpegRunner.ts`
12. `exportPlanner.ts` with classified unsupported cases
13. route current export through jobs
14. progress/cancel/error/result UI
15. acceptance fixtures and 5s/60s/3min/10min smoke checklist

### P1 — 真正生产可用

16. `ffmpegFiltergraph.ts` real image/video composition contract and implementation
17. audio preserve/AAC output path
18. job recovery/readback UI for recent failed/succeeded exports
19. richer error taxonomy and user copy
20. export dialog presets after backend behavior is stable

### P2 — 高级创作能力

21. Remotion dependency behind flag after license approval
22. Remotion composition
23. Remotion renderer wrapper
24. planner route for Remotion-required manifests
25. subtitles/templates/stickers/AI overlay

Do not advertise “stable long-video export” until P0 gates pass. Do not advertise “industrial/professional export” until P1 gates pass.
