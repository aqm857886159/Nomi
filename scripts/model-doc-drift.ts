// 已接入模型的官方文档漂移检查 —— 每日模型雷达的第二段（第一段是 model-radar.ts：上新 / 缺口）。
//
// 为什么要有：接入是对供应商文档某一天的一次抄写。档案里每处来源都记了 checkedAt，但抄完之后没有任何东西回头对——
// Muse Video 11-07 按「固定约 10 秒、按次计费」接入，供应商之后改成「2–10 秒可选、按秒计费」，
// 模型雷达每天抓同一份索引却只比「有没有新页」，这条变化每天从我们手里过、没人知道。
//
// 做法（通行的「内容指纹快照比对」，同 changedetection.io / urlwatch 一类）：
//   指纹表 docs/research/model-radar/doc-fingerprints.json（进仓库）：来源地址 → 正文指纹 + 参数相关行 + 核对日期 + 状态。
//   每天重抓每个来源地址 → 归一后算指纹 → 与表比：
//     变了      —— 列「模型 · 地址 · 上次核对日 · 参数 / 取值 / 计费相关行的前后差」；有人核对并 --accept 之前每天都报；
//     没查成    —— 明说「今天没查成」，绝不当成「没变」；
//     没指纹    —— 新出现的来源地址，说「还没有基线」，也不当成「没变」；
//     新无来源  —— 新接入、档案里没有任何来源地址的模型，报缺口（已登记在表里的存量缺口只计数）。
//   有差异的来源在表里记 pending-fix（待修），逐项对过一致的才记 verified（已核对 + 日期）。
//
// 不碰：任何 Key、付费接口、登录；请求不带用户 / 项目信息；同一主机串行 + 间隔（不同主机之间并行）。
// 用法：
//   pnpm run radar:docs                          抓 + 比对 + 打摘要（只读；退出码 0，全部没查成才 1）
//   pnpm run radar:docs -- --accept <verdicts.json>   核对完后落表：{ "<地址>": { "status": "verified"|"pending-fix", "note": "..." } }
//   pnpm run radar:docs -- --offline <dir>        用本地样本跑（单测 / 离线复现；文件名 = offlineSampleName(url)）
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelRadarResultDir } from "./model-radar.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const FINGERPRINT_TABLE_PATH = path.join(ROOT, "docs/research/model-radar/doc-fingerprints.json");

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type DocSource = {
  url: string;
  /** 引用这个地址的档案 id / 模型 key（去重后的并集）。 */
  models: string[];
  /** 声明里记的最晚核对日（多处引用取最晚的；缺省 ""）。 */
  declaredCheckedAt: string;
};

export type UnsourcedModel = { vendorKey: string; modelKey: string; kind: string };

export type FingerprintEntry = {
  fingerprint: string;
  /**
   * verified = 逐项对过一致；pending-fix = 对过、有差异待修；unaudited = 只记了基线、还没逐项对（以后变了照样报，但不能说成已核对）；
   * not-published = 记基线时这个地址就是 HTTP 404（例如某模型没有公开价目），以后它冒出来才算「变了」；
   * not-comparable = 记基线时这个地址就读不出正文（要脚本渲染的空壳 / 是接口不是文档页），自动比不了——摘要里明着计数，
   *   以后它能读出正文了才算「变了」。它们是「比不了」，不是「没变」。
   */
  status: "verified" | "pending-fix" | "unaudited" | "not-published" | "not-comparable";
  checkedAt: string;
  note?: string;
  /** 参数 / 取值 / 计费相关行（变化摘要用）；整页指纹变了才看这个。 */
  keyLines: string[];
};

export type FingerprintTable = {
  version: 1;
  entries: Record<string, FingerprintEntry>;
  /** 已登记的存量「没有来源地址」的模型（vendorKey/modelKey）——只计数；表里没有的才算新缺口。 */
  unsourcedAcknowledged: string[];
};

export type FetchedDoc = { ok: true; text: string } | { ok: false; error: string };

export type DriftItem = {
  url: string;
  models: string[];
  /** 上次核对日（表里的）；没有 = "" */
  lastCheckedAt: string;
  status: "changed" | "unreachable" | "no-baseline";
  /** changed：参数 / 取值 / 计费相关行的前后差；其余为空 */
  removed: string[];
  added: string[];
  error?: string;
};

export type DriftResult = {
  total: number;
  unchanged: number;
  items: DriftItem[];
  pendingFix: { url: string; models: string[]; note: string }[];
  /** 记了基线、没逐项对账的地址数（不是「已核对」）。 */
  unaudited: number;
  /** 读不出正文、自动比不了的地址数（摘要里明着报；不是「没变」）。 */
  notComparable: number;
  newUnsourced: UnsourcedModel[];
  acknowledgedUnsourcedCount: number;
};

// ---------------------------------------------------------------------------
// 归一与指纹
// ---------------------------------------------------------------------------

/** 抓回来的东西是 SPA 空壳（要脚本渲染）——这种页没有正文可比，必须按「没查成」算。 */
export const MIN_BODY_CHARS = 300;

const HTML_BLOCK_RE = /<\/?(?:p|div|br|li|ul|ol|tr|td|th|table|h[1-6]|section|article|pre|code)\b[^>]*>/gi;

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(HTML_BLOCK_RE, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 价目 / 接口类 JSON（体积小的）展开成排好序的 `路径=值` 行，并丢掉促销 / 会员 / 实付折扣这类天天可变、
 * 不属于「标价」的字段——指纹只随标价（计费单位、单价、档位）变。大 JSON（如 OpenAPI 全量文件）不展开，原样当文本比。
 */
const VOLATILE_JSON_KEY_RE = /discount|paid|membership|actual|saving|updated|timestamp|request_id/i;
const JSON_FLATTEN_MAX_CHARS = 200_000;
export const isFlatJsonLine = (line: string): boolean => /^[\w.[\]-]+=/.test(line);

function flattenJsonDoc(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") || trimmed.length > JSON_FLATTEN_MAX_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const lines: string[] = [];
  const walk = (value: unknown, at: string) => {
    if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (VOLATILE_JSON_KEY_RE.test(k)) continue;
        walk(v, at ? `${at}.${k}` : k);
      }
    } else lines.push(`${at}=${JSON.stringify(value)}`);
  };
  walk(parsed, "");
  return lines.sort().join("\n");
}

/** APIMart 每页顶部那段「Documentation Index」说明、站点导航样板——和模型内容无关，天天一样或随站点改版变。 */
const BOILERPLATE_RE = /^>\s*(?:##\s*Documentation Index|Fetch the complete documentation index|Use this file to discover)/i;

/**
 * 归一：HTML 去标签与脚本，markdown / JSON 原样；统一换行、塌连续空白、去掉站点样板行。
 * 目的是让指纹只随「内容」变，不随空白、样板、构建产物变。
 */
export function normalizeDocText(raw: string): string {
  const flat = flattenJsonDoc(raw);
  if (flat !== null) return flat;
  const isHtml = /^\s*<(?:!doctype|html)\b/i.test(raw);
  const base = isHtml ? htmlToText(raw) : raw;
  return base
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => line && !BOILERPLATE_RE.test(line))
    .join("\n");
}

export function fingerprintOf(normalized: string): string {
  return `sha256:${crypto.createHash("sha256").update(normalized).digest("hex")}`;
}

const KEY_LINE_RE =
  /duration|seconds?\b|秒|resolution|aspect|ratio|size\b|quality|pric(?:e|ing)|cost|credit|billing|charge|per (?:second|video|image|task|request|generation|minute|1k|1m)|每|默认|default|\bmax(?:imum)?\b|\bmin(?:imum)?\b|最多|最少|至多|至少|up to|at most|between|range|image_urls|reference|fps|frame|\d\s*[–—-]\s*\d|\b\d+\s?(?:p|k)\b|enum/i;
const KEY_LINE_MAX = 50;
const KEY_LINE_CHARS = 160;

/** 参数、取值范围、计费相关行：表格行一律收，正文行按关键词收；JSON 大文件不收（太大，只报「变了」）。 */
export function extractKeyLines(normalized: string): string[] {
  if (/^\s*[{[]/.test(normalized) && normalized.length > 200_000) return [];
  const flat = isFlatJsonLine(normalized.split("\n", 1)[0] ?? "");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of normalized.split("\n")) {
    if (!(flat || line.startsWith("|") || KEY_LINE_RE.test(line))) continue;
    const trimmed = line.length > KEY_LINE_CHARS ? `${line.slice(0, KEY_LINE_CHARS)}…` : line;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
    if (out.length >= KEY_LINE_MAX) break;
  }
  return out;
}

/** 抓回来的东西能不能当「正文」：太短 / 像要脚本渲染的空壳 → 不能。返回 null = 可用，否则是原因。 */
export function bodyProblem(raw: string): string | null {
  const text = normalizeDocText(raw);
  if (isFlatJsonLine(text.split("\n", 1)[0] ?? "")) return text.split("\n").length >= 3 ? null : "接口返回的字段太少（疑似出错）";
  if (text.length < MIN_BODY_CHARS) return `正文只有 ${text.length} 字符（疑似要脚本渲染 / 被拦截）`;
  if (/enable javascript|you need to enable javascript|please turn on javascript/i.test(text) && text.length < 2000) return "页面要启用脚本才有内容";
  return null;
}

// ---------------------------------------------------------------------------
// 来源收集：从内置目录与档案 derive，不手写清单
// ---------------------------------------------------------------------------

type ArchetypeLike = { id: string; sources?: { url: string; checkedAt: string }[] };
type SeedModelLike = { vendorKey: string; modelKey: string; modelAlias?: string | null; kind: string; tokenPricing?: { source?: { url: string; checkedAt: string } } };

/**
 * 纯函数（可测）：档案来源 + 目录里的按 token 计价出处 → 去重的来源地址；
 * 没有任何来源地址的已接入模型单列（缺口本身）。`isLocal` 为 true 的（本机运行，没有上游文档）不算缺口。
 */
export function buildDocSources(input: {
  archetypes: readonly ArchetypeLike[];
  models: readonly SeedModelLike[];
  archetypeIdForModel: (modelKey: string, modelAlias?: string | null) => string | null;
  isLocalVendor: (vendorKey: string) => boolean;
  /** 供应商不要 Key 的公开价目地址（有就纳入指纹：计费单位 / 单价 / 档位）；没有 = null。不算「有文档来源」。 */
  priceUrlFor?: (model: { vendorKey: string; modelKey: string }) => string | null;
}): { sources: DocSource[]; unsourced: UnsourcedModel[] } {
  const byUrl = new Map<string, { models: Set<string>; checked: string }>();
  const add = (url: string, who: string, checkedAt: string) => {
    const cur = byUrl.get(url) ?? { models: new Set<string>(), checked: "" };
    cur.models.add(who);
    if (checkedAt > cur.checked) cur.checked = checkedAt;
    byUrl.set(url, cur);
  };
  const archetypeById = new Map(input.archetypes.map((a) => [a.id, a] as const));
  for (const a of input.archetypes) for (const s of a.sources ?? []) add(s.url, a.id, s.checkedAt);
  const unsourced: UnsourcedModel[] = [];
  for (const m of input.models) {
    const archetype = archetypeById.get(input.archetypeIdForModel(m.modelKey, m.modelAlias) ?? "");
    const hasArchetypeSource = (archetype?.sources?.length ?? 0) > 0;
    const price = m.tokenPricing?.source;
    if (price) add(price.url, `${m.vendorKey}/${m.modelKey}`, price.checkedAt);
    const publicPrice = input.priceUrlFor?.(m);
    if (publicPrice) add(publicPrice, `${m.vendorKey}/${m.modelKey}（价目）`, "");
    if (!hasArchetypeSource && !price && !input.isLocalVendor(m.vendorKey)) unsourced.push({ vendorKey: m.vendorKey, modelKey: m.modelKey, kind: m.kind });
  }
  const sources = [...byUrl.entries()]
    .map(([url, v]) => ({ url, models: [...v.models].sort(), declaredCheckedAt: v.checked }))
    .sort((a, b) => a.url.localeCompare(b.url));
  return { sources, unsourced };
}

/** APIMart 公开价目接口（官方文档写明「不需要认证、不要发 Authorization」）：GET /api/pricing/model?model=<id>。 */
export const apimartPriceUrl = (modelKey: string): string => `https://api.apimart.ai/api/pricing/model?model=${encodeURIComponent(modelKey)}`;

/** 真实目录的来源（生产入口）；重依赖放这里面懒加载，单测不用拉。 */
export async function collectDocSources(): Promise<{ sources: DocSource[]; unsourced: UnsourcedModel[]; modelCount: number }> {
  const [{ applyBuiltinSeeds }, entry, { BUILTIN_VENDOR_SEEDS, isLocalSeed }] = await Promise.all([
    import("../electron/catalog/seedBuiltins.ts"),
    import("../electron/shared/modelArchetypes/entry.ts"),
    import("../electron/catalog/builtinVendorSeeds.ts"),
  ]);
  const state = applyBuiltinSeeds({ version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} }, "2026-01-01T00:00:00.000Z").state;
  const localKeys = new Set(BUILTIN_VENDOR_SEEDS.filter((seed) => isLocalSeed(seed)).map((seed) => seed.key));
  const built = buildDocSources({
    archetypes: entry.everyBuiltInArchetype(),
    models: state.models as unknown as SeedModelLike[],
    archetypeIdForModel: entry.archetypeIdForModel,
    isLocalVendor: (key) => localKeys.has(key),
    priceUrlFor: (m) => (m.vendorKey === "apimart" ? apimartPriceUrl(m.modelKey) : null),
  });
  return { ...built, modelCount: state.models.length };
}

// ---------------------------------------------------------------------------
// 比对（纯函数）
// ---------------------------------------------------------------------------

export function emptyTable(): FingerprintTable {
  return { version: 1, entries: {}, unsourcedAcknowledged: [] };
}

export function compareDocs(input: {
  sources: readonly DocSource[];
  unsourced: readonly UnsourcedModel[];
  table: FingerprintTable;
  fetched: ReadonlyMap<string, FetchedDoc>;
}): DriftResult {
  const items: DriftItem[] = [];
  const pendingFix: DriftResult["pendingFix"] = [];
  let unchanged = 0;
  let unaudited = 0;
  let notComparable = 0;
  for (const source of input.sources) {
    const entry = input.table.entries[source.url];
    const got = input.fetched.get(source.url);
    const base = { url: source.url, models: source.models, lastCheckedAt: entry?.checkedAt ?? "", removed: [] as string[], added: [] as string[] };
    // 记基线时就是 404 的地址：今天仍是 404 = 没变；冒出来了 = 变了（下面走正文比对，指纹对不上）。
    if (entry?.status === "not-published" && got && !got.ok && /^HTTP 404\b/.test(got.error)) {
      unchanged += 1;
      continue;
    }
    // 记基线时就读不出正文的地址：今天仍读不出 = 比不了（单独计数，不进「没变」）；读出来了 = 往下走，指纹对不上就是「变了」。
    if (entry?.status === "not-comparable" && (!got || !got.ok || bodyProblem(got.text))) {
      notComparable += 1;
      continue;
    }
    // 没抓回来就是没抓回来——缺失的键、抓取失败、空壳都走「没查成」，绝不落进「没变」。
    const problem = !got ? "今天没有抓取结果" : !got.ok ? got.error : bodyProblem(got.text);
    if (problem) {
      items.push({ ...base, status: "unreachable", error: problem });
      continue;
    }
    const normalized = normalizeDocText((got as { ok: true; text: string }).text);
    if (!entry) {
      items.push({ ...base, status: "no-baseline" });
      continue;
    }
    if (fingerprintOf(normalized) === entry.fingerprint) {
      unchanged += 1;
      if (entry.status === "unaudited") unaudited += 1;
      if (entry.status === "pending-fix") pendingFix.push({ url: source.url, models: source.models, note: entry.note ?? "" });
      continue;
    }
    const now = extractKeyLines(normalized);
    const before = new Set(entry.keyLines);
    const after = new Set(now);
    items.push({
      ...base,
      status: "changed",
      removed: entry.keyLines.filter((line) => !after.has(line)),
      added: now.filter((line) => !before.has(line)),
    });
  }
  const acknowledged = new Set(input.table.unsourcedAcknowledged);
  const newUnsourced = input.unsourced.filter((m) => !acknowledged.has(`${m.vendorKey}/${m.modelKey}`));
  return {
    total: input.sources.length,
    unchanged,
    items,
    pendingFix,
    unaudited,
    notComparable,
    newUnsourced,
    acknowledgedUnsourcedCount: input.unsourced.length - newUnsourced.length,
  };
}

// ---------------------------------------------------------------------------
// 摘要（进开工提示：行数紧，详情写文件）
// ---------------------------------------------------------------------------

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);
const modelList = (models: readonly string[]) => (models.length > 3 ? `${models.slice(0, 3).join("、")} 等 ${models.length} 个` : models.join("、"));

/** 完整报告（写文件用）。 */
export function formatFullReport(result: DriftResult): string {
  const lines: string[] = [];
  const changed = result.items.filter((i) => i.status === "changed");
  const unreachable = result.items.filter((i) => i.status === "unreachable");
  const noBaseline = result.items.filter((i) => i.status === "no-baseline");
  lines.push(`来源地址 ${result.total} 个：没变 ${result.unchanged}（其中未逐项对账 ${result.unaudited}）· 无法比对 ${result.notComparable} · 变了 ${changed.length} · 今天没查成 ${unreachable.length} · 还没有基线 ${noBaseline.length}`);
  for (const i of changed) {
    lines.push(`变了 · ${modelList(i.models)} · ${i.url} · 上次核对 ${i.lastCheckedAt || "未知"}`);
    for (const l of i.removed.slice(0, 6)) lines.push(`    - ${clip(l, 160)}`);
    for (const l of i.added.slice(0, 6)) lines.push(`    + ${clip(l, 160)}`);
    if (i.removed.length === 0 && i.added.length === 0) lines.push("    （正文变了，参数 / 取值 / 计费相关行没有差异——多半是示例或措辞，仍需有人看一眼后 --accept）");
  }
  for (const i of unreachable) lines.push(`今天没查成 · ${modelList(i.models)} · ${i.url} · ${i.error ?? ""}（不是「没变」）`);
  for (const i of noBaseline) lines.push(`还没有基线 · ${modelList(i.models)} · ${i.url}（指纹表里没有这个地址，不是「没变」）`);
  for (const p of result.pendingFix) lines.push(`待修 · ${modelList(p.models)} · ${p.url}${p.note ? ` · ${clip(p.note, 120)}` : ""}`);
  for (const m of result.newUnsourced) lines.push(`新缺口 · ${m.vendorKey}/${m.modelKey}（${m.kind}）已接入但档案里没有任何来源地址`);
  if (result.acknowledgedUnsourcedCount > 0) lines.push(`已登记的存量缺口 ${result.acknowledgedUnsourcedCount} 个（没有来源地址的已接入模型，见指纹表）`);
  return lines.join("\n");
}

const SUMMARY_MAX_ITEMS = 8;

/** 进开工提示的短版：一行总数 + 至多 8 条逐项 + 指向完整报告。变了 / 没查成 / 新缺口排前面。 */
export function formatSummary(result: DriftResult, reportPath: string): string {
  const changed = result.items.filter((i) => i.status === "changed");
  const unreachable = result.items.filter((i) => i.status === "unreachable");
  const noBaseline = result.items.filter((i) => i.status === "no-baseline");
  const head =
    `文档漂移：来源地址 ${result.total} 个 · 没变 ${result.unchanged} · ⚠️ 变了 ${changed.length} · ⚠️ 今天没查成 ${unreachable.length}（不是「没变」）` +
    ` · 没基线 ${noBaseline.length} · 无法比对 ${result.notComparable} · 未逐项对账 ${result.unaudited} · 待修 ${result.pendingFix.length} · 新缺口 ${result.newUnsourced.length}`;
  const rows: string[] = [];
  for (const i of changed) {
    const hint = i.added[0] ?? i.removed[0] ?? "正文变了，参数 / 计费行无差异";
    rows.push(`  ⚠️ 变了 ${modelList(i.models)}（上次核对 ${i.lastCheckedAt || "未知"}）${i.url} → ${clip(hint, 90)}`);
  }
  for (const i of unreachable) rows.push(`  ⚠️ 没查成 ${modelList(i.models)} ${i.url}：${clip(i.error ?? "", 60)}`);
  for (const m of result.newUnsourced) rows.push(`  ⚠️ 新缺口 ${m.vendorKey}/${m.modelKey}：已接入但没有任何来源地址`);
  for (const i of noBaseline) rows.push(`  没基线 ${modelList(i.models)} ${i.url}`);
  const shown = rows.slice(0, SUMMARY_MAX_ITEMS);
  const rest = rows.length - shown.length;
  return [head, ...shown, ...(rest > 0 ? [`  …另有 ${rest} 项`] : []), `  完整报告：${reportPath}（有人核对后：pnpm run radar:docs -- --accept <verdicts.json>；表里更新前每天都会再报）`].join("\n");
}

// ---------------------------------------------------------------------------
// 抓取
// ---------------------------------------------------------------------------

export type FetchDoc = (url: string) => Promise<string>;

/** 离线样本的文件名：主机 + 路径 + 查询串（价目接口靠查询串区分模型，不能丢）。 */
export const offlineSampleName = (url: string): string => {
  const u = new URL(url);
  return `${u.host}${u.pathname}${u.search}`.replace(/[^A-Za-z0-9.-]+/g, "_");
};

const REQUEST_TIMEOUT_MS = 12_000;
const HOST_GAP_MS = 250;
const HOST_LANES = 4;
const MAX_BODY_BYTES = 3_000_000;

/** 临时性错误（网络抖动 / 超时 / 限流 / 5xx）才重试；404、405 这类「地址本身的答案」不重试。 */
export const isTransientFetchError = (message: string): boolean => !/^HTTP (?:4(?!08|29)\d\d)\b/.test(message);
const FETCH_RETRIES = 2;
const RETRY_GAP_MS = 700;

/** 公开文档抓取：带重试的 {@link fetchPublicDocOnce}（几百个地址里总有几个一次抓不下来，每天报一堆「没查成」是噪音）。 */
export async function fetchPublicDoc(url: string): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // 第一次优先要 markdown（APIMart 无后缀页靠它拿到正文）；个别站点（kie）对这个头回空壳页，重试换成通用头。
      const text = await fetchPublicDocOnce(url, attempt === 0 ? ACCEPT_MARKDOWN_FIRST : ACCEPT_ANY);
      // 空壳（个别站点偶尔回要脚本渲染的页）也当临时错误重试；重试用完还是空壳，原样交回，由比对按「没查成」报。
      if (bodyProblem(text) && attempt < FETCH_RETRIES) throw new Error("shell body");
      return text;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= FETCH_RETRIES || !isTransientFetchError(message)) throw error;
      await new Promise((r) => setTimeout(r, RETRY_GAP_MS * (attempt + 1)));
    }
  }
}

/** 一次公开文档抓取：不带任何凭据 / 用户 / 项目信息，UA 通用；走环境里已有的代理（和雷达其余部分一样）。 */
const ACCEPT_MARKDOWN_FIRST = "text/markdown,text/plain,text/html,application/json;q=0.9,*/*;q=0.5";
const ACCEPT_ANY = "*/*";

async function fetchPublicDocOnce(url: string, accept: string): Promise<string> {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || "";
  let dispatcher: unknown;
  if (proxy) {
    const { ProxyAgent } = await import("undici");
    dispatcher = new ProxyAgent(proxy);
  }
  const res = await fetch(url, {
    headers: { "user-agent": "doc-drift-check/1", accept },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    ...(dispatcher ? { dispatcher } : {}),
  } as RequestInit);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) throw new Error("empty body"); // 个别站点偶尔回 200 + 空正文，按临时错误重试
  return text.length > MAX_BODY_BYTES ? text.slice(0, MAX_BODY_BYTES) : text;
}

/**
 * 同一主机最多 `lanes` 条并行线、每条线内串行 + 间隔（默认 4 条、间隔 250ms，对公开文档站足够轻）；不同主机并行。
 * 任何一个失败只记那一个，别的照抓。
 */
export async function fetchAll(urls: readonly string[], fetchDoc: FetchDoc, gapMs = HOST_GAP_MS, lanes = HOST_LANES): Promise<Map<string, FetchedDoc>> {
  const byHost = new Map<string, string[]>();
  for (const url of urls) {
    const host = new URL(url).host;
    byHost.set(host, [...(byHost.get(host) ?? []), url]);
  }
  const out = new Map<string, FetchedDoc>();
  const queues = [...byHost.values()].flatMap((list) => Array.from({ length: Math.min(lanes, list.length) }, (_, lane) => list.filter((_url, i) => i % lanes === lane)));
  await Promise.all(
    queues.map(async (list) => {
      for (let i = 0; i < list.length; i += 1) {
        if (i > 0 && gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
        try {
          out.set(list[i], { ok: true, text: await fetchDoc(list[i]) });
        } catch (error) {
          out.set(list[i], { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }),
  );
  return out;
}

/**
 * 抓回来和基线不一致的，先再抓一两次确认：个别大页面偶尔回半截 / 另一份内容，真改了的会一直不一样，
 * 抖一下的会和基线对上。对上了就用那一次的结果，别把抖动报成「变了」。
 */
export async function confirmChanged(input: {
  sources: readonly DocSource[];
  table: FingerprintTable;
  fetched: Map<string, FetchedDoc>;
  fetchDoc: FetchDoc;
  gapMs?: number;
  extraTries?: number;
}): Promise<number> {
  let settled = 0;
  for (const source of input.sources) {
    const entry = input.table.entries[source.url];
    const got = input.fetched.get(source.url);
    if (!entry || !got || !got.ok || bodyProblem(got.text) || entry.fingerprint === "http-404" || entry.fingerprint === "unreadable") continue;
    if (fingerprintOf(normalizeDocText(got.text)) === entry.fingerprint) continue;
    for (let i = 0; i < (input.extraTries ?? 2); i += 1) {
      if ((input.gapMs ?? HOST_GAP_MS) > 0) await new Promise((r) => setTimeout(r, input.gapMs ?? HOST_GAP_MS));
      try {
        const text = await input.fetchDoc(source.url);
        if (!bodyProblem(text) && fingerprintOf(normalizeDocText(text)) === entry.fingerprint) {
          input.fetched.set(source.url, { ok: true, text });
          settled += 1;
          break;
        }
      } catch {
        /* 复核抓不到就保留第一次的结果 */
      }
    }
  }
  return settled;
}

// ---------------------------------------------------------------------------
// 指纹表 IO 与核对落表
// ---------------------------------------------------------------------------

export function readFingerprintTable(file = FINGERPRINT_TABLE_PATH): FingerprintTable {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<FingerprintTable>;
    if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
      return { version: 1, entries: parsed.entries, unsourcedAcknowledged: Array.isArray(parsed.unsourcedAcknowledged) ? parsed.unsourcedAcknowledged : [] };
    }
  } catch {
    /* 没有表 = 空表：每个地址都会报「没基线」，不会被当成没变 */
  }
  return emptyTable();
}

export function writeFingerprintTable(table: FingerprintTable, file = FINGERPRINT_TABLE_PATH): void {
  const sorted: FingerprintTable = {
    version: 1,
    entries: Object.fromEntries(Object.entries(table.entries).sort(([a], [b]) => a.localeCompare(b))),
    unsourcedAcknowledged: [...table.unsourcedAcknowledged].sort(),
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(sorted, null, 1)}\n`);
}

export type Verdict = { status: FingerprintEntry["status"]; note?: string };

/**
 * 核对完落表：只有调用方明说 verified 的才记「已核对 + 今天」，pending-fix 记「待修」；
 * 抓不到的地址不落（不能把没看过的记成看过）。同时把当前的无来源模型登记为存量缺口。
 */
export function acceptVerdicts(input: {
  table: FingerprintTable;
  verdicts: Record<string, Verdict>;
  fetched: ReadonlyMap<string, FetchedDoc>;
  unsourced: readonly UnsourcedModel[];
  today: string;
}): { table: FingerprintTable; skipped: string[] } {
  const entries = { ...input.table.entries };
  const skipped: string[] = [];
  for (const [url, verdict] of Object.entries(input.verdicts)) {
    const got = input.fetched.get(url);
    if (verdict.status === "not-published") {
      if (got && !got.ok && /^HTTP 404\b/.test(got.error)) entries[url] = { fingerprint: "http-404", status: "not-published", checkedAt: input.today, ...(verdict.note ? { note: verdict.note } : {}), keyLines: [] };
      else skipped.push(url);
      continue;
    }
    if (verdict.status === "not-comparable") {
      // 只有今天确实读不出正文的才能记成「比不了」；读得出的不许躲进这一档。
      if (!got || got.ok === false || bodyProblem(got.text)) entries[url] = { fingerprint: "unreadable", status: "not-comparable", checkedAt: input.today, ...(verdict.note ? { note: verdict.note } : {}), keyLines: [] };
      else skipped.push(url);
      continue;
    }
    if (!got || !got.ok || bodyProblem(got.text)) {
      skipped.push(url);
      continue;
    }
    const normalized = normalizeDocText(got.text);
    entries[url] = { fingerprint: fingerprintOf(normalized), status: verdict.status, checkedAt: input.today, ...(verdict.note ? { note: verdict.note } : {}), keyLines: extractKeyLines(normalized) };
  }
  return {
    table: { version: 1, entries, unsourcedAcknowledged: input.unsourced.map((m) => `${m.vendorKey}/${m.modelKey}`) },
    skipped,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export const localToday = (now = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const offlineIdx = args.indexOf("--offline");
  const offlineDir = offlineIdx >= 0 ? args[offlineIdx + 1] : "";
  const acceptIdx = args.indexOf("--accept");
  const acceptFile = acceptIdx >= 0 ? args[acceptIdx + 1] : "";
  const fetchDoc: FetchDoc = offlineDir ? async (url) => fs.readFileSync(path.join(offlineDir, offlineSampleName(url)), "utf8") : fetchPublicDoc;

  const { sources, unsourced } = await collectDocSources();
  const fetched = await fetchAll(sources.map((s) => s.url), fetchDoc, offlineDir ? 0 : HOST_GAP_MS);
  const table = readFingerprintTable();
  if (!acceptFile) await confirmChanged({ sources, table, fetched, fetchDoc, gapMs: offlineDir ? 0 : HOST_GAP_MS });

  if (acceptFile) {
    const verdicts = JSON.parse(fs.readFileSync(acceptFile, "utf8")) as Record<string, Verdict>;
    const { table: next, skipped } = acceptVerdicts({ table, verdicts, fetched, unsourced, today: localToday() });
    writeFingerprintTable(next);
    console.log(`指纹表已更新：${Object.keys(verdicts).length - skipped.length} 个地址落表${skipped.length ? `；${skipped.length} 个今天没抓到、没落表：${skipped.join(" ")}` : ""}。`);
    return;
  }

  const result = compareDocs({ sources, unsourced, table, fetched });
  const dir = modelRadarResultDir();
  fs.mkdirSync(dir, { recursive: true });
  const reportPath = path.join(dir, "doc-drift-latest.txt");
  fs.writeFileSync(reportPath, `${formatFullReport(result)}\n`);
  console.log(formatSummary(result, reportPath));
  const reachable = result.total - result.items.filter((i) => i.status === "unreachable").length;
  if (result.total > 0 && reachable === 0) throw new Error("全部来源地址都没抓到——不是「没变」，多半是网络 / 代理问题");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`文档漂移检查失败：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
