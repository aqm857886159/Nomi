// 供应商模型雷达（apimart / kie）—— **发现层**：确定性脚本，不含判断。
// 方案见 docs/plan/2026-08-27-vendor-model-radar.md。
//
// 为什么是脚本不是 agent：「这家文档有没有多出一个模型」是**可判定的集合差**，不是判断题。
// 用 LLM 比对两个字符串集合既贵又不可靠（会看漏/看错），而集合差是确定的、可测的、可回归的。
// 判断层（这模型对 Nomi 有没有用、怎么建模）留给 nomi-model-radar 技能。
// 结果：**没有新模型的日子，雷达零额度成本**。
//
// 用法：
//   pnpm run radar:models                    抓 + 对比 + 打摘要
//   pnpm run radar:models -- --update-baseline   确认过之后更新快照（只更新本轮查成的家）
//   pnpm run radar:models -- --offline <dir>     用本地样本跑（单测/离线复现，不打网络；
//                                                文件名 = offlineFileName(url)，一家可有多份）
//
// 车道有两种（都是确定性集合差，都**不打生成调用**、不烧生成额度）：
//   ① 文档车道（kie / apimart）：抓公开 llms.txt 索引，比对「文档里有几个模型页」。
//   ② LLM 车道（apimart-llm）：打 authenticated `GET /v1/models`，比对「供应商今天列了哪些 chat id」。
//      为什么必须有它：文档索引的 texts 分区不盯（用户拍板只盯生图/生视频/音频），于是
//      **退役的文本模型能在我们的 catalog 里躺着没人发现**——2026-09-06 实测 `deepseek-v3.2-think`
//      就是这么烂在种子里的。这条车道的主信号是 `unlisted`：我们种了、供应商今天没列。
//      它需要凭据，取法见 resolveApimartApiKey（只从 env / 明文记录取，**永不打印**）。
//
// 失败语义（2026-08-31 apimart 改版把 kie 陪葬后定死，合同见
// docs/fixes/2026-08-31-model-radar-vendor-isolation.root-cause.json）：
//   单家采集失败（含解析 0 条）只把该家标成「没查成」——摘要打 ⚠️、latest.json 记 failures[]、
//   该家快照不动，其余家照常出差异，退出码 0；**全部**家失败才红着退出（1）。
//   「没查成」永远不许被读成「没有新模型」。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_ARCHETYPES } from "../src/config/modelArchetypes/index.ts";
import { applyBuiltinSeeds } from "../electron/catalog/seedBuiltins.ts";
import type { CatalogState } from "../electron/catalog/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_DIR = path.join(ROOT, "docs/research/model-radar");

/** 盯的类别（2026-08-27 用户拍板：生图 + 生视频 + 音频/TTS；不含 3D）。
 *  `text` 是 2026-09-06 补的 LLM 车道——**只走 authenticated /v1/models**，
 *  文档车道的 texts 分区仍不盯（那是端点手册，不是模型目录）。要开新类别只改这里一处。 */
export type RadarCategory = "image" | "video" | "audio" | "text";
const WATCHED: readonly RadarCategory[] = ["image", "video", "audio", "text"];

export type RadarEntry = {
  vendor: string;
  category: RadarCategory;
  /** 供应商侧的模型标识（用于和我们的覆盖集比对）。注意**它不等于 model id**，见 normalizeToken。 */
  slug: string;
  title: string;
  url: string;
};

// ---------------------------------------------------------------------------
// 归一
// ---------------------------------------------------------------------------

/**
 * 比对用 token：小写 + 去掉所有非字母数字。
 *
 * 为什么必须这么狠：kie 的**文档路径**是 `flux2/pro-text-to-image`，而**真实 model id** 是
 * `flux-2/pro-text-to-image`（带横杠）。按原串比会把已接的模型报成「新的」——雷达天天诈胡，
 * 几次之后就没人看了。归一后两者都是 `flux2protexttoimage`，对得上。
 */
export function normalizeToken(value: string): string {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** 剥掉 llms.txt 链接里的语言镜像段（kie 每页都有 /cn/ 复本，不剥 = 每个模型报两遍）。 */
export function stripLocale(pathname: string): string {
  return pathname.replace(/^\/?(?:cn|en|zh(?:-[a-z]+)?)\//i, "/");
}

// ---------------------------------------------------------------------------
// 解析：两家 llms.txt 结构不同，各给一个 parser（形状 100% 来自 2026-08-27 实抓）
// ---------------------------------------------------------------------------

const LINE_RE = /^-\s*(.*?)\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;

/**
 * kie：`- Image    Models > Seedream [标题](url): 描述`
 * - 分类来自行首面包屑（注意官方就是不规则空格 "Image    Models"，必须先塌空白）。
 * - **只收 `/market/` 下的页面**：那是模型市场；其余是端点文档。
 *   实测 `Suno API` 有 94 条，全是 `suno-api/generate-music`、`*-callbacks` 这类端点页，
 *   一条模型都没有——按分类收就是 94 条纯噪音。真正的 TTS 模型在 `market/elevenlabs/*`。
 */
export function parseKie(text: string): RadarEntry[] {
  const out: RadarEntry[] = [];
  for (const line of text.split("\n")) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    const crumb = m[1].replace(/\s+/g, " ").trim().split(">")[0].trim().toLowerCase();
    const url = m[3];
    const pathname = stripLocale(new URL(url).pathname);
    if (!pathname.startsWith("/market/")) continue; // 端点文档不是模型
    const slug = pathname.replace(/^\/market\//, "").replace(/\.md$/i, "");
    if (!slug || slug === "quickstart") continue;
    const category = crumb.startsWith("image")
      ? "image"
      : crumb.startsWith("video")
        ? "video"
        : crumb.startsWith("music") || crumb.startsWith("audio")
          ? "audio"
          : null;
    if (!category) continue; // chat 等不盯的类别
    out.push({ vendor: "kie", category, slug, title: m[2].trim(), url });
  }
  return dedupe(out);
}

/**
 * apimart：`- [标题](url): 描述`，分类由 URL 路径段派生（`/api-reference/{images,videos,audios}/`）。
 * 每个模型一页 `.../<model>/generation.md`，故 slug 取模型段。
 */
export function parseApimart(text: string): RadarEntry[] {
  const out: RadarEntry[] = [];
  for (const line of text.split("\n")) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    const url = m[3];
    const segs = stripLocale(new URL(url).pathname).split("/").filter(Boolean);
    const idx = segs.indexOf("api-reference");
    if (idx < 0 || segs.length < idx + 3) continue;
    const bucket = segs[idx + 1];
    const category: RadarCategory | null =
      bucket === "images" ? "image" : bucket === "videos" ? "video" : bucket === "audios" ? "audio" : null;
    if (!category) continue; // texts / tasks / account 不盯
    const slug = segs.slice(idx + 2).join("/").replace(/\.md$/i, "").replace(/\/(generation|quickstart)$/i, "");
    if (!slug) continue;
    out.push({ vendor: "apimart", category, slug, title: m[2].trim(), url });
  }
  return dedupe(out);
}

function dedupe(entries: RadarEntry[]): RadarEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const key = `${e.vendor}:${e.category}:${normalizeToken(e.slug)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// 采集：一次「抓」可能是多个请求（apimart 2026-08-31 起是两级索引）
// ---------------------------------------------------------------------------

export type FetchText = (url: string) => Promise<string>;

const KIE_INDEX_URL = "https://docs.kie.ai/llms.txt";
const APIMART_INDEX_URL = "https://docs.apimart.ai/llms.txt";

/** 索引跟进上限：现网只需 2 次（根 + en/api-manual）。超界 = 结构又大改，红着报，不无界爬。 */
const APIMART_MAX_INDEX_FETCHES = 8;

/**
 * 从 apimart 索引文本里挑「要跟进的子索引」。2026-08-31 改版（实抓）后根 llms.txt 是
 * 「索引的索引」：模型页全部搬进 `/_llms/en/api-manual.md`，根里自述「Follow each /_llms/
 * index recursively until you reach documentation pages」。只跟**英文份**（`/_llms/en.md`
 * 或 `/_llms/en/**`）：其余 9 份语言镜像与英文同册，跟了 = 每页抓 10 遍再靠去重扔掉。
 */
export function apimartSubIndexUrls(text: string): string[] {
  const urls: string[] = [];
  for (const line of text.split("\n")) {
    const m = LINE_RE.exec(line.trim());
    if (!m) continue;
    const url = m[3];
    const pathname = new URL(url).pathname;
    if (!pathname.startsWith("/_llms/")) continue;
    const rest = pathname.slice("/_llms/".length);
    if (rest !== "en.md" && !rest.startsWith("en/")) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

/**
 * apimart 采集：从根索引出发，有界跟进英文子索引，把沿途文本合并后走同一个行解析器。
 * 根里若直接列模型页（2026-08-31 之前的扁平结构）同一算法照收——这不是新旧两条
 * fallback 分支，而是「解析一切可达页面」的单一算法。
 */
export async function collectApimart(fetchText: FetchText): Promise<RadarEntry[]> {
  const queue: string[] = [APIMART_INDEX_URL];
  const seen = new Set<string>();
  const texts: string[] = [];
  for (let i = 0; i < queue.length; i += 1) {
    const url = queue[i];
    if (!url || seen.has(url)) continue;
    if (seen.size >= APIMART_MAX_INDEX_FETCHES) {
      throw new Error(
        `apimart 索引跟进超过 ${APIMART_MAX_INDEX_FETCHES} 个，结构可能又大改——实抓确认再适配，别放开上限硬爬`,
      );
    }
    seen.add(url);
    const text = await fetchText(url);
    texts.push(text);
    queue.push(...apimartSubIndexUrls(text));
  }
  return parseApimart(texts.join("\n"));
}

// ---------------------------------------------------------------------------
// LLM 车道：authenticated GET /v1/models（文档索引看不见的那一半）
// ---------------------------------------------------------------------------

/**
 * apimart 的模型目录 API。带 `expand=category&category=chat` 只取 chat 一类——
 * 裸 `/v1/models` 把生图/生视频 id 也混进来，而那些 id 与生成端点上的真实 id **命名不一致**
 * （实测：目录写 `seedream-5-0-pro`，我们生成端点上种的是 `doubao-seedream-5-0-pro`），
 * 拿它判生成模型死活会天天诈胡。chat 分区的 id 才和 `/v1/chat/completions` 的 model 同名。
 */
const APIMART_MODELS_API_URL = "https://api.apimart.ai/v1/models?expand=category&category=chat";

/**
 * 从凭据记录里取脚本层**能用**的明文。
 *
 * safeStorage 密文要 Electron 主进程才解得开，纯 tsx 脚本拿不到——这时返回空串，让调用方
 * 走「这条车道今天没查成」的显式失败，**绝不**静默当成「没有新模型」。
 * 永远不打印、不落盘任何返回值。
 */
export function usableApiKeyFromRecord(record: { apiKey?: string; enc?: string } | undefined): string {
  if (!record?.apiKey) return "";
  if (record.enc === "safeStorage") return ""; // 需 Electron safeStorage 才解得开
  return record.apiKey;
}

/** 本机 Nomi catalog 的位置（与 electron 侧 userData 一致；两种大小写目录都试）。 */
function localCatalogFiles(): string[] {
  const home = process.env.HOME || "";
  if (!home) return [];
  const roots =
    process.platform === "darwin"
      ? [path.join(home, "Library", "Application Support")]
      : [process.env.APPDATA || path.join(home, ".config")];
  const out: string[] = [];
  for (const root of roots) for (const dir of ["nomi", "Nomi"]) out.push(path.join(root, dir, "model-catalog.json"));
  return out;
}

/**
 * 取 apimart 凭据。顺序：`APIMART_API_KEY` 环境变量 → 本机 catalog 里的**明文**记录。
 * 都拿不到就抛——错误文案只说「怎么给」，**不带任何密钥内容**。
 */
export function resolveApimartApiKey(): string {
  const fromEnv = (process.env.APIMART_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  for (const file of localCatalogFiles()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as {
        apiKeysByVendor?: Record<string, { apiKey?: string; enc?: string }>;
      };
      const usable = usableApiKeyFromRecord(parsed.apiKeysByVendor?.apimart);
      if (usable) return usable;
    } catch {
      /* 该目录没有 catalog / 读不动 → 试下一个 */
    }
  }
  throw new Error(
    "拿不到 apimart 凭据：本机记录是 safeStorage 密文（要 Electron 才解得开）。" +
      "给这条车道设 APIMART_API_KEY 环境变量后重跑。",
  );
}

/** 把 `/v1/models` 的 JSON 解析成 RadarEntry。抛错 = 该车道「没查成」。 */
export function parseApimartLlm(text: string): RadarEntry[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("/v1/models 返回的不是 JSON——凭据或网关可能出问题了，不是「没有新模型」");
  }
  const rows = (json as { data?: unknown })?.data;
  if (!Array.isArray(rows)) throw new Error("/v1/models 返回里没有 data 数组——形状变了，实抓确认再适配");
  const out: RadarEntry[] = [];
  for (const row of rows) {
    const id = typeof row === "string" ? row : String((row as { id?: unknown })?.id ?? "");
    if (!id) continue;
    out.push({ vendor: "apimart-llm", category: "text", slug: id, title: id, url: APIMART_MODELS_API_URL });
  }
  return dedupe(out);
}

export type VendorAdapter = {
  collect: (fetchText: FetchText) => Promise<RadarEntry[]>;
  /** catalog 里对应的 vendorKey（覆盖集/种子集按它取）。省略 = 与适配器名同名。 */
  catalogVendorKey?: string;
  /** 这条车道的 slug 是不是**真实 model id**——是才能做「我们种了、他们没列」的反向检查。
   *  文档车道的 slug 是文档页路径，不是 id，做反向检查必然诈胡，故只有 LLM 车道开。 */
  seededKind?: "text";
};

export const VENDORS: Record<string, VendorAdapter> = {
  kie: { collect: async (fetchText) => parseKie(await fetchText(KIE_INDEX_URL)) },
  apimart: { collect: collectApimart },
  "apimart-llm": {
    collect: async (fetchText) => parseApimartLlm(await fetchText(APIMART_MODELS_API_URL)),
    catalogVendorKey: "apimart",
    seededKind: "text",
  },
};

export type VendorFailure = { vendor: string; error: string };

/**
 * 逐家采集，**单家失败只标记该家、不打死整轮**（2026-08-31 apimart 改版把 kie 陪葬的教训）。
 * 0 条守卫也住在这道边界里：解析出 0 条 = 该家「没查成」，永不静默等同「没有新模型」。
 */
export async function collectVendors(
  vendors: Record<string, VendorAdapter>,
  fetchText: FetchText,
): Promise<{ entries: Record<string, RadarEntry[]>; failures: VendorFailure[] }> {
  const entries: Record<string, RadarEntry[]> = {};
  const failures: VendorFailure[] = [];
  for (const [vendor, adapter] of Object.entries(vendors)) {
    try {
      const current = await adapter.collect(fetchText);
      if (current.length === 0) throw new Error("解析出 0 条模型——索引结构可能变了，别当成「没新模型」");
      entries[vendor] = current;
    } catch (err) {
      failures.push({ vendor, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { entries, failures };
}

// ---------------------------------------------------------------------------
// 覆盖集：我们到底接了哪些——**全部从代码 derive**
// ---------------------------------------------------------------------------

/**
 * 「我们有没有这个模型」的判据。
 *
 * ⚠️ 只比对种子 catalog 行是**不够**的：很多模型是以档案的 identifierPatterns / variants.modelKey /
 * modes.modelEnum 的形式被覆盖的（kie Seedream 5 的改图是独立 id 走 modelEnum；Wan 3.0 高速版走 variant）。
 * 漏掉这几路 = 把已接的模型报成缺口。全部 derive，不手写清单（手写必漂）。
 */
/**
 * 判「这个文档页对应的模型我们接没接」。
 *
 * 不能只做 token 全等——**文档页名往往不是 model id**，实测两类偏差：
 *   - 带厂商命名空间：kie 页 `google/nanobanana2`，真实 id `nano-banana-2` → 末段全等才对得上。
 *   - 页名是家族、id 带后缀：apimart 页 `gemini-3.1-flash`，真实 id `gemini-3.1-flash-image-preview`
 *     → 需要包含关系。
 * 故三级判据：全等 → 末段全等 → 足够长（≥8）时的双向包含。
 *
 * **长度闸是必要的**：没有它，`wan` 这种短 slug 会吃掉所有 wan 系模型，缺口全被吞掉。
 * 取舍方向也是刻意的——宁可少报缺口，不可天天诈胡：雷达的主信号是「新增」（与快照做差，
 * 不受本函数影响），`uncovered` 只是次要提示；而一旦天天把已接的模型报成缺口，几次之后就没人看了。
 * 实测校准：`flux2/flex-text-to-image`、`bytedance/seedance-1-5-pro` 这类真缺口仍被正确报出。
 */
export function isCovered(slug: string, coverage: Set<string>): boolean {
  const full = normalizeToken(slug);
  if (!full) return false;
  if (coverage.has(full)) return true;
  const last = normalizeToken(slug.split("/").pop() ?? "");
  if (last && coverage.has(last)) return true;
  for (const probe of [full, last]) {
    if (probe.length < 8) continue;
    for (const token of coverage) {
      if (token.length < 8) continue;
      if (token.includes(probe) || probe.includes(token)) return true;
    }
  }
  return false;
}

export function coverageTokens(vendorKey?: string): Set<string> {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  const state = applyBuiltinSeeds(empty, "2026-01-01T00:00:00.000Z").state;
  const tokens = new Set<string>();
  const add = (value: unknown) => {
    const token = normalizeToken(String(value ?? ""));
    if (token) tokens.add(token);
  };
  for (const model of state.models) {
    if (vendorKey && model.vendorKey !== vendorKey) continue;
    add(model.modelKey);
  }
  // 档案侧不区分供应商（同一模型多家共用档案），全收——宁可少报缺口，也不要天天诈胡。
  for (const arch of MODEL_ARCHETYPES) {
    for (const p of arch.identifierPatterns ?? []) add(p);
    for (const v of arch.variants ?? []) add(v.modelKey);
    for (const mode of arch.modes ?? []) add((mode as { modelEnum?: string }).modelEnum);
  }
  return tokens;
}

/**
 * 我们**为某家种下的真实 chat model id**（不是文档页 slug）。用于 LLM 车道的反向检查
 * 「我们种了、供应商今天没列」。全部从种子 derive，不手写清单。
 *
 * ⚠️ `kind === "text"` 还不够：种子里有 `MiniMax-H3-Context-IR` 这种 kind=text 但其实**走
 * 生成端点**的行（提示词增强，POST /v1/videos/generations），它本来就不在 chat 目录里，
 * 拿它比对会天天报一条假的「没列」——几次之后这个 ⚠️ 就没人看了。
 * 判据用代码里已有的不变量（seedBuiltins.test.ts 断言过）：**聊天大脑不挂任何 mapping**
 * （走 buildLanguageModelForVendor 直连 /chat/completions），挂了 mapping 的就不是聊天大脑。
 */
export function seededModelKeys(vendorKey: string, kind: "text"): string[] {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  const state = applyBuiltinSeeds(empty, "2026-01-01T00:00:00.000Z").state;
  const mapped = new Set(state.mappings.filter((p) => p.vendorKey === vendorKey).map((p) => p.modelKey));
  return state.models
    .filter((m) => m.vendorKey === vendorKey && m.kind === kind && !mapped.has(m.modelKey))
    .map((m) => m.modelKey);
}

// ---------------------------------------------------------------------------
// 差分
// ---------------------------------------------------------------------------

export type RadarDiff = {
  vendor: string;
  total: number;
  added: RadarEntry[];
  removed: RadarEntry[];
  uncovered: RadarEntry[];
  /**
   * 我们种了、供应商这一轮**没列**的 model id。LLM 车道的主信号——它与快照无关，
   * 首轮（还没基线）就能报，正是「退役文本模型烂在 catalog 里」那一族的探测器。
   * 只有 slug 就是真实 id 的车道会传 seeded；其余车道恒空。
   */
  unlisted: string[];
};

/**
 * @param coverage 传 `null` = 这条车道**不问**「供应商还有什么我们没接」。
 *   反向车道（LLM）就该传 null：我们刻意只curated 几个大脑，把 186 个没接的 chat 模型
 *   报成「未接入存量」既没有行动价值，又要把它们整包写进 latest.json。
 */
export function diffVendor(
  vendor: string,
  current: RadarEntry[],
  previous: RadarEntry[] | null,
  coverage: Set<string> | null,
  seeded: readonly string[] = [],
): RadarDiff {
  const key = (e: RadarEntry) => `${e.category}:${normalizeToken(e.slug)}`;
  const prevKeys = new Set((previous ?? []).map(key));
  const curKeys = new Set(current.map(key));
  const liveIds = new Set(current.map((e) => normalizeToken(e.slug)));
  return {
    vendor,
    total: current.length,
    // previous 为 null = 首次建基线：不把整册报成「新增」（那是噪音，不是信号）。
    added: previous ? current.filter((e) => !prevKeys.has(key(e))) : [],
    removed: (previous ?? []).filter((e) => !curKeys.has(key(e))),
    uncovered: coverage ? current.filter((e) => !isCovered(e.slug, coverage)) : [],
    // 归一后比对：目录大小写/分隔符与我们种的 id 偶有出入（MiniMax-H3 ↔ minimax-h3）。
    unlisted: seeded.filter((id) => !liveIds.has(normalizeToken(id))),
  };
}

// ---------------------------------------------------------------------------
// IO
// ---------------------------------------------------------------------------

function snapshotPath(vendor: string): string {
  return path.join(SNAPSHOT_DIR, `${vendor}.json`);
}

export function readSnapshot(vendor: string): RadarEntry[] | null {
  const file = snapshotPath(vendor);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as { entries?: RadarEntry[] };
  return Array.isArray(parsed.entries) ? parsed.entries : null;
}

function writeSnapshot(vendor: string, entries: RadarEntry[]): void {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const sorted = [...entries].sort((a, b) => `${a.category}${a.slug}`.localeCompare(`${b.category}${b.slug}`));
  fs.writeFileSync(snapshotPath(vendor), `${JSON.stringify({ vendor, entries: sorted }, null, 2)}\n`);
}

/** 离线样本文件名：URL 的 host+path 压平成一个安全文件名（`/`→`_`）。
 *  两级索引意味着一家可能要多份样本文件，所以不能再用 `<vendor>.txt` 一对一命名。
 *  例：https://docs.apimart.ai/_llms/en/api-manual.md → docs.apimart.ai__llms_en_api-manual.md */
export function offlineFileName(url: string): string {
  const u = new URL(url);
  return `${u.host}${u.pathname}`.replace(/\//g, "_");
}

function offlineFetcher(dir: string): FetchText {
  return async (url) => fs.readFileSync(path.join(dir, offlineFileName(url)), "utf8");
}

/** 抓索引。走 HTTPS_PROXY（本机 apimart/kie 需本地代理）。
 *  LLM 车道打的是需鉴权的模型目录 API，这里按 host 补 Authorization——凭据只在内存里流过，
 *  **不打印、不落盘、不进任何报告**（抓取失败的报错也只带 URL 与状态码）。
 *  **失败必须抛**——collectVendors 会把抛错翻译成该家的显式「没查成」；
 *  静默当成「没有新模型」会让雷达永远绿，是最坏的坏法。 */
async function fetchIndex(url: string): Promise<string> {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || "";
  let dispatcher: unknown;
  if (proxy) {
    const { ProxyAgent } = await import("undici");
    dispatcher = new ProxyAgent(proxy);
  }
  const needsAuth = new URL(url).host === "api.apimart.ai";
  const headers = needsAuth ? { Authorization: `Bearer ${resolveApimartApiKey()}` } : undefined;
  const res = await fetch(url, { ...(headers ? { headers } : {}), ...(dispatcher ? { dispatcher } : {}) } as RequestInit);
  if (!res.ok) throw new Error(`抓取失败 ${url} → HTTP ${res.status}`);
  const text = await res.text();
  if (text.trim().length < 200) throw new Error(`抓到的索引异常短（${text.length} 字节），疑似被拦截：${url}`);
  return text;
}

// CLI 包在 async 函数里：tsx 走 cjs 输出，顶层 await 不支持。
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const updateBaseline = args.includes("--update-baseline");
  const offlineIdx = args.indexOf("--offline");
  const offlineDir = offlineIdx >= 0 ? args[offlineIdx + 1] : "";

  const { entries, failures } = await collectVendors(VENDORS, offlineDir ? offlineFetcher(offlineDir) : fetchIndex);

  const diffs: RadarDiff[] = [];
  for (const [vendor, current] of Object.entries(entries)) {
    const adapter = VENDORS[vendor];
    const catalogVendorKey = adapter?.catalogVendorKey ?? vendor;
    // 一处声明驱动两件事：声明了 seededKind 的车道做反向检查（unlisted），
    // 并且不再问正向的「还有什么没接」（uncovered）——它俩是两个不同的问题。
    const seeded = adapter?.seededKind ? seededModelKeys(catalogVendorKey, adapter.seededKind) : [];
    const coverage = adapter?.seededKind ? null : coverageTokens(catalogVendorKey);
    diffs.push(diffVendor(vendor, current, readSnapshot(vendor), coverage, seeded));
    // 没查成的家不在 entries 里，快照自然不动：修好后重跑才有真差异，不会把断档吃成「全下架」。
    if (updateBaseline) writeSnapshot(vendor, current);
  }

  // 类别行只列这条车道真有的类别（LLM 车道只有 text，文档车道没有 text），别印一排恒 0。
  const byCat = (list: RadarEntry[], present: ReadonlySet<RadarCategory>) =>
    WATCHED.filter((c) => present.has(c))
      .map((c) => `${c} ${list.filter((e) => e.category === c).length}`)
      .join(" · ");

  for (const d of diffs) {
    const present = new Set<RadarCategory>((entries[d.vendor] ?? []).map((e) => e.category));
    console.log(`\n=== ${d.vendor} ===  盯住 ${d.total} 个模型`);
    const seededLane = Boolean(VENDORS[d.vendor]?.seededKind);
    console.log(
      `  新增 ${d.added.length} · 下架 ${d.removed.length}` +
        (seededLane
          ? ` · ⚠️ 我们种了但没列 ${d.unlisted.length}`
          : ` · 未接入 ${d.uncovered.length}（${byCat(d.uncovered, present)}）`),
    );
    for (const e of d.added) console.log(`  🆕 [${e.category}] ${e.slug} — ${e.title}`);
    for (const e of d.removed) console.log(`  🗑️  [${e.category}] ${e.slug}（上次有、这次没了）`);
    for (const id of d.unlisted) console.log(`  ⚠️  ${id}（我们的种子里有，供应商这一轮没列——查是不是退役了）`);
    if (d.added.length === 0 && d.removed.length === 0 && d.unlisted.length === 0) console.log("  （索引无变化）");
  }
  for (const f of failures) {
    console.log(`\n=== ${f.vendor} ===  ⚠️ 今天没查成：${f.error}`);
    console.log("  （这不是「没有新模型」——该家快照未动，修好后重跑）");
  }

  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SNAPSHOT_DIR, "latest.json"), `${JSON.stringify({ diffs, failures }, null, 2)}\n`);
  const totalNew = diffs.reduce((n, d) => n + d.added.length, 0);
  const totalUnlisted = diffs.reduce((n, d) => n + d.unlisted.length, 0);
  const failNote =
    failures.length > 0 ? `；⚠️ ${failures.map((f) => f.vendor).join(" / ")} 没查成（见上，不是「没新模型」）` : "";
  console.log(
    `\n结果已写 docs/research/model-radar/latest.json。本轮新增 ${totalNew} 个；` +
      `未接入存量 ${diffs.reduce((n, d) => n + d.uncovered.length, 0)} 个；` +
      `我们种了但供应商没列 ${totalUnlisted} 个${failNote}。` +
      (updateBaseline ? "（已更新快照）" : "（未更新快照，确认后跑 --update-baseline）"),
  );

  if (diffs.length === 0) {
    // 全部供应商都没查成 = 这一轮真没查成，红着退出（failures 已写进 latest.json 留档）。
    throw new Error(`全部供应商都没查成：${failures.map((f) => `${f.vendor}: ${f.error}`).join("；")}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // 抓不到就必须红着退出：静默当成「没有新模型」会让雷达永远绿。
    console.error(`模型雷达失败：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
