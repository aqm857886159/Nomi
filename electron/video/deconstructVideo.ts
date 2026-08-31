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
import { firstString, isJsonRecord, parseLooseJsonObject, trim } from "../jsonUtils";
import { resolveTextBrainKeys } from "../ai/agentChatV2";
import { runTask } from "../runtime";

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
};

export type DeconstructVideoResult = {
  shots: DeconstructShot[];
  durationSeconds: number;
  hasAudio: boolean;
  /** 画面分析失败的镜号（诚实回报，UI 据此提示「这几镜没读出来，可单独重试」）。 */
  failedShotIndexes: number[];
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
): Promise<{ hasAudio: boolean; dialogues: ReturnType<typeof assignSegmentsToShots> }> {
  const empty = assignSegmentsToShots([], boundaries);
  // ⚠️ 这个函数**绝不能 reject**：调用方把它当悬空 promise 先起跑、几十秒后才 await，
  // 中间若抛出，Node 会判「未处理的 rejection」→ 主进程崩 → IPC 侧只看到
  // 「reply was never sent」，完全查不出真因（2026-08-13 真踩，排查了两轮）。
  // 所以取音轨这一步也必须包住——它会因「视频太长/没装 ffmpeg」正常抛错。
  let track: Awaited<ReturnType<typeof extractAudioTrack>>;
  try {
    track = await extractAudioTrack({ videoUrl, projectId });
  } catch {
    return { hasAudio: false, dialogues: empty };
  }
  // 没有音轨不是错误——广告片常是纯画面/纯音乐。对白列留空，拆解照跑。
  if (!track.hasAudio || !track.url) return { hasAudio: false, dialogues: empty };

  const brain = resolveTextBrainKeys();
  if (!brain) return { hasAudio: true, dialogues: empty };
  try {
    const result = await runTask({
      vendor: brain.vendor,
      request: {
        kind: "transcribe",
        prompt: "",
        extras: { projectId, file: track.url, language: "zh" },
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
  } catch {
    // 转写挂了不该毁掉整次拆解——画面那半仍然有价值。
    return { hasAudio: true, dialogues: empty };
  }
}

/**
 * 拆一条视频。任一镜的画面分析失败只影响那一镜（标 visionFailed），不毁整批。
 */
export async function deconstructVideo(payload: DeconstructVideoPayload): Promise<DeconstructVideoResult> {
  const { videoUrl, projectId } = payload;
  if (!trim(videoUrl)) throw new DeconstructError("缺少源视频地址");
  if (!trim(projectId)) throw new DeconstructError("缺少 projectId");

  const framesPerShot = Math.max(1, payload.framesPerShot ?? DECONSTRUCT_FRAMES_PER_SHOT);
  const columns = (payload.customColumns || []).filter((c) => trim(c.name));

  // 时长：拿来算最后一镜的结尾，也用来判空。
  const { filePath, cleanup } = await resolveVideoLocalPath(videoUrl, projectId);
  let durationSeconds = 0;
  try {
    const meta = await probeMediaMetadata(filePath);
    durationSeconds = typeof meta.durationSeconds === "number" ? meta.durationSeconds : 0;
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

  // 声音那一路和画面那一路并行跑（互不依赖）。
  // `.catch` 是第二道保险：transcribeShots 已承诺不 reject，但悬空 promise 一旦破例
  // 就会崩主进程（见该函数头注释），这里再兜一层，代价为零。
  const audioPromise = transcribeShots(videoUrl, projectId, boundaries).catch(() => ({
    hasAudio: false,
    dialogues: assignSegmentsToShots([], boundaries),
  }));

  const brain = resolveTextBrainKeys({ preferImageInput: true });
  if (!brain) throw new DeconstructError("还没有能读图的文本模型。去「接入模型」启用一个（如 Gemini 3.5 Flash）。");

  const analyzed = await mapWithConcurrency(boundaries, payload.concurrency ?? DECONSTRUCT_CONCURRENCY, async (shot) => {
    const seconds = sampleSecondsForShot(shot, framesPerShot);
    let frameUrls: string[] = [];
    try {
      frameUrls = await Promise.all(
        seconds.map(async (s) => (await extractVideoFrameToAsset({ videoUrl, which: s, projectId })).url),
      );
    } catch {
      return { shot, frameUrls: [] as string[], parsed: null as Record<string, unknown> | null };
    }
    try {
      const result = await runTask({
        vendor: brain.vendor,
        request: {
          kind: "image_to_prompt",
          prompt: buildShotAnalysisPrompt(shot, frameUrls.length, columns),
          extras: {
            projectId,
            modelKey: brain.modelKey,
            referenceImages: frameUrls,
            temperature: 0.2,
            maxTokens: DECONSTRUCT_MAX_TOKENS,
          },
        },
      });
      return { shot, frameUrls, parsed: parseLooseJsonObject(textFromTaskResult((result as { raw?: unknown }).raw)) };
    } catch {
      return { shot, frameUrls, parsed: null };
    }
  });

  const { hasAudio, dialogues } = await audioPromise;
  const dialogueByIndex = new Map(dialogues.map((d) => [d.shotIndex, d]));
  const failedShotIndexes: number[] = [];

  const shots: DeconstructShot[] = analyzed.map(({ shot, frameUrls, parsed }) => {
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
      durationSeconds: Number((shot.endSeconds - shot.startSeconds).toFixed(2)),
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
    };
  });

  return { shots, durationSeconds, hasAudio, failedShotIndexes };
}
