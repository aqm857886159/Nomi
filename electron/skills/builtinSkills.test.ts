import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { parseSkillFrontmatter } from "./skillFrontmatter";
import { parseSkillManifest, type SkillManifest } from "./skillManifestSchema";
import { orderPlaybookStages } from "./playbookOrchestrator";
import { discoverSkillRecordsFromRoots, findSkillRecord, readSkillManifest } from "./skillStore";

// 内置 skill 回归门：仓库里 skills/<name>/SKILL.md 的 Nomi 扩展块（frontmatter 的
// metadata.nomi）一旦写坏这里就红，防「改坏内置包没人发现」。
// frontmatter 本身的规范合规性（必填字段、name 与目录同名、pi 能不能读）由
// `check:skills-format` 门岗管——一个语义一个 owner。
// 直接读磁盘（vitest cwd = 仓库根），不经 electron app。
const SKILLS_DIR = path.resolve(process.cwd(), "skills");

function builtinSkillDirs(): string[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  return fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(SKILLS_DIR, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

function manifestOf(dir: string): SkillManifest {
  const body = fs.readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
  const { manifest, error } = readSkillManifest(parseSkillFrontmatter(body));
  if (!manifest) throw new Error(`${dir}: ${error ?? "no metadata.nomi block"}`);
  return manifest;
}

describe("built-in skill packs", () => {
  const dirs = builtinSkillDirs();
  const withManifest = dirs.filter((dir) =>
    readSkillManifest(parseSkillFrontmatter(fs.readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8"))).manifest !== null);

  it("ships the built-in skill tree in packaged applications", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as {
      build?: { files?: string[] };
    };
    expect(packageJson.build?.files).toContain("skills/**");
  });

  it("finds at least the brand-promo playbook + legacy packs", () => {
    expect(withManifest).toContain("brand-promo");
    expect(withManifest.length).toBeGreaterThanOrEqual(4);
  });

  it("carries no second manifest file — SKILL.md frontmatter is the only one", () => {
    const strays = dirs.filter((dir) => fs.existsSync(path.join(SKILLS_DIR, dir, "skill.json")));
    expect(strays).toEqual([]);
  });

  it.each(dirs)("%s frontmatter parses, and its metadata.nomi validates", (dir) => {
    const body = fs.readFileSync(path.join(SKILLS_DIR, dir, "SKILL.md"), "utf8");
    const front = parseSkillFrontmatter(body);
    expect(front.error ?? "").toBe("");
    const { error } = readSkillManifest(front);
    expect(error ?? "").toBe("");
  });

  it("rejects a metadata.nomi block that pins a vendor archetype", () => {
    const result = parseSkillManifest({
      version: "1.0.0",
      tools: [],
      "required-providers": ["video"],
      stages: [{ id: "generate", goal: "生成", tools: [], "model-prefs": [{ kind: "video", archetypeId: "seedance-pro" }] }],
    });
    expect(result.ok).toBe(false);
  });

  it("brand-promo is a script-first 5-stage playbook that topo-sorts cleanly", () => {
    const stages = manifestOf("brand-promo").stages ?? [];
    expect(stages).toHaveLength(5);
    const ordered = orderPlaybookStages(stages).map((s) => s.id);
    expect(ordered).toEqual(["script", "storyboard", "build", "generate", "assemble"]);
    expect(stages.find((stage) => stage.id === "script")?.pause).toBe(true);
    expect(stages.find((stage) => stage.id === "script")?.skillRefs).toEqual([
      "writer-screenwriter",
      "writer-structure",
      "writer-dialogue",
      "writer-review",
    ]);
  });

  it("marks the storyboard planner as a user-selectable Workbench Skill", () => {
    expect(manifestOf("workbench-storyboard-planner").selectableInWorkbench).toBe(true);
  });

  it("release-media-pack is an evidence-first 7-stage playbook with an honest handoff", () => {
    const manifest = manifestOf("release-media-pack");
    const stages = manifest.stages ?? [];
    expect(orderPlaybookStages(stages).map((stage) => stage.id)).toEqual([
      "evidence",
      "research",
      "story",
      "build",
      "generate",
      "assemble",
      "handoff",
    ]);
    expect(stages.find((stage) => stage.id === "story")?.pause).toBe(true);
    expect(stages.find((stage) => stage.id === "handoff")?.pause).toBe(true);
    expect(manifest.tools).not.toContain("tikhub_search");
    expect(manifest.tools).not.toContain("ffmpeg");

    const body = fs.readFileSync(path.join(SKILLS_DIR, "release-media-pack", "SKILL.md"), "utf8");
    expect(body.split(/\r?\n/).length).toBeLessThanOrEqual(260);

    const top = new Set(manifest.tools);
    for (const stage of stages) {
      for (const tool of stage.tools) expect(top.has(tool)).toBe(true);
      for (const skillRef of stage.skillRefs ?? []) {
        expect(fs.existsSync(path.join(SKILLS_DIR, skillRef, "SKILL.md"))).toBe(true);
      }
    }
  });

  it("every brand-promo stage tool is also declared in the top-level tools whitelist", () => {
    const manifest = manifestOf("brand-promo");
    const top = new Set(manifest.tools);
    for (const stage of manifest.stages ?? []) {
      for (const tool of stage.tools) expect(top.has(tool)).toBe(true);
    }
  });

  // 2026-09-07：`name` 从点号分段（`workbench.generation.canvas-planner`）改成目录名，
  // 而查找归一只把 `.` 换成 `-`——所以归一后仍对不上目录名的那几个 skillKey 会**静默**
  // 失效：拿不到 manifest 就等于「不收窄能力、也不显示阶段」，CI 一片绿。这条断言把
  // 「代码里写死的 skillKey 必须指得到一个真实技能」变成机器判据（R28）。
  it("every hardcoded launcher skillKey still resolves to a real skill record", () => {
    const records = discoverSkillRecordsFromRoots([{ path: SKILLS_DIR, origin: "builtin" }]).records;
    const launcherKeys = [
      "workbench-generation",
      "workbench-storyboard-planner",
      "workbench-fixation-planner",
      "skill-author",
      "brand-promo",
    ];
    for (const key of launcherKeys) {
      expect(findSkillRecord(key, key, records)?.directoryName, key).toBe(key);
    }
  });

  it("still resolves the pre-convergence dotted keys that live in persisted data", () => {
    const records = discoverSkillRecordsFromRoots([{ path: SKILLS_DIR, origin: "builtin" }]).records;
    for (const [legacyKey, directoryName] of [
      ["workbench.storyboard.planner", "workbench-storyboard-planner"],
      ["workbench.fixation.planner", "workbench-fixation-planner"],
      ["brand.promo", "brand-promo"],
      ["drama.short", "drama-short"],
      ["release.media-pack", "release-media-pack"],
    ] as const) {
      expect(findSkillRecord(legacyKey, legacyKey, records)?.directoryName, legacyKey).toBe(directoryName);
    }
  });
});
