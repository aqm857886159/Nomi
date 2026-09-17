/**
 * 本地转写的**分段编排（纯函数）**——「不要弄不出来」那条硬约束的落点。
 *
 * ## 为什么要自己分段（whisper 本来就能吞长音频）
 *
 * whisper 内部按 30 秒窗口滚着解码，喂一条 40 分钟的音频它也能跑完。但对用户来说那是
 * **一个没有进度、一错全丢的黑盒**：跑到第 38 分钟网络/内存/编码出个岔，前面 37 分钟的结果一起没。
 * 所以我们在外面再切一层：
 *  · 切点取 30 秒窗口的**整数倍**（`CHUNK_WINDOWS × WINDOW_SECONDS`），不去打断模型自己的窗口节奏；
 *  · 每段单独重试一次，失败时报得出「是第几段、什么原因」；
 *  · 进度按已完成的秒数报，用户看得见它在走。
 *
 * ## 重叠与去重：为什么不按「固定重叠 + 丢掉前 N 秒」
 *
 * 固定重叠的老问题是**跨边界的那句话两头都不完整**：丢前 N 秒会把它腰斩，不丢就重复一遍。
 * 这里改成「按模型自己给出的句子边界续接」——多喂一段 `TAIL_SECONDS` 的尾巴当上下文，
 * 但只**采纳名义段内开始的句子**，然后把游标推到**最后一句被采纳的句子的结尾**。
 * whisper 的段边界落在自然停顿上，所以下一段正好从一句话的开头起跑，既不重也不断。
 *
 * 终止性：`acceptChunkSegments` 保证 `nextCursor` 至少前进 `MIN_ADVANCE_SECONDS`——
 * 否则一段静音或一句横跨整段的长句就能让游标原地不动、死循环（这类「看起来在跑其实卡死」
 * 的 bug 最难查，所以把它钉在纯函数里、用单测证明，而不是靠调用方自觉）。
 */

/** whisper 的解码窗口，上游常量；我们的切点必须是它的整数倍。 */
export const WINDOW_SECONDS = 30;
/** 一段 = 10 个窗口 = 5 分钟。够长（模型不用反复热身）、够短（进度看得见、重试代价可接受）。 */
export const CHUNK_WINDOWS = 10;
export const CHUNK_SECONDS = WINDOW_SECONDS * CHUNK_WINDOWS;
/** 多喂一个窗口当上下文，让跨边界那句话在本段里就是完整的。 */
export const TAIL_SECONDS = WINDOW_SECONDS;
/** 游标每段至少前进这么多，否则强制按名义段长推进（防死循环，见文件头）。 */
export const MIN_ADVANCE_SECONDS = 1;

export type LocalSpeechChunkPlan = {
  /** 第几段（从 0 起），错误文案里报给用户的就是它 +1。 */
  index: number;
  /** 喂给引擎的音频起点（秒）。 */
  startSeconds: number;
  /** 喂给引擎的音频长度（秒），含尾巴上下文。 */
  lengthSeconds: number;
  /** 名义段的结尾（秒）：只采纳在此之前开始的句子，尾巴那部分只当上下文。 */
  nominalEndSeconds: number;
  /** 这是最后一段吗——最后一段要把尾巴里的句子也采纳，否则结尾会缺一截。 */
  isLast: boolean;
};

export type LocalSpeechSegment = {
  /** 全局时间轴上的秒数（已加过段偏移）。 */
  start: number;
  end: number;
  text: string;
};

/**
 * 下一段该喂什么。`cursor >= durationSeconds` 时返回 null（转完了）。
 * `durationSeconds` 是音轨实测时长，不是容器声明的近似值——短了会漏掉结尾，长了会白跑一段静音。
 */
export function planNextChunk(cursorSeconds: number, durationSeconds: number): LocalSpeechChunkPlan | null {
  if (!(durationSeconds > 0)) return null;
  const start = Math.max(0, cursorSeconds);
  if (start >= durationSeconds) return null;
  const nominalEnd = Math.min(start + CHUNK_SECONDS, durationSeconds);
  const isLast = nominalEnd >= durationSeconds;
  const fedEnd = Math.min(isLast ? nominalEnd : nominalEnd + TAIL_SECONDS, durationSeconds);
  return {
    index: Math.floor(start / CHUNK_SECONDS),
    startSeconds: start,
    lengthSeconds: Math.max(0, fedEnd - start),
    nominalEndSeconds: nominalEnd,
    isLast,
  };
}

/** 这条音轨一共要跑几段（开跑前告诉用户「分 N 段」，以及算进度分母）。 */
export function countChunks(durationSeconds: number): number {
  if (!(durationSeconds > 0)) return 0;
  return Math.ceil(durationSeconds / CHUNK_SECONDS);
}

/**
 * 把引擎对某一段的回答折进全局时间轴，并决定游标推到哪。
 * `rawSegments` 的时间是**段内相对秒数**，这里统一加上段偏移，外面拿到的永远是全局时间。
 */
export function acceptChunkSegments(
  plan: LocalSpeechChunkPlan,
  rawSegments: readonly { start: number; end: number; text: string }[],
): { kept: LocalSpeechSegment[]; nextCursorSeconds: number } {
  const shifted: LocalSpeechSegment[] = [];
  for (const raw of rawSegments) {
    const start = Number(raw.start);
    const end = Number(raw.end);
    const text = typeof raw.text === "string" ? raw.text.trim() : "";
    if (!Number.isFinite(start) || !text) continue;
    shifted.push({
      start: plan.startSeconds + start,
      end: plan.startSeconds + (Number.isFinite(end) ? Math.max(end, start) : start),
      text,
    });
  }
  // 最后一段没有下一段可以接手，尾巴里的句子必须全收；中间段只收**名义段内开始**的句子。
  const kept = plan.isLast ? shifted : shifted.filter((segment) => segment.start < plan.nominalEndSeconds);
  const fedEndSeconds = plan.startSeconds + plan.lengthSeconds;
  if (plan.isLast) return { kept, nextCursorSeconds: Math.max(fedEndSeconds, plan.startSeconds + MIN_ADVANCE_SECONDS) };

  // 被采纳的句子**开始**在名义段内，但**结尾**可能伸进尾巴里（横跨边界的那一句）。
  // 游标推到它的结尾 = 下一段从下一句的开头起跑：不重、不断。
  // 若最后一句在名义段内就结束了（常见），就推到名义段尾——**不能**退回到句尾，
  // 否则「一段里只有开头几秒有人说话、后面全是静音」时游标每轮只走几秒，
  // 会变成一个能终止但永远跑不完的循环（这正是要在纯函数里钉死的那种坑）。
  const lastEnd = kept.length > 0 ? kept[kept.length - 1].end : 0;
  const advanced = Math.max(plan.nominalEndSeconds, Math.min(lastEnd, fedEndSeconds));
  return { kept, nextCursorSeconds: Math.max(advanced, plan.startSeconds + MIN_ADVANCE_SECONDS) };
}

/** 把所有段的文本拼成整篇（句间用换行，与云端 verbose_json 的 `text` 同一形状）。 */
export function joinSegmentText(segments: readonly LocalSpeechSegment[]): string {
  return segments.map((segment) => segment.text).join("\n");
}
