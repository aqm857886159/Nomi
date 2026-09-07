/**
 * Depth video node — inference worker (web worker entry, full implementation).
 *
 * Runs in a renderer web worker. Depth = onnxruntime-web (WebGPU, falling
 * back to wasm) + Depth Anything V2 fp16 ONNX (dynamic input [1,3,H,W], output
 * floored to /14 — spike-verified). Pose = MediaPipe Tasks Vision
 * PoseLandmarker (full tier), loaded lazily only for pose modes.
 *
 * Per-frame pipeline (post-processing lives in depthRenderUtils /
 * skeletonRenderUtils, already unit-tested):
 *   decode JPEG → [depth] run session → EMA smooth → depthToGray
 *     → depth: raw gray | depth_skeleton: gray→rgb canvas + pose overlay
 *   [pose] detect → overlay on depth canvas OR original color frame → rgb24
 *
 * Batch loop / cancellation semantics: videoDepthBatchRunner owns the serial
 * loop; this module only implements warm + single-batch processing and exposes
 * them to the runner. The message protocol lives in ./workerProtocol.
 *
 * Model URLs are provided by the main job after download (rendered/fetched via
 * the app's local asset serving); depth-only runs never load MediaPipe.
 */

/**
 * onnxruntime-web is NOT statically bundled: bundlers rewrite its wasm/webgpu
 * dynamic loading and hang. Like removeBackground, the worker loads the ort
 * runtime at warm time from the served ort directory (ortWasmBaseUrl) via
 * dynamic import — the exact path proven in the real-WebGPU smoke.
 */
import type * as ortNs from "onnxruntime-web";
import { DepthTemporalSmoother, depthToGray } from "./depthRenderUtils";
import { renderPoseOverlay, type VideoDepthPosePerson } from "./skeletonRenderUtils";
import type { VideoDepthWorkerRequest, VideoDepthWorkerResponse } from "./workerProtocol";
import type { VideoDepthDepthDirection } from "./depthRenderUtils";

type OrtModule = typeof ortNs;

type DepthSession = ortNs.InferenceSession;
let ortRuntime: OrtModule | null = null;
let session: DepthSession | null = null;

type PoseLandmarkerInstance = {
  detectForVideo(video: ImageBitmap, timestampMs: number): { landmarks?: Array<Array<{ x: number; y: number; visibility?: number }>> };
  close(): void;
};

/** Dynamically import the served ort.min.mjs runtime (avoids bundler rewrites that hang WebGPU). */
async function loadOrtRuntime(ortBaseUrl: string): Promise<OrtModule> {
  if (ortRuntime) return ortRuntime;
  const base = ortBaseUrl.endsWith("/") ? ortBaseUrl : `${ortBaseUrl}/`;
  const mod = (await import(/* @vite-ignore */ `${base}ort.min.mjs`)) as OrtModule;
  mod.env.wasm.wasmPaths = base;
  ortRuntime = mod;
  return mod;
}
let usedEp: "webgpu" | "wasm" | null = null;
let smoothingAlpha = 0.35;
let smoother: DepthTemporalSmoother | null = null;
let frameTimeMs = 0;
let cancelRequested = false;

let poseModulePromise: Promise<typeof import("@mediapipe/tasks-vision")> | null = null;
let poseLandmarker: PoseLandmarkerInstance | null = null;
let poseAssetPath = "";
let poseTaskUrl = "";

const canvasPool = new Map<string, OffscreenCanvas>();

function post(res: VideoDepthWorkerResponse): void {
  (self as unknown as Worker).postMessage(res);
}

function canvasFor(key: string, width: number, height: number): OffscreenCanvas {
  const id = `${key}-${width}x${height}`;
  let c = canvasPool.get(id);
  if (!c) {
    c = new OffscreenCanvas(width, height);
    canvasPool.set(id, c);
  }
  return c;
}

function ctx2d(cv: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  return cv.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
}

async function decodeJpeg(bytes: ArrayBuffer): Promise<ImageBitmap> {
  return createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
}

/** RGB NCHW float32 tensor, ImageNet-normalized. */
function bitmapToTensor(bmp: ImageBitmap, width: number, height: number): Float32Array {
  const cv = canvasFor("tensor", width, height);
  const ctx = ctx2d(cv);
  ctx.drawImage(bmp, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height).data;
  const n = width * height;
  const t = new Float32Array(3 * n);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) t[c * n + i] = (img[i * 4 + c] / 255 - mean[c]) / std[c];
  }
  return t;
}

function rawDepthToUpscaled(frame: Float32Array, ow: number, oh: number, dw: number, dh: number): Float32Array {
  if (ow === dw && oh === dh) return frame;
  // Nearest/area-safe upscale via canvas: draw depth as gray, read back floats.
  const src = canvasFor("depth-src", ow, oh);
  const sctx = ctx2d(src);
  const img = sctx.createImageData(ow, oh);
  const px = img.data;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn || 1;
  for (let i = 0; i < frame.length; i++) {
    const g = Math.round(((frame[i] - mn) / range) * 255);
    px[i * 4] = g;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = g;
    px[i * 4 + 3] = 255;
  }
  sctx.putImageData(img, 0, 0);
  const dst = canvasFor("depth-dst", dw, dh);
  const dctx = ctx2d(dst);
  dctx.drawImage(src, 0, 0, dw, dh);
  const data = dctx.getImageData(0, 0, dw, dh).data;
  const out = new Float32Array(dw * dh);
  for (let i = 0; i < dw * dh; i++) out[i] = data[i * 4] / 255;
  return out;
}

function grayToRgbCanvasCtx(gray: Uint8Array, width: number, height: number): OffscreenCanvasRenderingContext2D {
  const cv = canvasFor("gray-rgb", width, height);
  const ctx = ctx2d(cv);
  const img = ctx.createImageData(width, height);
  const px = img.data;
  for (let i = 0; i < gray.length; i++) {
    const g = gray[i];
    px[i * 4] = g;
    px[i * 4 + 1] = g;
    px[i * 4 + 2] = g;
    px[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return ctx;
}

function drawOriginalCtx(bmp: ImageBitmap, width: number, height: number): OffscreenCanvasRenderingContext2D {
  const cv = canvasFor("orig", width, height);
  const ctx = ctx2d(cv);
  ctx.drawImage(bmp, 0, 0, width, height);
  return ctx;
}

function ctxToRgb24(ctx: OffscreenCanvasRenderingContext2D, width: number, height: number): Uint8Array {
  const img = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    out[i * 3] = img[i * 4];
    out[i * 3 + 1] = img[i * 4 + 1];
    out[i * 3 + 2] = img[i * 4 + 2];
  }
  return out;
}

async function ensurePoseLandmarker(wasmsPath: string, taskUrl: string): Promise<PoseLandmarkerInstance> {
  if (poseLandmarker) {
    if (poseAssetPath === wasmsPath && poseTaskUrl === taskUrl) return poseLandmarker;
    poseLandmarker.close();
    poseLandmarker = null;
  }
  poseModulePromise ??= import("@mediapipe/tasks-vision");
  const mp = await poseModulePromise;
  const fileset = await mp.FilesetResolver.forVisionTasks(wasmsPath);
  poseLandmarker = (await mp.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: taskUrl, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 4,
    minPoseDetectionConfidence: 0.5,
  })) as unknown as PoseLandmarkerInstance;
  poseAssetPath = wasmsPath;
  poseTaskUrl = taskUrl;
  return poseLandmarker;
}

function detectPoses(bmp: ImageBitmap, width: number, height: number): VideoDepthPosePerson[] {
  if (!poseLandmarker) return [];
  frameTimeMs += 33;
  const res = poseLandmarker.detectForVideo(bmp, frameTimeMs);
  const people: VideoDepthPosePerson[] = [];
  for (const lm of res.landmarks ?? []) {
    people.push(
      lm.map((p) => ({
        x: p.x, // normalized against the input video frame (== processing size)
        y: p.y,
        visibility: p.visibility,
      })),
    );
  }
  return people;
}

export async function videoDepthWarm(req: Extract<VideoDepthWorkerRequest, { kind: "warm" }>): Promise<void> {
  cancelRequested = false;
  smoothingAlpha = req.smoothingAlpha;
  smoother = new DepthTemporalSmoother(smoothingAlpha);

  if (session === null) {
    const ort = await loadOrtRuntime(req.ortWasmBaseUrl);
    try {
      session = await ort.InferenceSession.create(req.depthUrl, { executionProviders: ["webgpu"] });
      usedEp = "webgpu";
    } catch {
      session = await ort.InferenceSession.create(req.depthUrl, { executionProviders: ["wasm"] });
      usedEp = "wasm";
    }
  }

  if (req.needPose && req.poseWasmsPath && req.poseTaskUrl) {
    await ensurePoseLandmarker(req.poseWasmsPath, req.poseTaskUrl);
  }

  post({ kind: "ready", requestId: req.requestId, usedEp: usedEp ?? "wasm" });
}

export async function videoDepthProcessBatch(
  req: Extract<VideoDepthWorkerRequest, { kind: "processBatch" }>,
): Promise<void> {
  if (session === null) {
    post({ kind: "error", requestId: req.requestId, code: "not-warmed", message: "worker must be warmed before processing", retryable: true });
    return;
  }
  if (!ortRuntime) {
    post({ kind: "error", requestId: req.requestId, code: "not-warmed", message: "ort runtime not loaded", retryable: true });
    return;
  }
  const ort = ortRuntime;
  const { mode, depthDirection, outWidth, outHeight, exportPoseJson, frames } = req;
  const needDepth = mode === "depth" || mode === "depth_skeleton";
  const needPose = mode === "depth_skeleton" || mode === "original_skeleton";
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  const rawFrames: ArrayBuffer[] = [];
  const poseChunks: string[] = [];

  for (let f = 0; f < frames.length; f++) {
    if (cancelRequested) {
      post({ kind: "cancelled", requestId: req.requestId });
      return;
    }
    const bmp = await decodeJpeg(frames[f]);

    // Depth pass (dynamic input → full-res output floored to /14).
    let depth: Float32Array | null = null;
    if (needDepth) {
      const tensor = bitmapToTensor(bmp, outWidth, outHeight);
      const feeds: Record<string, ort.Tensor> = {};
      feeds[inputName] = new ort.Tensor("float32", tensor, [1, 3, outHeight, outWidth]);
      const out = await session.run(feeds);
      const depthT = out[outputName];
      const dims = depthT.dims;
      const oh = dims[dims.length - 2];
      const ow = dims[dims.length - 1];
      const d = rawDepthToUpscaled(depthT.data as Float32Array, ow, oh, outWidth, outHeight);
      depth = smoother ? smoother.push(d) : d;
    }

    // Pose pass.
    let people: VideoDepthPosePerson[] = [];
    if (needPose) {
      people = detectPoses(bmp, outWidth, outHeight);
    }

    if (mode === "depth") {
      const gray = depthToGray(depth as Float32Array, depthDirection);
      rawFrames.push(gray.buffer as ArrayBuffer);
    } else {
      // rgb24 output: original frame or depth gray as the base, pose overlaid.
      const ctx =
        mode === "original_skeleton" ? drawOriginalCtx(bmp, outWidth, outHeight) : grayToRgbCanvasCtx(depthToGray(depth as Float32Array, depthDirection), outWidth, outHeight);
      if (people.length > 0) {
        renderPoseOverlay(ctx, people, {
          widthPx: outWidth,
          heightPx: outHeight,
          style: { lineWidth: 3, jointRadius: 5, confidence: 0.35 },
        });
      }
      rawFrames.push(ctxToRgb24(ctx, outWidth, outHeight).buffer as ArrayBuffer);
    }

    if (exportPoseJson && needPose) {
      poseChunks.push(JSON.stringify(people));
    }
  }

  post({ kind: "batchResult", requestId: req.requestId, batchId: req.batchId, rawFrames, poseChunks });
}

export function videoDepthReset(): void {
  cancelRequested = false;
}

/* Dedicated-worker message entry (module worker). Guarded so importing this
 * module from tests / the main thread is a no-op. */
declare const self: DedicatedWorkerGlobalScope | undefined;
if (typeof self !== "undefined" && "postMessage" in self) {
  self.onmessage = (ev: MessageEvent<VideoDepthWorkerRequest>) => {
    const req = ev.data;
    if (req.kind === "warm") {
      void videoDepthWarm(req).catch((err: unknown) =>
        post({
          kind: "error",
          requestId: req.requestId,
          code: "warm-failed",
          message: err instanceof Error ? err.message : String(err),
          retryable: true,
        }),
      );
    } else if (req.kind === "processBatch") {
      void videoDepthProcessBatch(req);
    } else if (req.kind === "cancel") {
      cancelRequested = true;
      post({ kind: "cancelled", requestId: req.requestId });
    }
  };
}
