// 付费卡带参考图生成（零额度 loopback）：卡上摆的参考 = 供应商收到的参考。
// 落地回写到画布节点（候选 → 节点参考槽）等画布写边界重构（方案 A）后接线，规划函数 planReferenceProjection 已有单测。
//
// 只有远端供应商是本机 loopback，其余（durable Run、改稿并入、封印 / 收据 / 门、提交、画布落地口）全是真的。
// 本项目素材库是夹具里那一份内存索引（`addReferenceAsset`），形状与生产 `projectSpendReferenceAssets` 一样。
import { afterEach, describe, expect, it } from "vitest";
import { spendActionFailureCopy } from "../../src/workbench/ai/v4/spendCardFailure";
import {
  PROJECT_ID, OPERATION_ID, addReferenceAsset, advanceClock, buildActions, draft, harness, harnessReferenceAssets,
  resetSpendFixture, startLoopbackVendor,
} from "./agentPanelSpendConfirmTestUtils";

afterEach(resetSpendFixture);

const CAT = `nomi-local://asset/${PROJECT_ID}/assets/cat.png`;
const FOX_IN_OTHER_PROJECT = "nomi-local://asset/project-other/assets/fox.png";

describe("付费卡带参考图：卡上 = 出站", () => {
  it("卡上带一张本项目的参考图点生成：供应商收到它", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    addReferenceAsset("asset-cat", CAT);
    const { withWindow } = buildActions(base, vendor.origin, submits, {
      resolveAssetReferenceIdentity: (projectId, assetId) => harnessReferenceAssets.identity(projectId, assetId),
    });
    try {
      await draft(base);
      advanceClock(1000);
      const revised = await withWindow.revisePendingSpend({
        projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: withWindow.listPendingSpend(PROJECT_ID)[0]!.quoteId,
        patch: { referenceInputs: [{ url: CAT, kind: "image", role: "reference" }] },
      });
      expect(revised).toMatchObject({ ok: true, code: "revised" });
      // 卡回来的那一份（宿主现算）摆着它，预览地址就是本项目素材库里的那一个。
      expect(withWindow.listPendingSpend(PROJECT_ID)[0]!.shots[0]!.references).toEqual([
        expect.objectContaining({ assetId: "asset-cat", kind: "image", role: "reference", url: CAT }),
      ]);
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      advanceClock(1000);
      const confirmed = await withWindow.confirmPendingSpend({ projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: withWindow.listPendingSpend(PROJECT_ID)[0]!.quoteId });
      expect(confirmed).toMatchObject({ ok: true, code: "spend_confirmed" });
      await base.canvasLanding.settleCanvasLanding(PROJECT_ID);

      // 出站：供应商那一侧收到的就是这一张。
      expect(vendor.bodies).toHaveLength(1);
      expect(vendor.bodies[0]!.references).toEqual([expect.objectContaining({ assetId: "asset-cat", kind: "image", role: "reference" })]);
    } finally {
      await vendor.close();
    }
  });

  it("卡上那张参考图不在本项目素材里（别的项目的原文件）：一次都不发，卡上那句点名是参考图、给拿掉或用 @ 重选的路", async () => {
    const vendor = await startLoopbackVendor();
    const base = harness();
    const submits: string[] = [];
    const { withWindow } = buildActions(base, vendor.origin, submits);
    try {
      await draft(base);
      advanceClock(1000);
      const outcome = await withWindow.revisePendingSpend({
        projectId: PROJECT_ID, operationId: OPERATION_ID, quoteId: withWindow.listPendingSpend(PROJECT_ID)[0]!.quoteId,
        patch: { referenceInputs: [{ url: FOX_IN_OTHER_PROJECT, kind: "image", role: "reference" }] },
      });
      expect(outcome).toMatchObject({ ok: false, message: "generation_not_started", reason: "generation_reference_asset_unsupported" });
      expect(spendActionFailureCopy(outcome, true)).toBe("agentPanelV4.spendActionReferenceNotInProject");
      expect(submits).toHaveLength(0);
      expect(vendor.bodies).toHaveLength(0);
    } finally {
      await vendor.close();
    }
  });
});
