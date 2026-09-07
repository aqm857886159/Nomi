/**
 * Depth video node — inference worker protocol (pure types/constants).
 *
 * Message shapes for the renderer-main ↔ web-worker channel (worker runs
 * onnxruntime-web WebGPU for Depth Anything V2 + MediaPipe Pose). Kept as a
 * plain module with no DOM / worker globals so it is trivially unit-testable
 * and shared between the worker entry and its orchestration client.
 */

/** Frames per transfer batch (R17: bounded IPC payloads, transferable buffers). */
export const VIDEO_DEPTH_BATCH_FRAMES = 32;

/** Worker phases surfaced to the node UI (download handled by main job, before warm). */
export type VideoDepthWorkerPhase = "idle" | "warming" | "ready" | "processing" | "done" | "cancelled" | "failed";

/** Renderer-main → worker requests. */
export type VideoDepthWorkerRequest =
  | {
      kind: "warm";
      requestId: string;
      depthModel: "small" | "base";
      depthUrl: string;
      /** Directory serving onnxruntime-web's own .mjs/.wasm assets (separate from the model URL). */
      ortWasmBaseUrl: string;
      needPose: boolean;
      poseWasmsPath?: string;
      poseTaskUrl?: string;
      maxPeople: number;
      smoothingAlpha: number;
    }
  | {
      kind: "processBatch";
      requestId: string;
      batchId: string;
      firstFrameIndex: number;
      frames: ArrayBuffer[];
      mode: "depth" | "depth_skeleton" | "original_skeleton";
      depthDirection: "nearWhite" | "nearBlack";
      outWidth: number;
      outHeight: number;
      exportPoseJson: boolean;
    }
  | { kind: "cancel"; requestId: string };

/** Worker → renderer-main responses. */
export type VideoDepthWorkerResponse =
  | { kind: "ready"; requestId: string; usedEp: "webgpu" | "wasm" }
  | { kind: "progress"; requestId: string; doneFrames: number }
  | {
      kind: "batchResult";
      requestId: string;
      batchId: string;
      /** Packed raw frames: gray (outWidth*outHeight bytes) for mode depth; rgb24 for the rest. */
      rawFrames: ArrayBuffer[];
      /** Optional per-frame pose JSON chunks (exportPoseJson). */
      poseChunks: string[];
    }
  | { kind: "cancelled"; requestId: string }
  | { kind: "error"; requestId: string; code: string; message: string; retryable: boolean };

/** A single in-flight request correlation record (idempotent dispatch guard). */
export function newVideoDepthRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `vd-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
