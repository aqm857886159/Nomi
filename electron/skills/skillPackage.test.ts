import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SKILL_PACKAGE_VERSION,
  buildSkillPackage,
  computeSkillContentHash,
  isSafeSkillFileName,
  readSkillDirFiles,
  resolveImportDirName,
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

const validFiles = { "SKILL.md": "# body", "skill.json": validManifest };

describe("isSafeSkillFileName", () => {
  it("accepts SKILL.md / skill.json / *.md / *.txt basenames", () => {
    expect(isSafeSkillFileName("SKILL.md")).toBe(true);
    expect(isSafeSkillFileName("skill.json")).toBe(true);
    expect(isSafeSkillFileName("REFERENCE.txt")).toBe(true);
  });
  it("rejects path traversal / subdirs / bad extensions", () => {
    expect(isSafeSkillFileName("../evil.md")).toBe(false);
    expect(isSafeSkillFileName("a/b.md")).toBe(false);
    expect(isSafeSkillFileName("run.sh")).toBe(false);
    expect(isSafeSkillFileName("payload.exe")).toBe(false);
    expect(isSafeSkillFileName("..")).toBe(false);
    expect(isSafeSkillFileName("")).toBe(false);
  });
});

describe("validateSkillPackage", () => {
  const pkg = (files: Record<string, string>) =>
    buildSkillPackage("brand-promo", files, 1700000000000);

  it("accepts a valid package with manifest", () => {
    const result = validateSkillPackage(pkg(validFiles));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest?.name).toBe("brand.promo");
  });

  it("accepts a legacy package (SKILL.md only, no manifest)", () => {
    const result = validateSkillPackage(pkg({ "SKILL.md": "# body only" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.manifest).toBeNull();
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
  it("reads a skill dir, packages, validates, and writes to a user root with collision avoidance", () => {
    const srcRoot = mkTmp();
    const srcDir = path.join(srcRoot, "brand-promo");
    fs.mkdirSync(srcDir);
    fs.writeFileSync(path.join(srcDir, "SKILL.md"), "# brand promo body");
    fs.writeFileSync(path.join(srcDir, "skill.json"), validManifest);
    fs.writeFileSync(path.join(srcDir, "ignore.bin"), "not shareable"); // 非白名单，应被忽略

    const files = readSkillDirFiles(srcDir);
    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "skill.json"]);

    const built = buildSkillPackage("brand-promo", files, 1700000000000);
    const validated = validateSkillPackage(built);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const userRoot = mkTmp();
    const first = writeSkillImport(userRoot, validated.pkg);
    expect(first.dirName).toBe("brand-promo");
    expect(fs.readFileSync(path.join(first.dir, "SKILL.md"), "utf8")).toContain("brand promo body");

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

  it("computes a stable content hash for identical package files", () => {
    const left = computeSkillContentHash(validFiles);
    const right = computeSkillContentHash({ "skill.json": validManifest, "SKILL.md": "# body" });
    expect(left).toBe(right);
    expect(left).toHaveLength(16);
  });

  it("changes the content hash when package content changes", () => {
    const left = computeSkillContentHash(validFiles);
    const right = computeSkillContentHash({ "SKILL.md": "# body", "skill.json": validManifest.replace("1.0.0", "1.0.1") });
    expect(left).not.toBe(right);
  });
});
