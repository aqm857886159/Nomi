import { describe, expect, it } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";

import {
  CANVAS_WRITE_ALIASES,
  CANVAS_WRITE_CAPABILITY,
  CANVAS_WRITE_OPERATION_ALIASES,
  CANVAS_WRITE_MAX_PROMPT_CHARS,
  canvasWritePiInputSchemaForAlias,
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
      additionalAliases: {
        pi: ["create_canvas_nodes", "connect_canvas_edges", "tidy_canvas"],
      },
      inputSchema: canvasWriteSemanticInputSchema,
      outputSchema: canvasWriteResultSchema,
      effect: "reversible_write",
      execution: { port: "canvas", availability: "renderer_required" },
      exposure: "internal_only",
      requiredScope: "canvas:write",
      targetKind: "canvas",
      approval: "proposal",
      projections: {
        pi: { description: "Propose an exact, reversible prompt update to one generation canvas node." },
      },
    });
    expect(CANVAS_WRITE_CAPABILITY.aliases).not.toHaveProperty("mcp");
  });

  it("accepts the strict reversible operation union", () => {
    expect(
      canvasWriteSemanticInputSchema.parse({
        operation: "set_node_prompt",
        nodeId: "  node-a  ",
        prompt: "new prompt",
      }),
    ).toEqual({ operation: "set_node_prompt", nodeId: "node-a", prompt: "new prompt" });

    const whitespacePrompt = canvasWriteSemanticInputSchema.parse({
      operation: "set_node_prompt",
      nodeId: "node-a",
      prompt: "  preserve prompt whitespace  ",
    });
    expect(whitespacePrompt.operation).toBe("set_node_prompt");
    if (whitespacePrompt.operation !== "set_node_prompt") throw new Error("Expected prompt operation");
    expect(whitespacePrompt.prompt).toBe("  preserve prompt whitespace  ");

    expect(
      canvasWriteSemanticInputSchema.safeParse({
        operation: "set_node_prompt",
        nodeId: "node-a",
        prompt: "x".repeat(CANVAS_WRITE_MAX_PROMPT_CHARS),
      }).success,
    ).toBe(true);
    expect(
      canvasWriteSemanticInputSchema.safeParse({
        operation: "set_node_prompt",
        nodeId: "node-a",
        prompt: "x".repeat(CANVAS_WRITE_MAX_PROMPT_CHARS + 1),
      }).success,
    ).toBe(false);

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
    expect(
      canvasWriteSemanticInputSchema.safeParse({
        operation: "create_canvas_nodes",
        summary: "Add two shots",
        nodes: [{ clientId: "n1", kind: "image", title: "Shot 1", prompt: "wide shot" }],
        edges: [],
      }).success,
    ).toBe(true);
    expect(
      canvasWriteSemanticInputSchema.safeParse({
        operation: "connect_canvas_edges",
        edges: [{ sourceClientId: "node-a", targetClientId: "node-b", mode: "reference" }],
      }).success,
    ).toBe(true);
    expect(canvasWriteSemanticInputSchema.safeParse({ operation: "tidy_canvas", categoryId: "shots" }).success).toBe(
      true,
    );
  });

  it("keeps create/connect bounds and confirmation guidance on canonical Pi projections", () => {
    const createSchema = canvasWritePiInputSchemaForAlias("create_canvas_nodes");
    const connectSchema = canvasWritePiInputSchemaForAlias("connect_canvas_edges");
    expect(createSchema).toBeDefined();
    expect(connectSchema).toBeDefined();

    const node = { clientId: "n1", kind: "image", title: "Shot 1", prompt: "A still frame" };
    expect(createSchema?.safeParse({ summary: "ok", nodes: [node] }).success).toBe(true);
    expect(createSchema?.safeParse({ summary: "ok", nodes: [] }).success).toBe(false);
    expect(
      createSchema?.safeParse({
        summary: "ok",
        nodes: Array.from({ length: 25 }, (_, i) => ({ ...node, clientId: `n${i}` })),
      }).success,
    ).toBe(false);
    expect(connectSchema?.safeParse({ edges: [{ sourceClientId: "n1", targetClientId: "n2" }] }).success).toBe(true);
    expect(connectSchema?.safeParse({ edges: [] }).success).toBe(false);
    expect(
      connectSchema?.safeParse({
        edges: Array.from({ length: 49 }, (_, i) => ({ sourceClientId: `s${i}`, targetClientId: `t${i}` })),
      }).success,
    ).toBe(false);

    const wire = JSON.parse(JSON.stringify(zodToJsonSchema(createSchema!, { $refStrategy: "none" }))) as {
      required?: string[];
      properties?: Record<string, { description?: string }>;
    };
    expect(wire.required).toEqual(expect.arrayContaining(["summary", "nodes"]));
    expect(wire.properties?.summary?.description).toContain("shown to the user before confirmation");
    expect(wire.properties?.edges?.description).toContain("same call");
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
    expect(
      canvasWriteResultSchema.safeParse({ ...result, reconciliation: { ok: false, deviationCount: -1 } }).success,
    ).toBe(false);
  });

  it("maps only the Registry-owned Pi operation aliases", () => {
    expect(canvasWriteOperationForAlias(CANVAS_WRITE_ALIASES.setNodePrompt)).toBe("set_node_prompt");
    expect(canvasWriteOperationForAlias(CANVAS_WRITE_OPERATION_ALIASES.createCanvasNodes)).toBe("create_canvas_nodes");
    expect(canvasWriteOperationForAlias(CANVAS_WRITE_OPERATION_ALIASES.connectCanvasEdges)).toBe(
      "connect_canvas_edges",
    );
    expect(canvasWriteOperationForAlias(CANVAS_WRITE_OPERATION_ALIASES.tidyCanvas)).toBe("tidy_canvas");
    expect(canvasWriteOperationForAlias("nomi_set_node_prompt")).toBeUndefined();
  });
});
