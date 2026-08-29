import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../skills/skillStore", () => ({
  listSkillSummaries: vi.fn(() => []),
  readSkillContent: vi.fn(() => null),
}));

import { listSkillSummaries, readSkillContent } from "../skills/skillStore";
import { dispatch } from "./dispatcher";

describe("Skill dispatcher audience authority", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hardcodes MCP audience for list and ignores caller-supplied audience", async () => {
    await dispatch("skills.list", { audience: "internal" }, {} as never);
    expect(listSkillSummaries).toHaveBeenCalledWith("mcp");
  });

  it("hardcodes MCP audience and version identity for read", async () => {
    await dispatch("skills.read", {
      audience: "internal",
      directoryName: "director-camera",
      packageVersion: "nomi-skill-v1",
      contentHash: "a".repeat(64),
    }, {} as never);
    expect(readSkillContent).toHaveBeenCalledWith(
      "director-camera",
      "mcp",
      undefined,
      { packageVersion: "nomi-skill-v1", contentHash: "a".repeat(64) },
    );
  });
});
