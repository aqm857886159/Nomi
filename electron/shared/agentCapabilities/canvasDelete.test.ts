import { describe, expect, it } from "vitest";

import {
  CANVAS_DELETE_CAPABILITY,
  canvasDeleteInputForAlias,
  canvasDeletePiInputSchema,
  canvasDeleteResultSchema,
} from "./canvasDelete";

describe("canvas.delete capability", () => {
  it("is a distinct destructive proposal contract", () => {
    expect(CANVAS_DELETE_CAPABILITY.effect).toBe("destructive");
    expect(CANVAS_DELETE_CAPABILITY.approval).toBe("proposal");
    expect(CANVAS_DELETE_CAPABILITY.execution.port).toBe("canvas");
    expect(canvasDeleteInputForAlias("delete_canvas_nodes", { nodeIds: ["node-1"] })).toEqual({
      operation: "delete_canvas_nodes",
      nodeIds: ["node-1"],
    });
  });

  it("requires one bounded unique node set", () => {
    expect(canvasDeletePiInputSchema.safeParse({ nodeIds: [] }).success).toBe(false);
    expect(canvasDeletePiInputSchema.safeParse({ nodeIds: ["node-1", "node-1"] }).success).toBe(false);
    expect(
      canvasDeletePiInputSchema.safeParse({ nodeIds: Array.from({ length: 25 }, (_, index) => `node-${index}`) }).success,
    ).toBe(false);
    expect(canvasDeletePiInputSchema.safeParse({ nodeIds: ["node-1"], extra: true }).success).toBe(false);
  });

  it("returns only exact deletion and reconciliation facts", () => {
    const result = {
      operation: "delete_canvas_nodes",
      applied: true,
      proposalId: "proposal-1",
      deletedNodeIds: ["node-1"],
      reconciliation: { ok: true, deviationCount: 0 },
    } as const;
    expect(canvasDeleteResultSchema.safeParse(result).success).toBe(true);
    expect(canvasDeleteResultSchema.safeParse({ ...result, undoState: "copied-shadow-owner" }).success).toBe(false);
  });
});
