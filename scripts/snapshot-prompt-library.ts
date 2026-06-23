// 生成提示词库「精选快照」—— 打包进 App 当地板，外部 GitHub raw 拉不到时也不空。
// 复用 electron 侧 PROMPT_SOURCES + parsers（单一真相源），仅把 hardenedFetch 换成原生 fetch
// （脚本跑在普通 Node，不进 electron 运行时）。每源 cap 收小到 SEED_CAP，快照只当地板非全量。
//
// 用法：npx tsx scripts/snapshot-prompt-library.ts
// 产物：electron/promptLibrary/promptLibrarySeed.json
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PROMPT_SOURCES, type PromptSource } from "../electron/promptLibrary/promptSources";
import type { LibraryPrompt } from "../electron/promptLibrary/promptLibraryTypes";

const SEED_CAP = 30; // 每源最多塞进快照多少条（地板，不是全量）
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "electron", "promptLibrary", "promptLibrarySeed.json");

// 走 curl（认 HTTP(S)_PROXY 环境代理；Node undici fetch 默认不认代理，对 GitHub raw 会连接超时）。
function fetchText(url: string): string {
  return execFileSync("curl", ["-sSL", "--max-time", "40", "--fail", url], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

async function loadSource(source: PromptSource): Promise<LibraryPrompt[]> {
  const parsed: LibraryPrompt[] = [];
  const seen = new Set<string>();
  for (const file of source.files) {
    let markdown = "";
    try {
      markdown = fetchText(`${source.rawBase}/${file}`);
    } catch {
      continue;
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
      if (parsed.length >= SEED_CAP) return parsed;
    }
  }
  return parsed;
}

async function main(): Promise<void> {
  const all: LibraryPrompt[] = [];
  for (const source of PROMPT_SOURCES) {
    const prompts = await loadSource(source);
    console.log(`${source.label.padEnd(18)} ${prompts.length} 条`);
    all.push(...prompts);
  }
  writeFileSync(OUT, JSON.stringify(all, null, 0) + "\n");
  console.log(`\n✅ 快照已写 ${path.relative(ROOT, OUT)} · 共 ${all.length} 条`);
}

void main();
