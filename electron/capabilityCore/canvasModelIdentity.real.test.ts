// `assertCatalogModelIdentity` 的**生产判据**测试，喂的是真实目录（seedBuiltins），不是自造桩。
//
// 2026-09-22 验收实测的覆盖缺口：把 `assertCatalogModelIdentity` 整个短路成 no-op，
// 96/96 测试全绿——`MODEL_KIND_FOR_NODE_KIND` 的 9 个 kind 映射、vendor 过滤、closest 匹配、
// 以及 `core.ts` 的接线全部无人守。那份自造目录桩只证明了「我写的桩会抛」。
import { describe, expect, it } from "vitest";

import { applyBuiltinSeeds } from "../catalog/seedBuiltins";
import { deriveModelListing } from "../catalog/modelCatalogListing";
import { CanvasGraphError } from "./canvasGraph";
import { assertCatalogModelIdentity, type ModelIdentityRow } from "./canvasModelIdentity";

const state = applyBuiltinSeeds(
  { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} },
  "2026-09-22T00:00:00.000Z",
).state;
/** 生产里递进来的就是这一份（`core.addProjectNodes` → `listAvailableModels()`）。 */
const listing: ModelIdentityRow[] = deriveModelListing(state);

const pick = (kind: string): ModelIdentityRow => {
  const row = listing.find((entry) => entry.kind === kind);
  if (!row) throw new Error(`the seeded catalog has no ${kind} model — this test's premise is gone`);
  return row;
};

const failure = (identity: { vendor?: string; modelKey?: string; kind: string }): CanvasGraphError => {
  try {
    assertCatalogModelIdentity(listing, identity);
  } catch (error) {
    if (error instanceof CanvasGraphError) return error;
    throw error;
  }
  throw new Error(`expected ${JSON.stringify(identity)} to be refused`);
};

describe("assertCatalogModelIdentity against the real seeded catalog", () => {
  it("accepts a real image model on an image node", () => {
    const row = pick("image");
    expect(() => assertCatalogModelIdentity(listing, { vendor: row.vendor, modelKey: row.modelKey, kind: "image" }))
      .not.toThrow();
  });

  it("refuses a model key the real catalog does not have", () => {
    const error = failure({ vendor: "apimart", modelKey: "totally-not-a-real-model", kind: "image" });
    expect(error.code).toBe("unknown_model_identity");
    expect(error.details).toMatchObject({ modelKey: "totally-not-a-real-model", nodeKind: "image" });
  });

  it("refuses a real model attached to the wrong node kind", () => {
    // 真实的 video 模型挂到 image 节点上：短路掉判据时这条会绿，所以它守的是 kind 映射那一半。
    const video = pick("video");
    const error = failure({ vendor: video.vendor, modelKey: video.modelKey, kind: "image" });
    expect(error.details).toMatchObject({ modelKind: "video", expectedModelKind: "image" });
  });

  it("refuses a real model claimed under a vendor that does not carry it", () => {
    const row = pick("image");
    expect(failure({ vendor: "no-such-vendor", modelKey: row.modelKey, kind: "image" }).code)
      .toBe("unknown_model_identity");
  });

  it("points at the closest real model when the caller misspells one", () => {
    const row = pick("image");
    const error = failure({ vendor: row.vendor, modelKey: row.modelKey.toUpperCase() + "-typo", kind: "image" });
    // 近似只经名字主人（与助手写错名字时同一个判据）：给出这一家里一个真实存在、又像这次写法的行。
    const closest = String(error.details?.closest);
    expect(closest.startsWith(`${row.vendor}/`)).toBe(true);
    expect(row.modelKey.toLowerCase().startsWith(closest.slice(row.vendor.length + 1).toLowerCase())).toBe(true);
  });

  // ── kind 映射那张表：逐项守，别让「加了个节点 kind 忘了映射」无声通过 ──
  it.each([
    ["image", "image"], ["keyframe", "image"], ["character", "image"],
    ["scene", "image"], ["panorama", "image"], ["video", "video"],
    ["clip", "video"], ["audio", "audio"], ["model3d", "model3d"],
  ])("node kind %s demands a %s model", (nodeKind, expectedModelKind) => {
    expect(failure({ modelKey: "totally-not-a-real-model", kind: nodeKind }).details)
      .toMatchObject({ expectedModelKind });
  });

  it("stays out of the way for node kinds that carry no model", () => {
    for (const kind of ["text", "shot", "output", "director", "whiteboard"]) {
      expect(() => assertCatalogModelIdentity(listing, { modelKey: "totally-not-a-real-model", kind }))
        .not.toThrow();
    }
  });
});
