// 参考图出站合同的回归锁：档案声明的槽 → 渲染后的 create body。
// 这三条各锁一个 2026-09-08 实测到的根因，全部零网络。
import { describe, expect, it } from "vitest";
import { applyBuiltinSeeds } from "./seedBuiltins";
import type { CatalogState } from "./types";
import { findOutboundContractBreaches } from "../../scripts/check-reference-outbound-contract";
import { buildArchetypeInputParams } from "../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { resolveArchetypeForModel } from "../shared/modelArchetypes";
import { taskTemplateParams } from "./taskParams";
import { renderTemplateValue } from "../ai/requestPipeline";
import { modeWrittenInMeta } from "../../src/workbench/generationCanvas/nodes/controls/modeTestHelpers";

function seeded(): CatalogState {
  const empty: CatalogState = { version: 4, vendors: [], models: [], mappings: [], apiKeysByVendor: {} };
  return applyBuiltinSeeds(empty, "2026-09-08T00:00:00.000Z").state;
}

describe("参考图出站合同", () => {
  it("内置目录里没有『UI 承诺发得出、报文里却没有』的参考槽", () => {
    const { breaches, slotsChecked } = findOutboundContractBreaches(seeded());
    // 槽数归零 = 判据被架空（档案投影或 seed 形状变了），必须和违规一样红。
    expect(slotsChecked).toBeGreaterThan(0);
    expect(breaches).toEqual([]);
  });

  it("fal 的 gpt-image-2 改图：档案键 input_urls 真的进得了 fal 的 image_urls 字段", () => {
    const state = seeded();
    const model = state.models.find((m) => m.vendorKey === "fal" && m.modelKey === "openai/gpt-image-2");
    const mapping = state.mappings.find(
      (m) => m.vendorKey === "fal" && m.modelKey === "openai/gpt-image-2" && m.modeId === "i2i",
    );
    expect(model && mapping).toBeTruthy();
    const archetype = resolveArchetypeForModel(model!)!;
    expect(archetype.id).toBe("gpt-image-2");

    const refs = ["https://assets.test/a.png", "https://assets.test/b.png"];
    const projected = buildArchetypeInputParams(
      { archetype: { id: archetype.id, modeId: "i2i" } } as Record<string, unknown>,
      modeWrittenInMeta({ archetype: { id: archetype.id, modeId: "i2i" } }, archetype),
      { referenceImages: refs } as never,
    );
    // 档案投影落在契约键上（这一半此前就是对的）。
    expect(projected.input_urls).toEqual(refs);

    const params = taskTemplateParams(
      { prompt: "p", extras: { referenceImages: refs, archetypeInput: projected }, model: "openai/gpt-image-2" } as never,
      { vendorKey: "fal", modelKey: "openai/gpt-image-2" },
    );
    const body = renderTemplateValue(
      (mapping as { create?: { body?: unknown } }).create?.body,
      { request: { prompt: "p", params } } as never,
    ) as Record<string, unknown>;
    // 断的就是这一半：fal 的 wire 字段名是 image_urls，值必须来自档案的 input_urls。
    expect(body.image_urls).toEqual(refs);
  });
});
