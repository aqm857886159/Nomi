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

/** 每镜采样时两端各内缩的比例（避开转场帧）。sampleSecondsForShot 与最短镜头推导共用这一个数。 */
export const SHOT_SAMPLE_INSET = 0.08;

export type ShotBoundaryOptions = {
  /** 源片帧率（probeMediaMetadata 给的真数）。缺席 = 判不出最短镜头，只丢退化切点。 */
  fps?: number;
  /** 每镜要取几帧（与 sampleSecondsForShot 同一个数）。 */
  framesPerShot?: number;
};

/**
 * 这条片子上，**短于多少秒的镜头不值得存在**。
 *
 * 判据不是「觉得 0.01s 太短」，而是可度量的事实：一镜要取 N 帧喂模型，这 N 帧必须落在 N 个
 * **不同的源帧**上。采样跨度是 `(1 - 2*INSET) * span`，要放得下 `N-1` 个帧间隔，于是
 *
 *   minShot = max(1/fps, (N-1) / ((1 - 2*INSET) * fps))
 *
 * 30fps 取 3 帧 → 0.079s；12fps 取 3 帧 → 0.198s。**同一个常数不可能同时对**——
 * 这正是 2026-09-11 那条 `0.0333s` 的镜头（30fps 的第 2 帧被当成切点）漏进来的原因：
 * 老代码写的是 `s > 0.01`，而 `0.0333 > 0.01`。
 *
 * fps 拿不到时返回 0：判不出来就不假装判得出（只有退化切点会被丢）。
 */
export function minShotSeconds(options: ShotBoundaryOptions = {}): number {
  const fps = Number.isFinite(options.fps) && (options.fps as number) > 0 ? (options.fps as number) : 0;
  if (fps <= 0) return 0;
  const frameSeconds = 1 / fps;
  const frames = Math.max(1, Math.floor(options.framesPerShot ?? 1));
  if (frames <= 1) return frameSeconds;
  return Math.max(frameSeconds, ((frames - 1) * frameSeconds) / (1 - 2 * SHOT_SAMPLE_INSET));
}

/**
 * 切点 → 镜头区间。
 *
 * 为什么第一段从 0 开始：第一个镜头不由切点产生（它从片头就在），
 * 只列切点会丢掉整个开场镜——而开场镜恰恰是广告里最重要的钩子。
 */
export function buildShotBoundaries(
  cutSeconds: readonly number[],
  durationSeconds: number,
  options: ShotBoundaryOptions = {},
): ShotBoundary[] {
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  if (duration <= 0) return [];

  // 最短镜头长度**从源片派生**（见 minShotSeconds）。拿不到 fps 就只丢退化切点（贴着 0 / 片尾的），
  // 不拿一个写死的秒数假装知道——那正是 0.0333s 那一镜的来处。
  const minShot = minShotSeconds(options);

  // 去重 + 排序 + 丢掉落在片外、贴边、或短到取不出 N 张不同帧的切点。
  //
  // 两道判据分开写，因为它们管的不是一件事：
  //  · 退化（`s > 0 && s < duration`）与 fps 无关，永远要丢——切在第 0 秒或正好切在片尾，
  //    切出来的是一个零长镜头。**这道不能靠 minShot 兼任**：fps 拿不到时 minShot 是 0，
  //    而 `duration - 0 === duration`，片尾那一刀就会漏进来（2026-09-13 实测：8s 片的 s=8
  //    切出 [8,8] 这一镜）。早先用 ±0.01 的写法碰巧挡住了它，但那个常数同时也是 0.0333s 碎镜的来处。
  //  · 太短（`minShot`）只有拿得到 fps 才判得出——判不出来就不假装判得出。
  const ordered = Array.from(new Set(
    cutSeconds
      .filter((s) => Number.isFinite(s))
      .map((s) => Math.max(0, s))
      .filter((s) => s > 0 && s < duration)
      .filter((s) => s >= minShot && s <= duration - minShot),
  )).sort((a, b) => a - b);

  // 相邻切点也要拉开 minShot：连着两个近切点同样会切出取不出不同帧的碎镜。
  const cuts: number[] = [];
  for (const s of ordered) if (!cuts.length || s - cuts[cuts.length - 1] >= minShot) cuts.push(s);

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
  const inset = span * SHOT_SAMPLE_INSET;
  const from = shot.startSeconds + inset;
  const to = shot.endSeconds - inset;
  const n = Math.max(1, Math.floor(frames));
  if (n === 1) return [(from + to) / 2];
  const step = (to - from) / (n - 1);
  return Array.from({ length: n }, (_, i) => Number((from + step * i).toFixed(3)));
}
