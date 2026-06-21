// 提示词库聚合 + 1h TTL 内存缓存(仿 events/secretsProvider.ts:失败回退旧缓存)。
// 拉取走 hardenedFetchText(代理自动继承,SSRF/超时加固);惰性刷新,无后台 timer(沿用代码库习惯)。
import { hardenedFetchText } from "../hardenedFetch";
import { PROMPT_SOURCES, type PromptSource } from "./promptSources";
import type { LibraryPrompt } from "./promptLibraryTypes";

const TTL_MS = 60 * 60 * 1000;
const FETCH_MAX_BYTES = 12 * 1024 * 1024; // 大 README(900+ case)可达数 MB
const FETCH_TIMEOUT_MS = 30_000;

let cache: { at: number; prompts: LibraryPrompt[] } | null = null;
let inflight: Promise<LibraryPrompt[]> | null = null;

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
  if (cache && Date.now() - cache.at < TTL_MS) return cache.prompts;
  if (inflight) return inflight;
  inflight = loadAll()
    .then((prompts) => {
      if (prompts.length > 0) cache = { at: Date.now(), prompts };
      return cache?.prompts ?? prompts;
    })
    .catch(() => cache?.prompts ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** 测试/手动失效。 */
export function resetPromptLibraryCache(): void {
  cache = null;
  inflight = null;
}
