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
      aliases: { pi: "set_node_prompt", mcp: "nomi_canvas_edit" },
      additionalAliases: {
        pi: [
          "create_canvas_nodes",
          "connect_canvas_edges",
          "tidy_canvas",
          "propose_storyboard_plan",
          "arrange_storyboard_to_timeline",
          "create_staging_reference",
          "create_camera_move",
        ],
      },
      inputSchema: canvasWriteSemanticInputSchema,
      outputSchema: canvasWriteResultSchema,
      effect: "reversible_write",
      execution: { port: "canvas", availability: "renderer_required" },
      exposure: "mcp_safe",
      requiredScope: "canvas:write",
      targetKind: "canvas",
      approval: "proposal",
      projections: {
        pi: { description: "Propose an exact, reversible prompt update to one generation canvas node." },
        mcp: { description: "Propose a validated, reversible canvas edit from current intent." },
      },
    });
    expect(CANVAS_WRITE_CAPABILITY.aliases.mcp).toBe("nomi_canvas_edit");
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
    // The resident generation editor returns the explicit model identity that
    // the user selected. These are capability fields (not renderer-only
    // decoration): re-preparing an approved proposal must accept them so the
    // selected vendor/variant can reach the canvas domain owner.
    expect(
      createSchema?.safeParse({
        summary: "Use the selected generation model",
        nodes: [{ ...node, vendor: "apimart", variantId: "mini" }],
      }).success,
    ).toBe(true);
    expect(
      createSchema?.safeParse({
        summary: "Reject contradictory provider aliases",
        nodes: [{ ...node, vendor: "apimart", modelVendor: "kie" }],
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

  it("keeps storyboard-side tools inside the canonical executable capability", () => {
    const plan = canvasWritePiInputSchemaForAlias("propose_storyboard_plan");
    const arrange = canvasWritePiInputSchemaForAlias("arrange_storyboard_to_timeline");
    const staging = canvasWritePiInputSchemaForAlias("create_staging_reference");
    const camera = canvasWritePiInputSchemaForAlias("create_camera_move");
    expect(plan?.safeParse({ title: "猫", anchors: [], shots: [{ index: 1 }] }).success).toBe(true);
    expect(arrange?.safeParse({ nodeIds: ["shot-1"] }).success).toBe(true);
    expect(staging?.safeParse({ characters: [{ name: "猫" }] }).success).toBe(true);
    expect(camera?.safeParse({ shotClientId: "shot-1", move: "push_in" }).success).toBe(true);
    expect(canvasWriteOperationForAlias("propose_storyboard_plan")).toBe("propose_storyboard_plan");
    expect(canvasWriteOperationForAlias("arrange_storyboard_to_timeline")).toBe("arrange_storyboard_to_timeline");
    expect(canvasWriteOperationForAlias("create_staging_reference")).toBe("create_staging_reference");
    expect(canvasWriteOperationForAlias("create_camera_move")).toBe("create_camera_move");
    expect(plan?.safeParse({ title: "猫", anchors: [], shots: [{ index: 1 }], extra: true }).success).toBe(false);
    expect(camera?.safeParse({ shotClientId: "shot-1" }).success).toBe(false);
  });
});
