// 提示词库聚合 + 1h TTL 缓存(仿 events/secretsProvider.ts:失败回退旧缓存)。
// 缓存内存 + 磁盘双层:进程内 1h TTL 内存命中;首次访问从 userData 水合,成功拉取后原子落盘,
// 故重启后无需重拉、离线也能出旧库(避免「每次开 App 都去 GitHub raw 拉一遍」)。
// 拉取走 hardenedFetchText(代理自动继承,SSRF/超时加固);惰性刷新,无后台 timer(沿用代码库习惯)。
import path from "node:path";
import { hardenedFetchText } from "../hardenedFetch";
import { writeJsonFileAtomic } from "../jsonFile";
import { getSettingsRoot, readJson } from "../runtimePaths";
import { PROMPT_SOURCES, type PromptSource } from "./promptSources";
import type { LibraryPrompt } from "./promptLibraryTypes";
import seedJson from "./promptLibrarySeed.json";

// 打包进 App 的精选快照(scripts/snapshot-prompt-library.ts 生成)。
// 作用=地板:外部 GitHub raw 全拉不到且无磁盘缓存时,库也不空(只覆盖空态,在线拉成功照常顶掉)。
const PROMPT_LIBRARY_SEED = seedJson as unknown as LibraryPrompt[];

/** 当前可用的「地板」:有磁盘/内存缓存优先用缓存,否则用打包快照。绝不返回空致空态。 */
function floor(): LibraryPrompt[] {
  return cache?.prompts.length ? cache.prompts : PROMPT_LIBRARY_SEED;
}

const TTL_MS = 60 * 60 * 1000;
const FETCH_MAX_BYTES = 12 * 1024 * 1024; // 大 README(900+ case)可达数 MB
const FETCH_TIMEOUT_MS = 30_000;
const CACHE_FILE = "prompt-library-cache.json"; // 落 userData(NOMI_SETTINGS_DIR 可覆盖,隔离 eval/测试)

type CacheEntry = { at: number; prompts: LibraryPrompt[] };

let cache: CacheEntry | null = null;
let inflight: Promise<LibraryPrompt[]> | null = null;
let hydrated = false; // 是否已尝试从磁盘水合(每进程一次,惰性)

function cacheFilePath(): string {
  return path.join(getSettingsRoot(), CACHE_FILE);
}

/** 首次访问时把磁盘缓存读回内存——让缓存跨重启/离线存活。只读一次,失败静默(无缓存=照常拉取)。 */
function hydrateFromDisk(): void {
  if (hydrated) return;
  hydrated = true;
  const raw = readJson<CacheEntry | null>(cacheFilePath(), null);
  if (raw && typeof raw.at === "number" && Array.isArray(raw.prompts)) {
    cache = { at: raw.at, prompts: raw.prompts };
  }
}

/** 原子落盘;失败仅吞掉,绝不影响内存缓存可用性(下次成功拉取再写)。 */
function persistToDisk(entry: CacheEntry): void {
  try {
    writeJsonFileAtomic(cacheFilePath(), entry);
  } catch {
    // 落盘失败不致命:内存缓存仍可用
  }
}

async function loadSource(source: PromptSource): Promise<LibraryPrompt[]> {
  const parsed: LibraryPrompt[] = [];
  const seen = new Set<string>();
  for (const file of source.files) {
    let markdown = "";
    try {
      const res = await hardenedFetchText(`${source.rawBase}/${file}`, { maxBytes: FETCH_MAX_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
      markdown = res.text;
    } catch {
      continue; // 单文件 404/超时不拖垮整源
    }
    for (const item of source.parse(markdown, source.rawBase)) {
      const key = item.prompt.slice(0, 120);
      if (!item.prompt || seen.has(key)) continue;
      seen.add(key);
      parsed.push({
        ...item,
        id: `${source.id}-${parsed.length + 1}`,
        promptType: source.promptType,
        origin: "public",
        source: source.label,
        sourceId: source.id,
        sourceUrl: source.sourceUrl,
      });
      if (parsed.length >= source.cap) return parsed;
    }
  }
  return parsed;
}

async function loadAll(): Promise<LibraryPrompt[]> {
  const settled = await Promise.all(
    PROMPT_SOURCES.map((source) => loadSource(source).catch(() => [] as LibraryPrompt[])),
  );
  return settled.flat();
}

/** 取全部提示词;命中缓存即返,否则拉取;全失败回退旧缓存(可能空)。 */
export async function getPromptLibrary(): Promise<LibraryPrompt[]> {
  hydrateFromDisk();
  if (cache && Date.now() - cache.at < TTL_MS) return cache.prompts;
  if (inflight) return inflight;
  inflight = loadAll()
    .then((prompts) => {
      if (prompts.length > 0) {
        cache = { at: Date.now(), prompts };
        persistToDisk(cache);
        return prompts;
      }
      return floor(); // 全拉空 → 缓存或打包快照兜底,不返回空
    })
    .catch(() => floor())
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 测试/手动失效。清内存 + 重新允许磁盘水合(下次访问从盘读回或重拉)。 */
export function resetPromptLibraryCache(): void {
  cache = null;
  inflight = null;
  hydrated = false;
}
