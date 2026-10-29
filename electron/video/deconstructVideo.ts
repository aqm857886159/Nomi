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
import type { ShotCutCoverage } from "../shared/canvas/shotTable";
import { firstString, isJsonRecord, parseLooseJsonObject, trim } from "../jsonUtils";
// main 上 chooseTextModel/resolveTextBrainKeys 已从 agentChatV2 抽到 textBrainResolver（1040 commit 间的重构）；
// 旧分支从 agentChatV2 import 已失效，port 时改指真源（docs/ARCHITECTURE-NOW 的「文本大脑」判据同一处）。
import { resolveVisionLeg, type VisionLegIdentity } from "./deconstructVisionLeg";
import { runTask } from "../runtime";
import { TOKEN_ADMISSION, stoppableAdmission, type TaskAdmission } from "../tasks/taskSpend";
import { findExecutableModel, findExecutableModelForMode, findExecutableModelInMode } from "../catalog/executableModel";
import { readCatalog } from "../catalog/catalogStore";
import { readVendorPreferenceSettings } from "../settings/vendorPreferenceSettings";
import { getDesktopLocale } from "../i18n";
import { isSpendAuthorizationError } from "../spendGrant";
import { logError, logInfo } from "../logging/logger";
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
  /** IPC 的请求号：主进程按「发送方:requestId」登记这次拆解，取消口按它撤（缺了主进程直接拒）。 */
  requestId?: string;
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
  /**
   * 这次**读图**用哪个模型（与 `transcribe` 同形，2026-10-11）。显式给定 = 用户在分镜表底栏选的：
   * 解不出（停用 / 被删）就整次拒绝，不悄悄换别家。缺省 = 先看 `visionPreferred`，再自动挑。
   */
  vision?: VisionLegIdentity;
  /** 软偏好（渲染层带来的「用户在 Agent 面板选的脑」）：它此刻可用且能读图才采用，否则当没给。 */
  visionPreferred?: VisionLegIdentity;
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
  /** 这次转写用哪个模型；没有音轨 = 不转写 = null（报价卡上就不出「转写」那一行）。 */
  transcribe: { vendorKey: string; modelKey: string } | null;
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
  /**
   * 这次拆解的停止信号。**必填**，理由同 authorizeSpend：新调用方漏传在编译期就红，而不是写出一条停不下来的拆解。
   * 由主进程请求登记签发（electron/ipcRequestRegistry.ts：渲染层撤回 / 发起窗口销毁 / 项目会话失效 / 退出）。
   * 第一刀（2026-10-27）：已取消就不再起新的本机子进程、不再进付费闸；取消那一刻已经过了付费闸的那一次照常结算。
   */
  signal: AbortSignal;
};

export type DeconstructVideoResult = {
  shots: DeconstructShot[];
  durationSeconds: number;
  hasAudio: boolean;
  /**
   * 这张表是不是整条片子。**必填**——这正是 2026-09-22 修的那条：
   * 做成可选字段，读侧「忘了带」就又会变成一次静默截断，而编译器帮不上忙。
   */
  cutCoverage: ShotCutCoverage;
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

/** 这次拆解被停下了（用户点取消 / 发起窗口没了 / 项目换了 / 退出）。不是失败：IPC 侧据此回「已停」，不写失败、不记失败日志。 */
export class DeconstructCancelledError extends Error {
  constructor() {
    super("deconstruct cancelled");
    this.name = "DeconstructCancelledError";
  }
}

/** 编排里每一步发之前都过这一下：已取消就不往下走——不起新的本机子进程、不发新的付费调用。 */
function stopIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DeconstructCancelledError();
}

/** 取消时记的那一笔（日志 `deconstruct.cancelled`）。过了付费闸的记「已发或未知」：供应商可能已受理，不说退款、不说没花钱。 */
type CancelReceipt = {
  quotedCalls: number;
  sentOrUnknown: number;
  /** 转写腿：none = 没起跑；stopped = 被停下（没进闸，或回来时已取消）；settled = 照常回来；failed = 取消前就失败了。 */
  transcribe: "none" | "stopped" | "settled" | "failed";
};

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
    // 字段用界面语言写（2026-10-18 效果评测：中文界面里「运镜」一列 64%–100% 是英文；英文界面拿到的又全是中文）。
    // 景别仍从下面那六档中文里选（下游按这六个词认），imagePrompt 是喂给图片模型的，不限语言。
    getDesktopLocale() === "en"
      ? "Write every text field in English, except shotSize (pick one of the six Chinese labels below) and imagePrompt."
      : "除 imagePrompt 外，所有文字字段都用中文写（包括 motionPrompt）。",
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
  run: { signal: AbortSignal; admission: TaskAdmission },
  onDetail?: (detail: string) => void,
): Promise<{ hasAudio: boolean; dialogues: ReturnType<typeof assignSegmentsToShots>; failureReason?: string; failureKind?: "local-speech" }> {
  const empty = assignSegmentsToShots([], boundaries);
  // ⚠️ 这个函数**只在取消时 reject**（抛 DeconstructCancelledError，调用方当场挂着 `.catch` 认它）；
  // 其余失败一律带原因返回：调用方把它当悬空 promise 先起跑、几十秒后才 await，
  // 中间若抛出又没人接，Node 会判「未处理的 rejection」→ 主进程崩 → IPC 侧只看到
  // 「reply was never sent」，完全查不出真因（2026-08-13 真踩，排查了两轮）。
  // 所以取音轨这一步也必须包住——它会因「视频太长/没装 ffmpeg」正常抛错。
  let track: Awaited<ReturnType<typeof extractAudioTrack>>;
  try {
    track = await extractAudioTrack({ videoUrl, projectId }, { signal: run.signal });
  } catch (error) {
    // 取消不是「取音轨失败」：照原样交出去，由调用方的 `.catch` 记成「转写腿已停」。
    if (run.signal.aborted) throw new DeconstructCancelledError();
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
    // 发转写之前再看一眼：已取消就连付费闸都不碰。
    stopIfCancelled(run.signal);
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
    }, run.admission);
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
    // 转出了字却没有时间戳：分不到镜头上。说出来，不让对白列静默空白（2026-10-19 前 Scribe 正是这样整列空的）。
    if (!segments.length && isJsonRecord(raw) && firstString(raw.text).trim()) {
      return { hasAudio: true, dialogues: empty, failureReason: desktopT("deconstruct.transcriptUntimed", { model: leg.modelKey }) };
    }
    return { hasAudio: true, dialogues: assignSegmentsToShots(segments, boundaries) };
  } catch (error) {
    // 取消之后回来的任何错误（闸外层拒了、在途那一次失败了、本机转写停了）都是「已停」，不是转写失败：
    // 不记 transcribe-failed，更不认成 local-speech——那会给出「改用云端重试」，让用户为一次取消多花钱。
    if (run.signal.aborted) throw new DeconstructCancelledError();
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
 * 这里只修默认派生（取界面语言）；把它做成用户可选那一步归 TODO 的 拆解前选模型。
 */
function transcribeLanguage(): string {
  return getDesktopLocale() === "en" ? "en" : "zh";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 转写腿解出来的结果。三种，各有各的话（与读图腿 `resolveVisionLeg` 同形）：
 *  · ok：这次用这一行；
 *  · requested-unavailable：用户点名的那一行跑不了（停用 / 没钥匙 / 根本不是转写模型）——**不悄悄换别家**，原话带回去；
 *  · none：自动挑也挑不出一个能转写的。
 */
export type TranscribeLegResolution =
  | { ok: true; vendorKey: string; modelKey: string }
  | { ok: false; reason: "requested-unavailable"; requested: { vendorKey: string; modelKey: string }; detail: string }
  | { ok: false; reason: "none" };

/** 这一行的转写 mapping 声明了本机引擎（`localEngine`）——「改用云端重试」要排除的就是它。按声明认，不按 vendor 名认。 */
function servesTranscribeLocally(model: { vendorKey: string; modelKey: string }): boolean {
  return readCatalog().mappings.some((mapping) => mapping.enabled && mapping.taskKind === "transcribe"
    && mapping.vendorKey === model.vendorKey && (!mapping.modelKey || mapping.modelKey === model.modelKey)
    && Boolean(mapping.create?.localEngine));
}

/**
 * 解出转写会用的那一行模型（与 runtime 用同一个解析器，报价才对得上真实扣费）。
 *
 * 显式指定优先：`{vendorKey,modelKey}` 就按它解；**指定了却解不出来就带原因返回**，不悄悄回落到别家——
 * 「我选了本地，它却偷偷走了云端并且扣了钱」是这条路上最糟的失败。
 * `"cloud"` = 这次强制走云端：同一份候选里排除本机引擎那几行（否则本地挂了点「改用云端重试」又落回本地）。
 *
 * 候选**按模式**问（`findExecutableModelForMode("transcribe")`），与转写 chip 的选项同一份投影、同一条判据。
 * 2026-10-19 之前这里问的是 kind（`findExecutableModelAnyVendor("audio")`）：目录序第一个能用的 audio 行
 * 是 Suno / TTS 时，转写腿就拿它去发转写请求。
 */
export function resolveTranscribeLeg(requested?: DeconstructVideoPayload["transcribe"]): TranscribeLegResolution {
  if (requested && requested !== "cloud") {
    try {
      const { vendor, model } = findExecutableModelInMode(requested.vendorKey, requested.modelKey, "transcribe");
      return { ok: true, vendorKey: vendor.key, modelKey: model.modelKey };
    } catch (error) {
      return { ok: false, reason: "requested-unavailable", requested, detail: messageOf(error) };
    }
  }
  const resolved = findExecutableModelForMode("transcribe", {
    orderedVendorKeys: readVendorPreferenceSettings().orderedVendorKeys,
    ...(requested === "cloud" ? { accept: (model: { vendorKey: string; modelKey: string }) => !servesTranscribeLocally(model) } : {}),
  });
  return resolved ? { ok: true, vendorKey: resolved.vendor.key, modelKey: resolved.model.modelKey } : { ok: false, reason: "none" };
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
  const receipt: CancelReceipt = { quotedCalls: 0, sentOrUnknown: 0, transcribe: "none" };
  try {
    const result = await runDeconstruction(payload, options, receipt);
    // 两条腿都回来了才发现已取消：结果作废，不交出去（IPC 侧回「已停」）。
    stopIfCancelled(options.signal);
    return result;
  } catch (error) {
    if (!options.signal.aborted) throw error;
    logInfo("tasks", "deconstruct.cancelled", {
      projectId: trim(payload.projectId),
      nodeId: trim(payload.nodeId),
      requestId: trim(payload.requestId),
      quotedCalls: receipt.quotedCalls,
      sentOrUnknown: receipt.sentOrUnknown,
      neverSent: Math.max(0, receipt.quotedCalls - receipt.sentOrUnknown),
      transcribe: receipt.transcribe,
    });
    throw error instanceof DeconstructCancelledError ? error : new DeconstructCancelledError();
  }
}

async function runDeconstruction(payload: DeconstructVideoPayload, options: DeconstructVideoOptions, receipt: CancelReceipt): Promise<DeconstructVideoResult> {
  const { signal } = options;
  // 取消之后不再报进度：表已经是「已取消」，迟到的阶段不该把它演回「进行中」。
  const onPhase = (phase: 0 | 1 | 2, detail?: string): void => { if (!signal.aborted) options.onPhase?.(phase, detail); };
  stopIfCancelled(signal);
  onPhase(0);
  const { videoUrl, projectId } = payload;
  if (!trim(videoUrl)) throw new DeconstructError("缺少源视频地址");
  if (!trim(projectId)) throw new DeconstructError("缺少 projectId");

  const framesPerShot = Math.max(1, payload.framesPerShot ?? DECONSTRUCT_FRAMES_PER_SHOT);
  const columns = (payload.customColumns || []).filter((c) => trim(c.name));

  // 时长算最后一镜的结尾；
  // hasAudio 决定这次到底要不要买一次转写——没有音轨就不该出现在报价里。
  const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId, signal);
  let durationSeconds: number;
  let sourceHasAudio: boolean;
  try {
    const meta = await probeMediaMetadata(filePath, { signal });
    durationSeconds = typeof meta.durationSeconds === "number" ? meta.durationSeconds : 0;
    sourceHasAudio = meta.hasAudio === true;
  } finally {
    cleanup();
  }
  if (!(durationSeconds > 0)) throw new DeconstructError("读不出视频时长，无法拆解");

  stopIfCancelled(signal);
  const detected = await detectShotCuts({ videoUrl, projectId }, { signal });
  const threshold = payload.threshold;
  const cutSeconds = (detected.cuts || [])
    .filter((cut) => (typeof threshold === "number" ? cut.score >= threshold : true))
    .map((cut) => cut.seconds);
  const boundaries = buildShotBoundaries(cutSeconds, durationSeconds);
  if (!boundaries.length) throw new DeconstructError("没能切出任何镜头");
  // 「这张表是不是整条片子」跟着结果一路走到底。
  //
  // 2026-09-22 之前这一行不存在：`detectShotCuts` 早就把 `truncated` 算好了，而这里只取了 `cuts`，
  // 于是 447 刀的片子拆出一张「看着齐、其实只覆盖到第 55 秒」的表，**一句提示都没有**。
  // 用户自己的灵敏度过滤会让采用数再少一些，所以 `keptCuts` 以**这里**的实际条数为准，
  // 不照抄检测层那个数——两个数不一致时，说谎的一定是照抄的那个。
  const cutCoverage: ShotCutCoverage = {
    ...detected.coverage,
    keptCuts: cutSeconds.length,
    coveredSeconds: cutSeconds.at(-1) ?? 0,
  };

  const visionLeg = resolveVisionLeg({ requested: payload.vision, preferred: payload.visionPreferred });
  if (!visionLeg.ok) {
    if (visionLeg.reason === "requested-unavailable") {
      throw new DeconstructError(desktopT("deconstruct.visionModelUnavailable", { model: visionLeg.requested.modelKey, detail: visionLeg.detail }));
    }
    throw new DeconstructError("还没有能读图的文本模型。去「接入模型」启用一个（如 Gemini 3.5 Flash）。");
  }
  const brain = { vendor: visionLeg.vendor, modelKey: visionLeg.modelKey };

  const targets = payload.shotIndexes ? boundaries.filter((shot) => payload.shotIndexes!.includes(shot.index)) : boundaries;
  if (!targets.length) throw new DeconstructError("没能切出任何镜头");

  // —— 钱的闸：一次报价、一次确认、一颗令牌覆盖这一整批 ——
  const nodeId = trim(payload.nodeId) || `deconstruct-${projectId}`;
  // 报价用的 vendor/model 必须是 runTask **真会解出来**的那一行，否则卡上的数和真扣的数对不上。
  const visionModel = findExecutableModel(brain.vendor, brain.modelKey, "text");
  const visionIdentity = { vendorKey: visionModel.vendor.key, modelKey: visionModel.model.modelKey };
  const visionParameters: Record<string, unknown> = { projectId, modelKey: brain.modelKey, temperature: 0.2, maxTokens: DECONSTRUCT_MAX_TOKENS };
  const transcribeResolution = sourceHasAudio ? resolveTranscribeLeg(payload.transcribe) : null;
  // 点名的转写模型跑不了：和读图腿同一条规矩——**整次拒绝，零报价、零付费调用**，不悄悄换别家，
  // 也不「画面照拆、对白留空」（验收线 C1，2026-10-19：那样用户花了读图的钱，拿回一列自己没选的空白）。
  // 「一个能转写的都没有」（自动挑不到）不在此列：画面那半仍值得拆，对白列顶上一行说清原因。
  if (transcribeResolution && !transcribeResolution.ok && transcribeResolution.reason === "requested-unavailable") {
    throw new DeconstructError(desktopT("deconstruct.transcribeModelUnavailable", { model: transcribeResolution.requested.modelKey, detail: transcribeResolution.detail }));
  }
  const transcribeLeg = transcribeResolution?.ok ? { vendorKey: transcribeResolution.vendorKey, modelKey: transcribeResolution.modelKey } : null;
  const plan: DeconstructSpendPlan = {
    projectId,
    nodeId,
    shotCount: targets.length,
    vision: visionIdentity,
    transcribe: transcribeLeg,
    lines: [
      ...targets.map(() => ({ ...visionIdentity, parameters: visionParameters })),
      // 转写这一行也带上 parameters：报价卡看到的 language 与真实调用发出去的是同一个值
      // （2026-09-17；此前调用侧写死 "zh"，卡上什么都没写，两边对不上也看不出来）。
      ...(transcribeLeg ? [{ ...transcribeLeg, parameters: { language: transcribeLanguage() } }] : []),
    ],
  };
  receipt.quotedCalls = plan.lines.length;
  // 报价卡之前、令牌回来之后各看一眼：已取消就不弹卡；卡上确认与取消同时到，也不发。
  stopIfCancelled(signal);
  const grantId = await options.authorizeSpend(plan);
  stopIfCancelled(signal);
  if (!grantId) throw new DeconstructError(desktopT("deconstruct.spendDeclined"));
  // 付费闸外层的「停」：已取消不进闸、不扣钱；闸里等人确认回来时已取消也不放行。
  // 过了闸的那一次照常发出、照常结算（在途不断开，runtime.ts 一行不动；断开是第二刀），这里只记「已发或未知」几次。
  const admission = stoppableAdmission(signal, TOKEN_ADMISSION, () => { receipt.sentOrUnknown += 1; });

  // 声音那一路和画面那一路并行跑（互不依赖）。
  // `.catch` 当场挂上：transcribeShots 只在取消时 reject，悬空 promise 没人接就会崩主进程（见该函数头注释）。
  // 取消照原样认出来（记「转写腿已停」），不摊成「对白没取到」那句失败；别的意外才落失败原因。
  type AudioOutcome = Awaited<ReturnType<typeof transcribeShots>> & { stopped?: boolean };
  const audioPromise: Promise<AudioOutcome> = transcribeLeg
    ? transcribeShots(videoUrl, projectId, boundaries, { ...transcribeLeg, grantId, nodeId }, { signal, admission }, (detail) => onPhase(2, detail)).catch((error: unknown) => (signal.aborted
        ? { hasAudio: false, dialogues: assignSegmentsToShots([], boundaries), stopped: true }
        : { hasAudio: false, dialogues: assignSegmentsToShots([], boundaries), failureReason: messageOf(error) }))
    : Promise.resolve({
        hasAudio: sourceHasAudio,
        dialogues: assignSegmentsToShots([], boundaries),
        // 有音轨却没有可用的转写模型 —— 这句话必须说出来，不然用户只看到空白的对白列。
        // （点名的模型跑不了已在报价前整次拒绝，走不到这里。）
        ...(transcribeResolution && !transcribeResolution.ok ? { failureReason: desktopT("deconstruct.noTranscribeModel") } : {}),
      });

  onPhase(1);
  // 闸在半路拒了（令牌过期 / 预算被别处吃光）= 整件事没被授权，不是某一格空白。
  // 记下来、停掉后续镜头，收尾时整体抛出——绝不摊进每一格变成满屏「没读出」。
  let gateFailure: string | null = null;
  const analyzed = await mapWithConcurrency(targets, payload.concurrency ?? DECONSTRUCT_CONCURRENCY, async (shot): Promise<AnalyzedShot> => {
    const empty: AnalyzedShot = { shot, frameUrls: [], parsed: null };
    // 闸拒了，或已取消：后面的镜不再起跑。取消不留原因——它不是这一镜读图失败（结果整份作废）。
    if (gateFailure || signal.aborted) return empty;
    const seconds = sampleSecondsForShot(shot, framesPerShot);
    let frameUrls: string[];
    try {
      frameUrls = await Promise.all(
        seconds.map(async (s) => (await extractVideoFrameToAsset({ videoUrl, which: s, projectId }, { signal })).url),
      );
    } catch (error) {
      if (signal.aborted) return empty;
      logError("tasks", "deconstruct.frame-failed", error, { projectId, shot: String(shot.index) });
      return { ...empty, failureReason: messageOf(error) };
    }
    // 发读图之前再看一眼：抽帧那几秒里取消了，这一镜就不发。
    if (signal.aborted) return empty;
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
            // 拆解逐镜并发读图：限流（429）不自动重试（只会放大失败与耗时），失败原话落表，由用户点重试。
            maxRetries: 0,
          },
        },
      }, admission);
      const parsed = parseLooseJsonObject(textFromTaskResult((result as { raw?: unknown }).raw));
      // 模型回了但不是可解析的 JSON：也要留一句话，不让这一镜只剩空白。
      return { shot, frameUrls, parsed, ...(parsed ? {} : { failureReason: desktopT("deconstruct.visionUnparseable") }) };
    } catch (error) {
      // 取消之后回来的任何错误（闸外层拒了、在途那一次失败了）都是「已停」，不摊成这一镜读图失败、不记失败日志。
      if (signal.aborted) return { shot, frameUrls, parsed: null };
      if (isSpendAuthorizationError(error)) {
        gateFailure = messageOf(error);
        return { shot, frameUrls, parsed: null };
      }
      logError("tasks", "deconstruct.model-failed", error, { projectId, shot: String(shot.index) });
      return { shot, frameUrls, parsed: null, failureReason: messageOf(error) };
    }
  });
  if (gateFailure) throw new DeconstructError(gateFailure);

  onPhase(2);
  const audio = await audioPromise;
  if (transcribeLeg) receipt.transcribe = audio.stopped ? "stopped" : audio.failureReason ? "failed" : "settled";
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
    cutCoverage,
    failedShotIndexes,
    ...(audio.failureReason ? { failureReason: audio.failureReason } : {}),
    ...(audio.failureKind ? { failureKind: audio.failureKind } : {}),
  };
}
