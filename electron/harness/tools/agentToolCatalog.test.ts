import { describe, expect, it } from "vitest";
import { resolveCapabilityAlias } from "../../shared/agentCapabilities/registry";
import { agentToolCatalog, agentToolNames } from "./agentToolCatalog";

describe("Agent tool catalog", () => {
  it("keeps one discoverable model projection per tool name", () => {
    const allNames = Object.values(agentToolNames).flat();
    expect(new Set(allNames).size).toBe(allNames.length);
    expect(agentToolCatalog.generation.map(({ name }) => name)).toEqual([
      "nomi_generation_plan",
      "nomi_generation_status",
    ]);
    expect(allNames).toHaveLength(43);
    expect(allNames).not.toEqual(expect.arrayContaining([
      "nomi_operation_create",
      "nomi_submit_generation_plan",
      "nomi_preview_execution",
      "nomi_start_generation",
      "nomi_request_generation_gate",
    ]));
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
      expect(canonical, `missing canonical capability for ${descriptor.name}`).toBeDefined();
      expect(canonical?.contract.id).toMatch(/\./);
    }
  });

  it("marks the legacy production draft as non-generating and points concrete goals to the semantic plan", () => {
    const legacyStart = agentToolCatalog.production.find(({ name }) => name === "start_production_run");
    expect(legacyStart?.description).toContain("never generates media");
    expect(legacyStart?.description).toContain("generation plan intent");
    expect(legacyStart?.description).toContain("Host handles");
  });
});
