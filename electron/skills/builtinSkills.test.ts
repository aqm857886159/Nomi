import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseSkillManifest } from "./skillManifestSchema";
import { orderPlaybookStages } from "./playbookOrchestrator";

// 内置 skill 回归门：仓库里 skills/<name>/skill.json 一旦写坏（schema/JSON）这里就红，
// 防「改坏内置包没人发现」。直接读磁盘（vitest cwd = 仓库根），不经 electron app。
const SKILLS_DIR = path.resolve(process.cwd(), "skills");

function builtinSkillJsonDirs(): string[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, e.name, "skill.json")))
    .map((e) => e.name);
}

describe("built-in skill packs", () => {
  const dirs = builtinSkillJsonDirs();

  it("finds at least the brand-promo playbook + legacy packs", () => {
    expect(dirs).toContain("brand-promo");
    expect(dirs.length).toBeGreaterThanOrEqual(4);
  });

  it.each(dirs)("%s/skill.json parses against the manifest schema", (dir) => {
    const raw = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, dir, "skill.json"), "utf8"));
    const result = parseSkillManifest(raw);
    expect(result.ok, result.ok ? "" : (result as { error: string }).error).toBe(true);
  });

  it("brand-promo is a 4-stage playbook that topo-sorts cleanly", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, "brand-promo", "skill.json"), "utf8"));
    const parsed = parseSkillManifest(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const stages = parsed.manifest.stages ?? [];
    expect(stages).toHaveLength(4);
    const ordered = orderPlaybookStages(stages).map((s) => s.id);
    expect(ordered).toEqual(["storyboard", "build", "generate", "assemble"]);
  });

  it("every brand-promo stage tool is also declared in the top-level tools whitelist", () => {
    const raw = JSON.parse(fs.readFileSync(path.join(SKILLS_DIR, "brand-promo", "skill.json"), "utf8"));
    const parsed = parseSkillManifest(raw);
    if (!parsed.ok) throw new Error("brand-promo invalid");
    const top = new Set(parsed.manifest.tools);
    for (const stage of parsed.manifest.stages ?? []) {
      for (const tool of stage.tools) expect(top.has(tool)).toBe(true);
    }
  });
});
