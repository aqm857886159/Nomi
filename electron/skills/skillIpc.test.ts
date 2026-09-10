import { describe, expect, it, vi } from "vitest";

import type { SkillManifest } from "./skillManifestSchema";
import { SKILL_PACKAGE_VERSION } from "./skillPackage";
import type { SkillRecord } from "./skillStore";
import { listSkillsForRenderer } from "./skillIpc";

const manifest = (partial: Partial<SkillManifest>): SkillManifest => ({
  version: "1.0.0",
  tools: [],
  requiredProviders: [],
  ...partial,
});

const record = (partial: Partial<SkillRecord>): SkillRecord => ({
  name: "test.skill",
  directoryName: "test-skill",
  filePath: "/tmp/test-skill/SKILL.md",
  description: "Test skill",
  body: "Use the test skill.",
  manifest: manifest({}),
  origin: "builtin",
  audience: "internal",
  packageVersion: SKILL_PACKAGE_VERSION,
  contentHash: "a".repeat(64),
  ...partial,
});

vi.mock("./skillStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skillStore")>();
  return { ...actual, readSkillRecords: vi.fn() };
});

describe("listSkillsForRenderer", () => {
  it("projects declared media and the body through the renderer boundary, without inventing a cover for legacy Skills", async () => {
    const { readSkillRecords } = await import("./skillStore");
    const { readSkillCuration } = await import("../shared/skillCuration");
    const { parseSkillFrontmatter } = await import("./skillFrontmatter");
    const fs = await import("node:fs");
    const source = fs.readFileSync("skills/curated-multi-view/SKILL.md", "utf8");
    const curation = readSkillCuration(parseSkillFrontmatter(source).values);
    vi.mocked(readSkillRecords).mockReturnValue([
      record({ directoryName: "curated-multi-view", curation, body: source, manifest: manifest({ selectableInWorkbench: true }) }),
      record({ name: "external", origin: "user" }),
    ]);
    const [curated, external] = listSkillsForRenderer();
    expect(curated.cover).toBe("nomi-local://skill-preview/curated-multi-view");
    expect(curated.preview).toEqual({ url: curated.cover, type: "image" });
    expect(curated.body).toBe(source);
    expect(curated.curation?.license).toBe("Apache-2.0");
    expect(external.cover).toBeUndefined();
    expect(external.preview).toBeUndefined();
  });
  it("projects an explicitly selectable single-stage storyboard Skill into the real renderer DTO", async () => {
    const { readSkillRecords } = await import("./skillStore");
    vi.mocked(readSkillRecords).mockReturnValue([
      record({
        name: "workbench-storyboard-planner",
        directoryName: "workbench-storyboard-planner",
        manifest: manifest({ selectableInWorkbench: true }),
      }),
      record({
        name: "workbench-generation",
        directoryName: "workbench-generation",
        manifest: manifest({}),
      }),
    ]);

    expect(listSkillsForRenderer().map((skill) => skill.name)).toEqual([
      "workbench-storyboard-planner",
    ]);
  });

  it("keeps user Skills and existing playbooks visible while excluding malformed or routing-only built-ins", async () => {
    const { readSkillRecords } = await import("./skillStore");
    vi.mocked(readSkillRecords).mockReturnValue([
      record({ name: "brand-promo", manifest: manifest({ stages: [{ id: "script", goal: "Write", tools: [] }] }) }),
      record({ name: "workbench-broken", manifest: null, manifestError: "invalid metadata.nomi" }),
      record({ name: "workbench-routing", manifest: manifest({}) }),
      record({ name: "user-skill", origin: "user", manifest: null, manifestError: "invalid metadata.nomi" }),
      record({ name: "wrong-scope", manifest: manifest({ audience: "mcp" }) }),
    ]);

    expect(listSkillsForRenderer().map((skill) => skill.name)).toEqual([
      "brand-promo",
      "user-skill",
    ]);
    expect(listSkillsForRenderer().find((skill) => skill.name === "user-skill")).toMatchObject({
      origin: "user",
      manifestError: "invalid metadata.nomi",
    });
  });
});
