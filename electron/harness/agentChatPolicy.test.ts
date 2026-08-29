import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CANVAS_WRITE_CAPABILITY,
  canvasWritePiDescriptionForAlias,
  canvasWritePiInputSchema,
  canvasWritePiInputSchemaForAlias,
} from "../shared/agentCapabilities/canvasWrite";
import {
  CANVAS_DELETE_CAPABILITY,
  canvasDeletePiDescriptionForAlias,
  canvasDeletePiInputSchema,
} from "../shared/agentCapabilities/canvasDelete";
import { capabilityOperationAliasesFor } from "../shared/agentCapabilities/registry";
import { agentToolsForCapability } from "./agentChatPolicy";
import { canvasToolDescriptors } from "./tools/canvasDescriptors";

describe("Project Agent Pi capability projection", () => {
  it("projects canvas.write from the Registry and leaves no hand-written descriptor owner", () => {
    const tools = agentToolsForCapability("canvas-refine");
    expect(tools).toEqual([
      {
        name: CANVAS_WRITE_CAPABILITY.aliases.pi,
        description: CANVAS_WRITE_CAPABILITY.projections.pi.description,
        schema: canvasWritePiInputSchema,
      },
    ]);
    expect(canvasWritePiInputSchema.safeParse({ nodeId: "node-a", prompt: "new prompt" }).success).toBe(true);
    expect(canvasToolDescriptors).not.toHaveProperty(CANVAS_WRITE_CAPABILITY.aliases.pi);

    const aliases = [
      CANVAS_WRITE_CAPABILITY.aliases.pi,
      ...capabilityOperationAliasesFor(CANVAS_WRITE_CAPABILITY.id, "pi"),
    ];
    const canvasAgentTools = agentToolsForCapability("canvas-agent");
    for (const alias of aliases) {
      expect(canvasAgentTools).toContainEqual({
        name: alias,
        description: canvasWritePiDescriptionForAlias(alias),
        schema: canvasWritePiInputSchemaForAlias(alias),
      });
      expect(canvasToolDescriptors).not.toHaveProperty(alias);
    }
    expect(canvasAgentTools).toContainEqual({
      name: CANVAS_DELETE_CAPABILITY.aliases.pi,
      description: canvasDeletePiDescriptionForAlias(CANVAS_DELETE_CAPABILITY.aliases.pi),
      schema: canvasDeletePiInputSchema,
    });
    expect(canvasToolDescriptors).not.toHaveProperty(CANVAS_DELETE_CAPABILITY.aliases.pi);
    expect(canvasDeletePiInputSchema.parse({ nodeIds: ["obsolete-shot"], reason: "Removed by the creator" }))
      .toEqual({ nodeIds: ["obsolete-shot"], reason: "Removed by the creator" });
    expect(tools.map(({ name }) => name)).toEqual([CANVAS_WRITE_CAPABILITY.aliases.pi]);

    const policySource = readFileSync(new URL("./agentChatPolicy.ts", import.meta.url), "utf8");
    const descriptorSource = readFileSync(new URL("./tools/canvasDescriptors.ts", import.meta.url), "utf8");
    expect(policySource).not.toContain("canvas.set_node_prompt");
    expect(descriptorSource).not.toContain("set_node_prompt");
    expect(descriptorSource).not.toContain("delete_canvas_nodes");
  });
});
