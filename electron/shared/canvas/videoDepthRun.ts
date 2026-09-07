/**
 * 深度视频节点 —— 一次运行的阶段词表与纯 reducer（跨进程唯一 owner）。
 *
 * ── 为什么这张表住在共享层 ──────────────────────────────────────────────────────
 * 这次运行由**渲染层编排**（推理必须在渲染层的 WebGPU worker 里跑），主进程负责它做不到的那几段
 * （ffmpeg 抽帧、权重下载、合成落盘）。两边都要对同一件事说话：现在到哪一步了。
 * 如果各写各的枚举，就会出现「主进程说 encoding、界面说 processing」这类同一语义两份定义
 * （R14.1 横扫要抓的正是这个）。所以阶段只有这一份，reducer 也只有这一份，
 * 两个进程都从这里 import，`check:vocabularies` 按单一 owner 登记它。
 *
 * 阶段顺序（每一步都对用户可见，因为每一步的等待理由不同）：
 *   idle → downloading → extracting → warming → processing → encoding → done
 *                                  \                                  /
 *                                   ---------→ failed | cancelled ←---
 */

export const VIDEO_DEPTH_PHASES = [
  "idle",
  /** 首次使用：下载权重（用户拍板①，约 50MB）。已缓存则整段跳过。 */
  "downloading",
  /** ffmpeg 按裁剪窗口/帧率/分辨率抽帧。 */
  "extracting",
  /** worker 建 WebGPU 会话 + 编译着色器（第一次最慢，第二次复用）。 */
  "warming",
  /** 逐帧推理。唯一有「剩余时间」可估的阶段。 */
  "processing",
  /** ffmpeg 把裸帧合成 mp4 并落成项目资产。 */
  "encoding",
  "done",
  "failed",
  "cancelled",
] as const;

export type VideoDepthPhase = (typeof VIDEO_DEPTH_PHASES)[number];

export const TERMINAL_VIDEO_DEPTH_PHASES: ReadonlySet<VideoDepthPhase> = new Set(["done", "failed", "cancelled"]);

/**
 * prepare 期间由**主进程**推送的那两段。
 * 渲染层在这两段里什么都看不见（帧还没抽出来、权重还没下完），所以只有这两段需要跨进程推。
 * 它是 `VideoDepthPhase` 的子集而不是第二份词表——写成 `Extract` 是为了让阶段名改动时
 * 编译器先红，而不是两处字面量悄悄走散。
 */
export type VideoDepthMainOwnedPhase = Extract<VideoDepthPhase, "downloading" | "extracting">;

export function isTerminalVideoDepthPhase(phase: VideoDepthPhase): boolean {
  return TERMINAL_VIDEO_DEPTH_PHASES.has(phase);
}

/**
 * 失败分类。每一类都必须能对用户说出**下一步**——压成一句「处理失败」等于没说
 * （`check:outbound-policy` 规则 4 抓的就是那一族）。
 */
export type VideoDepthErrorCode =
  /** 源视频不在项目里/读不动。 */
  | "source-unavailable"
  /** ffprobe 量不出尺寸或时长——量不出就不开跑，不猜默认值。 */
  | "source-unmeasurable"
  /** 这次的参数会跑到天荒地老（预算门在开跑前拦下）。 */
  | "over-budget"
  /** 权重下载失败（网络/出站策略/校验）。 */
  | "model-download-failed"
  /** 这台机器没有可用的 WebGPU。fail-closed，不静默退 CPU。 */
  | "webgpu-unavailable"
  /** 推理中途抛了。 */
  | "inference-failed"
  /** ffmpeg 抽帧或合成失败。 */
  | "media-failed"
  /** 同一个项目已经有一个深度任务在跑。 */
  | "already-running";

export type VideoDepthProgress =
  | { kind: "bytes"; doneBytes: number; totalBytes: number }
  | { kind: "frames"; doneFrames: number; totalFrames: number; etaSeconds: number | null };

export type VideoDepthRunState = {
  phase: VideoDepthPhase;
  jobId: string;
  progress?: VideoDepthProgress;
  error?: { code: VideoDepthErrorCode; message: string; retryable: boolean };
  result?: { url: string; assetId?: string };
};

export type VideoDepthRunEvent =
  | { kind: "enter"; phase: Exclude<VideoDepthPhase, "done" | "failed" | "cancelled"> }
  | { kind: "bytes"; doneBytes: number; totalBytes: number }
  | { kind: "frames"; doneFrames: number; totalFrames: number; etaSeconds: number | null }
  | { kind: "done"; url: string; assetId?: string }
  | { kind: "cancel" }
  | { kind: "fail"; code: VideoDepthErrorCode; message: string; retryable: boolean };

export function initialVideoDepthRunState(jobId: string): VideoDepthRunState {
  return { phase: "idle", jobId };
}

/**
 * 纯 reducer。终态吸收一切后续事件——取消之后迟到的一条 `frames` 不该把界面
 * 从「已取消」拽回「处理中」（真实竞态：取消发出去时最后一批还在 worker 里跑）。
 */
export function nextVideoDepthRunState(state: VideoDepthRunState, event: VideoDepthRunEvent): VideoDepthRunState {
  if (isTerminalVideoDepthPhase(state.phase)) return state;
  switch (event.kind) {
    case "enter": {
      const next: VideoDepthRunState = { ...state, phase: event.phase };
      delete next.progress;
      return next;
    }
    case "bytes":
      if (state.phase !== "downloading") return state;
      return { ...state, progress: { kind: "bytes", doneBytes: event.doneBytes, totalBytes: event.totalBytes } };
    case "frames":
      if (state.phase !== "processing") return state;
      return {
        ...state,
        progress: {
          kind: "frames",
          doneFrames: event.doneFrames,
          totalFrames: event.totalFrames,
          etaSeconds: event.etaSeconds,
        },
      };
    case "done": {
      const next: VideoDepthRunState = { ...state, phase: "done", result: { url: event.url, assetId: event.assetId } };
      delete next.progress;
      return next;
    }
    case "cancel": {
      const next: VideoDepthRunState = { ...state, phase: "cancelled" };
      delete next.progress;
      return next;
    }
    case "fail": {
      const next: VideoDepthRunState = {
        ...state,
        phase: "failed",
        error: { code: event.code, message: event.message, retryable: event.retryable },
      };
      delete next.progress;
      return next;
    }
  }
}

/**
 * 剩余时间估算：用**实测**的每帧耗时外推，不用任何硬编码常量。
 * 前几帧含 shader 编译与缓存预热，快慢差一个数量级——所以在 `minSamples` 帧之前
 * 一律返回 null（界面显示「正在测速」而不是一个会跳的假数字）。
 */
export function estimateVideoDepthEtaSeconds(input: {
  doneFrames: number;
  totalFrames: number;
  elapsedMsSinceFirstFrame: number;
  minSamples?: number;
}): number | null {
  const minSamples = input.minSamples ?? 4;
  if (input.doneFrames < minSamples || input.doneFrames >= input.totalFrames) return null;
  if (input.elapsedMsSinceFirstFrame <= 0) return null;
  const msPerFrame = input.elapsedMsSinceFirstFrame / input.doneFrames;
  return Math.round(((input.totalFrames - input.doneFrames) * msPerFrame) / 1000);
}
