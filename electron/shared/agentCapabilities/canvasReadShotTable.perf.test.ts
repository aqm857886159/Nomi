import { describe, expect, it } from "vitest";

import { projectCanvasRead } from "./canvasRead";
import { formatCanvasForAgent } from "./canvasReadCompact";

// Worst-case projection correctness; wall-clock diagnostics do not belong in unit gates.
const ROWS = 200;
const LONG = "雨夜霓虹街口撑红伞的女孩".repeat(60);

function worstTableMeta(selected: string[]) {
  const builtin = ["shotSize", "motion", "visual", "dialogue", "onScreenText", "mood"];
  const custom = Array.from({ length: 10 }, (_, index) => `custom-${index}`);
  return {
    shotTable: {
      schemaVersion: 1, revision: 1, updatedAt: "2026-10-19T00:00:00.000Z",
      view: { selectedRowIds: selected, density: "auto" },
      source: { kind: "deconstruction", sourceNodeId: "video-0", title: "worst", status: "ready" },
      columnSetId: "facts",
      columns: [
        ...builtin.map((columnId, order) => ({ columnId, kind: "builtin", labelKey: columnId, order, visible: true })),
        ...custom.map((columnId, index) => ({ columnId, kind: "custom", labelKey: `自定义列${index}`, order: 6 + index, visible: true })),
      ],
      rows: Array.from({ length: ROWS }, (_, index) => ({
        rowId: `fact-${index + 1}`, order: index + 1, startSeconds: index, endSeconds: index + 1, durationSeconds: 1, carriedOver: false,
        cells: Object.fromEntries([...builtin, ...custom].map((columnId) => [columnId, `${columnId}-${index} ${LONG}`])),
        imagePrompt: `image-${index} ${LONG}`, motionPrompt: `motion-${index} ${LONG}`,
      })),
    },
  };
}

function worstCanvas() {
  const nodes: Record<string, unknown>[] = Array.from({ length: 198 }, (_, index) => ({
    id: index === 0 ? "video-0" : `node-${index}`, kind: index % 2 ? "image" : "video", title: `镜头 ${index}`,
    prompt: `prompt ${index} ${LONG}`, position: { x: index * 10, y: 0 },
  }));
  nodes.push({ id: "table-a", kind: "shot_table", title: "表 A", position: { x: 0, y: 900 }, meta: worstTableMeta(["fact-150", "fact-199"]) });
  nodes.push({ id: "table-b", kind: "shot_table", title: "表 B", position: { x: 0, y: 1800 }, meta: worstTableMeta([]) });
  return { nodes, edges: [], groups: [], selectedNodeIds: ["table-a"] };
}

describe("分镜表最坏规模读面", () => {
  it(`200 节点 + 两张 ${ROWS} 行 × 16 列的表保留投影和勾选镜头`, () => {
    const projected = projectCanvasRead(worstCanvas());
    expect(projected.nodes).toHaveLength(200);
    expect(projected.nodes.filter((node) => node.kind === "shot_table")).toHaveLength(2);
    expect(formatCanvasForAgent(projected)).toContain("镜 150 (fact-150)");
  });
});
