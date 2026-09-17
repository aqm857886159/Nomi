// 视频拆解编排：一条本地视频 → 一张结构化分镜表。
//
// 三条上游合流（其中两条是**现成的**，只有取音轨是本次新增）：
//   画面 ── detectShotCuts 找切点(本地 ffmpeg,零成本) → 每镜抽 N 帧 → 多模态 chat 一次读 N 帧
//   声音 ── extractAudioTrack(新) → 已接好的 whisper-1 转写(verbose_json,带时间戳)
//   合流 ── shotTimeline.assignSegmentsToShots 按时间戳把句子归属到镜头
//
// 为什么一镜喂多帧而不是一帧（实测，见 docs/plan/2026-08-13-video-deconstruction-storyboard-table.md）：
// 单帧会漏掉「出现又消失」的字幕/角标/价格——同一镜的 3 帧里，下载弹窗只在第 3 帧出现。
// 而多帧几乎白送：image token 线性涨，**墙钟只慢 26%**（8.8s → 11.1s，瓶颈在模型思考不在传图）。
//
// 为什么 maxTokens 给到 4000：gemini-3.5-flash 是**思考型**模型，回「可用」两个字都要烧 47
// completion_tokens。给小了 → 正文为空 + finishReason='length'，看着像模型不行，其实是自己截断的。
import { detectShotCuts } from "./detectShotCuts";
import { extractAudioTrack } from "./extractAudioTrack";
import { extractVideoFrameToAsset, resolveVideoLocalPath } from "./extractVideoFrame";
import { probeMediaMetadata } from "../export/mediaProbe";
import {
  assignSegmentsToShots,
  buildShotBoundaries,
  sampleSecondsForShot,
  type ShotBoundary,
  type TranscriptSegment,
} from "./shotTimeline";
import { quantizeShotSeconds } from "../shared/canvas/shotTime";
import { firstString, isJsonRecord, parseLooseJsonObject, trim } from "../jsonUtils";
// main 上 chooseTextModel/resolveTextBrainKeys 已从 agentChatV2 抽到 textBrainResolver（1040 commit 间的重构）；
// 旧分支从 agentChatV2 import 已失效，port 时改指真源（docs/ARCHITECTURE-NOW 的「文本大脑」判据同一处）。
import { resolveTextBrainKeys } from "../ai/textBrainResolver";
import { runTask } from "../runtime";
import { findExecutableModel, findExecutableModelAnyVendor } from "../catalog/executableModel";
import { readVendorPreferenceSettings } from "../settings/vendorPreferenceSettings";
import { getDesktopLocale } from "../i18n";
import { isSpendAuthorizationError } from "../spendGrant";
import { logError } from "../logging/logger";
import { desktopT } from "../i18n";

/** 用户自定义列：`hint` 会拼进 VLM 的输出 schema —— 你想让 AI 关注什么，就加一列告诉它。 */
export type DeconstructColumn = {
  name: string;
  hint?: string;
};

export type DeconstructShot = {
  index: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  /** 原片帧（该镜中点那张）：**只读对照**，默认不喂给模型。见 plan §1.2。 */
  sourceFrameUrl: string;
  shotSize: string;
  mood: string;
  visual: string;
  onScreenText: string;
  dialogue: string;
  /** 上一镜的话说到了这一镜 → UI 标「承接上镜」，别让用户以为漏词了。 */
  carriedOver: boolean;
  imagePrompt: string;
  motionPrompt: string;
  custom: Record<string, string>;
  /** 这一镜的画面分析没成功（其余字段仍可用，比如对白）。诚实标出来，不假装拆成功。 */
  visionFailed?: boolean;
  /** 这一镜为什么没读出来（供应商原话/抽帧失败）。空着的格子背后总有一句能说的话。 */
  failureReason?: string;
};

export type DeconstructVideoPayload = {
  videoUrl: string;
  projectId: string;
  /** 切点灵敏度；不传用 detectShotCuts 的默认低阈值全集。 */
  threshold?: number;
  /** 每镜取几帧，默认 3。调到 1 = 省钱档（会漏快闪字幕）。 */
  framesPerShot?: number;
  customColumns?: DeconstructColumn[];
  /** 同时在跑的镜头数。默认 4：再高对单条视频收益递减，且容易撞供应商限流。 */
  concurrency?: number;
  /** Retry only these measured shot indexes; all boundaries and dialogue timing remain derived from the source. */
  shotIndexes?: number[];
  /** 这次拆解挂在哪个画布节点上（分镜表节点）。付费令牌按节点记预算，traceVendorRequested 也按它归档。 */
  nodeId?: string;
  /**
   * 这次对白用**哪一条转写线**。缺省 = 沿用既有的自动解析（跟着文本大脑那家的音频线走）。
   * 显式给 `local-speech` 那一行就是本地离线转写；显式给 `"cloud"` 就是**这次强制走云端**
   * （本地跑挂之后那个「改用云端重试」按钮走的正是它——它必须是一个**显式的用户动作**，
   * 不能由代码在失败时自己切，那样用户会在不知情的情况下花钱，也就再没人知道本地那条坏了）。
   */
  transcribe?: { vendorKey: string; modelKey: string } | "cloud";
};

/** 本次拆解会真正发出的付费调用之一。一行一次——报价、令牌预算、真实调用三者同一个计数。 */
export type DeconstructSpendLine = {
  vendorKey: string;
  modelKey: string;
  parameters?: Record<string, unknown>;
};

/** 开跑前摆给用户看的那张账：拆几镜、用哪个模型、一共几次调用。 */
export type DeconstructSpendPlan = {
  projectId: string;
  nodeId: string;
  shotCount: number;
  vision: { vendorKey: string; modelKey: string };
  lines: DeconstructSpendLine[];
};

/**
 * 钱的闸。返回 grantId = 用户（或档位）批了这一整批；返回 null = 没批。
 *
 * **必填，不给默认值**：runTask 的付费出口靠「调用方记得带 grantId」，而漏带只在运行期炸、
 * 还会被 catch 吞成「没读出」（2026-09-11 用户撞上的正是这个）。让编译器在这一层就拦住
 * （R28：能让编译器拦的别留给门岗）。
 */
export type DeconstructAuthorizeSpend = (plan: DeconstructSpendPlan) => Promise<string | null>;

/** 一镜分析完的中间形态（编排内部用；失败时带原因，不是只留一个空对象）。 */
type AnalyzedShot = {
  shot: ShotBoundary;
  frameUrls: string[];
  parsed: Record<string, unknown> | null;
  failureReason?: string;
};

export type DeconstructVideoOptions = {
  /**
   * `detail` 是阶段内部那句更细的话（本地转写的下载/分段进度）。
   * 只有会长时间停在一个阶段的路才会给它，云端那两条不给——**不按 vendor 分支**，谁报谁给。
   */
  onPhase?: (phase: 0 | 1 | 2, detail?: string) => void;
  authorizeSpend: DeconstructAuthorizeSpend;
};

export type DeconstructVideoResult = {
  shots: DeconstructShot[];
  durationSeconds: number;
  hasAudio: boolean;
  /** 整次失败的**类别**（机器可读）。`local-speech` = 本地离线转写那一路挂了，UI 据此给「改用云端重试」。 */
  failureKind?: "local-speech";
  /** 画面分析失败的镜号（诚实回报，UI 据此提示「这几镜没读出来，可单独重试」）。 */
  failedShotIndexes: number[];
  /**
   * 整次拆解层面的失败原因（如「对白没取到：这台机器上没有可用的转写模型」）。
   * UI 顶部**一行**显示它——不是每一格摊一句「没读出」（B10 拍板：一条原因，不要满屏兜底文案）。
   */
  failureReason?: string;
};

export class DeconstructError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeconstructError";
  }
}

export const DECONSTRUCT_FRAMES_PER_SHOT = 3;
export const DECONSTRUCT_CONCURRENCY = 4;
export const DECONSTRUCT_MAX_TOKENS = 4000;

/**
 * 拼 VLM 的提示词。自定义列在这里**动态进 schema** —— 这是「加一列就等于告诉 AI 多看一个维度」
 * 的实现点（derive 不 hardcode：列是用户数据，schema 随它长）。
 */
export function buildShotAnalysisPrompt(shot: ShotBoundary, frameCount: number, columns: DeconstructColumn[]): string {
  const extraKeys = columns
    .filter((c) => trim(c.name))
    .map((c) => `  "${trim(c.name)}": "${trim(c.hint) || `该镜的「${trim(c.name)}」`}"`);
  return [
    `你在拆解一条广告片的第 ${shot.index} 个镜头（${shot.startSeconds.toFixed(1)}s–${shot.endSeconds.toFixed(1)}s）。`,
    `下面是这一镜按时间顺序的 ${frameCount} 帧。它们是**同一个镜头**的不同时刻，请合起来看，不要当成 ${frameCount} 个镜头。`,
    "特别注意：有些文字（字幕/价格/促销角标）只在部分帧出现，请把**所有帧里出现过的**屏幕文字都收进 onScreenText。",
    "只返回 JSON，不要 markdown、不要代码块、不要任何解释。JSON 结构：",
    "{",
    '  "shotSize": "景别，从 极特写/特写/近景/中景/全景/远景 里选一个",',
    '  "mood": "情绪，2-4 个字",',
    '  "visual": "画面描述，30-60 字，说清主体、动作、构图、光线",',
    '  "onScreenText": "画面上出现的文字，多条用 / 分隔；没有就空字符串",',
    '  "imagePrompt": "可直接喂图片模型的提示词，含主体/构图/光线/材质/风格",',
    '  "motionPrompt": "运镜提示词，只说镜头怎么动、主体怎么演进，不要复述静态外观"',
    ...(extraKeys.length ? [",", extraKeys.join(",\n")] : []),
    "}",
  ].join("\n");
}

/** 简易并发闸：不引依赖，够用就好。 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor;
      cursor += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 从任务结果里取文本（文本任务的 raw 被合成成 OpenAI choices 形状）。 */
function textFromTaskResult(raw: unknown): string {
  if (!isJsonRecord(raw)) return "";
  const choices = raw.choices;
  if (!Array.isArray(choices) || !choices.length) return "";
  const first = choices[0];
  if (!isJsonRecord(first)) return "";
  const message = first.message;
  return isJsonRecord(message) ? firstString(message.content) : "";
}

async function transcribeShots(
  videoUrl: string,
  projectId: string,
  boundaries: ShotBoundary[],
  leg: { vendorKey: string; modelKey: string; grantId: string; nodeId: string },
  onDetail?: (detail: string) => void,
): Promise<{ hasAudio: boolean; dialogues: ReturnType<typeof assignSegmentsToShots>; failureReason?: string; failureKind?: "local-speech" }> {
  const empty = assignSegmentsToShots([], boundaries);
  // ⚠️ 这个函数**绝不能 reject**：调用方把它当悬空 promise 先起跑、几十秒后才 await，
  // 中间若抛出，Node 会判「未处理的 rejection」→ 主进程崩 → IPC 侧只看到
  // 「reply was never sent」，完全查不出真因（2026-08-13 真踩，排查了两轮）。
  // 所以取音轨这一步也必须包住——它会因「视频太长/没装 ffmpeg」正常抛错。
  let track: Awaited<ReturnType<typeof extractAudioTrack>>;
  try {
    track = await extractAudioTrack({ videoUrl, projectId });
  } catch (error) {
    logError("tasks", "deconstruct.audio-track-failed", error, { projectId });
    return { hasAudio: false, dialogues: empty, failureReason: messageOf(error) };
  }
  // 没有音轨不是错误——广告片常是纯画面/纯音乐。对白列留空，拆解照跑。
  if (!track.hasAudio || !track.url) return { hasAudio: false, dialogues: empty };

  // 本地转写那条线会在这几分钟里持续报进度（先下引擎与权重、再逐段推理）。云端那两条不报，
  // 于是这个登记器对它们就是个空操作——**不按 vendor 分支**，谁报谁用（P4）。
  const { registerLocalSpeechProgressSink } = await import("../localSpeech/localSpeechProgressBus");
  const releaseSink = registerLocalSpeechProgressSink(leg.nodeId, (progress) => {
    if (progress.phase === "starting") {
      // 没有 GPU 加速时才说——有加速时这句话只会变成噪音（R2：没有行动价值的信息就删）。
      if (!progress.gpuAccelerated) onDetail?.(desktopT("localSpeech.noGpuNotice", { minutes: progress.estimatedMinutes }));
      return;
    }
    onDetail?.(
      progress.phase === "downloading"
        ? desktopT("localSpeech.progressDownload", {
            done: Math.round(progress.doneBytes / 1_000_000),
            total: Math.round(progress.totalBytes / 1_000_000),
          })
        : desktopT("localSpeech.progressChunk", {
            index: progress.chunkIndex + 1,
            count: progress.chunkCount,
            done: Math.round(progress.doneSeconds),
            total: Math.round(progress.totalSeconds),
          }),
    );
  });
  try {
    const result = await runTask({
      vendor: leg.vendorKey,
      request: {
        kind: "transcribe",
        prompt: "",
        // grantId/nodeId 必须带：转写走 runtime 的音频付费出口（runtime.ts 的 consumeTaskSpend）。
        // 2026-09-09 之前这里的注释写着「早于 grant 校验返回」——那条前提当天就被删了，
        // 而注释留到了 09-11，于是对白列跟画面列一起变成空白（诊断 D）。
        // language 随输入派生，不 hardcode（2026-09-17）：原来写死 "zh"，英文用户的视频
        // 被按中文转写。它同时进 spend plan 的 parameters，报价与真实调用看到的是同一个值。
        extras: { projectId, file: track.url, language: transcribeLanguage(), modelKey: leg.modelKey, grantId: leg.grantId, nodeId: leg.nodeId },
      },
    });
    const raw = (result as { raw?: unknown }).raw;
    const segments: TranscriptSegment[] = isJsonRecord(raw) && Array.isArray(raw.segments)
      ? raw.segments.flatMap((item) => {
          if (!isJsonRecord(item)) return [];
          const start = Number(item.start);
          const end = Number(item.end);
          const text = firstString(item.text);
          if (!Number.isFinite(start) || !text.trim()) return [];
          return [{ start, end: Number.isFinite(end) ? end : start, text }];
        })
      : [];
    return { hasAudio: true, dialogues: assignSegmentsToShots(segments, boundaries) };
  } catch (error) {
    // 转写挂了不该毁掉整次拆解——画面那半仍然有价值。但**原因要带回去**：
    // 顶上一行说清「对白为什么是空的」，不再让用户对着空列猜（诊断「静默吞错门」第 2 行）。
    logError("tasks", "deconstruct.transcribe-failed", error, { projectId });
    // 本地那条线的失败要**带上机器可读的类别**，UI 据此给出「改用云端重试」那个按钮。
    // 认的是错误对象的 name，不是文案——文案会翻译、会改写，拿它当判据迟早静默失效。
    const failureKind = error instanceof Error && error.name === "LocalSpeechError" ? ("local-speech" as const) : undefined;
    return { hasAudio: true, dialogues: empty, failureReason: messageOf(error), ...(failureKind ? { failureKind } : {}) };
  } finally {
    releaseSink();
  }
}

/**
 * 转写语言。**随输入派生**，不写死（2026-09-17）：原来是 `language: "zh"`，
 * 于是英文界面的用户把一段英文视频拆出来，转写请求仍然按中文发。
 * 这里只修默认派生（取界面语言）；把它做成用户可选那一步归 TODO 的 T-DS-15。
 */
function transcribeLanguage(): string {
  return getDesktopLocale() === "en" ? "en" : "zh";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 解出转写会用的那一行模型（与 runtime 用同一个解析器，报价才对得上真实扣费）。

 * **两件事合在这一个解析器里，都保留：**
 * ① 显式指定优先——`{vendorKey,modelKey}` 就按它解（本地转写那条线靠它选中自己）。
 *    **指定了却解不出来就返回 null**，不悄悄回落到别家：「我选了本地，它却偷偷走了云端并且扣了钱」
 *    是这条路上最糟的失败。
 * ② `"cloud"` 与缺省走自动解析，而自动解析**不绑文本大脑那一家**（2026-09-17 修）：
 *    原来写的是 `findExecutableModel(brain.vendor, "", "audio")`，大脑是 Moonshot 时必然找不到，
 *    用户拿到「没有可用的转写模型」，而 APIMart / 火山语音的转写模型就在隔壁启用着（09-17 真机实测）。
 *    「谁来做转写」和「谁来做文本」本来就是两件事。现在在所有已启用供应商里解，顺序按 #682 的供应商偏好。
 */
function resolveTranscribeLeg(requested?: DeconstructVideoPayload["transcribe"]): { vendorKey: string; modelKey: string } | null {
  if (requested && requested !== "cloud") {
    try {
      const { vendor, model } = findExecutableModel(requested.vendorKey, requested.modelKey, "audio");
      return { vendorKey: vendor.key, modelKey: model.modelKey };
    } catch {
      return null;
    }
  }
  const resolved = findExecutableModelAnyVendor("audio", readVendorPreferenceSettings().orderedVendorKeys);
  return resolved ? { vendorKey: resolved.vendor.key, modelKey: resolved.model.modelKey } : null;
}

/**
 * 拆一条视频。任一镜的画面分析失败只影响那一镜（标 visionFailed），不毁整批。
 *
 * **钱的闸在这一层**（2026-09-12 修）：切点、抽帧、算时长全是本地零成本的，
 * 先把它们跑完，才知道这次一共要发几次付费调用——然后**一次性**问用户一次，
 * 拿到一颗覆盖全部镜头的令牌往下传。以前这两处 runTask 一个 grantId 都不带，
 * 于是 09-09 的付费闸把每一镜都在发请求之前挡掉，再被 catch 吞成每格「没读出」。
 */
export async function deconstructVideo(payload: DeconstructVideoPayload, options: DeconstructVideoOptions): Promise<DeconstructVideoResult> {
  const onPhase = options.onPhase;
  onPhase?.(0);
  const { videoUrl, projectId } = payload;
  if (!trim(videoUrl)) throw new DeconstructError("缺少源视频地址");
  if (!trim(projectId)) throw new DeconstructError("缺少 projectId");

  const framesPerShot = Math.max(1, payload.framesPerShot ?? DECONSTRUCT_FRAMES_PER_SHOT);
  const columns = (payload.customColumns || []).filter((c) => trim(c.name));

  // 时长算最后一镜的结尾；
  // hasAudio 决定这次到底要不要买一次转写——没有音轨就不该出现在报价里。
  const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId);
  let durationSeconds: number;
  let sourceHasAudio: boolean;
  try {
    const meta = await probeMediaMetadata(filePath);
    durationSeconds = typeof meta.durationSeconds === "number" ? meta.durationSeconds : 0;
    sourceHasAudio = meta.hasAudio === true;
  } finally {
    cleanup();
  }
  if (!(durationSeconds > 0)) throw new DeconstructError("读不出视频时长，无法拆解");

  const detected = await detectShotCuts({ videoUrl, projectId });
  const threshold = payload.threshold;
  const cutSeconds = (detected.cuts || [])
    .filter((cut) => (typeof threshold === "number" ? cut.score >= threshold : true))
    .map((cut) => cut.seconds);
  const boundaries = buildShotBoundaries(cutSeconds, durationSeconds);
  if (!boundaries.length) throw new DeconstructError("没能切出任何镜头");

  const brain = resolveTextBrainKeys({ preferImageInput: true });
  if (!brain) throw new DeconstructError("还没有能读图的文本模型。去「接入模型」启用一个（如 Gemini 3.5 Flash）。");

  const targets = payload.shotIndexes ? boundaries.filter((shot) => payload.shotIndexes!.includes(shot.index)) : boundaries;
  if (!targets.length) throw new DeconstructError("没能切出任何镜头");

  // —— 钱的闸：一次报价、一次确认、一颗令牌覆盖这一整批 ——
  const nodeId = trim(payload.nodeId) || `deconstruct-${projectId}`;
  // 报价用的 vendor/model 必须是 runTask **真会解出来**的那一行，否则卡上的数和真扣的数对不上。
  const visionModel = findExecutableModel(brain.vendor, brain.modelKey, "text");
  const visionIdentity = { vendorKey: visionModel.vendor.key, modelKey: visionModel.model.modelKey };
  const visionParameters: Record<string, unknown> = { projectId, modelKey: brain.modelKey, temperature: 0.2, maxTokens: DECONSTRUCT_MAX_TOKENS };
  const transcribeLeg = sourceHasAudio ? resolveTranscribeLeg(payload.transcribe) : null;
  const plan: DeconstructSpendPlan = {
    projectId,
    nodeId,
    shotCount: targets.length,
    vision: visionIdentity,
    lines: [
      ...targets.map(() => ({ ...visionIdentity, parameters: visionParameters })),
      // 转写这一行也带上 parameters：报价卡看到的 language 与真实调用发出去的是同一个值
      // （2026-09-17；此前调用侧写死 "zh"，卡上什么都没写，两边对不上也看不出来）。
      ...(transcribeLeg ? [{ ...transcribeLeg, parameters: { language: transcribeLanguage() } }] : []),
    ],
  };
  const grantId = await options.authorizeSpend(plan);
  if (!grantId) throw new DeconstructError(desktopT("deconstruct.spendDeclined"));

  // 声音那一路和画面那一路并行跑（互不依赖）。
  // `.catch` 是第二道保险：transcribeShots 已承诺不 reject，但悬空 promise 一旦破例
  // 就会崩主进程（见该函数头注释），这里再兜一层，代价为零。
  type AudioOutcome = Awaited<ReturnType<typeof transcribeShots>>;
  const audioPromise: Promise<AudioOutcome> = transcribeLeg
    ? transcribeShots(videoUrl, projectId, boundaries, { ...transcribeLeg, grantId, nodeId }, (detail) => onPhase?.(2, detail)).catch((error: unknown) => ({
        hasAudio: false,
        dialogues: assignSegmentsToShots([], boundaries),
        failureReason: messageOf(error),
      }))
    : Promise.resolve({
        hasAudio: sourceHasAudio,
        dialogues: assignSegmentsToShots([], boundaries),
        // 有音轨却没有可用的转写模型 —— 这句话必须说出来，不然用户只看到空白的对白列。
        ...(sourceHasAudio ? { failureReason: desktopT("deconstruct.noTranscribeModel") } : {}),
      });

  onPhase?.(1);
  // 闸在半路拒了（令牌过期 / 预算被别处吃光）= 整件事没被授权，不是某一格空白。
  // 记下来、停掉后续镜头，收尾时整体抛出——绝不摊进每一格变成满屏「没读出」。
  let gateFailure: string | null = null;
  const analyzed = await mapWithConcurrency(targets, payload.concurrency ?? DECONSTRUCT_CONCURRENCY, async (shot): Promise<AnalyzedShot> => {
    const empty: AnalyzedShot = { shot, frameUrls: [], parsed: null };
    if (gateFailure) return empty;
    const seconds = sampleSecondsForShot(shot, framesPerShot);
    let frameUrls: string[];
    try {
      frameUrls = await Promise.all(
        seconds.map(async (s) => (await extractVideoFrameToAsset({ videoUrl, which: s, projectId })).url),
      );
    } catch (error) {
      logError("tasks", "deconstruct.frame-failed", error, { projectId, shot: String(shot.index) });
      return { ...empty, failureReason: messageOf(error) };
    }
    try {
      const result = await runTask({
        vendor: brain.vendor,
        request: {
          kind: "image_to_prompt",
          prompt: buildShotAnalysisPrompt(shot, frameUrls.length, columns),
          extras: {
            ...visionParameters,
            referenceImages: frameUrls,
            // 付费闸的授权：这颗令牌在开跑前由用户确认过，覆盖本次全部镜头。
            grantId,
            nodeId,
          },
        },
      });
      return { shot, frameUrls, parsed: parseLooseJsonObject(textFromTaskResult((result as { raw?: unknown }).raw)) };
    } catch (error) {
      if (isSpendAuthorizationError(error)) {
        gateFailure = messageOf(error);
        return { shot, frameUrls, parsed: null };
      }
      logError("tasks", "deconstruct.model-failed", error, { projectId, shot: String(shot.index) });
      return { shot, frameUrls, parsed: null, failureReason: messageOf(error) };
    }
  });
  if (gateFailure) throw new DeconstructError(gateFailure);

  onPhase?.(2);
  const audio = await audioPromise;
  const { hasAudio, dialogues } = audio;
  const dialogueByIndex = new Map(dialogues.map((d) => [d.shotIndex, d]));
  const failedShotIndexes: number[] = [];

  const shots: DeconstructShot[] = analyzed.map(({ shot, frameUrls, parsed, failureReason }) => {
    const line = dialogueByIndex.get(shot.index);
    const midFrame = frameUrls.length ? frameUrls[Math.floor(frameUrls.length / 2)] : "";
    if (!parsed) failedShotIndexes.push(shot.index);
    const custom: Record<string, string> = {};
    for (const column of columns) {
      const key = trim(column.name);
      custom[key] = parsed ? firstString(parsed[key]) : "";
    }
    return {
      index: shot.index,
      startSeconds: shot.startSeconds,
      endSeconds: shot.endSeconds,
      // 时长是派生量，不是第二份真相：两端都已落在格子上，减法的浮点尾数（1.5 - 0.7）再吸一次。
      durationSeconds: quantizeShotSeconds(shot.endSeconds - shot.startSeconds),
      sourceFrameUrl: midFrame,
      shotSize: parsed ? firstString(parsed.shotSize) : "",
      mood: parsed ? firstString(parsed.mood) : "",
      visual: parsed ? firstString(parsed.visual) : "",
      onScreenText: parsed ? firstString(parsed.onScreenText) : "",
      dialogue: line?.text || "",
      carriedOver: Boolean(line?.carriedOver),
      imagePrompt: parsed ? firstString(parsed.imagePrompt) : "",
      motionPrompt: parsed ? firstString(parsed.motionPrompt) : "",
      custom,
      ...(parsed ? {} : { visionFailed: true }),
      ...(!parsed && failureReason ? { failureReason } : {}),
    };
  });

  // 片长跟镜头区间落在同一个格子上：否则「最后一镜的 endSeconds」和「整片时长」会差出一条尾数，
  // 同一张卡上两个数字互相打脸。
  return {
    shots,
    durationSeconds: quantizeShotSeconds(durationSeconds),
    hasAudio,
    failedShotIndexes,
    ...(audio.failureReason ? { failureReason: audio.failureReason } : {}),
    ...(audio.failureKind ? { failureKind: audio.failureKind } : {}),
  };
}
