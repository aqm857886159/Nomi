import { describe, expect, it } from "vitest";

import { selectCheapestTestGenerationModel } from "./cheapestGenerationModel";
import type { Model } from "./types";

function model(
  modelKey: string,
  kind: Model["kind"],
  cost: number | undefined,
  overrides: Partial<Model> = {},
): Model {
  return {
    vendorKey: "apimart",
    modelKey,
    labelZh: modelKey,
    kind,
    enabled: true,
    createdAt: "now",
    updatedAt: "now",
    ...(cost === undefined
      ? {}
      : { pricing: { cost, enabled: true, specCosts: [] } }),
    ...overrides,
  };
}

describe("selectCheapestTestGenerationModel (test harness only)", () => {
  it("selects the lowest priced enabled ApiMart model for the requested media kind", () => {
    const result = selectCheapestTestGenerationModel({
      kind: "video",
      models: [
        model("expensive-video", "video", 2),
        model("cheap-image", "image", 0.01),
        model("cheap-video", "video", 0.2),
        model("other-vendor-video", "video", 0.01, { vendorKey: "other" }),
        model("disabled-video", "video", 0.01, { enabled: false }),
      ],
    });

    expect(result).toEqual({ vendorKey: "apimart", modelKey: "cheap-video", cost: 0.2 });
  });

  it("uses a deterministic model-key tie break", () => {
    const result = selectCheapestTestGenerationModel({
      kind: "image",
      models: [model("z-image", "image", 0.1), model("a-image", "image", 0.1)],
    });

    expect(result && "modelKey" in result ? result.modelKey : undefined).toBe("a-image");
  });

  it("returns an explicit unpriced result instead of guessing when no enabled candidate has a price", () => {
    const result = selectCheapestTestGenerationModel({
      kind: "image",
      models: [model("unknown-image", "image", undefined)],
    });

    expect(result).toEqual({ status: "unpriced", vendorKey: "apimart", kind: "image" });
  });

  it("does not silently switch away from an explicitly requested provider", () => {
    const result = selectCheapestTestGenerationModel({
      kind: "video",
      vendorKey: "kie",
      models: [model("apimart-video", "video", 0.1), model("kie-video", "video", 1, { vendorKey: "kie" })],
    });

    expect(result).toEqual({ vendorKey: "kie", modelKey: "kie-video", cost: 1 });
  });
});
