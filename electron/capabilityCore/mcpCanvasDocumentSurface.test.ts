import { describe, expect, it } from "vitest";

import { deriveProjectSessionScopes } from "./projectSessionAuthority";
import { MCP_CAPABILITY_RESOLVER } from "./mcpCapabilityProjection";
import { normalizeSnapshot, connectNodes, deleteNodes, setNodePrompt } from "./canvasGraph";
import { projectCanvasRead } from "../shared/agentCapabilities/canvasRead";
import { canvasWriteResultSchema } from "../shared/agentCapabilities/canvasWrite";

describe("M2 canvas/document semantic MCP surface", () => {
  it("R1 exposes semantic canvas and document tools and no direct legacy canvas tools", () => {
    expect(MCP_CAPABILITY_RESOLVER.list().map((tool) => tool.name)).toEqual(expect.arrayContaining([
      "nomi_canvas_read",
      "nomi_canvas_plan",
      "nomi_canvas_edit",
      "nomi_canvas_maintenance",
      "nomi_document_read",
      "nomi_document_edit",
    ]));
    expect(MCP_CAPABILITY_RESOLVER.list().map((tool) => tool.name)).not.toEqual(expect.arrayContaining([
      "nomi_read_canvas",
      "nomi_add_nodes",
      "nomi_connect_nodes",
      "nomi_set_node_prompt",
      "nomi_delete_nodes",
    ]));
  });

  it("R2 grants the same session scope family used by read/write canvas and document tools", () => {
    const scopes = deriveProjectSessionScopes({
      snapshot: () => ({ flagEnabled: false, effectiveScope: [] }),
    } as never);
    expect(scopes).toEqual(expect.arrayContaining(["canvas:read", "canvas:write", "document:read", "document:write"]));
    for (const name of ["nomi_canvas_read", "nomi_canvas_plan", "nomi_canvas_edit", "nomi_canvas_maintenance", "nomi_document_read", "nomi_document_edit"]) {
      expect(MCP_CAPABILITY_RESOLVER.resolve(name)?.inputSchema.required).toContain("leaseHandle");
    }
  });

  it("R3 rejects an unknown node kind before a snapshot can be accepted", () => {
    expect(() => normalizeSnapshot({
      nodes: [{ id: "ghost-kind", kind: "hologram", title: "bad", position: { x: 0, y: 0 } }],
      edges: [],
    })).toThrow();
  });

  it("R7 rejects an unknown edge mode instead of silently downgrading it", () => {
    const snapshot = { nodes: [
      { id: "a", kind: "image", title: "A", position: { x: 0, y: 0 } },
      { id: "b", kind: "video", title: "B", position: { x: 0, y: 0 } },
    ], edges: [] };
    expect(() => connectNodes(snapshot, [{ source: "a", target: "b", mode: "hologram" }])).toThrow();
  });

  it("R8 makes ghost mutations explicit failures instead of changed=false/empty success", () => {
    const snapshot = { nodes: [], edges: [] };
    expect(() => setNodePrompt(snapshot, "missing", "prompt")).toThrow();
    expect(() => deleteNodes(snapshot, ["missing"])).toThrow();
  });

  it("R4/R5/R6 publish typed write receipts, destructive hints, and bounded reads", () => {
    const writeReceipt = { applied: true, proposalId: "proposal-1", operation: "set_node_prompt", affectedNodeIds: ["node-1"], reconciliation: { ok: true, deviationCount: 0 } };
    expect(canvasWriteResultSchema.safeParse(writeReceipt).success).toBe(true);
    expect(MCP_CAPABILITY_RESOLVER.resolve("nomi_canvas_maintenance")?.annotations).toEqual({ destructiveHint: true });
    const projected = projectCanvasRead({ nodes: [{ id: "n", kind: "text", prompt: "x".repeat(300_000) }], edges: [] });
    expect(projected.truncated).toBe(true);
    expect(projected.nodes[0]?.prompt.length).toBeLessThanOrEqual(8_192);
  });
});
