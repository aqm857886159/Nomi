import { describe, expect, it } from "vitest";

import {
  CanvasWriteEvidenceError,
  buildCanvasWriteAdmission,
  type CanvasWriteRawEvidence,
} from "./canvasWriteEvidence";
import { CANVAS_WRITE_MAX_PROMPT_CHARS } from "./canvasWrite";

function evidence(patch: Partial<CanvasWriteRawEvidence["node"]> = {}): CanvasWriteRawEvidence {
  return {
    node: {
      id: "node-real",
      kind: "image",
      title: "Opening shot",
      prompt: "old prompt",
      locked: false,
      categoryId: "shots",
      groupId: "group-a",
      model: {
        modelKey: "seedance-2",
        vendorKey: "volcengine",
        archetypeId: "seedance",
        modeId: "i2v",
        variantId: "pro",
      },
      currentResult: {
        id: "result-a",
        type: "video",
        taskId: "task-a",
        assetId: "asset-a",
        assetRefId: "asset-ref-a",
      },
      ...patch,
    },
    groups: [{ id: "group-a", categoryId: "shots", nodeIds: ["node-real", "node-other"] }],
  };
}

describe("canvas.write raw evidence admission", () => {
  it("derives canonical target and main-owned preconditions from raw evidence", () => {
    const admission = buildCanvasWriteAdmission(evidence());

    expect(admission.target).toEqual({ kind: "canvas", nodeIds: ["node-real"], groupIds: ["group-a"] });
    expect(admission.preconditions).toEqual({
      nodes: [{ nodeId: "node-real", contentHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/) }],
      groups: [{ groupId: "group-a", membershipHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/) }],
      results: [{ nodeId: "node-real", resultId: "result-a", pointerHash: expect.stringMatching(/^sha256-[a-f0-9]{64}$/) }],
    });
  });

  it.each([
    ["title", { title: "Changed title" }],
    ["prompt", { prompt: "changed prompt" }],
    ["lock", { locked: true }],
    ["model vendor", { model: { ...evidence().node.model, vendorKey: "kie" } }],
    ["model mode", { model: { ...evidence().node.model, modeId: "t2v" } }],
    ["model variant", { model: { ...evidence().node.model, variantId: "standard" } }],
    ["result pointer", { currentResult: { ...evidence().node.currentResult!, id: "result-b" } }],
    ["category", { categoryId: "cast" }],
  ] as const)("changes the node precondition when %s changes", (_label, patch) => {
    const baseline = buildCanvasWriteAdmission(evidence()).preconditions.nodes?.[0]?.contentHash;
    if (_label === "category") {
      expect(() => buildCanvasWriteAdmission(evidence(patch as Partial<CanvasWriteRawEvidence["node"]>)))
        .toThrowError(CanvasWriteEvidenceError);
      return;
    }
    const changed = buildCanvasWriteAdmission(evidence(patch as Partial<CanvasWriteRawEvidence["node"]>))
      .preconditions.nodes?.[0]?.contentHash;
    expect(changed).not.toBe(baseline);
  });

  it("fails closed on ambiguous or inconsistent two-sided group membership", () => {
    expect(() => buildCanvasWriteAdmission({
      ...evidence(),
      groups: [{ id: "group-a", categoryId: "shots", nodeIds: ["node-other"] }],
    })).toThrowError(expect.objectContaining({ code: "capability_target_stale" }));
    expect(() => buildCanvasWriteAdmission({
      ...evidence(),
      groups: [
        ...evidence().groups,
        { id: "group-b", categoryId: "shots", nodeIds: ["node-real"] },
      ],
    })).toThrowError(expect.objectContaining({ code: "capability_target_stale" }));
  });

  it("ignores unrelated members in the same group but bounds renderer-controlled evidence", () => {
    const baseline = buildCanvasWriteAdmission(evidence());
    const unrelatedMemberChanged = buildCanvasWriteAdmission({
      ...evidence(),
      groups: [{ id: "group-a", categoryId: "shots", nodeIds: ["node-real", "another-member"] }],
    });
    expect(unrelatedMemberChanged.preconditions).toEqual(baseline.preconditions);

    expect(() => buildCanvasWriteAdmission(evidence({
      prompt: "x".repeat(CANVAS_WRITE_MAX_PROMPT_CHARS + 1),
    }))).toThrowError(expect.objectContaining({ code: "capability_input_invalid" }));
  });
});
