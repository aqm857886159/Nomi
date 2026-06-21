// 已接入的公开提示词仓库清单(实查锁定 2026-06-21)。
// 每源:从 rawBase 拉 files,逐文件喂 parse,聚合。图片源媒体稳;视频源结构干净但媒体可能降级。
import type { ParsedPrompt } from "./promptLibraryTypes";
import { parseEvoLinkAI, parseImgEdify, parseSora2, parseSoraOfficial, parseYouMind } from "./promptParsers";

export type PromptSource = {
  id: string;
  label: string;
  sourceUrl: string;
  promptType: "image" | "video";
  rawBase: string;
  files: string[];
  /** 每源最多保留多少条(防单源 900+ 撑爆 payload)。 */
  cap: number;
  parse: (markdown: string, rawBase: string) => ParsedPrompt[];
};

const gh = (owner: string, repo: string) => ({
  url: `https://github.com/${owner}/${repo}`,
  raw: `https://raw.githubusercontent.com/${owner}/${repo}/main`,
});

const evo = gh("EvoLinkAI", "awesome-gpt-image-2-API-and-Prompts");
const imgEdify = gh("ImgEdify", "Awesome-GPT4o-Image-Prompts");
const youMind = gh("YouMind-OpenLab", "awesome-nano-banana-pro-prompts");
const sora2 = gh("zhangchenchen", "awesome_sora2_prompt");
const soraOfficial = gh("hr98w", "awesome-sora-prompts");

export const PROMPT_SOURCES: PromptSource[] = [
  {
    id: "evolink-gpt-image-2",
    label: "GPT Image 2",
    sourceUrl: evo.url,
    promptType: "image",
    rawBase: evo.raw,
    files: ["README.md"],
    cap: 280,
    parse: parseEvoLinkAI,
  },
  {
    id: "youmind-nano-banana-pro",
    label: "Nano Banana Pro",
    sourceUrl: youMind.url,
    promptType: "image",
    rawBase: youMind.raw,
    files: ["README.md"],
    cap: 280,
    parse: parseYouMind,
  },
  {
    id: "imgedify-gpt4o",
    label: "GPT-4o 图像",
    sourceUrl: imgEdify.url,
    promptType: "image",
    rawBase: imgEdify.raw,
    files: ["README.md"],
    cap: 200,
    parse: parseImgEdify,
  },
  {
    id: "sora2-viral",
    label: "Sora 2",
    sourceUrl: sora2.url,
    promptType: "video",
    rawBase: sora2.raw,
    files: ["prompts/official-prompts.md", "prompts/sora2-viral-prompts.md", "prompts/hyperrealism-landscapes.md"],
    cap: 200,
    parse: parseSora2,
  },
  {
    id: "sora-official",
    label: "Sora 官方",
    sourceUrl: soraOfficial.url,
    promptType: "video",
    rawBase: soraOfficial.raw,
    files: ["README.md", "animating-prompts.md", "image-generation-prompts.md", "video-editing-prompts.md"],
    cap: 120,
    parse: parseSoraOfficial,
  },
];
