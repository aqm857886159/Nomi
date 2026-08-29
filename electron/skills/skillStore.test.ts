import { describe, expect, it } from "vitest";

import {
  findSkillRecord,
  isSkillVisibleTo,
  listSkillSummaries,
  normalizeSkillLookupKey,
  readSkillContent,
  type SkillRecord,
} from "./skillStore";

function record(
  name: string,
  directoryName: string,
  overrides: Partial<SkillRecord> = {},
): SkillRecord {
  return {
    name,
    directoryName,
    filePath: `${directoryName}/SKILL.md`,
    description: `${name} description`,
    body: `${name} body`,
    manifest: null,
    origin: "builtin",
    audience: "internal",
    packageVersion: "nomi-skill-v1",
    contentHash: "a".repeat(64),
    ...overrides,
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

describe("Skill audience visibility", () => {
  const publicBuiltin = record("craft.camera", "arbitrary-public-name", { audience: "mcp" });
  const hiddenPrefixed = record("internal.director", "director-hidden", { audience: "internal" });
  const userClaimingMcp = record("user.claim", "writer-user-claim", { origin: "user", audience: "mcp" });
  const records = [publicBuiltin, hiddenPrefixed, userClaimingMcp];

  it("uses explicit audience and origin rather than a directory prefix", () => {
    expect(isSkillVisibleTo(publicBuiltin, "mcp")).toBe(true);
    expect(isSkillVisibleTo(hiddenPrefixed, "mcp")).toBe(false);
    expect(isSkillVisibleTo(userClaimingMcp, "mcp")).toBe(false);
    expect(isSkillVisibleTo(userClaimingMcp, "internal")).toBe(true);
  });

  it("applies the same guard to list and exact read", () => {
    expect(listSkillSummaries("mcp", records)).toEqual([
      expect.objectContaining({
        name: publicBuiltin.name,
        directoryName: publicBuiltin.directoryName,
        packageVersion: "nomi-skill-v1",
        contentHash: "a".repeat(64),
      }),
    ]);
    expect(readSkillContent(publicBuiltin.directoryName, "mcp", records)?.body).toContain("craft.camera");
    expect(readSkillContent(hiddenPrefixed.directoryName, "mcp", records)).toBeNull();
    expect(readSkillContent(userClaimingMcp.name, "mcp", records)).toBeNull();
  });

  it("does not let external reads use the internal fuzzy-prefix lookup", () => {
    expect(readSkillContent(`${publicBuiltin.name}.extra`, "mcp", records)).toBeNull();
  });
});
