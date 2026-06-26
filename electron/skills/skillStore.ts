// Skill 加载/查找的单一真相源（P1）。原先散在 agentChatV2.ts 里只读 SKILL.md 正文、
// 从不读 skill.json（manifest 是死代码）。本模块收口加载逻辑，并**第一次把 skill.json
// 解析成 manifest 暴露出来**——playbook 的 stages / requiredProviders / tools / description
// 都从这里读。向后兼容：skill.json 缺失或不合法 ⇒ manifest=null，照旧只用 markdown 正文。
import fs from "node:fs";
import path from "node:path";

import { getSkillsRoots, getUserSkillsRoot, readText } from "../runtimePaths";
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
  /** SKILL.md 正文（去掉首尾空白）。 */
  body: string;
  /** skill.json 解析出的 manifest；缺失/非法 ⇒ null（legacy markdown-only）。 */
  manifest: SkillManifest | null;
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
function readSkillManifest(skillDir: string): { manifest: SkillManifest | null; error?: string } {
  const manifestPath = path.join(skillDir, "skill.json");
  if (!fs.existsSync(manifestPath)) return { manifest: null };
  let raw: unknown;
  try {
    raw = JSON.parse(readText(manifestPath));
  } catch (err) {
    return { manifest: null, error: `skill.json 不是合法 JSON：${(err as Error).message}` };
  }
  const parsed = parseSkillManifest(raw);
  if (parsed.ok) return { manifest: parsed.manifest };
  return { manifest: null, error: parsed.error };
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
      const body = readText(filePath).trim();
      if (!body) continue;
      seenDirs.add(entry.name);
      const { manifest, error } = readSkillManifest(skillDir);
      records.push({
        name: manifest?.name || parseSkillName(body, entry.name),
        directoryName: entry.name,
        filePath,
        body,
        manifest,
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
