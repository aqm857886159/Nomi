import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CANVAS_WRITE_CAPABILITY, canvasWritePiInputSchema } from "../shared/agentCapabilities/canvasWrite";
import { agentToolsForCapability } from "./agentChatPolicy";
import { canvasToolDescriptors } from "./tools/canvasDescriptors";

describe("Project Agent Pi capability projection", () => {
  it("projects canvas.write from the Registry and leaves no hand-written descriptor owner", () => {
    const tools = agentToolsForCapability("canvas-refine");
    expect(tools).toEqual([{
      name: CANVAS_WRITE_CAPABILITY.aliases.pi,
      description: CANVAS_WRITE_CAPABILITY.projections.pi.description,
      schema: canvasWritePiInputSchema,
    }]);
    expect(canvasWritePiInputSchema.safeParse({ nodeId: "node-a", prompt: "new prompt" }).success).toBe(true);
    expect(canvasToolDescriptors).not.toHaveProperty(CANVAS_WRITE_CAPABILITY.aliases.pi);

    const policySource = readFileSync(new URL("./agentChatPolicy.ts", import.meta.url), "utf8");
    const descriptorSource = readFileSync(new URL("./tools/canvasDescriptors.ts", import.meta.url), "utf8");
    expect(policySource).not.toContain("canvas.set_node_prompt");
    expect(descriptorSource).not.toContain("set_node_prompt");
  });
});
