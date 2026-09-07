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
