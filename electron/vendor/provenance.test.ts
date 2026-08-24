import { describe, expect, it } from "vitest";
import { buildNormalizedRecipe, buildTaskProvenance } from "./provenance";
import type { Model, Vendor } from "../catalog/types";

const vendor = { key: "kie" } as unknown as Vendor;
const model = { modelKey: "gpt-image-2", modelAlias: "" } as unknown as Model;

describe("buildNormalizedRecipe(S4-1:一份数据三用的'机器比'侧)", () => {
  it("params 键排序且剔除路由字段(projectId/nodeId 不影响产物,进指纹会假漂)", () => {
    const recipe = buildNormalizedRecipe({
      vendor,
      model,
      request: {
        kind: "text_to_image",
        prompt: "a cat",
        seed: 42,
        width: 1024,
        extras: { zQuality: "high", aspectRatio: "16:9", projectId: "p1", nodeId: "n1" },
      },
    });
    expect(Object.keys(recipe.params)).toEqual(["aspectRatio", "width", "zQuality"]);
    expect(recipe.params).not.toHaveProperty("projectId");
    expect(recipe).toMatchObject({ vendorKey: "kie", modelKey: "gpt-image-2", seed: 42, prompt: "a cat" });
  });

  it("同输入(extras 键序不同)→ 序列化逐字节相等(S8 指纹的前提)", () => {
    const a = buildNormalizedRecipe({ vendor, model, request: { kind: "k", prompt: "p", extras: { b: 1, a: 2 } } });
    const b = buildNormalizedRecipe({ vendor, model, request: { kind: "k", prompt: "p", extras: { a: 2, b: 1 } } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("buildTaskProvenance(profile/fallback 两路径共用,修主路径漏写)", () => {
  it("形状与原 fallback 内联块对齐(E11 契约不变)", () => {
    const provenance = buildTaskProvenance({
      vendor,
      model,
      request: { kind: "text_to_image", prompt: "a cat", negativePrompt: "blur", seed: 7, width: 512, extras: { x: 1 } },
      vendorRequestId: "task-1",
    });
    expect(provenance).toMatchObject({
      provider: "kie",
      modelKey: "gpt-image-2",
      prompt: "a cat",
      negativePrompt: "blur",
      seed: 7,
      vendorRequestId: "task-1",
      params: { width: 512, extras: { x: 1 } },
    });
    expect(typeof provenance.timestamp).toBe("number");
  });

  it("仅在供应商给出可靠证据时把实际积分带进 provenance", () => {
    const provenance = buildTaskProvenance({
      vendor,
      model,
      request: { kind: "text_to_image", prompt: "a cat" },
      vendorRequestId: "task-credit",
      actualCost: { amount: 8.52, unit: "credits", provider: "apimart" },
    });
    expect(provenance.cost).toEqual({ amount: 8.52, currency: "credits", unit: "actual" });
  });
});
