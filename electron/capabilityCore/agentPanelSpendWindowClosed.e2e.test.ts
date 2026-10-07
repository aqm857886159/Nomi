// 特征测试（2026-10-05，付费卡并进对话投影之前钉住）：卡开着、批下了一张之后关窗。
//
// 关窗 = lane 关掉 → 闸把等这张卡的那次 hold 收成「被停」→ lane 收回这一次出价（`withdrawPresentation(…, "stopped")`）。
// 用户看到的结果必须是：**已经点过「生成这张」的那一张照发、照扣，没点的一张都不发**；重开之后回执按宿主的逐镜结局说话。
// 真链路、零额度：真 Run 账本、真封印 / 收据 / 决门、真批次调度器，只有供应商是本机 loopback HTTP。
import { afterEach, describe, expect, it } from "vitest";

import { generationPresentationOutcome } from "../shared/productionGenerationPresentation";
import {
  PROJECT_ID, OPERATION_ID, startLoopbackVendor, harness, buildActions, resetSpendFixture, advanceClock, imageDraft, shotsSent,
} from "./agentPanelSpendConfirmTestUtils";

afterEach(resetSpendFixture);

describe("卡开着时关窗：已批的照发，没点的不发", () => {
  it("3 张、点了第 1 张「生成这张」后关窗：供应商只收到第 1 张；卡没了；逐镜结局说第 1 张在生成、另两张因「被停」没发", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const built = buildActions(base, vendor.origin, submits);
    try {
      await imageDraft(base, built.handler, 3);
      const card = built.withWindow.listPendingSpend(PROJECT_ID)[0];
      advanceClock(1000);
      expect(await built.withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: card.quoteId, shotId: "shot-1" }))
        .toMatchObject({ ok: true });
      // lane 关窗那一支做的事（`laneExtendedDesktopPorts.preflightGenerate` 的 cancelled 分支）。
      await built.transport("step").withdrawPresentation(OPERATION_ID, "stopped");
      expect(shotsSent(submits), "已批的那一张照发，没点的不发").toEqual(["shot-1"]);
      expect(built.withWindow.listPendingSpend(PROJECT_ID), "卡跟着收回").toEqual([]);
      expect(generationPresentationOutcome(base.repository.read(PROJECT_ID, OPERATION_ID)!)).toEqual({
        closedBy: "stopped",
        generating: ["shot-1"],
        failedBeforeSending: [],
        removed: [],
        takenByCanvas: [],
        undecided: [{ shotId: "shot-2", reason: "stopped" }, { shotId: "shot-3", reason: "stopped" }],
      });
      expect(await built.transport("step").readPresentationOutcome(OPERATION_ID), "回合读到的就是这一份").toEqual(
        generationPresentationOutcome(base.repository.read(PROJECT_ID, OPERATION_ID)!),
      );
    } finally {
      await vendor.close();
    }
  });
});
