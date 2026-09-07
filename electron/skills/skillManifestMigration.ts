import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

import { parseSkillFrontmatter } from "./skillFrontmatter";

/**
 * 存量 `skill.json` 的一次性迁移（2026-09-07）。
 *
 * 收敛前用户目录里的技能可能带第二份清单 `skill.json`。它现在没有读取路径了，所以
 * 光删掉读取代码是不够的——那会让用户**静默丢掉**他声明过的工具白名单、模态需求和
 * playbook 阶段。这里在加载时把它搬进 `SKILL.md` 的 `metadata.nomi`，然后把原文件
 * 改名成 `.bak` 留在原地。
 *
 * 三条纪律：
 *  · **只碰用户目录。** 内置技能在只读安装目录，仓库里那 33 个已经在同一个 PR 里改写完了。
 *  · **不删原文件。** 改名成 `skill.json.migrated-<ts>.bak`，用户打开目录就看得见发生过什么。
 *    迁移本身不可逆（frontmatter 会被重写），备份是给「我想看看原来写的什么」用的。
 *  · **失败不阻断。** 任何一步出错就跳过这个技能、返回一条诊断，照常按 frontmatter 加载它。
 *    迁移是便利，不是加载的前置条件。
 *
 * 迁完目录里就没有 `skill.json` 了，下次扫描自然跳过——所以只会跑一次。
 */

type MigrationOutcome = { migrated: boolean; message?: string };

/** 旧 JSON 清单（camelCase）→ 新 `metadata.nomi` 块（kebab-case）。 */
export function nomiBlockFromLegacyManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const block: Record<string, unknown> = {};
  const copy = (from: string, to = from): void => {
    if (manifest[from] !== undefined) block[to] = manifest[from];
  };
  copy("version");
  copy("label");
  copy("author");
  copy("audience");
  copy("selectableInWorkbench", "selectable-in-workbench");
  copy("requestedCapabilities", "requested-capabilities");
  block.tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  block["required-providers"] = Array.isArray(manifest.requiredProviders) ? manifest.requiredProviders : [];
  if (Array.isArray(manifest.stages)) {
    block.stages = manifest.stages.map((raw) => {
      const stage = raw as Record<string, unknown>;
      const out: Record<string, unknown> = { id: stage.id, goal: stage.goal, tools: stage.tools ?? [] };
      if (stage.dependsOn !== undefined) out["depends-on"] = stage.dependsOn;
      if (stage.pause !== undefined) out.pause = stage.pause;
      if (stage.skillRefs !== undefined) out["skill-refs"] = stage.skillRefs;
      if (stage.modelPrefs !== undefined) out["model-prefs"] = stage.modelPrefs;
      return out;
    });
  }
  if (block.version === undefined) block.version = "1.0.0";
  return block;
}

/**
 * `inputs` / `examples` 是作者手写的人话，没有任何机器消费者——它们进正文，
 * 而不是被塞进扩展块继续当登记表（规范推荐的正文分区里本来就有「示例」）。
 */
function proseSectionsFromLegacyManifest(manifest: Record<string, unknown>): string {
  const section = (title: string, lines: string[]): string =>
    lines.length ? `\n## ${title}\n\n${lines.join("\n")}\n` : "";
  const inputs = (Array.isArray(manifest.inputs) ? manifest.inputs : []).map((raw) => {
    const input = raw as Record<string, unknown>;
    return `- **${String(input.name ?? "")}**${input.required ? "（必填）" : ""}：${String(input.description ?? "")}`;
  });
  const examples = (Array.isArray(manifest.examples) ? manifest.examples : []).map((raw) => {
    const example = raw as Record<string, unknown>;
    const description = example.description ? `：${String(example.description)}` : "";
    const input = example.input ? `\n  > ${String(example.input)}` : "";
    return `- **${String(example.title ?? "")}**${description}${input}`;
  });
  return `${section("输入", inputs)}${section("示例", examples)}`;
}

/** 把一份旧清单 + 旧 SKILL.md 渲染成新的 SKILL.md 文本（纯函数，可单测）。 */
export function rewriteSkillMarkdown(
  markdown: string,
  directoryName: string,
  manifest: Record<string, unknown>,
): string {
  const normalized = markdown.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
  const frontEnd = normalized.startsWith("---") ? normalized.indexOf("\n---", 3) : -1;
  const front = parseSkillFrontmatter(normalized);
  const body = frontEnd === -1 ? normalized : normalized.slice(frontEnd + 4);

  // description 取「今天模型实际看到的那一份」：清单优先、frontmatter 兜底。迁移不许
  // 顺手换掉模型看到的自我介绍。
  const description = String(manifest.description || front.values.description || "").trim()
    || `${directoryName} skill`;
  const head: Record<string, unknown> = { name: directoryName, description };
  if (front.values["disable-model-invocation"] === true) head["disable-model-invocation"] = true;
  head.metadata = { nomi: nomiBlockFromLegacyManifest(manifest) };

  const frontYaml = yaml.dump(head, { lineWidth: -1, noRefs: true, quotingType: '"' });
  const prose = proseSectionsFromLegacyManifest(manifest);
  return `---\n${frontYaml}---\n\n${body.replace(/^\n+/, "").replace(/\n+$/, "")}\n${prose}`;
}

/** 迁移一个用户技能目录；没有 `skill.json` 就什么都不做。 */
export function migrateLegacySkillManifest(skillDir: string, now: () => number = Date.now): MigrationOutcome {
  const manifestPath = path.join(skillDir, "skill.json");
  const markdownPath = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(manifestPath) || !fs.existsSync(markdownPath)) return { migrated: false };
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error("legacy skill.json is not an object");
    }
    const markdown = fs.readFileSync(markdownPath, "utf8");
    const rewritten = rewriteSkillMarkdown(markdown, path.basename(skillDir), manifest);
    fs.writeFileSync(markdownPath, rewritten, "utf8");
    fs.renameSync(manifestPath, path.join(skillDir, `skill.json.migrated-${now()}.bak`));
    return {
      migrated: true,
      // Discovery diagnostics are main-process developer output, not UI copy —
      // the sibling messages in skillStore.ts are English for the same reason.
      message: "Legacy skill.json folded into SKILL.md frontmatter; the original was kept as a .bak (this rewrite is not reversible)",
    };
  } catch (error) {
    return { migrated: false, message: `Legacy skill.json migration failed, loading from frontmatter as usual: ${(error as Error).message}` };
  }
}
