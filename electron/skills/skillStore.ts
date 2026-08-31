// Skill 加载/查找的单一真相源（P1）。原先散在 agentChatV2.ts 里只读 SKILL.md 正文、
// 从不读 skill.json（manifest 是死代码）。本模块收口加载逻辑，并**第一次把 skill.json
// 解析成 manifest 暴露出来**——playbook 的 stages / requiredProviders / tools / description
// 都从这里读。向后兼容：skill.json 缺失或不合法 ⇒ manifest=null，照旧只用 markdown 正文。
import fs from "node:fs";
import path from "node:path";

import { getSkillsRoots, getUserSkillsRoot, readText } from "../runtimePaths";
import { computeSkillContentHash } from "./skillPackage";
import {
  parseSkillManifest,
  type SkillManifest,
} from "./skillManifestSchema";

export type SkillRecord = {
  /** SKILL.md frontmatter / manifest 里的稳定 name（如 workbench.storyboard.planner）。 */
  name: string;
  /** 磁盘目录名（回退匹配键）。 */
  directoryName: string;
  /** SKILL.md 绝对路径。 */
  filePath: string;
  /** SKILL.md frontmatter / manifest 里的一句话描述（用于技能库卡片、MCP 资源/提示词元数据）。 */
  description: string;
  /** SKILL.md 正文（去掉首尾空白）。 */
  body: string;
  /** skill.json 解析出的 manifest；缺失/非法 ⇒ null（legacy markdown-only）。 */
  manifest: SkillManifest | null;
  /** 同内容同 hash；供 UI / MCP / 导入导出对账。 */
  contentHash: string;
  /** manifest version；缺失/非法 ⇒ null。 */
  version: string | null;
  /** manifest 解析失败时的人话原因（用于加载期诊断；成功/缺失为 undefined）。 */
  manifestError?: string;
  /** 来源：'user' = 可写用户目录（可删/可导出）；'builtin' = 安装目录随附（只读）。 */
  origin: "builtin" | "user";
};

function parseSkillName(markdown: string, directoryName: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] || "";
  const nameMatch = frontmatter.match(/^name:\s*["']?(.+?)["']?\s*$/m);
  return String(nameMatch?.[1] || directoryName).trim();
}

/** 从 SKILL.md frontmatter 取 `description:`（单行）。缺失 ⇒ ""。 */
function parseSkillDescription(markdown: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] || "";
  const descMatch = frontmatter.match(/^description:\s*["']?(.+?)["']?\s*$/m);
  return String(descMatch?.[1] || "").trim();
}

export function normalizeSkillLookupKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[._\s/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/-+/g, "-")
    .toLowerCase();
}

/** 读一个 skill 目录的 skill.json（若有）并校验。缺失 ⇒ {manifest:null}（不报错，走 legacy）。 */
function readSkillManifest(skillDir: string): { manifest: SkillManifest | null; error?: string; rawText?: string } {
  const manifestPath = path.join(skillDir, "skill.json");
  if (!fs.existsSync(manifestPath)) return { manifest: null };
  let raw: unknown;
  const rawText = readText(manifestPath);
  try {
    raw = JSON.parse(rawText);
  } catch (err) {
    return { manifest: null, error: `skill.json 不是合法 JSON：${(err as Error).message}`, rawText };
  }
  const parsed = parseSkillManifest(raw);
  if (parsed.ok) return { manifest: parsed.manifest, rawText };
  return { manifest: null, error: parsed.error, rawText };
}

/** 扫描所有 skills 根（内置 + 用户目录），读出每个 skill 的正文 + manifest。 */
export function readSkillRecords(): SkillRecord[] {
  const records: SkillRecord[] = [];
  const seenDirs = new Set<string>();
  const userRoot = path.resolve(getUserSkillsRoot());
  for (const root of getSkillsRoots()) {
    if (!fs.existsSync(root)) continue;
    const origin: SkillRecord["origin"] = path.resolve(root) === userRoot ? "user" : "builtin";
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(root, entry.name);
      // 多根去重：同名目录以**先出现的根**为准（用户目录通常排后；保持现有内置优先语义）。
      if (seenDirs.has(entry.name)) continue;
      const filePath = path.join(skillDir, "SKILL.md");
      if (!fs.existsSync(filePath)) continue;
      const rawBody = readText(filePath);
      const body = rawBody.trim();
      if (!body) continue;
      seenDirs.add(entry.name);
      const { manifest, error, rawText } = readSkillManifest(skillDir);
      const version = manifest?.version ?? null;
      const contentHash = computeSkillContentHash({
        "SKILL.md": rawBody,
        ...(rawText ? { "skill.json": rawText } : {}),
      });
      records.push({
        name: manifest?.name || parseSkillName(body, entry.name),
        directoryName: entry.name,
        filePath,
        description: manifest?.description || parseSkillDescription(body),
        body,
        manifest,
        contentHash,
        version,
        manifestError: error,
        origin,
      });
    }
  }
  return records;
}

/** 按 LLM/前端传来的 key/name 在已加载 skill 里找匹配（精确 → 前缀 → 归一化模糊）。 */
export function findSkillRecord(
  skillKey: string,
  skillName: string,
  records: SkillRecord[] = readSkillRecords(),
): SkillRecord | null {
  if (!records.length) return null;
  const normalizedKey = normalizeSkillLookupKey(skillKey);
  const normalizedName = normalizeSkillLookupKey(skillName);

  const exact = records.find((skill) => skill.name === skillKey);
  if (exact) return exact;

  const prefix = records
    .filter((skill) => skillKey.startsWith(`${skill.name}.`))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (prefix) return prefix;

  return (
    records.find(
      (skill) =>
        normalizeSkillLookupKey(skill.name) === normalizedKey ||
        normalizeSkillLookupKey(skill.directoryName) === normalizedKey ||
        (normalizedName && normalizeSkillLookupKey(skill.name) === normalizedName) ||
        (normalizedName && normalizeSkillLookupKey(skill.directoryName) === normalizedName),
    ) || null
  );
}

/** 技能元数据（不含正文）——MCP 脊柱 resources/prompts 列表用，渐进披露。 */
export type SkillSummary = {
  name: string;
  directoryName: string;
  description: string;
  version: string | null;
  contentHash: string;
  origin: "builtin" | "user";
};

/**
 * 面向 MCP 脊柱暴露的「导演 / 编剧技能库」= directoryName 以 director- / writer- 开头的内置技能。
 * 这是从阿泽导演台整过来、供内外 agent 按需调用的电影方法论库；workbench.* 等内部编排技能不外暴露。
 */
const CRAFT_SKILL_PREFIXES = ["director-", "writer-"] as const;
function isCraftSkill(directoryName: string): boolean {
  return CRAFT_SKILL_PREFIXES.some((prefix) => directoryName.startsWith(prefix));
}

/** 技能元数据清单（渐进披露：只给 name+描述，不含正文）。默认只列导演/编剧技能库。 */
export function listSkillSummaries(craftOnly = true): SkillSummary[] {
  return readSkillRecords()
    .filter((record) => (craftOnly ? isCraftSkill(record.directoryName) : true))
    .map((record) => ({
      name: record.name,
      directoryName: record.directoryName,
      description: record.description,
      version: record.version,
      contentHash: record.contentHash,
      origin: record.origin,
    }));
}

/** 读一个技能的完整正文（按 name / directoryName 匹配）。找不到 ⇒ null。 */
export function readSkillContent(
  key: string,
): { name: string; directoryName: string; description: string; body: string; version: string | null; contentHash: string } | null {
  const record = findSkillRecord(key, key);
  if (!record) return null;
  return {
    name: record.name,
    directoryName: record.directoryName,
    description: record.description,
    body: record.body,
    version: record.version,
    contentHash: record.contentHash,
  };
}
