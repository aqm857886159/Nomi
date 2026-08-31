import { describe, expect, it } from "vitest";

import {
  findSkillRecord,
  isSkillSelectableInWorkbench,
  isSkillVisibleTo,
  isSkillVisibleToMcp,
  listSkillSummaries,
  listSkillSummariesForMcp,
  normalizeSkillLookupKey,
  readSkillContent,
  readSkillContentForMcp,
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
    expect(readSkillContent("craft-camera", "mcp", records)?.name).toBe("craft.camera");
  });

  it("does not let external reads use the internal fuzzy-prefix lookup", () => {
    expect(readSkillContent(`${publicBuiltin.name}.extra`, "mcp", records)).toBeNull();
  });

  it("exposes the same user/private records only to a verified local MCP connection", () => {
    expect(isSkillVisibleToMcp(userClaimingMcp, "public")).toBe(false);
    expect(isSkillVisibleToMcp(userClaimingMcp, "local-authenticated")).toBe(true);
    expect(listSkillSummariesForMcp("local-authenticated", records)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: userClaimingMcp.name, contentHash: userClaimingMcp.contentHash }),
      ]),
    );
    expect(readSkillContentForMcp(userClaimingMcp.name, "local-authenticated", records)?.body).toContain("user.claim");
  });
});

describe("Workbench skill picker visibility", () => {
  it("shows creative built-ins and user skills while hiding implementation routing skills", () => {
    expect(isSkillSelectableInWorkbench(record("director.action", "director-action"))).toBe(true);
    expect(isSkillSelectableInWorkbench(record("writer.screenwriter", "writer-screenwriter"))).toBe(true);
    expect(isSkillSelectableInWorkbench(record("workbench.generation", "workbench-generation"))).toBe(false);
    expect(isSkillSelectableInWorkbench(record("creation-edit", "creation-edit"))).toBe(false);
    expect(isSkillSelectableInWorkbench(record("user.private", "user-private", { origin: "user" }))).toBe(true);
  });
});
