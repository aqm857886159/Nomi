import { describe, expect, it } from "vitest";
import { extractProviderCostActual } from "./cost";

describe("extractProviderCostActual", () => {
  it("reads APIMart credits_cost without confusing the money cost field", () => {
    expect(
      extractProviderCostActual("apimart", {
        data: { cost: 0.852, credits_cost: 8.52, status: "completed" },
      }),
    ).toEqual({ amount: 8.52, unit: "credits", provider: "apimart" });
  });

  it("reads APIMart records nested in a data array and keeps zero as known", () => {
    expect(extractProviderCostActual("APIMART", { data: [{ credits_cost: 0 }] })).toEqual({
      amount: 0,
      unit: "credits",
      provider: "apimart",
    });
  });

  it("reads KIE recordInfo creditsConsumed", () => {
    expect(
      extractProviderCostActual("kie", {
        code: 200,
        data: { state: "success", creditsConsumed: 50, resultJson: "{\"resultUrls\":[]}" },
      }),
    ).toEqual({ amount: 50, unit: "credits", provider: "kie" });
  });

  it("does not guess for missing, invalid, or unknown-provider responses", () => {
    expect(extractProviderCostActual("apimart", { data: { credits_cost: "8.52" } })).toBeUndefined();
    expect(extractProviderCostActual("kie", { data: { creditsConsumed: -1 } })).toBeUndefined();
    expect(extractProviderCostActual("custom", { data: { credits_cost: 8 } })).toBeUndefined();
  });
});
