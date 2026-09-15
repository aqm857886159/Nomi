import yaml from "js-yaml";
import { readSkillCuration } from "../shared/skillCuration";

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
  const values = parsed as Record<string, unknown>;
  try {
    readSkillCuration(values);
  } catch {
    return { values, error: "Invalid curated Skill license or metadata" };
  }
  return { values };
}

/**
 * SKILL.md 去掉 frontmatter 之后的正文。
 *
 * ── 它在解决哪个真实摩擦 ──
 *
 * `SkillRecord.body` 是**整份文件**（`skillStore.ts:179`），frontmatter 包含在内。当它被原样
 * 注入系统提示词时，模型读到的前半段是 `license: Apache-2.0` / `source: url:` / `preview: path:`
 * / 两种语言的 `label` —— 打包元数据，不是方法。实测占比：`curated-film-storyboard` 2380B 里
 * 1543B（65%）是 frontmatter，真正的方法只有 837B；`curated-multi-view` 同为 65%，
 * `curated-product-turntable` 52%，`brand-promo` 41%。用户「选了技能但提示词一看就不对」
 * 的一半就在这里：我们把清单当方法喂进去了。
 *
 * **只给提示词注入用**。`read_skill` / MCP `resources/read` 要的仍是原文——外部读者按
 * Agent Skills 标准期待一份完整的 SKILL.md（R31），在那里裁掉 frontmatter 才是错的。
 *
 * 解析位置与 `parseSkillFrontmatter` 同一份判据（`---` 开头 + 第一个 `\n---`），所以这里
 * 和它住在一个文件：两处各自找结束符就是两份定义。
 */
export function skillMarkdownWithoutFrontmatter(markdown: string): string {
  const normalized = String(markdown).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---")) return normalized.trim();
  const end = normalized.indexOf("\n---", 3);
  // 没闭合的 frontmatter 不算 frontmatter（与 parseSkillFrontmatter 同一判据）：整份当正文给出去，
  // 少给远比静默给空强——空正文的症状是「技能挂着但模型什么都没照做」，正是这次在修的病。
  if (end === -1) return normalized.trim();
  return normalized.slice(normalized.indexOf("\n", end + 1) + 1).trim() || normalized.trim();
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
