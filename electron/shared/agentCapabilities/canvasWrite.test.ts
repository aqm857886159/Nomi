import { describe, expect, it } from "vitest";

import {
  CANVAS_WRITE_ALIASES,
  CANVAS_WRITE_CAPABILITY,
  canvasWriteResultSchema,
  canvasWriteSemanticInputSchema,
  canvasWriteOperationForAlias,
} from "./canvasWrite";

describe("canvas.write canonical contract", () => {
  it("owns set_node_prompt as an internal reversible proposal capability", () => {
    expect(CANVAS_WRITE_CAPABILITY).toEqual({
      id: "canvas.write",
      version: 1,
      aliases: { pi: "set_node_prompt" },
      inputSchema: canvasWriteSemanticInputSchema,
      outputSchema: canvasWriteResultSchema,
      effect: "reversible_write",
      execution: { port: "canvas", availability: "renderer_required" },
      exposure: "internal_only",
      requiredScope: "canvas:write",
      targetKind: "canvas",
      approval: "proposal",
      projections: {
        pi: { description: "Propose an exact, reversible update to a generation canvas node." },
      },
    });
    expect(CANVAS_WRITE_CAPABILITY.aliases).not.toHaveProperty("mcp");
  });

  it("accepts only the strict set_node_prompt semantic input", () => {
    expect(canvasWriteSemanticInputSchema.parse({
      operation: "set_node_prompt",
      nodeId: "  node-a  ",
      prompt: "new prompt",
    })).toEqual({ operation: "set_node_prompt", nodeId: "node-a", prompt: "new prompt" });

    expect(canvasWriteSemanticInputSchema.parse({
      operation: "set_node_prompt",
      nodeId: "node-a",
      prompt: "  preserve prompt whitespace  ",
    }).prompt).toBe("  preserve prompt whitespace  ");

    for (const rejected of [
      { operation: "set_node_prompt", nodeId: "", prompt: "new prompt" },
      { operation: "set_node_prompt", nodeId: "   ", prompt: "new prompt" },
      { operation: "set_node_prompt", nodeId: "node-a", prompt: "" },
      { operation: "set_node_prompt", nodeId: "node-a", prompt: "   " },
      { operation: "set_node_prompt", nodeId: "node-a", prompt: "new prompt", projectId: "project-a" },
      { operation: "delete_canvas_nodes", nodeId: "node-a", prompt: "new prompt" },
    ]) {
      expect(canvasWriteSemanticInputSchema.safeParse(rejected).success).toBe(false);
    }
  });

  it("projects a strict safe receipt without Canvas store objects", () => {
    const result = {
      applied: true,
      proposalId: "prop-a",
      operation: "set_node_prompt",
      affectedNodeIds: ["node-a"],
      reconciliation: { ok: true, deviationCount: 0 },
    } as const;
    expect(canvasWriteResultSchema.parse(result)).toEqual(result);
    expect(canvasWriteResultSchema.safeParse({ ...result, raw: { nodes: [] } }).success).toBe(false);
    expect(canvasWriteResultSchema.safeParse({ ...result, proposalId: "   " }).success).toBe(false);
    expect(canvasWriteResultSchema.safeParse({ ...result, affectedNodeIds: [] }).success).toBe(false);
    expect(canvasWriteResultSchema.safeParse({ ...result, affectedNodeIds: ["node-a", "node-b"] }).success).toBe(false);
    expect(canvasWriteResultSchema.safeParse({ ...result, affectedNodeIds: ["node-a", "node-a"] }).success).toBe(false);
    expect(canvasWriteResultSchema.safeParse({ ...result, reconciliation: { ok: false, deviationCount: -1 } }).success).toBe(false);
  });

  it("maps only the Registry-owned Pi alias", () => {
    expect(canvasWriteOperationForAlias(CANVAS_WRITE_ALIASES.setNodePrompt)).toBe("set_node_prompt");
    expect(canvasWriteOperationForAlias("nomi_set_node_prompt")).toBeUndefined();
  });
});
