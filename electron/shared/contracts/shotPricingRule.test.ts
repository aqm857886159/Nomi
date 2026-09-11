// 算式与身份匹配规则的单测。它们 2026-09-11 从主进程搬进契约层，因为付费确认卡要在渲染层
// 用**同一条**算式当场重算价格——所以这里守的是「两端报同一个数」这条不变量。
import { describe, expect, it } from "vitest";
import { createModelPricingResolver, deriveShotPrice } from "./shotPricingRule";

const ROWS = [
  {
    vendorKey: "APIMart", modelKey: "gpt-image-2", modelAlias: "gpt-image",
    pricing: { cost: 0.3, enabled: true, specCosts: [
      { specKey: "size:1536x1024", cost: 0.2, enabled: true },
      { specKey: "720p", cost: 0.1, enabled: true },
      { specKey: "4k", cost: 9, enabled: false },
    ] },
  },
  { vendorKey: "apimart", modelKey: "disabled-pricing", pricing: { cost: 5, enabled: false, specCosts: [] } },
  { vendorKey: "apimart", modelKey: "no-pricing" },
];

describe("shotPricingRule", () => {
  const resolvePricing = createModelPricingResolver(ROWS);

  it("身份匹配大小写不敏感，modelAlias 也算同一行", () => {
    expect(resolvePricing("apimart", "gpt-image-2")?.cost).toBe(0.3);
    expect(resolvePricing("APIMART", "GPT-IMAGE")?.cost).toBe(0.3);
    expect(resolvePricing("kie", "gpt-image-2")).toBeUndefined();
  });

  it("基价 + 命中的规格加价；paramKey:value 与裸值两种写法都认", () => {
    expect(deriveShotPrice({ candidate: { providerId: "apimart", modelId: "gpt-image-2", parameters: { size: "1024x1024" } }, resolvePricing }))
      .toEqual({ known: true, amount: 0.3 });
    expect(deriveShotPrice({ candidate: { providerId: "apimart", modelId: "gpt-image-2", parameters: { size: "1536x1024" } }, resolvePricing }))
      .toEqual({ known: true, amount: 0.5 });
    expect(deriveShotPrice({ candidate: { providerId: "apimart", modelId: "gpt-image-2", parameters: { resolution: "720p" } }, resolvePricing }))
      .toEqual({ known: true, amount: 0.4 });
  });

  it("没开的加价档不算钱；没价目 / 价目关闭 → 诚实报「算不出」，绝不落成 0", () => {
    expect(deriveShotPrice({ candidate: { providerId: "apimart", modelId: "gpt-image-2", parameters: { quality: "4k" } }, resolvePricing }))
      .toEqual({ known: true, amount: 0.3 });
    expect(deriveShotPrice({ candidate: { providerId: "apimart", modelId: "disabled-pricing", parameters: {} }, resolvePricing }))
      .toEqual({ known: false });
    expect(deriveShotPrice({ candidate: { providerId: "apimart", modelId: "no-pricing", parameters: {} }, resolvePricing }))
      .toEqual({ known: false });
  });

  it("非标量参数不参与匹配（规格加价不可能钉在一个对象/数组的选择上）", () => {
    expect(deriveShotPrice({
      candidate: { providerId: "apimart", modelId: "gpt-image-2", parameters: { refs: ["1536x1024"], size: "1024x1024" } },
      resolvePricing,
    })).toEqual({ known: true, amount: 0.3 });
  });
});
