import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { SkillManifest } from "./skillManifestSchema";
import { SKILL_PACKAGE_VERSION } from "./skillPackage";
import {
  discoverSkillRecordsFromRoots,
  findSkillRecord,
  isSkillSelectableInWorkbench,
  normalizeSkillLookupKey,
  type SkillRecord,
} from "./skillStore";

function manifest(partial: Partial<SkillManifest>): SkillManifest {
  return {
    version: "1.0.0",
    tools: [],
    requiredProviders: [],
    ...partial,
  };
}

function record(name: string, directoryName: string): SkillRecord {
  return {
    name,
    directoryName,
    filePath: `${directoryName}/SKILL.md`,
    description: "Test skill",
    body: "x",
    manifest: null,
    origin: "builtin",
    audience: "internal",
    packageVersion: SKILL_PACKAGE_VERSION,
    contentHash: "a".repeat(64),
  };
}

const records: SkillRecord[] = [
  record("workbench.generation", "workbench-generation"),
  record("workbench.storyboard.planner", "workbench-storyboard-planner"),
  record("brand.promo", "brand-promo"),
];

describe("normalizeSkillLookupKey", () => {
  it("normalizes camelCase / dots / underscores to kebab", () => {
    expect(normalizeSkillLookupKey("workbench.storyboard.planner")).toBe("workbench-storyboard-planner");
    expect(normalizeSkillLookupKey("brandPromo")).toBe("brand-promo");
  });
});

describe("findSkillRecord", () => {
  it("matches exact name first", () => {
    expect(findSkillRecord("brand.promo", "", records)?.name).toBe("brand.promo");
  });

  it("matches by prefix (e.g. creation mode key under a base skill name)", () => {
    expect(findSkillRecord("workbench-generation", "", records)?.name).toBe(
      "workbench.generation",
    );
  });

  it("falls back to normalized directory-name match", () => {
    expect(findSkillRecord("brand-promo", "", records)?.name).toBe("brand.promo");
  });

  it("returns null when nothing matches", () => {
    expect(findSkillRecord("does.not.exist", "nope", records)).toBeNull();
  });
});

describe("isSkillSelectableInWorkbench", () => {
  it("requires explicit opt-in for a built-in single-stage Skill", () => {
    expect(isSkillSelectableInWorkbench({
      ...record("workbench.storyboard.planner", "workbench-storyboard-planner"),
      manifest: manifest({ selectableInWorkbench: true }),
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("workbench-generation", "workbench-generation"),
      manifest: manifest({ selectableInWorkbench: false }),
    })).toBe(false);
  });

  it("keeps user Skills and existing multi-stage playbooks selectable, independent of MCP audience", () => {
    expect(isSkillSelectableInWorkbench({
      ...record("brand.promo", "brand-promo"),
      manifest: manifest({ stages: [{ id: "script", goal: "Write", tools: [] }] }),
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("user.skill", "user-skill"),
      origin: "user",
      manifest: null,
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("mcp.only", "mcp-only"),
      manifest: manifest({ audience: "mcp" }),
    })).toBe(false);
  });
});

describe("discoverSkillRecordsFromRoots", () => {
  // 2026-09-07：这条断言原来住在 `harness/runtime/pi/nomiSkillResources.test.ts`，
  // 但它测的一直是本文件的 owner（`skillStore.ts:181` 那条「损坏包不许占坑遮蔽」的注释就指它）。
  // 死模块删掉后断言搬到活 owner 旁边，内容逐字不变。
  it("does not let an invalid higher-priority package shadow a valid same-directory package", async () => {
    const root = await mkdtemp(join(tmpdir(), "nomi-skill-precedence-"));
    const broken = join(root, "broken");
    const valid = join(root, "valid");
    await mkdir(join(broken, "shared"), { recursive: true });
    await mkdir(join(valid, "shared"), { recursive: true });
    await writeFile(join(broken, "shared", "SKILL.md"), "---\nname: shared\ndescription: Broken\n---\n\0");
    await writeFile(join(valid, "shared", "SKILL.md"), "---\nname: shared\ndescription: Valid\n---\nUse me.");
    try {
      const discovered = discoverSkillRecordsFromRoots([
        { path: broken, origin: "builtin" },
        { path: valid, origin: "user" },
      ]);
      expect(discovered.records).toHaveLength(1);
      expect(discovered.records[0]).toMatchObject({ origin: "user", description: "Valid" });
      expect(discovered.diagnostics).toEqual([
        expect.objectContaining({ type: "warning", path: join(broken, "shared") }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
