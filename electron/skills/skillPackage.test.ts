import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  SKILL_PACKAGE_VERSION,
  buildSkillPackage,
  isExecutableSkillPath,
  normalizeSkillImportInput,
  isSafeSkillFilePath,
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

/** 一个技能包就是一个 SKILL.md：frontmatter 是唯一清单，正文是方法论。 */
const validSkillMarkdown = [
  "---",
  "name: brand-promo",
  "description: 做品牌宣传片",
  "metadata:",
  "  nomi:",
  '    version: "1.0.0"',
  "    tools: [propose_storyboard_plan]",
  "    required-providers: [text, image, video]",
  "---",
  "",
  "# 正文",
].join("\n");

describe("isSafeSkillFilePath", () => {
  it("accepts root files and standard knowledge subdirs", () => {
    expect(isSafeSkillFilePath("SKILL.md")).toBe(true);
    // `.json` 仍是合法的知识层扩展名（references/lookup.json）；它只是不再是清单。
    expect(isSafeSkillFilePath("references/lookup.json")).toBe(true);
    expect(isSafeSkillFilePath("REFERENCE.txt")).toBe(true);
    // 2026-08-27：这三条以前是 false（禁一切子目录），正是「别人的技能进不来」的根因
    expect(isSafeSkillFilePath("references/shot-list.md")).toBe(true);
    expect(isSafeSkillFilePath("assets/template.txt")).toBe(true);
    expect(isSafeSkillFilePath("references\\win\\style.yaml")).toBe(true);
  });
  it("rejects traversal / absolute / drive letters / null bytes", () => {
    expect(isSafeSkillFilePath("../evil.md")).toBe(false);
    expect(isSafeSkillFilePath("references/../../evil.md")).toBe(false);
    expect(isSafeSkillFilePath("/etc/passwd.md")).toBe(false);
    expect(isSafeSkillFilePath("C:/windows/x.md")).toBe(false);
    expect(isSafeSkillFilePath("a\0b.md")).toBe(false);
    expect(isSafeSkillFilePath("")).toBe(false);
    expect(isSafeSkillFilePath("..")).toBe(false);
  });
  it("rejects non-text extensions and over-deep paths", () => {
    expect(isSafeSkillFilePath("run.sh")).toBe(false);
    expect(isSafeSkillFilePath("payload.exe")).toBe(false);
    expect(isSafeSkillFilePath("logo.png")).toBe(false);
    expect(isSafeSkillFilePath("a/b/c/d/e.md")).toBe(false);
  });
  it("treats executable dirs as a distinct case (so the UI can explain why)", () => {
    expect(isExecutableSkillPath("scripts/build.md")).toBe(true);
    expect(isExecutableSkillPath("bin/x.txt")).toBe(true);
    expect(isExecutableSkillPath("references/x.md")).toBe(false);
    // 可执行区即使扩展名合法也不收
    expect(isSafeSkillFilePath("scripts/notes.md")).toBe(false);
  });
});

describe("validateSkillPackage", () => {
  const pkg = (files: Record<string, string>) =>
    buildSkillPackage("brand-promo", files, 1700000000000);

  it("takes the skill name from the frontmatter", () => {
    const result = validateSkillPackage(pkg({ "SKILL.md": validSkillMarkdown }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skillName).toBe("brand-promo");
  });

  it("accepts a pure knowledge pack with no Nomi extension block", () => {
    const result = validateSkillPackage(
      pkg({ "SKILL.md": "---\nname: notes\ndescription: 只有方法论\n---\n\n# body only" }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skillName).toBe("notes");
  });

  it("falls back to the directory name when the frontmatter names nothing", () => {
    const result = validateSkillPackage(pkg({ "SKILL.md": "# body only" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.skillName).toBe("brand-promo");
  });

  it("rejects an incompatible version", () => {
    const result = validateSkillPackage({ version: "nope", dirName: "x", files: { "SKILL.md": "b" } });
    expect(result.ok).toBe(false);
  });

  it("rejects a package missing SKILL.md", () => {
    const result = validateSkillPackage(pkg({ "references/notes.md": "x" }));
    expect(result.ok).toBe(false);
  });

  it("rejects an unsafe filename in the package", () => {
    const result = validateSkillPackage(pkg({ "SKILL.md": "b", "../escape.md": "x" }));
    expect(result.ok).toBe(false);
  });

  it("accepts knowledge subdirs (references/ assets/)", () => {
    const result = validateSkillPackage(
      pkg({ "SKILL.md": "b", "references/shots.md": "list", "assets/tpl.txt": "t" }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects scripts/ with a reason a human can act on, not a generic 'unsafe path'", () => {
    const result = validateSkillPackage(pkg({ "SKILL.md": "b", "scripts/build.sh": "x" }));
    expect(result.ok).toBe(false);
    // v1 只吃知识层：错误必须说清「为什么不收」，否则用户只会以为文件坏了
    if (!result.ok) expect(result.error).toContain("知识层");
  });

  it("rejects a SKILL.md whose frontmatter a real YAML parser cannot read", () => {
    // 未加引号的值里带 ": " —— 我们自己的正则以前读得下去，pi / Claude Code / Codex 直接
    // 丢掉整个技能。收下它等于把一个「在别的宿主里不存在」的技能落进用户目录。
    const broken = "---\nname: bad\ndescription: 为 anchor（`carrier: visual`）写提示词\n---\n\n# body";
    const result = validateSkillPackage(pkg({ "SKILL.md": broken }));
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
    fs.writeFileSync(path.join(srcDir, "SKILL.md"), `${validSkillMarkdown}\n\n# brand promo body`);
    fs.writeFileSync(path.join(srcDir, "references/../notes.md"), "shot notes");
    fs.writeFileSync(path.join(srcDir, "ignore.bin"), "not shareable"); // 非白名单，应被忽略

    const files = readSkillDirFiles(srcDir);
    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "notes.md"]);

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

  // 2026-08-27：子目录闭环。此前 readSkillDirFiles 只读顶层、writeSkillImport 只写平铺，
  // 带 references/ 的技能导出一圈就被削平——生态里的技能大多带 references。
  it("round-trips subdirectories (references/ assets/) without flattening", () => {
    const srcDir = path.join(mkTmp(), "with-refs");
    fs.mkdirSync(path.join(srcDir, "references"), { recursive: true });
    fs.mkdirSync(path.join(srcDir, "assets"), { recursive: true });
    fs.mkdirSync(path.join(srcDir, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(srcDir, "SKILL.md"), "# body");
    fs.writeFileSync(path.join(srcDir, "references", "shots.md"), "shot list");
    fs.writeFileSync(path.join(srcDir, "assets", "tpl.txt"), "template");
    fs.writeFileSync(path.join(srcDir, "scripts", "build.md"), "should not travel"); // 可执行区不导出

    const files = readSkillDirFiles(srcDir);
    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "assets/tpl.txt", "references/shots.md"]);

    const validated = validateSkillPackage(buildSkillPackage("with-refs", files, 0));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const userRoot = mkTmp();
    const { dir } = writeSkillImport(userRoot, validated.pkg);
    expect(fs.readFileSync(path.join(dir, "references", "shots.md"), "utf8")).toBe("shot list");
    expect(fs.existsSync(path.join(dir, "scripts"))).toBe(false);
  });

  it("never writes outside the skill dir even if a crafted path slips through", () => {
    const userRoot = mkTmp();
    // 直接构造一个绕过 validate 的包（writeSkillImport 是最后一道，必须自己也拦住）
    const evil = buildSkillPackage("evil", { "SKILL.md": "b", "../../escaped.md": "pwn" }, 0);
    const { dir } = writeSkillImport(userRoot, evil);
    expect(fs.existsSync(path.join(dir, "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(path.dirname(path.dirname(userRoot)), "escaped.md"))).toBe(false);
  });
});

// 接缝测试：渲染层解析器产出的形状，主进程到底吃不吃。两边各自单测全绿、接缝错位的假绿栽过好几次
// （dead-selector / assert-you-are-in-the-situation），所以这条必须跨过边界真跑一遍。
describe("接缝：渲染层 zip 解析 → 主进程落地", () => {
  it("a real zip goes end-to-end: bytes → parse → normalize → validate → disk", async () => {
    const { zipSync, strToU8, unzipSync } = await import("fflate");
    const { packageFromZipEntries } = await import("../../src/workbench/skillLibrary/parseSkillImport");

    const md = "---\nname: brand.promo\ndescription: d\n---\n\n# body";
    const bytes = zipSync({
      "brand-promo/SKILL.md": strToU8(md),
      "brand-promo/references/shots.md": strToU8("镜头清单"),
      "brand-promo/logo.png": strToU8("binary-ish"),
    });

    const parsed = packageFromZipEntries(unzipSync(bytes), "brand-promo.zip");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.skipped).toEqual(["logo.png"]);

    // 渲染层不带 version —— 主进程负责盖戳（版本号单一真相源）
    expect((parsed.payload as Record<string, unknown>).version).toBeUndefined();
    const validated = validateSkillPackage(normalizeSkillImportInput(parsed.payload));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const userRoot = mkTmp();
    const { dir } = writeSkillImport(userRoot, validated.pkg);
    expect(fs.readFileSync(path.join(dir, "SKILL.md"), "utf8")).toContain("# body");
    expect(fs.readFileSync(path.join(dir, "references", "shots.md"), "utf8")).toBe("镜头清单");
    expect(fs.existsSync(path.join(dir, "logo.png"))).toBe(false);
  });

  it("a bare SKILL.md alone is enough to create a skill", async () => {
    const { packageFromMarkdown } = await import("../../src/workbench/skillLibrary/parseSkillImport");
    const parsed = packageFromMarkdown("anything.md", "---\nname: solo\ndescription: d\n---\n\n# 正文");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const validated = validateSkillPackage(normalizeSkillImportInput(parsed.payload));
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const userRoot = mkTmp();
    const { dirName, dir } = writeSkillImport(userRoot, validated.pkg);
    expect(dirName).toBe("solo");
    expect(fs.existsSync(path.join(dir, "SKILL.md"))).toBe(true);
  });
});

describe("normalizeSkillImportInput（裸文件表 → 带版本戳的包）", () => {
  it("stamps the current version onto a bare {dirName, files} payload", () => {
    const out = normalizeSkillImportInput({ dirName: "x", files: { "SKILL.md": "b" } }) as Record<string, unknown>;
    expect(out.version).toBe(SKILL_PACKAGE_VERSION);
    expect(validateSkillPackage(out).ok).toBe(true);
  });

  it("leaves an existing envelope untouched (so a foreign version still gets rejected)", () => {
    const foreign = { version: "someone-elses-v9", dirName: "x", files: { "SKILL.md": "b" } };
    expect(normalizeSkillImportInput(foreign)).toBe(foreign);
    expect(validateSkillPackage(foreign).ok).toBe(false);
  });
});
