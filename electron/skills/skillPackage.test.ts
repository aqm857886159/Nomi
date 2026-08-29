import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SKILL_PACKAGE_VERSION,
  SKILL_PACKAGE_MAX_FILES,
  buildSkillPackage,
  computeSkillContentHash,
  isSafeSkillRelativePath,
  readSkillDirFiles,
  resolveImportDirName,
  stampSkillPackage,
  validateSkillPackage,
  writeSkillImport,
} from "./skillPackage";

const tmpDirs: string[] = [];
function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-skillpkg-"));
  tmpDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (tmpDirs.length) fs.rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
});

const validManifest = JSON.stringify({
  name: "brand.promo",
  version: "1.0.0",
  description: "做品牌宣传片",
  tools: ["propose_storyboard_plan"],
  requiredProviders: ["text", "image", "video"],
  permissions: ["create"],
  stages: [{ id: "s", goal: "g", tools: [], modelPrefs: [{ kind: "video", family: "seedance" }] }],
});

describe("isSafeSkillRelativePath", () => {
  it("accepts root metadata and recursive textual knowledge files", () => {
    expect(isSafeSkillRelativePath("SKILL.md")).toBe(true);
    expect(isSafeSkillRelativePath("skill.json")).toBe(true);
    expect(isSafeSkillRelativePath("README.md")).toBe(true);
    expect(isSafeSkillRelativePath("references/camera/REFERENCE.md")).toBe(true);
    expect(isSafeSkillRelativePath("assets/templates/shot.csv")).toBe(true);
    expect(isSafeSkillRelativePath("examples/shot.yaml")).toBe(true);
    expect(isSafeSkillRelativePath("evals/evals.json")).toBe(true);
  });
  it.each([
    "../evil.md",
    "references/../evil.md",
    "/absolute.md",
    "references\\evil.md",
    "scripts/run.md",
    "bin/tool.txt",
    "hooks/post-install.md",
    "assets/logo.png",
    "run.sh",
    "..",
    "",
  ])("rejects paths outside the knowledge-only boundary: %s", (relativePath) => {
    expect(isSafeSkillRelativePath(relativePath)).toBe(false);
  });
});

describe("validateSkillPackage", () => {
  const pkg = (files: Record<string, string>) =>
    buildSkillPackage("brand-promo", files, 1700000000000);

  it("accepts a valid package with manifest", () => {
    const result = validateSkillPackage(pkg({ "SKILL.md": "# body", "skill.json": validManifest }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest?.name).toBe("brand.promo");
  });

  it("accepts a legacy package (SKILL.md only, no manifest)", () => {
    const result = validateSkillPackage(pkg({ "SKILL.md": "# body only" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).toBeNull();
  });

  it("accepts and preserves recursive textual references and assets", () => {
    const result = validateSkillPackage(pkg({
      "SKILL.md": "# body",
      "references/camera.md": "reference",
      "assets/templates/shot.yaml": "shot: close-up",
    }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.pkg.files["references/camera.md"]).toBe("reference");
      expect(result.pkg.files["assets/templates/shot.yaml"]).toContain("close-up");
    }
  });

  it("rejects an incompatible version", () => {
    const result = validateSkillPackage({ version: "nope", dirName: "x", files: { "SKILL.md": "b" } });
    expect(result.ok).toBe(false);
  });

  it("rejects a package missing SKILL.md", () => {
    const result = validateSkillPackage(pkg({ "skill.json": validManifest }));
    expect(result.ok).toBe(false);
  });

  it("rejects an unsafe filename in the package", () => {
    const result = validateSkillPackage(pkg({ "SKILL.md": "b", "../escape.md": "x" }));
    expect(result.ok).toBe(false);
  });

  it("rejects paths that collide on case-insensitive filesystems", () => {
    const result = validateSkillPackage(pkg({
      "SKILL.md": "body",
      "references/Camera.md": "first",
      "references/camera.md": "second",
    }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("colliding paths") });
  });

  it("rejects paths that collide after Unicode normalization", () => {
    const result = validateSkillPackage(pkg({
      "SKILL.md": "body",
      "references/caf\u00e9.md": "first",
      "references/cafe\u0301.md": "second",
    }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("colliding paths") });
  });

  it("rejects a file that would also have to be a parent directory", () => {
    const result = validateSkillPackage(pkg({
      "SKILL.md": "body",
      "references.md": "file",
      "references.md/nested.txt": "nested",
    }));
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("file/directory collision") });
  });

  it.each([
    ["scripts/run.md", "not executable just because it is markdown"],
    ["assets/logo.png", "fake binary"],
    ["references/nul.txt", "before\0after"],
  ])("rejects unsupported package content instead of silently truncating it: %s", (name, content) => {
    expect(validateSkillPackage(pkg({ "SKILL.md": "body", [name]: content })).ok).toBe(false);
  });

  it("rejects packages above the bounded file count", () => {
    const files: Record<string, string> = { "SKILL.md": "body" };
    for (let index = 0; index < SKILL_PACKAGE_MAX_FILES; index += 1) {
      files[`references/${index}.txt`] = String(index);
    }
    expect(validateSkillPackage(pkg(files)).ok).toBe(false);
  });

  it("rejects a package whose skill.json fails manifest validation (e.g. archetypeId)", () => {
    const bad = JSON.stringify({
      name: "bad",
      version: "1.0.0",
      description: "d",
      tools: [],
      requiredProviders: ["video"],
      permissions: ["create"],
      stages: [{ id: "s", goal: "g", tools: [], modelPrefs: [{ kind: "video", archetypeId: "seedance-2" }] }],
    });
    const result = validateSkillPackage(pkg({ "SKILL.md": "b", "skill.json": bad }));
    expect(result.ok).toBe(false);
  });
});

describe("resolveImportDirName", () => {
  it("kebab-cases and avoids collisions with suffixes", () => {
    expect(resolveImportDirName("Brand Promo", new Set())).toBe("brand-promo");
    expect(resolveImportDirName("brand-promo", new Set(["brand-promo"]))).toBe("brand-promo-2");
    expect(resolveImportDirName("brand-promo", new Set(["brand-promo", "brand-promo-2"]))).toBe(
      "brand-promo-3",
    );
  });
});

describe("FS round-trip (export dir → package → import dir)", () => {
  it("recursively preserves a knowledge package and writes it with collision avoidance", () => {
    const srcRoot = mkTmp();
    const srcDir = path.join(srcRoot, "brand-promo");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "SKILL.md"), "# brand promo body");
    fs.writeFileSync(path.join(srcDir, "skill.json"), validManifest);
    fs.mkdirSync(path.join(srcDir, "references", "camera"), { recursive: true });
    fs.mkdirSync(path.join(srcDir, "assets", "templates"), { recursive: true });
    fs.writeFileSync(path.join(srcDir, "references", "camera", "shots.md"), "shot reference");
    fs.writeFileSync(path.join(srcDir, "assets", "templates", "shot.txt"), "shot template");

    const files = readSkillDirFiles(srcDir);
    expect(Object.keys(files).sort()).toEqual([
      "SKILL.md",
      "assets/templates/shot.txt",
      "references/camera/shots.md",
      "skill.json",
    ]);

    const built = buildSkillPackage("brand-promo", files, 1700000000000);
    const validated = validateSkillPackage(built);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const userRoot = mkTmp();
    const first = writeSkillImport(userRoot, validated.pkg);
    expect(first.dirName).toBe("brand-promo");
    expect(fs.readFileSync(path.join(first.dir, "SKILL.md"), "utf8")).toContain("brand promo body");
    expect(fs.readFileSync(path.join(first.dir, "references", "camera", "shots.md"), "utf8"))
      .toBe("shot reference");

    // 再导入同一个包 → 冲突避让，不覆盖
    const second = writeSkillImport(userRoot, validated.pkg);
    expect(second.dirName).toBe("brand-promo-2");
    expect(fs.existsSync(path.join(userRoot, "brand-promo"))).toBe(true);
    expect(fs.existsSync(path.join(userRoot, "brand-promo-2"))).toBe(true);
  });

  it("uses the package version constant", () => {
    const built = buildSkillPackage("x", { "SKILL.md": "b" }, 0);
    expect(built.version).toBe(SKILL_PACKAGE_VERSION);
  });

  it("rejects unsupported files and symlinks on disk instead of exporting a partial package", () => {
    const unsupported = mkTmp();
    fs.writeFileSync(path.join(unsupported, "SKILL.md"), "body");
    fs.writeFileSync(path.join(unsupported, "logo.png"), "fake");
    expect(() => readSkillDirFiles(unsupported)).toThrow("Unsupported Skill package path");

    const linked = mkTmp();
    fs.writeFileSync(path.join(linked, "SKILL.md"), "body");
    fs.mkdirSync(path.join(linked, "references"));
    fs.symlinkSync(path.join(linked, "SKILL.md"), path.join(linked, "references", "linked.md"));
    expect(() => readSkillDirFiles(linked)).toThrow("symbolic link");
  });

  it("enforces file-size and depth limits before reading a disk package", () => {
    const oversized = mkTmp();
    fs.writeFileSync(path.join(oversized, "SKILL.md"), "body");
    fs.mkdirSync(path.join(oversized, "references"));
    fs.writeFileSync(
      path.join(oversized, "references", "large.txt"),
      Buffer.alloc(1024 * 1024 + 1, "a"),
    );
    expect(() => readSkillDirFiles(oversized)).toThrow("超过大小限制");

    const tooDeep = mkTmp();
    fs.writeFileSync(path.join(tooDeep, "SKILL.md"), "body");
    const nested = path.join(tooDeep, ...Array.from({ length: 9 }, (_, index) => `level-${index}`));
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "notes.md"), "deep");
    expect(() => readSkillDirFiles(tooDeep)).toThrow("Unsupported Skill package path");
  });

  it("never replaces a non-directory collision in the user Skill root", () => {
    const userRoot = mkTmp();
    fs.writeFileSync(path.join(userRoot, "brand-promo"), "keep me");
    const imported = writeSkillImport(
      userRoot,
      buildSkillPackage("brand-promo", { "SKILL.md": "body" }, 0),
    );
    expect(imported.dirName).toBe("brand-promo-2");
    expect(fs.readFileSync(path.join(userRoot, "brand-promo"), "utf8")).toBe("keep me");
  });
});

describe("main-owned package identity", () => {
  it("stamps normalized renderer input with the current package version", () => {
    expect(stampSkillPackage({ dirName: "plain", files: { "SKILL.md": "body" } }, 123)).toEqual({
      version: SKILL_PACKAGE_VERSION,
      exportedAt: 123,
      dirName: "plain",
      files: { "SKILL.md": "body" },
    });
  });

  it("hashes the complete sorted file table deterministically", () => {
    const first = computeSkillContentHash({ "SKILL.md": "body", "references/a.md": "A" });
    const reordered = computeSkillContentHash({ "references/a.md": "A", "SKILL.md": "body" });
    const changed = computeSkillContentHash({ "SKILL.md": "body", "references/a.md": "B" });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });
});
