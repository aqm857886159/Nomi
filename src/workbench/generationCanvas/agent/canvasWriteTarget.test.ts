import { describe, expect, it } from "vitest";

import type { GenerationCanvasSnapshot } from "../model/generationCanvasTypes";
import { captureCanvasWriteRawEvidence } from "./canvasWriteTarget";

describe("canvas.write renderer evidence capture", () => {
  it("resolves an alias to the canonical node and excludes transient/provider state", () => {
    const snapshot: GenerationCanvasSnapshot = {
      nodes: [{
        id: "node-real",
        kind: "video",
        title: "Shot",
        position: { x: 10, y: 20 },
        size: { width: 300, height: 200 },
        prompt: "old prompt",
        locked: true,
        categoryId: "shots",
        groupId: "group-a",
        status: "running",
        progress: { updatedAt: 1, percent: 30 },
        meta: {
          modelKey: "seedance-2",
          modelVendor: "volcengine",
          archetype: { id: "seedance", modeId: "i2v", variantId: "pro" },
          unrelatedTransient: "do-not-copy",
        },
        result: {
          id: "result-a",
          type: "video",
          taskId: "task-a",
          assetId: "asset-a",
          assetRefId: "asset-ref-a",
          url: "nomi-local://mutable-localization",
          providerUrl: "https://provider.invalid/private",
          raw: { secret: true },
          createdAt: 1,
        },
      }],
      edges: [],
      selectedNodeIds: ["node-real"],
      groups: [{
        id: "group-a",
        name: "Shots",
        categoryId: "shots",
        nodeIds: ["node-real"],
        color: "red",
        collapsed: true,
        createdAt: 1,
        updatedAt: 2,
      }],
    };

    expect(captureCanvasWriteRawEvidence(snapshot, "client-alias", () => "node-real")).toEqual({
      node: {
        id: "node-real",
        kind: "video",
        title: "Shot",
        prompt: "old prompt",
        locked: true,
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
      },
      groups: [{ id: "group-a", categoryId: "shots", nodeIds: ["node-real"] }],
    });
  });
});
