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
    expect(allNames).toHaveLength(33);
    expect(allNames).not.toEqual(expect.arrayContaining([
      "nomi_operation_create",
      "nomi_submit_generation_plan",
      "nomi_preview_execution",
      "nomi_start_generation",
      "nomi_request_generation_gate",
    ]));
    expect(agentToolCatalog.canvas.map(({ name }) => name).slice(0, 4)).toEqual([
      "nomi_canvas_read", "nomi_canvas_plan", "nomi_canvas_edit", "nomi_canvas_maintenance",
    ]);
    for (const descriptor of Object.values(agentToolCatalog).flat()) {
      expect(descriptor.name.trim()).not.toBe("");
      expect(descriptor.description.trim()).not.toBe("");
      expect(descriptor.parameters).toBeDefined();
    }
  });

  it("keeps semantic projections tied to canonical capability references", () => {
    for (const descriptor of Object.values(agentToolCatalog).flat()) {
      const canonical = resolveCapabilityAlias(descriptor.name);
      if (canonical) expect(canonical.contract.id).toMatch(/\./);
    }
  });

  it("marks the legacy production draft as non-generating and points concrete goals to the semantic plan", () => {
    const legacyStart = agentToolCatalog.production.find(({ name }) => name === "start_production_run");
    expect(legacyStart?.description).toContain("never generates media");
    expect(legacyStart?.description).toContain("generation plan intent");
    expect(legacyStart?.description).toContain("Host handles");
  });
});
