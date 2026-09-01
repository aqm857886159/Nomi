import { describe, expect, it } from "vitest";

import { buildCanvasDeleteAdmission } from "./canvasDeleteEvidence";

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    nodes: [
      {
        id: "node-1",
        kind: "image",
        title: "Shot",
        prompt: "prompt",
        locked: false,
        categoryId: "shots",
        groupId: "group-1",
        position: { x: 0, y: 0 },
        model: { modelKey: "model-1", vendorKey: "vendor-1", archetypeId: null, modeId: null, variantId: null },
        currentResult: { id: "result-1", type: "image", assetId: "asset-1" },
      },
      {
        id: "node-2",
        kind: "image",
        title: "Reference",
        prompt: "reference",
        locked: false,
        categoryId: "shots",
        groupId: "group-1",
        position: { x: 100, y: 0 },
        model: { modelKey: null, vendorKey: null, archetypeId: null, modeId: null, variantId: null },
        currentResult: null,
      },
    ],
    edges: [{ id: "edge-1", source: "node-2", target: "node-1", mode: "reference" }],
    groups: [{ id: "group-1", categoryId: "shots", nodeIds: ["node-1", "node-2"] }],
    resolvedReferences: [{ requestedId: "client-1", nodeId: "node-1" }],
    ...overrides,
  };
}

const input: { operation: "delete_canvas_nodes"; nodeIds: string[] } = {
  operation: "delete_canvas_nodes",
  nodeIds: ["client-1"],
};

describe("canvas.delete exact admission", () => {
  it("freezes node, result, membership, and edge relations", () => {
    const admission = buildCanvasDeleteAdmission(evidence(), input);
    expect(admission.target).toEqual({ kind: "canvas", nodeIds: ["node-1"], groupIds: ["group-1"] });
    expect(admission.preconditions.nodes).toHaveLength(1);
    expect(admission.preconditions.results).toHaveLength(1);
    expect(admission.preconditions.groups).toHaveLength(1);
    expect(admission.preconditions.edges).toHaveLength(1);
  });

  it("rejects missing, duplicate, locked, and inconsistent targets", () => {
    expect(() => buildCanvasDeleteAdmission(evidence({ resolvedReferences: [] }), input)).toThrow(
      /capability_target_stale/,
    );
    expect(() =>
      buildCanvasDeleteAdmission(
        evidence({ resolvedReferences: [{ requestedId: "client-1", nodeId: "node-2" }, { requestedId: "client-1", nodeId: "node-1" }] }),
        input,
      ),
    ).toThrow(/capability_target_stale/);
    const locked = evidence();
    (locked.nodes[0] as { locked: boolean }).locked = true;
    expect(() => buildCanvasDeleteAdmission(locked, input)).toThrow(/capability_target_stale/);
    expect(() => buildCanvasDeleteAdmission(evidence({ groups: [] }), input)).toThrow(/capability_target_stale/);
  });
});
