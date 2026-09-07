/**
 * Depth video node — main-process job state machine (pure reducer).
 *
 * Models the deterministic phase transitions for a single depth-process job.
 * Side effects (ffmpeg spawn, model download, IPC, writeAsset) live in the
 * surrounding job driver and are exercised through this reducer; the reducer
 * itself has no IO so every transition is unit-testable.
 *
 * Phases: download-model → warming → processing → encoding → done
 *                          \                              /
 *                           ----------<-- (failed | cancelled)
 */

export type VideoDepthJobPhase =
  | "idle"
  | "download-model"
  | "warming"
  | "processing"
  | "encoding"
  | "done"
  | "failed"
  | "cancelled";

export type VideoDepthJobEvent =
  | { kind: "start" }
  | { kind: "download-progress"; doneBytes: number; totalBytes: number }
  | { kind: "download-done" }
  | { kind: "warm-done" }
  | { kind: "batch-progress"; doneFrames: number; totalFrames: number }
  | { kind: "batches-done" }
  | { kind: "encode-done"; assetId: string }
  | { kind: "pose-json-written"; assetId: string }
  | { kind: "cancel" }
  | { kind: "fail"; code: string; message: string; retryable: boolean };

export type VideoDepthProgress =
  | { kind: "download"; doneBytes: number; totalBytes: number }
  | { kind: "frames"; doneFrames: number; totalFrames: number }
  | { kind: "pose-json"; assetId: string };

export type VideoDepthJobState = {
  phase: VideoDepthJobPhase;
  jobId: string;
  attempts: number;
  progress?: VideoDepthProgress;
  error?: { code: string; message: string; retryable: boolean };
  result?: { videoAssetId: string; poseAssetId?: string };
};

export const TERMINAL_VIDEO_DEPTH_PHASES: ReadonlySet<VideoDepthJobPhase> = new Set([
  "done",
  "failed",
  "cancelled",
]);

export function initialVideoDepthJobState(jobId: string): VideoDepthJobState {
  return { phase: "idle", jobId, attempts: 0 };
}

export function nextVideoDepthJobState(
  state: VideoDepthJobState,
  ev: VideoDepthJobEvent,
): VideoDepthJobState {
  const s: VideoDepthJobState = { ...state };
  switch (ev.kind) {
    case "start":
      if (s.phase === "idle") {
        s.phase = "download-model";
        s.attempts += 1;
      }
      return s;
    case "download-progress":
      if (s.phase === "download-model") {
        s.progress = { kind: "download", doneBytes: ev.doneBytes, totalBytes: ev.totalBytes };
      }
      return s;
    case "download-done":
      if (s.phase === "download-model") {
        s.phase = "warming";
        delete s.progress;
      }
      return s;
    case "warm-done":
      if (s.phase === "warming") {
        s.phase = "processing";
      }
      return s;
    case "batch-progress":
      if (s.phase === "processing") {
        s.progress = { kind: "frames", doneFrames: ev.doneFrames, totalFrames: ev.totalFrames };
      }
      return s;
    case "batches-done":
      if (s.phase === "processing") {
        s.phase = "encoding";
        delete s.progress;
      }
      return s;
    case "encode-done":
      if (s.phase === "encoding") {
        s.result = { ...(s.result ?? { videoAssetId: ev.assetId }), videoAssetId: ev.assetId };
        s.phase = "done";
        delete s.progress;
      }
      return s;
    case "pose-json-written":
      if (s.phase === "encoding" || s.phase === "done") {
        s.result = { ...(s.result ?? { videoAssetId: "" }), poseAssetId: ev.assetId };
        s.phase = "done";
      }
      return s;
    case "cancel":
      if (!TERMINAL_VIDEO_DEPTH_PHASES.has(s.phase)) {
        s.phase = "cancelled";
        delete s.progress;
      }
      return s;
    case "fail":
      if (!TERMINAL_VIDEO_DEPTH_PHASES.has(s.phase)) {
        s.phase = "failed";
        s.error = { code: ev.code, message: ev.message, retryable: ev.retryable };
        delete s.progress;
      }
      return s;
  }
}

/** Whether the state already represents a terminal outcome. */
export function isVideoDepthJobTerminal(s: VideoDepthJobState): boolean {
  return TERMINAL_VIDEO_DEPTH_PHASES.has(s.phase);
}
