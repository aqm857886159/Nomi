import { describe, expect, it } from "vitest";

import { buildSkillExecutionEvidence, skillRefsForStage } from "./skillExecutionEvidence";
import type { SkillManifest } from "./skillManifestSchema";

const manifest: SkillManifest = {
  version: "1.0.0",
  tools: [],
  requiredProviders: ["text", "image", "video"],
  stages: [
    { id: "script", goal: "write", tools: [], skillRefs: ["writer-screenwriter", "writer-dialogue"] },
    { id: "storyboard", goal: "shots", tools: [], skillRefs: ["director-shot-translation"] },
  ],
};

describe("skill execution evidence", () => {
  it("returns only the craft references declared for a stage", () => {
    expect(skillRefsForStage(manifest, "script")).toEqual(["writer-screenwriter", "writer-dialogue"]);
    expect(skillRefsForStage(manifest, "generate")).toEqual([]);
  });

  it("records only loaded declared skills and rejects missing declared skills", () => {
    expect(buildSkillExecutionEvidence(manifest, "script", [
      { name: "writer-screenwriter", version: "2.0.0" },
      { name: "writer-dialogue", version: "1.1.0" },
    ])).toEqual([
      { name: "writer-screenwriter", version: "2.0.0", stageId: "script" },
      { name: "writer-dialogue", version: "1.1.0", stageId: "script" },
    ]);
    expect(() => buildSkillExecutionEvidence(manifest, "script", [
      { name: "writer-screenwriter", version: "2.0.0" },
    ])).toThrow("writer-dialogue");
  });
});
