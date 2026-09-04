import { describe, expect, it } from "vitest";

import { listSkillsForRenderer } from "./skillIpc";
import { readSkillRecords } from "./skillStore";

describe("renderer Skill catalog projection", () => {
  it("exposes the built-in storyboard planner in the Agent Skill menu DTO", () => {
    const record = readSkillRecords().find((skill) => skill.name === "workbench.storyboard.planner");
    expect(record?.origin).toBe("builtin");
    expect(record?.name).toBe("workbench.storyboard.planner");

    const visible = listSkillsForRenderer();
    expect(visible.map((skill) => skill.name)).toContain("workbench.storyboard.planner");
  });
});
