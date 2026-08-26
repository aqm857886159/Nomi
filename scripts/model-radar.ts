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
//   pnpm run radar:models -- --update-baseline   确认过之后更新快照
//   pnpm run radar:models -- --offline <dir>     用本地样本跑（单测/离线复现，不打网络）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODEL_ARCHETYPES } from "../src/config/modelArchetypes/index.ts";
import { applyBuiltinSeeds } from "../electron/catalog/seedBuiltins.ts";
import type { CatalogState } from "../electron/catalog/types.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_DIR = path.join(ROOT, "docs/research/model-radar");

/** 盯的类别（2026-08-27 用户拍板：生图 + 生视频 + 音频/TTS；不含 LLM、不含 3D）。
 *  要开新类别只改这里一处。 */
export type RadarCategory = "image" | "video" | "audio";
const WATCHED: readonly RadarCategory[] = ["image", "video", "audio"];

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

export const VENDORS: Record<string, { indexUrl: string; parse: (text: string) => RadarEntry[] }> = {
  kie: { indexUrl: "https://docs.kie.ai/llms.txt", parse: parseKie },
  apimart: { indexUrl: "https://docs.apimart.ai/llms.txt", parse: parseApimart },
};

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

// ---------------------------------------------------------------------------
// 差分
// ---------------------------------------------------------------------------

export type RadarDiff = {
  vendor: string;
  total: number;
  added: RadarEntry[];
  removed: RadarEntry[];
  uncovered: RadarEntry[];
};

export function diffVendor(
  vendor: string,
  current: RadarEntry[],
  previous: RadarEntry[] | null,
  coverage: Set<string>,
): RadarDiff {
  const key = (e: RadarEntry) => `${e.category}:${normalizeToken(e.slug)}`;
  const prevKeys = new Set((previous ?? []).map(key));
  const curKeys = new Set(current.map(key));
  return {
    vendor,
    total: current.length,
    // previous 为 null = 首次建基线：不把整册报成「新增」（那是噪音，不是信号）。
    added: previous ? current.filter((e) => !prevKeys.has(key(e))) : [],
    removed: (previous ?? []).filter((e) => !curKeys.has(key(e))),
    uncovered: current.filter((e) => !isCovered(e.slug, coverage)),
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

/** 抓索引。走 HTTPS_PROXY（本机 apimart/kie 需本地代理）。
 *  **失败必须抛**——静默当成「没有新模型」会让雷达永远绿，是最坏的坏法。 */
async function fetchIndex(url: string): Promise<string> {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy || "";
  let dispatcher: unknown;
  if (proxy) {
    const { ProxyAgent } = await import("undici");
    dispatcher = new ProxyAgent(proxy);
  }
  const res = await fetch(url, { ...(dispatcher ? { dispatcher } : {}) } as RequestInit);
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

  const diffs: RadarDiff[] = [];
  for (const [vendor, cfg] of Object.entries(VENDORS)) {
    const text = offlineDir
      ? fs.readFileSync(path.join(offlineDir, `${vendor}.txt`), "utf8")
      : await fetchIndex(cfg.indexUrl);
    const current = cfg.parse(text);
    if (current.length === 0) throw new Error(`${vendor}: 解析出 0 条模型——索引结构可能变了，别当成「没新模型」`);
    diffs.push(diffVendor(vendor, current, readSnapshot(vendor), coverageTokens(vendor)));
    if (updateBaseline) writeSnapshot(vendor, current);
  }

  const byCat = (list: RadarEntry[]) =>
    WATCHED.map((c) => `${c} ${list.filter((e) => e.category === c).length}`).join(" · ");

  for (const d of diffs) {
    console.log(`\n=== ${d.vendor} ===  盯住 ${d.total} 个模型`);
    console.log(`  新增 ${d.added.length} · 下架 ${d.removed.length} · 未接入 ${d.uncovered.length}（${byCat(d.uncovered)}）`);
    for (const e of d.added) console.log(`  🆕 [${e.category}] ${e.slug} — ${e.title}`);
    for (const e of d.removed) console.log(`  🗑️  [${e.category}] ${e.slug}（上次有、这次没了）`);
    if (d.added.length === 0 && d.removed.length === 0) console.log("  （索引无变化）");
  }

  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SNAPSHOT_DIR, "latest.json"), `${JSON.stringify({ diffs }, null, 2)}\n`);
  const totalNew = diffs.reduce((n, d) => n + d.added.length, 0);
  console.log(
    `\n结果已写 docs/research/model-radar/latest.json。本轮新增 ${totalNew} 个；` +
      `未接入存量 ${diffs.reduce((n, d) => n + d.uncovered.length, 0)} 个。` +
      (updateBaseline ? "（已更新快照）" : "（未更新快照，确认后跑 --update-baseline）"),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    // 抓不到就必须红着退出：静默当成「没有新模型」会让雷达永远绿。
    console.error(`模型雷达失败：${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
