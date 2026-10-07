import { describe, expect, it } from "vitest";

import { canvasShotClaimCommandId, detachShotNodesCommandId, isProductionRunIdentifier } from "./productionRunCommandId";

// 造号与校验住在同一个模块：这里钉的是「造出来的号，主进程那道校验一定收」，不是某个固定写法。
describe("production run command ids", () => {
  const runs = ["op-e37e8de2-e776-45b8-af56-202792751f12", "run-1", "r".repeat(160), "a.b_c-d"];
  const nodeSets = [
    ["gen-v2-video-mumbjiki-yuqt"],
    ["gen-v2-video-mumbjiki-yuqt", "gen-v2-video-mumbjike-9s7l"],
    Array.from({ length: 40 }, (_, index) => `gen-v2-image-${index.toString(36)}-node`),
  ];

  it("every detach command id passes the identifier rule the IPC boundary enforces", () => {
    for (const runId of runs) {
      for (const nodeIds of nodeSets) {
        const commandId = detachShotNodesCommandId(runId, nodeIds, 12345);
        expect(isProductionRunIdentifier(commandId), `${runId} × ${nodeIds.length} nodes → ${commandId}`).toBe(true);
      }
    }
  });

  it("is the same id for the same deletion report, whatever the order or repetition", () => {
    const [first, second] = nodeSets[1];
    expect(detachShotNodesCommandId("run-1", [first, second], 7)).toBe(detachShotNodesCommandId("run-1", [second, first, second], 7));
  });

  it("distinguishes node sets and runs (a different deletion is never swallowed as a replay)", () => {
    const ids = new Set([
      detachShotNodesCommandId("run-1", nodeSets[0], 7),
      detachShotNodesCommandId("run-1", nodeSets[1], 7),
      detachShotNodesCommandId("run-2", nodeSets[0], 7),
      // 同一个节点撤销删除、重新绑上之后又删一次：Run 在中间前进过，是另一次删除。
      detachShotNodesCommandId("run-1", nodeSets[0], 9),
    ]);
    expect(ids.size).toBe(4);
  });

  it("canvas claim ids: same attempt → same id; the next attempt of the same shot → a new id; always a valid identifier", () => {
    for (const runId of runs) {
      const id = canvasShotClaimCommandId(runId, "shot-2", 1);
      expect(isProductionRunIdentifier(id), id).toBe(true);
      expect(canvasShotClaimCommandId(runId, "shot-2", 1)).toBe(id);
    }
    const ids = new Set([
      canvasShotClaimCommandId("run-1", "shot-2", 1),
      canvasShotClaimCommandId("run-1", "shot-2", 2),
      canvasShotClaimCommandId("run-1", "shot-2", 3),
      canvasShotClaimCommandId("run-1", "shot-3", 1),
      canvasShotClaimCommandId("run-2", "shot-2", 1),
    ]);
    expect(ids.size).toBe(5);
  });

  it("rejects the shapes the IPC boundary rejects", () => {
    // 2026-09-29 真实事故里的那种号：渲染层手拼、带「:」「,」。
    expect(isProductionRunIdentifier("detach-canvas:op-1:gen-v2-a,gen-v2-b")).toBe(false);
    for (const value of ["", ".", "..", "x".repeat(161), "a/b", "a b", "镜头"]) {
      expect(isProductionRunIdentifier(value), JSON.stringify(value)).toBe(false);
    }
  });
});
