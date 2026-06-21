// 公开提示词仓库的 markdown 解析器(纯函数,无 electron 依赖 → 可独立单测)。
// 解析锚点来自 2026-06-21 实查(docs/plan/2026-06-21-prompt-library.md §3)。
// 容错铁律:任一 block 缺 prompt/媒体就跳过这条,不让坏数据污染;一个源解析失败上层兜回旧缓存。
import type { ParsedPrompt } from "./promptLibraryTypes";

/** 按「行首标题」把文档切成块,每块从一个标题到下一个标题之前。 */
export function splitBlocks(markdown: string, headingSource: string): string[] {
  const re = new RegExp(headingSource, "gm");
  const starts: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) starts.push(match.index);
  return starts.map((start, i) => markdown.slice(start, i + 1 < starts.length ? starts[i + 1] : undefined));
}

function first(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m && m[1] != null ? m[1] : null;
}

function clean(text: string): string {
  return text.replace(/\r/g, "").replace(/^\s+|\s+$/g, "");
}

function stripInline(text: string): string {
  return text.replace(/[#*`>]/g, "").trim();
}

/** **Prompt:** 后的代码块或紧随段落(到下一个标题/分隔/img 为止)。 */
function extractPrompt(block: string): string | null {
  const fenced = first(block, /\*\*Prompt[^*]*:?\*\*\s*\n+```[a-zA-Z]*\n([\s\S]*?)\n```/);
  if (fenced) return clean(fenced);
  const inline = first(block, /\*\*Prompt[^*]*:?\*\*\s*`([^`]+)`/);
  if (inline) return clean(inline);
  const para = first(block, /\*\*Prompt[^*]*:?\*\*\s*\n+([\s\S]*?)(?:\n###|\n---|\n<img|\n!\[|\n\*\*|$)/);
  return para ? clean(para) : null;
}

/** EvoLinkAI/awesome-gpt-image-2-API-and-Prompts —— `### Case N` + raw github 封面图。 */
export function parseEvoLinkAI(markdown: string, rawBase: string): ParsedPrompt[] {
  const out: ParsedPrompt[] = [];
  for (const block of splitBlocks(markdown, "^### Case \\d+:")) {
    const head = block.match(/^### Case (\d+):\s*\[([^\]]+)\]/);
    if (!head) continue;
    const prompt = extractPrompt(block);
    if (!prompt) continue;
    const found = first(block, /<img[^>]+src="(https:\/\/raw\.githubusercontent\.com\/[^"]+?)"/);
    const mediaUrl = found || `${rawBase}/images/poster_case${head[1]}/output.jpg`;
    out.push({ title: stripInline(head[2]), prompt, mediaUrl, mediaType: "image" });
  }
  return out;
}

/** ImgEdify/Awesome-GPT4o-Image-Prompts —— `### 标题` + `**Prompt Text:** \`...\`` + cdn 封面。 */
export function parseImgEdify(markdown: string): ParsedPrompt[] {
  const out: ParsedPrompt[] = [];
  for (const block of splitBlocks(markdown, "^### .+")) {
    const head = block.match(/^### (.+)/);
    if (!head) continue;
    const prompt = extractPrompt(block);
    const mediaUrl = first(block, /<img[^>]+src="(https:\/\/cdn\.imgedify\.com\/[^"]+)"/);
    if (!prompt || !mediaUrl) continue;
    out.push({ title: stripInline(head[1]), prompt, mediaUrl, mediaType: "image" });
  }
  return out;
}

/** YouMind nano-banana-pro / gpt-image-2 —— `### No.N: 标题` + `#### 📝 Prompt` 代码块 + cms 封面。 */
export function parseYouMind(markdown: string): ParsedPrompt[] {
  const out: ParsedPrompt[] = [];
  for (const block of splitBlocks(markdown, "^### No\\.?\\s*\\d+")) {
    const head = block.match(/^### No\.?\s*(\d+):?\s*(.*)/);
    if (!head) continue;
    const prompt =
      first(block, /####[^\n]*Prompt[^\n]*\n+```[a-zA-Z]*\n([\s\S]*?)\n```/) ||
      first(block, /####[^\n]*Prompt[^\n]*\n+([\s\S]*?)(?:\n####|\n###|$)/);
    const mediaUrl = first(block, /<img[^>]+src="(https:\/\/cms-assets\.youmind\.com\/[^"]+)"/);
    if (!prompt || !mediaUrl) continue;
    const title = stripInline(head[2]) || `提示词 ${head[1]}`;
    out.push({ title, prompt: clean(prompt), mediaUrl, mediaType: "image" });
  }
  return out;
}

/** zhangchenchen/awesome_sora2_prompt —— `### 标题` + `**Prompt:**` 代码块 + twitter mp4(可能缺)。 */
export function parseSora2(markdown: string): ParsedPrompt[] {
  const out: ParsedPrompt[] = [];
  for (const block of splitBlocks(markdown, "^### .+")) {
    const head = block.match(/^### (.+)/);
    if (!head) continue;
    const prompt = extractPrompt(block);
    if (!prompt) continue;
    const mediaUrl = first(block, /\((https:\/\/[^)\s]+\.mp4[^)\s]*)\)/) || "";
    out.push({ title: stripInline(head[1]), prompt, mediaUrl: mediaUrl || "", mediaType: "video" });
  }
  return out;
}

/** mp4 文件名 → 人话标题:`tokyo-walk.mp4` → `Tokyo Walk`。 */
function titleFromMediaUrl(url: string): string {
  const file = url.split("/").pop() || "";
  const stem = file.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  return stem ? stem.replace(/\b\w/g, (c) => c.toUpperCase()) : "Sora";
}

/** hr98w/awesome-sora-prompts —— 媒体锚定:`> prompt` 紧跟 `Generated Videos: [link](mp4)`,标题取 mp4 文件名。 */
export function parseSoraOfficial(markdown: string): ParsedPrompt[] {
  const out: ParsedPrompt[] = [];
  const re = />\s*([^\n]+)\n+(?:Generated\s+Videos?|Video|视频)[^\n]*\[[^\]]*\]\((https:\/\/cdn\.openai\.com\/sora\/videos\/[^)\s]+\.mp4)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(markdown))) {
    const prompt = clean(match[1]);
    if (prompt.length < 8) continue;
    out.push({ title: titleFromMediaUrl(match[2]), prompt, mediaUrl: match[2], mediaType: "video" });
  }
  return out;
}
