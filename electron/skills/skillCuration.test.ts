import * as runtimePaths from "../runtimePaths";
import { resolveSkillPreview } from "./skillPreview";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { parseSkillFrontmatter, readSkillFrontmatterIdentity } from "./skillFrontmatter";
import { readSkillCuration } from "../shared/skillCuration";
import { discoverSkillRecordsFromRoots, isSkillSelectableInWorkbench } from "./skillStore";
import { buildSkillPackage, validateSkillPackage, readSkillDirFiles, exportSkillPackageByName } from "./skillPackage";
import { getCuratedPrompts } from "../promptLibrary/curatedPrompts";

const root = path.resolve(__dirname, "../..");
const read = (relative: string): string => fs.readFileSync(path.join(root, relative), "utf8");
function rewrite(source: string, mutate: (front: Record<string, unknown>) => void): string {
  const front = parseSkillFrontmatter(source).values;
  mutate(front);
  return `---\n${yaml.dump(front)}---\n${source.replace(/^---\n[\s\S]*?\n---\n/, "")}`;
}

describe("curated Skill and effect intake", () => {
  it("resolves a real media file for every bundled Skill, including legacy knowledge packs", () => {
    const { records } = discoverSkillRecordsFromRoots([{ path: path.join(root, 'skills'), origin: 'builtin' }])
    expect(records).toHaveLength(88)
    for (const record of records) {
      expect(record.manifestError, record.directoryName).toBeUndefined()
      expect(record.curation?.preview, record.directoryName).toBeDefined()
      expect(fs.statSync(path.join(path.dirname(record.filePath), record.curation!.preview!.path)).size).toBeGreaterThan(0)
    }
  })

  it("explicitly exposes all 48 curated Skills through the existing Workbench opt-in policy", () => {
    const { records } = discoverSkillRecordsFromRoots([{ path: path.join(root, 'skills'), origin: 'builtin' }])
    const library = records.filter(record => record.curation?.kind === 'skill')
    expect(library).toHaveLength(48)
    expect(library.filter(isSkillSelectableInWorkbench).map(record => record.name).sort()).toEqual(library.map(record => record.name).sort())
  })

  it("accepts the repository's declared AGPL license without relabeling first-party cover metadata", () => {
    const front = parseSkillFrontmatter(read('skills/curated-multi-view/SKILL.md')).values
    front.license = JSON.parse(read('package.json')).license
    expect(readSkillCuration(front)?.license).toBe('AGPL-3.0-only')
  })

  it.each(["tests/fixtures/standard-formats/agent-skill/SKILL.md", "tests/fixtures/standard-formats/agent-skill/anthropic-algorithmic-art.md"])("reads unmodified official sample %s", (file) => {
    const source = read(file);
    expect(readSkillFrontmatterIdentity(source).error).toBeUndefined();
    expect(validateSkillPackage(buildSkillPackage("official", { "SKILL.md": source }, 0)).ok).toBe(true);
  });

  for (const dir of ["curated-multi-view", "effect-character-three-view"]) {
    const source = read(`skills/${dir}/SKILL.md`);
    it(`${dir}: rejects missing redistribution license through the real importer`, () => {
      const broken = rewrite(source, (front) => { delete front.license; });
      expect(validateSkillPackage(buildSkillPackage(dir, { "SKILL.md": broken }, 0)).ok).toBe(false);
    });
    it(`${dir}: rejects unsupported node applicability`, () => {
      const broken = rewrite(source, (front) => {
        const metadata = front.metadata as { nomi: { library: { appliesTo: string[] } } };
        metadata.nomi.library.appliesTo = ["audio"];
      });
      expect(validateSkillPackage(buildSkillPackage(dir, { "SKILL.md": broken }, 0)).ok).toBe(false);
    });
    it(`${dir}: rejects a preview escaping its own package`, () => {
      const broken = rewrite(source, (front) => {
        const metadata = front.metadata as { nomi: { library: { preview: unknown } } };
        metadata.nomi.library.preview = { path: "assets/../../private.png", type: "image", provenance: "illustration" };
      });
      expect(validateSkillPackage(buildSkillPackage(dir, { "SKILL.md": broken }, 0)).ok).toBe(false);
    });
  }

  it("discovers 48 Skills and projects 40 effects from the same packages", () => {
    const { records } = discoverSkillRecordsFromRoots([{ path: path.join(root, "skills"), origin: "builtin" }]);
    expect(records.filter((record) => record.curation?.kind === "skill")).toHaveLength(48);
    const prompts = getCuratedPrompts(records);
    expect(prompts).toHaveLength(40);
    expect(new Set(prompts.map((prompt) => prompt.id)).size).toBe(40);
    for (const record of records.filter((record) => record.curation)) {
      expect(record.manifestError, record.directoryName).toBeUndefined();
      const item = readSkillCuration(parseSkillFrontmatter(record.body).values)!;
      for (const slot of item.slots) expect(record.body).toContain(slot.token);
      if (item.preview) expect(fs.existsSync(path.join(path.dirname(record.filePath), item.preview.path))).toBe(true);
    }
    const record = records.find((item) => item.directoryName === "effect-character-three-view")!;
    const changed = { ...record, body: record.body.replace("纯白背景", "中性背景") };
    expect(getCuratedPrompts([changed])[0].prompt).toContain("中性背景");
    expect(getCuratedPrompts([{ ...changed, origin: "user" }])).toEqual([]);
  });
});

it("rejects a declared binary preview omitted by the text transport", () => {
  const dir = "curated-multi-view";
  const files = readSkillDirFiles(path.join(root, "skills", dir));
  expect(files["assets/preview.jpg"]).toBeUndefined();
  expect(validateSkillPackage(buildSkillPackage(dir, files, 0)).ok).toBe(false);
});
it("projects a preview address independent of dev or packaged renderer location", () => {
  const { records } = discoverSkillRecordsFromRoots([{ path: path.join(root, "skills"), origin: "builtin" }]);
  const record = records.find((item) => item.directoryName === "curated-multi-view")!;
  const effect = { ...record, curation: { ...record.curation!, kind: "effect" as const } };
  const address = getCuratedPrompts([effect])[0].mediaUrl;
  for (const renderer of ["http://localhost:5198/", "file:///Applications/Nomi.app/Contents/Resources/app.asar/dist/index.html"]) {
    expect(new URL(address, renderer).href).toBe("nomi-local://skill-preview/curated-multi-view");
  }
});

it("never exports a text envelope with dangling media declarations", () => {
  const roots = vi.spyOn(runtimePaths, "getSkillsRoots").mockReturnValue([path.join(root, "skills")]);
  try {
    expect(exportSkillPackageByName("curated-multi-view", 0)).toBeNull();
    expect(exportSkillPackageByName("effect-character-three-view", 0)).toBeNull();
  } finally { roots.mockRestore(); }
});
it("refuses user media and symlinks outside a skill, including packaged directory layouts", () => {
  const { records } = discoverSkillRecordsFromRoots([{ path: path.join(root, "skills"), origin: "builtin" }]);
  const record = records.find((item) => item.directoryName === "curated-multi-view")!;
  expect(resolveSkillPreview([record.directoryName], [{ ...record, origin: "user" }])).toBeNull();
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "curated-preview-"));
  try {
    const dir = path.join(temp, "app.asar", "skills", record.directoryName);
    fs.mkdirSync(path.join(dir, "assets"), { recursive: true });
    const outside = path.join(temp, "secret.jpg");
    fs.writeFileSync(outside, "not allowed");
    const media = path.join(dir, record.curation!.preview!.path);
    fs.symlinkSync(outside, media);
    const fixture = { ...record, filePath: path.join(dir, "SKILL.md") };
    expect(resolveSkillPreview([record.directoryName], [fixture])).toBeNull();
    fs.unlinkSync(media);
    fs.writeFileSync(media, "declared output");
    expect(resolveSkillPreview([record.directoryName], [fixture])?.filePath).toBe(fs.realpathSync(media));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
