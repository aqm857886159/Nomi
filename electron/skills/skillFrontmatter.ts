import yaml from "js-yaml";

/**
 * SKILL.md 的 YAML frontmatter —— 技能清单的**唯一** owner（2026-09-07 起）。
 *
 * 单独一个文件，是因为两边都要读它而它们不能互相 import：`skillStore` 组装记录时读，
 * `skillPackage` 校验外来包时也读，而 `skillStore` 已经 import `skillPackage`。
 * 一个语义一个 owner，正是这次收敛在治的病。
 *
 * 为什么用真 YAML 解析器而不是正则（收敛前那四条正则的教训）：
 * `skills/director-art-design/SKILL.md` 的 description 里有段未加引号的 `carrier: visual`，
 * 正则按行抓得好好的，而 pi / Claude Code / Codex 的真解析器直接把整个技能丢掉——
 * 我们比别人宽松的那一侧永远看不见问题。现在两边同一档严格度。
 *
 * `JSON_SCHEMA` 把解析限制在纯标量 / 映射 / 列表：不认 YAML 标签、不做日期强转。
 */
export type SkillFrontmatter = {
  values: Record<string, unknown>;
  /** 有 frontmatter 但解析不了时才有值；没有 frontmatter 不是错。 */
  error?: string;
};

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const normalized = String(markdown).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return { values: {} };
  const end = normalized.indexOf("\n---", 3);
  if (end === -1) return { values: {}, error: "SKILL.md 的 frontmatter 没有闭合的 ---" };
  let parsed: unknown;
  try {
    parsed = yaml.load(normalized.slice(4, end), { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    return { values: {}, error: `SKILL.md 的 frontmatter 不是合法 YAML：${(error as Error).message.split("\n")[0]}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { values: {} };
  return { values: parsed as Record<string, unknown> };
}

export function frontmatterString(front: SkillFrontmatter, key: string): string {
  const value = front.values[key];
  return typeof value === "string" ? value.trim() : "";
}

/** 包导入侧只需要身份：叫什么、frontmatter 读不读得动。 */
export function readSkillFrontmatterIdentity(markdown: string): { name: string; error?: string } {
  const front = parseSkillFrontmatter(markdown);
  return { name: frontmatterString(front, "name"), error: front.error };
}
