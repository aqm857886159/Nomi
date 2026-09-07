import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { migrateLegacySkillManifest, rewriteSkillMarkdown } from "./skillManifestMigration";
import { discoverSkillRecordsFromRoots } from "./skillStore";

// 全程只在临时目录里跑：迁移会重写 SKILL.md，绝不允许碰用户真实技能库。
const tmpDirs: string[] = [];
function mkSkill(files: Record<string, string>, dirName = "legacy-skill"): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-skill-migrate-"));
  tmpDirs.push(root);
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content, "utf8");
  return root;
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

const LEGACY_MANIFEST = JSON.stringify({
  name: "legacy.skill",
  version: "2.1.0",
  label: "旧技能",
  author: "@someone",
  description: "清单里的描述才是模型今天看到的那一份",
  tools: ["read_canvas_state"],
  requiredProviders: ["text", "video"],
  permissions: ["create"],
  selectableInWorkbench: true,
  inputs: [{ name: "brief", description: "一段话", required: true }],
  examples: [{ title: "示例一", description: "怎么用" }],
  stages: [
    { id: "script", goal: "写剧本", tools: [], pause: true, skillRefs: ["writer-dialogue"] },
    { id: "shots", goal: "拆镜", tools: ["read_canvas_state"], dependsOn: ["script"], modelPrefs: [{ kind: "video", family: "seedance" }] },
  ],
});
const LEGACY_MARKDOWN = "---\nname: legacy.skill\ndescription: frontmatter 那份描述\n---\n\n# 正文\n\n方法论。\n";

describe("rewriteSkillMarkdown", () => {
  it("keeps the description the model actually sees today (manifest wins, frontmatter is the fallback)", () => {
    const rewritten = rewriteSkillMarkdown(LEGACY_MARKDOWN, "legacy-skill", JSON.parse(LEGACY_MANIFEST));
    expect(rewritten).toContain("清单里的描述才是模型今天看到的那一份");
    expect(rewritten).not.toContain("frontmatter 那份描述");
  });

  it("renames the skill to its directory, as the spec requires", () => {
    const rewritten = rewriteSkillMarkdown(LEGACY_MARKDOWN, "legacy-skill", JSON.parse(LEGACY_MANIFEST));
    expect(rewritten).toMatch(/^---\nname: legacy-skill\n/);
    expect(rewritten).not.toContain("legacy.skill");
  });

  it("moves inputs and examples into the body instead of carrying them as dead metadata", () => {
    const rewritten = rewriteSkillMarkdown(LEGACY_MARKDOWN, "legacy-skill", JSON.parse(LEGACY_MANIFEST));
    expect(rewritten).toContain("## 输入");
    expect(rewritten).toContain("**brief**（必填）：一段话");
    expect(rewritten).toContain("## 示例");
    expect(rewritten).toContain("**示例一**：怎么用");
    expect(rewritten).toContain("方法论。");
  });

  it("drops permissions, which never granted anything", () => {
    expect(rewriteSkillMarkdown(LEGACY_MARKDOWN, "legacy-skill", JSON.parse(LEGACY_MANIFEST)))
      .not.toContain("permissions");
  });

  it("preserves disable-model-invocation, which pi and Claude Code both read", () => {
    const markdown = "---\nname: x\ndescription: d\ndisable-model-invocation: true\n---\n\nbody";
    expect(rewriteSkillMarkdown(markdown, "legacy-skill", JSON.parse(LEGACY_MANIFEST)))
      .toContain("disable-model-invocation: true");
  });
});

describe("migrateLegacySkillManifest", () => {
  it("rewrites SKILL.md, backs the old manifest up, and never runs twice", () => {
    const root = mkSkill({ "SKILL.md": LEGACY_MARKDOWN, "skill.json": LEGACY_MANIFEST });
    const dir = path.join(root, "legacy-skill");

    const first = migrateLegacySkillManifest(dir, () => 1_700_000_000_000);
    expect(first.migrated).toBe(true);
    expect(first.message).toContain("not reversible");
    expect(fs.existsSync(path.join(dir, "skill.json"))).toBe(false);
    expect(fs.readFileSync(path.join(dir, "skill.json.migrated-1700000000000.bak"), "utf8")).toBe(LEGACY_MANIFEST);

    const migrated = fs.readFileSync(path.join(dir, "SKILL.md"), "utf8");
    const second = migrateLegacySkillManifest(dir, () => 1_700_000_000_001);
    expect(second.migrated).toBe(false);
    expect(second.message).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")).toBe(migrated);
  });

  it("carries every field that still has a consumer through the discovery path", () => {
    const root = mkSkill({ "SKILL.md": LEGACY_MARKDOWN, "skill.json": LEGACY_MANIFEST });
    const { records, diagnostics } = discoverSkillRecordsFromRoots([{ path: root, origin: "user" }]);

    expect(diagnostics.map((d) => d.type)).toEqual(["warning"]);
    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record.name).toBe("legacy-skill");
    expect(record.description).toBe("清单里的描述才是模型今天看到的那一份");
    expect(record.manifest?.version).toBe("2.1.0");
    expect(record.manifest?.label).toBe("旧技能");
    expect(record.manifest?.author).toBe("@someone");
    expect(record.manifest?.selectableInWorkbench).toBe(true);
    expect(record.manifest?.requiredProviders).toEqual(["text", "video"]);
    expect(record.manifest?.tools).toEqual(["read_canvas_state"]);
    expect(record.manifest?.stages?.[0].skillRefs).toEqual(["writer-dialogue"]);
    expect(record.manifest?.stages?.[1].dependsOn).toEqual(["script"]);
    expect(record.manifest?.stages?.[1].modelPrefs).toEqual([{ kind: "video", family: "seedance" }]);
    // 导入的技能仍然被来源策略强制成 internal，与迁移无关。
    expect(record.audience).toBe("internal");
  });

  it("never touches built-in roots", () => {
    const root = mkSkill({ "SKILL.md": LEGACY_MARKDOWN, "skill.json": LEGACY_MANIFEST });
    discoverSkillRecordsFromRoots([{ path: root, origin: "builtin" }]);
    expect(fs.existsSync(path.join(root, "legacy-skill", "skill.json"))).toBe(true);
  });

  it("loads the skill anyway when the old manifest is unreadable, and says so", () => {
    const root = mkSkill({ "SKILL.md": LEGACY_MARKDOWN, "skill.json": "{ not json" });
    const { records, diagnostics } = discoverSkillRecordsFromRoots([{ path: root, origin: "user" }]);
    expect(diagnostics.some((d) => d.type === "error" && d.message.includes("migration failed"))).toBe(true);
    expect(records).toHaveLength(1);
    expect(records[0].description).toBe("frontmatter 那份描述");
  });
});
