// 「找参考」的**归一层**：把三个平台形状各异的检索响应，压成同一个 ReferenceItem。
//
// 为什么必须有这一层（不是过度设计）：TikHub 的文档**按平台分组而不是按能力分组**，
// 且**不规定统一的响应 envelope**（docs.tikhub.io 实读 2026-09-07）。实测证据：
//   · 抖音   条目在 data.data[].aweme_info，指标在 statistics.{digg_count,collect_count,…}
//   · 小红书 比其它家**多包一层信封**，条目在 data.data.items[].note，指标是 liked_count/collected_count（字符串）
//   · TikTok 广告库 条目在 data.data.materials[]，指标是 like/ctr/cost，且**只有它有投放表现面**
// 上游不给统一形状，归一就只能我们做；做完之后 UI 只认识 ReferenceItem，不认识任何平台字段。
//
// 契约（平台词表 / ReferenceItem / 证据格）住在中立层 electron/shared/contracts/referenceSearch.ts。
// 方案与实调记录：docs/plan/2026-09-07-find-reference-connector.md
import { isJsonRecord, firstString, trim, type JsonRecord } from "../jsonUtils";
import {
  REFERENCE_PLATFORM_FACTS,
  type ReferenceEvidence,
  type ReferenceItem,
  type ReferencePlatform,
  type ReferenceSearchResult,
} from "../shared/contracts/referenceSearch";

/** 把任意形状的计数读成 number（小红书返回的是字符串）。读不出返回 null，**不假装成 0**。 */
function readCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

/**
 * 中文平台的计数格式化：万/亿。
 * 归一层负责格式化而不是 UI——因为「多少算大」是平台习惯（抖音说 74.1万，TikTok 说 8.4k）。
 */
export function formatCountCn(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, "")}亿`;
  if (n >= 10_000) return `${(n / 10_000).toFixed(1).replace(/\.0$/, "")}万`;
  return String(n);
}

/** 英文平台的计数格式化：k/M。 */
export function formatCountEn(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** 秒 → 「0:22」。拿不到返回空串（不编 0:00）。 */
export function formatDuration(seconds: unknown): string {
  const n = typeof seconds === "number" && Number.isFinite(seconds) ? seconds : null;
  if (n === null || n <= 0) return "";
  const total = Math.round(n);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function clampCaption(text: string): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 60)}…` : one;
}

/**
 * 各平台的条目遍历——**normalizer 与媒体直链提取共用这一条**，不长两份走法（P1）。
 * 返回 `{ id, raw }`：raw 是该平台条目的「有效根」（抖音是 aweme_info，小红书是 note，广告库就是条目本身）。
 */
function entriesOf(platform: ReferencePlatform, body: JsonRecord): { id: string; raw: JsonRecord }[] {
  const out: { id: string; raw: JsonRecord }[] = [];
  const envelope = isJsonRecord(body.data) ? body.data : {};
  if (platform === "douyin") {
    const list = Array.isArray(envelope.data) ? envelope.data : [];
    for (const entry of list) {
      if (!isJsonRecord(entry)) continue;
      const aweme = isJsonRecord(entry.aweme_info) ? entry.aweme_info : entry;
      const id = firstString(aweme.aweme_id);
      if (id) out.push({ id, raw: aweme });
    }
    return out;
  }
  // 小红书比其它家多包一层信封。
  const inner = isJsonRecord(envelope.data) ? envelope.data : envelope;
  if (platform === "xhs") {
    const list = Array.isArray(inner.items) ? inner.items : [];
    for (const entry of list) {
      if (!isJsonRecord(entry)) continue;
      const note = isJsonRecord(entry.note) ? entry.note : entry;
      const id = firstString(note.id, note.note_id, entry.id);
      if (id) out.push({ id, raw: note });
    }
    return out;
  }
  const list = Array.isArray(inner.materials) ? inner.materials : [];
  for (const entry of list) {
    if (!isJsonRecord(entry)) continue;
    const id = firstString(entry.id);
    if (id) out.push({ id, raw: entry });
  }
  return out;
}

/**
 * 从条目里抽可直接落盘的媒体直链。
 *
 * ⚠️ **这些是平台侧的短时签名 URL**，所以它们**不进 ReferenceItem、不过 IPC**——
 * 只留在主进程，由服务层在用户点「加入素材库」时就地取用（见 tikhubConnectorService）。
 *
 * 各平台的坑（实调 2026-09-07）：
 *   · 抖音   `video.play_addr.url_list[0]`
 *   · 小红书 必须挑 **h264** 那一路：它的 `format` 是 `mp4`（完整文件）；
 *            h265/h266/av1 给的是 `.m4s` **分片流**，落下来不是能播的文件。
 *            URL 是 `http://`，统一升到 https（实测 xhscdn 两种都返回 206 + video/mp4）。
 *   · 广告库 `video_info.video_url['720p']`（实测可直下：206 / video/mp4 / ftypisom）
 */
export function extractMediaUrl(platform: ReferencePlatform, raw: JsonRecord): string {
  if (platform === "douyin") {
    const video = isJsonRecord(raw.video) ? raw.video : {};
    const play = isJsonRecord(video.play_addr) ? video.play_addr : {};
    const list = Array.isArray(play.url_list) ? play.url_list : [];
    return firstString(list[0]);
  }
  if (platform === "xhs") {
    const v2 = isJsonRecord(raw.video_info_v2) ? raw.video_info_v2 : {};
    const media = isJsonRecord(v2.media) ? v2.media : {};
    const stream = isJsonRecord(media.stream) ? media.stream : {};
    const h264 = Array.isArray(stream.h264) ? stream.h264 : [];
    const first = isJsonRecord(h264[0]) ? h264[0] : {};
    const url = firstString(first.master_url);
    return url.startsWith("http://") ? `https://${url.slice("http://".length)}` : url;
  }
  const info = isJsonRecord(raw.video_info) ? raw.video_info : {};
  const urls = isJsonRecord(info.video_url) ? info.video_url : {};
  return firstString(urls["720p"], urls["540p"], urls["360p"]);
}

/** 一次检索里「条目 id → 媒体直链」的映射。只在主进程用。 */
export function extractMediaUrls(platform: ReferencePlatform, body: JsonRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { id, raw } of entriesOf(platform, body)) {
    const url = extractMediaUrl(platform, raw);
    if (/^https?:\/\//i.test(url)) out[id] = url;
  }
  return out;
}

// ── 抖音 ──────────────────────────────────────────────────────────────────────
// 实调 2026-09-07：statistics 里 digg/collect/comment/share 都是真值，
// 但 **play_count 与 exposure_count 恒为 0** —— 所以不画「播放量」这一格（画了就是长期显示 0）。
export function normalizeDouyin(body: JsonRecord): ReferenceItem[] {
  const data = isJsonRecord(body.data) ? body.data : {};
  const list = Array.isArray(data.data) ? data.data : [];
  const out: ReferenceItem[] = [];
  for (const entry of list) {
    if (!isJsonRecord(entry)) continue;
    const aweme = isJsonRecord(entry.aweme_info) ? entry.aweme_info : entry;
    const id = firstString(aweme.aweme_id);
    if (!id) continue;
    const stats = isJsonRecord(aweme.statistics) ? aweme.statistics : {};
    const digg = readCount(stats.digg_count);
    const collect = readCount(stats.collect_count);
    const evidence: ReferenceEvidence[] = [];
    if (digg !== null) evidence.push({ kind: "scale", metric: "none", value: `♥ ${formatCountCn(digg)}` });
    if (collect !== null) evidence.push({ kind: "secondary", metric: "collect", value: formatCountCn(collect) });
    const video = isJsonRecord(aweme.video) ? aweme.video : {};
    const cover = isJsonRecord(video.cover) ? video.cover : {};
    const coverList = Array.isArray(cover.url_list) ? cover.url_list : [];
    out.push({
      platform: "douyin",
      id,
      caption: clampCaption(firstString(aweme.desc)),
      coverUrl: firstString(coverList[0]),
      pageUrl: `https://www.douyin.com/video/${id}`,
      durationLabel: formatDuration(typeof video.duration === "number" ? video.duration / 1000 : undefined),
      mediaKind: "video",
      evidence,
    });
  }
  return out;
}

// ── 小红书 ────────────────────────────────────────────────────────────────────
// 实调 2026-09-07：比其它三家**多包一层信封**（data.data.items[].note），计数是**字符串**。
// **收藏排在点赞前面**：小红书的收藏≈「被当成攻略存起来」，比点赞更接近「这条有用」。
// 同一个视觉位置，语义跟抖音不同——这正是「证据格必须按平台 derive」的由来。
export function normalizeXhs(body: JsonRecord): ReferenceItem[] {
  const envelope = isJsonRecord(body.data) ? body.data : {};
  const inner = isJsonRecord(envelope.data) ? envelope.data : envelope;
  const list = Array.isArray(inner.items) ? inner.items : [];
  const out: ReferenceItem[] = [];
  for (const entry of list) {
    if (!isJsonRecord(entry)) continue;
    const note = isJsonRecord(entry.note) ? entry.note : entry;
    const id = firstString(note.id, note.note_id, entry.id);
    if (!id) continue;
    const liked = readCount(note.liked_count);
    const collected = readCount(note.collected_count);
    const evidence: ReferenceEvidence[] = [];
    if (collected !== null) evidence.push({ kind: "scale", metric: "collect", value: formatCountCn(collected) });
    if (liked !== null) evidence.push({ kind: "secondary", metric: "none", value: `♥ ${formatCountCn(liked)}` });
    const cover = isJsonRecord(note.cover) ? note.cover : {};
    const isVideo = firstString(note.type) === "video";
    out.push({
      platform: "xhs",
      id,
      caption: clampCaption(firstString(note.title, note.desc)),
      coverUrl: firstString(cover.url, cover.url_size_large, cover.info_list),
      pageUrl: `https://www.xiaohongshu.com/explore/${id}`,
      durationLabel: isVideo ? formatDuration(readCount(note.duration) ?? undefined) : "",
      // 小红书有大量图文帖——显式标出来，UI 才能说「图文」而不是显示空白时长。
      mediaKind: isVideo ? "video" : "image",
      evidence,
    });
  }
  return out;
}

// ── TikTok 广告库 ─────────────────────────────────────────────────────────────
// 实调 2026-09-07：条目在 data.data.materials[]。**唯一有投放表现面的平台**。
// 角标用规模（like）而不是 CTR——实测 CTR 与投放规模**反相关**：
//   cost=2 那批 CTR 均值 0.16% / 点赞均值 8374；cost=0 那批 CTR 0.64% / 点赞 7（小样本噪声）。
// 「放量」标取 cost >= 2（⚠️ 阈值来自 20 条样本，样本小；文档说 cost 是 1-5，实测出现过 0）。
const TIKTOK_HOT_COST_THRESHOLD = 2;

export function normalizeTiktokAds(body: JsonRecord): ReferenceItem[] {
  const envelope = isJsonRecord(body.data) ? body.data : {};
  const inner = isJsonRecord(envelope.data) ? envelope.data : envelope;
  const list = Array.isArray(inner.materials) ? inner.materials : [];
  const out: ReferenceItem[] = [];
  for (const entry of list) {
    if (!isJsonRecord(entry)) continue;
    const id = firstString(entry.id);
    if (!id) continue;
    const like = readCount(entry.like);
    const ctr = typeof entry.ctr === "number" ? entry.ctr : null;
    const cost = readCount(entry.cost);
    const evidence: ReferenceEvidence[] = [];
    if (like !== null) evidence.push({ kind: "scale", metric: "none", value: `♥ ${formatCountEn(like)}` });
    if (cost !== null && cost >= TIKTOK_HOT_COST_THRESHOLD) {
      evidence.push({ kind: "hot", metric: "hot", value: "" });
    }
    if (ctr !== null) evidence.push({ kind: "perf", metric: "ctr", value: `${ctr.toFixed(2)}%` });
    const info = isJsonRecord(entry.video_info) ? entry.video_info : {};
    out.push({
      platform: "tiktok",
      id,
      caption: clampCaption(firstString(entry.ad_title)),
      coverUrl: firstString(info.cover),
      // 广告库条目没有公开作品页；留空，UI 据此不画「去看原片」。
      pageUrl: "",
      durationLabel: formatDuration(info.duration),
      mediaKind: "video",
      evidence,
    });
  }
  return out;
}

/** 平台 → normalizer 的单一登记表（新增平台只改这里 + 契约里的词表）。 */
export const REFERENCE_NORMALIZERS: Readonly<Record<ReferencePlatform, (body: JsonRecord) => ReferenceItem[]>> = {
  douyin: normalizeDouyin,
  xhs: normalizeXhs,
  tiktok: normalizeTiktokAds,
};

/** 中文字符检测——决定要不要为英文索引的平台做转译。 */
export function hasChinese(text: string): boolean {
  return /[一-鿿]/.test(text);
}

/**
 * 组装一次检索的归一结果。
 *
 * `effectiveKeyword` 与用户输入不同时（中文 → 英文），**必须让 UI 回显**：
 * 不回显，用户不知道结果为什么长这样（设计文档卡点③b）。
 * 实测依据：中文词打 TikTok 广告库相关性只有 32%（英文 85%），且混入泰语/印尼语结果。
 */
export function buildSearchResult(
  platform: ReferencePlatform,
  body: JsonRecord,
  inputKeyword: string,
  effectiveKeyword: string,
): ReferenceSearchResult {
  const items = REFERENCE_NORMALIZERS[platform](body);
  const facts = REFERENCE_PLATFORM_FACTS[platform];
  const translated = trim(effectiveKeyword) !== trim(inputKeyword);
  return {
    platform,
    items,
    effectiveKeyword: trim(effectiveKeyword),
    ...(translated && facts.indexLanguage === "en" ? { translationReason: "english-index" as const } : {}),
    // 上游各平台的游标形态不同（cursor / page / search_id），对 UI 只暴露布尔。
    hasMore: items.length >= facts.pageSize,
  };
}
