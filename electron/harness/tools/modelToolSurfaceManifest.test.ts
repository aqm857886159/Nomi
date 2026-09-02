import { describe, expect, it } from "vitest";

import {
  GENERATION_HOST_ONLY_TRANSITIONS,
  modelToolSurfaceManifest,
} from "./modelToolSurfaceManifest";
import { agentToolCatalog } from "./agentToolCatalog";

describe("M2 generation model tool surface", () => {
  it("projects the generation chain as two semantic intents", () => {
    expect(modelToolSurfaceManifest.generation.map(({ name }) => name)).toEqual([
      "nomi_generation_plan",
      "nomi_generation_status",
    ]);
    expect(agentToolCatalog.generation.map(({ name }) => name)).toEqual([
      "nomi_generation_plan",
      "nomi_generation_status",
    ]);
    expect(Object.values(agentToolCatalog).flat()).toHaveLength(43);
  });

  it("requires metadata and keeps Host-only transitions out of the model", () => {
    for (const descriptor of modelToolSurfaceManifest.generation) {
      expect(descriptor.intent).not.toBe("");
      expect(descriptor.capabilityRefs.length).toBeGreaterThan(0);
      expect(descriptor.inputSchema).toBeDefined();
      expect(descriptor.outputSchema).toBeDefined();
      expect(descriptor.risk).toMatch(/^(read|project_write|paid_external)$/);
      expect(descriptor.sideEffect).toMatch(/^(none|proposal|external)$/);
    }
    const modelNames = new Set<string>(modelToolSurfaceManifest.generation.map(({ name }) => name));
    for (const transition of GENERATION_HOST_ONLY_TRANSITIONS) {
      expect(modelNames.has(transition.name)).toBe(false);
    }
    expect([...modelNames]).not.toEqual(expect.arrayContaining([
      "nomi_request_generation_gate",
      "nomi_start_generation",
      "nomi_decide_generation_gate",
    ]));
  });
});
