/**
 * 「提取深度」—— 推理 worker（渲染层 web worker 入口）。
 *
 * onnxruntime-web 的 **WebGPU** 执行器 + Depth Anything V2 Small fp16 ONNX
 * （动态输入 [1,3,H,W]，输出边长按 14 取整——spike 实测）。输出只有一种：单通道灰度深度帧。
 *
 * 后处理（灰度映射 / EMA 平滑）都在 depthRenderUtils，已被单测覆盖；这里只负责
 * 「把它们串起来」和一切与 GPU/解码有关的、单测覆盖不到的部分。
 *
 * ── 为什么没有 wasm 回退 ────────────────────────────────────────────────────────
 * 「WebGPU 建不起来就退 CPU wasm」听上去很稳，实际是把一次 4 秒的处理悄悄变成十几分钟：
 * 用户看到的是「这功能怎么这么慢」，而不是「我这台机器不支持」。所以这里 **fail-closed**：
 * 没有 WebGPU 就报 `webgpu-unavailable` 并让界面给出可行动的下一步，不静默降级。
 *
 * ── 只有一个 ort 入口 ───────────────────────────────────────────────────────────
 * 这里 import 的 `onnxruntime-web` 与抠图链路上 `@imgly/background-removal` 动态 import 的
 * **是同一个 specifier、同一份 1.21.0**（默认 bundle 已含 jsep/WebGPU 执行器）。
 * 两个入口共用一份运行时，也共用同一条前提：谁都在 create 之前显式设 wasmPaths，
 * 所以 vite.config.ts 摘掉的那份 24MB 兜底 .wasm 对两边都仍然是死代码。
 * 守卫见 src/lib/removeBackgroundBundle.test.ts。
 *
 * ── ort 的 wasm 从哪来 ──────────────────────────────────────────────────────────
 * 从 `nomi-local://runtime/ort/`（主进程按白名单伺服随包 node_modules 里那一份）。
 * 打包态渲染层是 `file://`，对 `file:` 的 fetch 一律跨源拒绝，所以必须走这条协议。
 * **在 `InferenceSession.create` 之前显式设 `env.wasm.wasmPaths`** 也是
 * vite.config.ts 里 `nomiDropDeadOrtWasmAsset` 成立的前提（见 removeBackgroundBundle.test.ts）。
 */
import * as ort from "onnxruntime-web";
import { DepthTemporalSmoother, depthToGray } from "./depthRenderUtils";
import type { VideoDepthWorkerRequest, VideoDepthWorkerResponse } from "./workerProtocol";

let session: ort.InferenceSession | null = null;
let sessionModelUrl = "";
let smoother: DepthTemporalSmoother | null = null;
let cancelRequested = false;

const canvasPool = new Map<string, OffscreenCanvas>();

function post(response: VideoDepthWorkerResponse, transfer?: Transferable[]): void {
  (self as unknown as Worker).postMessage(response, transfer ?? []);
}

function canvasFor(key: string, width: number, height: number): OffscreenCanvas {
  const id = `${key}-${width}x${height}`;
  let canvas = canvasPool.get(id);
  if (!canvas) {
    canvas = new OffscreenCanvas(width, height);
    canvasPool.set(id, canvas);
  }
  return canvas;
}

function ctx2d(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("OffscreenCanvas 2d context unavailable");
  return ctx as OffscreenCanvasRenderingContext2D;
}

/** ImageNet 归一化的 NCHW float32 张量。 */
function bitmapToTensor(bitmap: ImageBitmap, width: number, height: number): Float32Array {
  const ctx = ctx2d(canvasFor("tensor", width, height));
  ctx.drawImage(bitmap, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const pixelCount = width * height;
  const tensor = new Float32Array(3 * pixelCount);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  for (let i = 0; i < pixelCount; i += 1) {
    for (let c = 0; c < 3; c += 1) {
      tensor[c * pixelCount + i] = (pixels[i * 4 + c] / 255 - mean[c]) / std[c];
    }
  }
  return tensor;
}

/**
 * 深度图按 14 取整后比输出小一点，用 canvas 双线性放回目标尺寸。
 * 归一化在这里做一次是为了能过 8bit 通道；真正的灰度映射仍由 depthToGray 决定方向。
 */
function upscaleDepth(depth: Float32Array, srcW: number, srcH: number, dstW: number, dstH: number): Float32Array {
  if (srcW === dstW && srcH === dstH) return depth;
  const srcCtx = ctx2d(canvasFor("depth-src", srcW, srcH));
  const image = srcCtx.createImageData(srcW, srcH);
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < depth.length; i += 1) {
    if (depth[i] < min) min = depth[i];
    if (depth[i] > max) max = depth[i];
  }
  const range = max - min || 1;
  for (let i = 0; i < depth.length; i += 1) {
    const gray = Math.round(((depth[i] - min) / range) * 255);
    image.data[i * 4] = gray;
    image.data[i * 4 + 1] = gray;
    image.data[i * 4 + 2] = gray;
    image.data[i * 4 + 3] = 255;
  }
  srcCtx.putImageData(image, 0, 0);
  const dstCtx = ctx2d(canvasFor("depth-dst", dstW, dstH));
  dstCtx.imageSmoothingEnabled = true;
  dstCtx.imageSmoothingQuality = "high";
  dstCtx.drawImage(canvasFor("depth-src", srcW, srcH), 0, 0, dstW, dstH);
  const scaled = dstCtx.getImageData(0, 0, dstW, dstH).data;
  const out = new Float32Array(dstW * dstH);
  for (let i = 0; i < out.length; i += 1) out[i] = scaled[i * 4] / 255;
  return out;
}

async function ensureDepthSession(modelUrl: string, ortWasmBaseUrl: string): Promise<ort.InferenceSession> {
  if (session && sessionModelUrl === modelUrl) return session;
  if (!("gpu" in navigator)) {
    throw new WorkerFailure("webgpu-unavailable", "navigator.gpu is not available in this renderer", false);
  }
  // 顺序要紧：wasmPaths 必须在 create 之前设好（见文件头）。
  ort.env.wasm.wasmPaths = ortWasmBaseUrl.endsWith("/") ? ortWasmBaseUrl : `${ortWasmBaseUrl}/`;
  // 算子跑在 GPU 上，wasm 侧只做调度；单线程避免依赖 SharedArrayBuffer（跨源隔离可能被关掉）。
  ort.env.wasm.numThreads = 1;
  try {
    session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["webgpu"] });
  } catch (error) {
    // 不退 wasm：宁可明说「这台机器不支持」，也不把 4 秒变成十几分钟（见文件头）。
    throw new WorkerFailure(
      "webgpu-unavailable",
      error instanceof Error ? error.message : String(error),
      false,
    );
  }
  sessionModelUrl = modelUrl;
  return session;
}

class WorkerFailure extends Error {
  readonly code: "webgpu-unavailable" | "model-unavailable" | "inference-failed" | "not-warmed";
  readonly retryable: boolean;

  constructor(code: WorkerFailure["code"], message: string, retryable: boolean) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

async function handleWarm(request: Extract<VideoDepthWorkerRequest, { kind: "warm" }>): Promise<void> {
  cancelRequested = false;
  smoother = new DepthTemporalSmoother(request.smoothingAlpha);
  await ensureDepthSession(request.depthModelUrl, request.ortWasmBaseUrl);
  post({ kind: "ready", requestId: request.requestId });
}

async function handleProcessBatch(request: Extract<VideoDepthWorkerRequest, { kind: "processBatch" }>): Promise<void> {
  const { depthDirection, outWidth, outHeight, frames } = request;
  if (!session) throw new WorkerFailure("not-warmed", "depth session was never warmed", false);

  const rawFrames: ArrayBuffer[] = [];
  for (const frameBytes of frames) {
    if (cancelRequested) {
      post({ kind: "cancelled", requestId: request.requestId });
      return;
    }
    const bitmap = await createImageBitmap(new Blob([frameBytes], { type: "image/jpeg" }));
    try {
      const inputName = session.inputNames[0];
      const outputName = session.outputNames[0];
      const tensor = bitmapToTensor(bitmap, outWidth, outHeight);
      const outputs = await session.run({
        [inputName]: new ort.Tensor("float32", tensor, [1, 3, outHeight, outWidth]),
      });
      const raw = outputs[outputName];
      const dims = raw.dims;
      const scaled = upscaleDepth(
        raw.data as Float32Array,
        dims[dims.length - 1],
        dims[dims.length - 2],
        outWidth,
        outHeight,
      );
      const depth = smoother ? smoother.push(scaled) : scaled;
      rawFrames.push(depthToGray(depth, depthDirection).buffer as ArrayBuffer);
    } finally {
      bitmap.close();
    }
  }

  post({ kind: "batchResult", requestId: request.requestId, batchId: request.batchId, rawFrames }, rawFrames);
}

function failureOf(error: unknown): { code: WorkerFailure["code"]; message: string; retryable: boolean } {
  if (error instanceof WorkerFailure) return { code: error.code, message: error.message, retryable: error.retryable };
  return { code: "inference-failed", message: error instanceof Error ? error.message : String(error), retryable: true };
}

self.onmessage = (event: MessageEvent<VideoDepthWorkerRequest>) => {
  const request = event.data;
  if (request.kind === "cancel") {
    cancelRequested = true;
    post({ kind: "cancelled", requestId: request.requestId });
    return;
  }
  if (request.kind === "reset") {
    cancelRequested = false;
    smoother?.reset();
    post({ kind: "reset", requestId: request.requestId });
    return;
  }
  const run = request.kind === "warm" ? handleWarm(request) : handleProcessBatch(request);
  void run.catch((error: unknown) => {
    const failure = failureOf(error);
    post({ kind: "error", requestId: request.requestId, ...failure });
  });
};
