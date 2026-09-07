/**
 * 「提取深度」—— 推理 worker 协议（纯类型/常量，无 DOM、无 worker 全局）。
 *
 * 渲染层主线程 ↔ web worker 的消息形状。单独成模块是为了让批处理编排
 * （videoDepthBatchRunner）与 worker 本体都能引用同一份契约，且两边都能被单测覆盖。
 */
import type { VideoDepthDepthDirection } from "../../../../electron/shared/canvas/videoDepth";

/**
 * 每批传输的帧数（R17：IPC 载荷有界、用 transferable 零拷贝）。
 * 32 帧 × 518px JPEG（≈60KB）≈ 2MB/批；回传的裸帧 32 × 518×290 ≈ 4.8MB（单通道灰度），
 * 仍在一次 structured-clone transfer 的合理区间内，且批间会释放。
 */
export const VIDEO_DEPTH_BATCH_FRAMES = 32;

/**
 * worker 侧的失败分类。**每一类都必须能对用户说出下一步**，所以它是枚举不是字符串——
 * 「没有 WebGPU」和「模型文件坏了」的下一步完全不同，压成一句「处理失败」等于没说。
 */
export type VideoDepthWorkerErrorCode =
  /** 这台机器/这个 Electron 构建没有可用的 WebGPU 适配器。fail-closed：不静默退 wasm。 */
  | "webgpu-unavailable"
  /** 权重文件取不到或读不动（协议、路径、损坏）。 */
  | "model-unavailable"
  /** 会话建起来了但推理中途抛了。 */
  | "inference-failed"
  /** 还没 warm 就来了 processBatch（编排 bug，不是用户问题）。 */
  | "not-warmed";

export type VideoDepthWorkerRequest =
  | {
      kind: "warm";
      requestId: string;
      /** 深度权重的可 fetch 地址（nomi-local://model/<fileName>）。 */
      depthModelUrl: string;
      /** onnxruntime-web 自带 wasm 的目录（结尾带 /）。由构建产出，不是 CDN。 */
      ortWasmBaseUrl: string;
      /** 时序平滑系数（配方里那一个 0.35）。 */
      smoothingAlpha: number;
    }
  | {
      kind: "processBatch";
      requestId: string;
      batchId: string;
      firstFrameIndex: number;
      /** 每帧一份 JPEG 字节（transferable）。 */
      frames: ArrayBuffer[];
      depthDirection: VideoDepthDepthDirection;
      outWidth: number;
      outHeight: number;
    }
  | { kind: "cancel"; requestId: string }
  /** 一次运行结束：丢掉时序平滑状态与帧时钟，下一次运行必须从零开始。 */
  | { kind: "reset"; requestId: string };

export type VideoDepthWorkerResponse =
  | { kind: "ready"; requestId: string }
  | {
      kind: "batchResult";
      requestId: string;
      batchId: string;
      /** 打包好的裸帧：单通道灰度，w*h 字节。 */
      rawFrames: ArrayBuffer[];
    }
  | { kind: "cancelled"; requestId: string }
  | { kind: "reset"; requestId: string }
  | {
      kind: "error";
      requestId: string;
      code: VideoDepthWorkerErrorCode;
      message: string;
      retryable: boolean;
    };

export function newVideoDepthRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `vd-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
