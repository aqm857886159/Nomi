import { describe, expect, it } from "vitest";

import { findSkillRecord, isSkillSelectableInWorkbench, normalizeSkillLookupKey, type SkillRecord } from "./skillStore";

function record(name: string, directoryName: string): SkillRecord {
  return { name, directoryName, filePath: `${directoryName}/SKILL.md`, body: "x", manifest: null, origin: "builtin" };
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
    expect(findSkillRecord("workbench.generation.canvas-planner", "", records)?.name).toBe(
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
      manifest: { selectableInWorkbench: true } as SkillRecord["manifest"],
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("workbench.generation.canvas-planner", "workbench-generation"),
      manifest: { selectableInWorkbench: false } as SkillRecord["manifest"],
    })).toBe(false);
  });

  it("keeps user Skills and existing multi-stage playbooks selectable, independent of MCP audience", () => {
    expect(isSkillSelectableInWorkbench({
      ...record("brand.promo", "brand-promo"),
      manifest: { stages: [{ id: "script", goal: "Write", tools: [] }] } as SkillRecord["manifest"],
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("user.skill", "user-skill"),
      origin: "user",
      manifest: null,
    })).toBe(true);
    expect(isSkillSelectableInWorkbench({
      ...record("mcp.only", "mcp-only"),
      manifest: { audience: "mcp" } as SkillRecord["manifest"],
    })).toBe(false);
  });
});
