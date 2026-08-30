import { describe, expect, it } from "vitest";
import { resolveCapabilityAlias } from "../../shared/agentCapabilities/registry";
import { agentToolCatalog, agentToolNames } from "./agentToolCatalog";

describe("Agent tool catalog", () => {
  it("keeps one discoverable model projection per tool name", () => {
    const allNames = Object.values(agentToolNames).flat();
    expect(new Set(allNames).size).toBe(allNames.length);
    expect(agentToolCatalog.canvas.map(({ name }) => name).slice(0, 4)).toEqual([
      "read_canvas_state",
      "propose_storyboard_plan",
      "arrange_storyboard_to_timeline",
      "create_staging_reference",
    ]);
    for (const descriptor of Object.values(agentToolCatalog).flat()) {
      expect(descriptor.name.trim()).not.toBe("");
      expect(descriptor.description.trim()).not.toBe("");
      expect(descriptor.parameters).toBeDefined();
    }
  });

  it("maps projected tools back to a canonical capability when one exists", () => {
    for (const descriptor of Object.values(agentToolCatalog).flat()) {
      const canonical = resolveCapabilityAlias(descriptor.name);
      if (canonical) expect(canonical.contract.id).toMatch(/\./);
    }
  });
});
