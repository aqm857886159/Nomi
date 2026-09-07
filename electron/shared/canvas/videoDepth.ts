/**
 * 「提取深度」—— 跨进程契约（唯一 owner）。
 *
 * 纯数据，渲染层（动作 / 编排客户端）与主进程（job 执行）共用。
 * 不 import Electron / React / fs / i18n / provider，遵循 electron/shared/canvas/ 的既有约定。
 *
 * ── 用户价值（2026-09-07 用户原话）────────────────────────────────────────────────
 * 「给一段参考视频（如 30 秒打斗镜头）→ 出深度视频 → 当动作参考喂视频模型、只换人物。」
 * 产物是**画布上一个普通视频资产**：能拖进任意模型的参考槽，也能直接导出。
 * 本动作不认识任何供应商、不做特殊接线（P4）。
 *
 * ── 为什么这里没有一个「设置」对象（2026-09-07 用户拍板）──────────────────────────
 * 拍板原话：「其实如果这么砍了之后 也没啥设计的 只要保持一致 能挂入参考被模型使用就行」。
 * 于是输出只剩**一种**：DA2 Small、518px、整段、灰度深度视频。没有面板、没有三选一、
 * 没有「高级」——用户在那一刻**没有判断依据**去选 12 还是 30fps、0.35 还是 0.5 平滑，
 * 问他等于把我们的功课推给他（D1）。
 *
 * 所以这一版删掉的不是「界面上那几个控件」，是**整个可变参数的概念**：
 * 没有 settings schema、没有跨进程传参、没有节点上的参数 meta。留一份「界面不暴露但仍然
 * 传来传去」的设置对象，等于给「顺手把面板加回来」发返场票（P1）。这次跑用什么档，
 * 答案只有一个地方——下面这个 `VIDEO_DEPTH_RECIPE`。
 *
 * ── 相对 PR #572 / 上一版主动砍掉的东西（P1：不留没有消费方的半成品）──────────────
 * `depthModel` / `poseModel` / `depthStyle` / `exportPoseJson`（#572 那一版）；
 * 本次再砍：`mode`（深度 / 深度+骨架 / 原片+骨架三选一）连同**整条骨架推理链**、
 * `maxPeople`、`maxResolution`（只剩 518）、`processingFps` / `temporalSmoothing` /
 * `trimStart|EndSeconds`（收进配方）、以及 rgb24 这一半像素格式（只剩灰度）。
 * 砍掉 = 从契约里删掉，不是留着不解析。
 */

/**
 * 深度图的灰度方向。**不是设置**，是渲染事实的两半：`depthToGray` 两条分支各有单测。
 * v1 固定用 `nearWhite`（近处更亮，与 depth.cards 一致，也是那次真实 A/B 用的那一组）。
 */
export const VIDEO_DEPTH_DEPTH_DIRECTIONS = ["nearWhite", "nearBlack"] as const;
export type VideoDepthDepthDirection = (typeof VIDEO_DEPTH_DEPTH_DIRECTIONS)[number];

/**
 * 这次处理用的**唯一一份配方**。三个数各自有出处，都不是随手定的：
 * · `maxResolutionPx: 518` —— DA2 ViT-S 的原生训练输入（14×37）。比全分辨率快约 3 倍，
 *   而产物是给下游模型看的结构信号、不是给人看的成片。
 * · `processingFps: 30` —— 常见素材的原生帧率；再高只是把同一段动作切得更碎。
 * · `temporalSmoothing: 0.35` —— docs/research/2026-09-07-motion-ref-raw-vs-depth.md
 *   那次真实 A/B 用的那一组，改动会让那份实测失去可比性。
 */
export const VIDEO_DEPTH_RECIPE = {
  maxResolutionPx: 518,
  processingFps: 30,
  temporalSmoothing: 0.35,
  depthDirection: "nearWhite" as VideoDepthDepthDirection,
} as const;

/**
 * 画布上那段源视频的身份。产物落回来时用它连线，也是「源没了」的判据。
 * 这是一个**渲染层内部**的形状（不跨进程——跨进程只传 sourceUrl），所以是普通类型不是 schema。
 */
export type VideoDepthSourceReference = {
  sourceNodeId: string;
  sourceUrl: string;
  title: string;
  durationSeconds?: number;
};

/** 规划时已知的源事实（来自 ffprobe）。 */
export type VideoDepthSourceFacts = {
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type VideoDepthProcessingPlan = {
  outWidth: number;
  outHeight: number;
  /** 源时长未知时为 null；job 在 ffprobe 之后必然有值。 */
  durationSeconds: number | null;
  totalFramesEstimate: number | null;
  /** 全部帧展开成裸像素的字节数——预算门岗与「预计耗时」共用同一个数。 */
  expectedRawBytes: number | null;
};

/**
 * 裸帧是**单通道灰度**，一个像素一个字节。
 *
 * 这曾经是个 `"gray" | "rgb24"` 的联合：rgb24 那一半只为骨架模式存在（要画彩色骨架线）。
 * 骨架模式随这一版一起删了，所以联合的另一半没有任何取值路径能到达——留着就是让下一个人
 * 以为「换个模式就能出彩色」（P1）。
 */
export const VIDEO_DEPTH_RAW_BYTES_PER_PIXEL = 1;

export function computeExpectedRawBytes(frameCount: number, outWidth: number, outHeight: number): number {
  return frameCount * outWidth * outHeight * VIDEO_DEPTH_RAW_BYTES_PER_PIXEL;
}

/** yuv420p 要求偶数边长。 */
function even(n: number): number {
  return Math.max(2, Math.floor(n / 2) * 2);
}

function scaleToLongestEdge(width: number, height: number, limit: number): { w: number; h: number } {
  const longest = Math.max(width, height);
  if (longest <= limit) return { w: even(width), h: even(height) };
  const k = limit / longest;
  return { w: even(Math.round(width * k)), h: even(Math.round(height * k)) };
}

/**
 * 输出尺寸 + 帧数/字节数估算。整段处理，不裁剪。
 * 源尺寸/时长未知时**不编数字**：`totalFramesEstimate` / `expectedRawBytes` 为 null，
 * 上游据此 fail-closed 而不是拿一个假的预估去开跑（D4：缺口明着标）。
 */
export function deriveProcessingPlan(source: VideoDepthSourceFacts): VideoDepthProcessingPlan {
  const durationSeconds = source.durationSeconds !== undefined && source.durationSeconds > 0 ? source.durationSeconds : null;
  const knownSize = source.width !== undefined && source.height !== undefined;
  let outWidth = 0;
  let outHeight = 0;
  if (knownSize) {
    ({ w: outWidth, h: outHeight } = scaleToLongestEdge(
      source.width as number,
      source.height as number,
      VIDEO_DEPTH_RECIPE.maxResolutionPx,
    ));
  }

  const totalFramesEstimate =
    durationSeconds !== null ? Math.max(1, Math.round(durationSeconds * VIDEO_DEPTH_RECIPE.processingFps)) : null;
  const expectedRawBytes =
    totalFramesEstimate !== null && knownSize ? computeExpectedRawBytes(totalFramesEstimate, outWidth, outHeight) : null;

  return { outWidth, outHeight, durationSeconds, totalFramesEstimate, expectedRawBytes };
}

/**
 * 裸像素预算上限。
 *
 * 为什么在只有一档分辨率之后**仍然需要它**：518px 封住的是每帧多大，封不住片子多长。
 * 一段一小时的素材按 30fps 就是 10.8 万帧，跑上小时级——用户等不起，必须在开跑**之前**
 * 拦下来，而不是让他等半小时再发现。我们不落中间 `.raw` 文件（帧直接 pipe 进 ffmpeg
 * stdin，见 depthVideoPipeline.ts），所以这不是磁盘风险，是**时间**风险的诚实度量。
 */
export const VIDEO_DEPTH_MAX_RAW_BYTES = 4 * 1024 * 1024 * 1024;

export type VideoDepthBudgetVerdict =
  | { ok: true }
  | { ok: false; reason: "unknown-source" }
  | { ok: false; reason: "over-budget"; expectedRawBytes: number; limitBytes: number };

/** 开跑前的预算判定。源事实不全 = 不放行（fail-closed，不猜）。 */
export function checkVideoDepthBudget(plan: VideoDepthProcessingPlan): VideoDepthBudgetVerdict {
  if (plan.expectedRawBytes === null) return { ok: false, reason: "unknown-source" };
  if (plan.expectedRawBytes > VIDEO_DEPTH_MAX_RAW_BYTES) {
    return {
      ok: false,
      reason: "over-budget",
      expectedRawBytes: plan.expectedRawBytes,
      limitBytes: VIDEO_DEPTH_MAX_RAW_BYTES,
    };
  }
  return { ok: true };
}
