// 镜头时间轴：把「切点」变成「镜头区间」，再把转写句按时间戳归属到镜头。
//
// 纯函数、零 IO —— 这是整条拆解链最容易翻车的一环，必须能被单测钉死：
// 归属规则错一格，整张分镜表的「对白」列会**整体串行**，而且错得很隐蔽（每句话都在，只是错位）。
//
// ⚠️ 切点 ≠ 镜头。detectShotCuts 返回的是**画面切换发生的时刻**（N 个切点）；
// 一条视频因此被切成 **N+1 段镜头**（0→cut1、cut1→cut2、…、cutN→片尾）。
// 「按镜头拆」那个已有功能列的是切点本身（在切点处抽帧），和这里的语义不同，别混。

/** whisper verbose_json 的 segment（只取我们用得上的三个字段）。 */
export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
};

export type ShotBoundary = {
  /** 1-based 镜号，直接当分镜表的「镜」列。 */
  index: number;
  startSeconds: number;
  endSeconds: number;
};

export type ShotDialogue = {
  shotIndex: number;
  /** 归属到这一镜的台词（多句以空格合并）。没有则空串。 */
  text: string;
  /** 上一镜有句话说到了这一镜里 —— UI 标「承接上镜」，避免用户以为这镜漏词了。 */
  carriedOver: boolean;
};

/**
 * 切点 → 镜头区间。
 *
 * 为什么第一段从 0 开始：第一个镜头不由切点产生（它从片头就在），
 * 只列切点会丢掉整个开场镜——而开场镜恰恰是广告里最重要的钩子。
 */
export function buildShotBoundaries(cutSeconds: readonly number[], durationSeconds: number): ShotBoundary[] {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (duration <= 0) return [];

  // 去重 + 排序 + 丢掉落在片外或贴边的切点（贴边切出 0 长镜头，没意义）。
  const cuts = Array.from(new Set(
    cutSeconds
      .filter((s) => Number.isFinite(s))
      .map((s) => Math.max(0, s))
      .filter((s) => s > 0.01 && s < duration - 0.01),
  )).sort((a, b) => a - b);

  const marks = [0, ...cuts, duration];
  const shots: ShotBoundary[] = [];
  for (let i = 0; i < marks.length - 1; i += 1) {
    shots.push({ index: i + 1, startSeconds: marks[i], endSeconds: marks[i + 1] });
  }
  return shots;
}

/** 二分找 seconds 落在哪一镜；落在边界上算**后一镜**（切点是新镜的开始）。 */
function shotIndexAt(boundaries: readonly ShotBoundary[], seconds: number): number {
  if (!boundaries.length) return -1;
  const t = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  // 超出片尾的句子归最后一镜，别丢（whisper 偶尔给出略超时长的 end/start）。
  const last = boundaries[boundaries.length - 1];
  if (t >= last.endSeconds) return last.index;
  for (const shot of boundaries) {
    if (t >= shot.startSeconds && t < shot.endSeconds) return shot.index;
  }
  return boundaries[0].index;
}

/**
 * 把转写句归属到镜头。
 *
 * 规则（2026-08-13 拍板，写进 docs/plan）：
 * ① 句子按**起始时间**归属——一句话从哪一镜开始，就算哪一镜的词；
 * ② 跨镜的长句**不切分**（切开会把半句话塞给下一镜，读起来像乱码，而且没法还原语气）；
 * ③ 被跨过去的镜头标 `carriedOver` —— UI 上写「承接上镜」，让用户知道这镜不是漏词，
 *    是上一句还没说完。不标的话用户会以为拆解漏了。
 */
export function assignSegmentsToShots(
  segments: readonly TranscriptSegment[],
  boundaries: readonly ShotBoundary[],
): ShotDialogue[] {
  const result: ShotDialogue[] = boundaries.map((s) => ({ shotIndex: s.index, text: "", carriedOver: false }));
  if (!boundaries.length) return result;
  const byIndex = new Map(result.map((r) => [r.shotIndex, r]));

  const ordered = [...segments]
    .filter((s) => s && typeof s.text === "string" && s.text.trim())
    .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

  for (const seg of ordered) {
    const startIdx = shotIndexAt(boundaries, seg.start);
    const row = byIndex.get(startIdx);
    if (!row) continue;
    const piece = seg.text.trim();
    row.text = row.text ? `${row.text} ${piece}` : piece;

    // 这句说到了哪一镜为止；中间跨过的镜头全部标「承接上镜」。
    const endSeconds = Number.isFinite(seg.end) ? seg.end : seg.start;
    const endIdx = shotIndexAt(boundaries, Math.max(seg.start, endSeconds));
    for (let i = startIdx + 1; i <= endIdx; i += 1) {
      const carried = byIndex.get(i);
      if (carried) carried.carriedOver = true;
    }
  }
  return result;
}

/**
 * 每镜取几帧、取哪几秒。
 *
 * 为什么默认 3 帧而不是 1 帧（实测支撑，见 docs/plan/2026-08-13-…）：
 * 单帧会漏掉「出现又消失」的字幕/角标/价格——实测同一镜的 3 帧里，下载弹窗只在第 3 帧。
 * 而 3 帧的代价极小：image token 线性 ×3，但**墙钟只慢 26%**（8.8s → 11.1s，瓶颈在模型思考不在传图）。
 *
 * 取首/中/尾而不是均匀撒点：首帧定构图、尾帧看运动到哪、中帧兜住主体。
 * 两端各内缩 8%，避开转场帧（切点处常是叠化/黑场，抽到就是一张糊的）。
 */
export function sampleSecondsForShot(shot: ShotBoundary, frames = 3): number[] {
  const span = Math.max(0, shot.endSeconds - shot.startSeconds);
  if (span <= 0) return [shot.startSeconds];
  const inset = span * 0.08;
  const from = shot.startSeconds + inset;
  const to = shot.endSeconds - inset;
  const n = Math.max(1, Math.floor(frames));
  if (n === 1) return [(from + to) / 2];
  const step = (to - from) / (n - 1);
  return Array.from({ length: n }, (_, i) => Number((from + step * i).toFixed(3)));
}
