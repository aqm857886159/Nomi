import { describe, expect, it } from "vitest";

import type { PlanCandidate } from "../capabilityCore/executionContract";
import {
  buildMultiShotGateProjection,
  checkSealAffordability,
  deriveShotPrice,
  projectMultiShotPreview,
  type ModelPricingRow,
  type ShotPriceInput,
} from "./shotPricing";

// P4 S2: per-shot pricing derive + preview projection + seal precheck.
//
// TDD (red→green). The pricing *matching* rule has no prior consumer in the repo — the catalog
// `pricing`/`specCosts` shape (electron/catalog/types.ts:207-213) was authored but never joined
// (documented as "数据已有全未用", docs/plan/2026-06-11-nomi-harness-master-plan.md:244). These tests
// pin the rule S2 adopts: an enabled base `cost`, plus enabled `specCosts` whose `specKey` matches a
// parameter selection on the shot (bare value OR `paramKey:paramValue`). No pricing / disabled / no
// match → honest `{ known: false }`, never a fabricated 0.

function candidate(overrides: Partial<PlanCandidate> = {}): PlanCandidate {
  return {
    candidateId: "cand-1",
    revision: 1,
    moduleId: "generation.single-shot",
    providerId: "apimart",
    modelId: "seedance-2.5",
    mode: "text-to-video",
    prompt: "a paper boat",
    parameters: { resolution: "720p", duration: 5 },
    references: [],
    ...overrides,
  };
}

function pricingRow(overrides: Partial<ModelPricingRow> = {}): ModelPricingRow {
  return {
    providerId: "apimart",
    modelId: "seedance-2.5",
    pricing: { cost: 10, enabled: true, specCosts: [] },
    ...overrides,
  };
}

function input(overrides: Partial<ShotPriceInput> = {}): ShotPriceInput {
  return {
    candidate: candidate(),
    resolvePricing: (providerId, modelId) =>
      providerId === "apimart" && modelId === "seedance-2.5" ? pricingRow().pricing : undefined,
    ...overrides,
  };
}

describe("deriveShotPrice", () => {
  it("returns the base cost when the model has enabled pricing and no specCosts", () => {
    expect(deriveShotPrice(input())).toEqual({ known: true, amount: 10 });
  });

  it("adds an enabled specCost when its bare-value specKey matches a selected parameter", () => {
    const result = deriveShotPrice(
      input({
        resolvePricing: () => ({
          cost: 10,
          enabled: true,
          specCosts: [{ specKey: "720p", cost: 4, enabled: true }],
        }),
      }),
    );
    expect(result).toEqual({ known: true, amount: 14 });
  });

  it("adds an enabled specCost when its paramKey:paramValue specKey matches a selection", () => {
    const result = deriveShotPrice(
      input({
        resolvePricing: () => ({
          cost: 10,
          enabled: true,
          specCosts: [{ specKey: "resolution:720p", cost: 6, enabled: true }],
        }),
      }),
    );
    expect(result).toEqual({ known: true, amount: 16 });
  });

  it("matches a numeric parameter selection (duration) by stringified value", () => {
    const result = deriveShotPrice(
      input({
        resolvePricing: () => ({
          cost: 10,
          enabled: true,
          specCosts: [{ specKey: "duration:5", cost: 3, enabled: true }],
        }),
      }),
    );
    expect(result).toEqual({ known: true, amount: 13 });
  });

  it("sums multiple matching specCosts on top of the base cost", () => {
    const result = deriveShotPrice(
      input({
        resolvePricing: () => ({
          cost: 10,
          enabled: true,
          specCosts: [
            { specKey: "resolution:720p", cost: 4, enabled: true },
            { specKey: "duration:5", cost: 3, enabled: true },
          ],
        }),
      }),
    );
    expect(result).toEqual({ known: true, amount: 17 });
  });

  it("ignores a specCost whose specKey does not match any selection", () => {
    const result = deriveShotPrice(
      input({
        resolvePricing: () => ({
          cost: 10,
          enabled: true,
          specCosts: [{ specKey: "1080p", cost: 9, enabled: true }],
        }),
      }),
    );
    expect(result).toEqual({ known: true, amount: 10 });
  });

  it("ignores a disabled specCost even when its specKey matches", () => {
    const result = deriveShotPrice(
      input({
        resolvePricing: () => ({
          cost: 10,
          enabled: true,
          specCosts: [{ specKey: "720p", cost: 5, enabled: false }],
        }),
      }),
    );
    expect(result).toEqual({ known: true, amount: 10 });
  });

  it("is unknown (not 0) when the model has no pricing row at all", () => {
    expect(deriveShotPrice(input({ resolvePricing: () => undefined }))).toEqual({ known: false });
  });

  it("is unknown when pricing exists but is disabled (enabled=false)", () => {
    expect(
      deriveShotPrice(input({ resolvePricing: () => ({ cost: 10, enabled: false, specCosts: [] }) })),
    ).toEqual({ known: false });
  });

  it("is unknown when the base cost is not a finite non-negative number", () => {
    expect(
      deriveShotPrice(input({ resolvePricing: () => ({ cost: Number.NaN, enabled: true, specCosts: [] }) })),
    ).toEqual({ known: false });
  });
});

describe("projectMultiShotPreview", () => {
  const resolvePricing = (_providerId: string, modelId: string) =>
    modelId === "seedance-2.5"
      ? { cost: 10, enabled: true, specCosts: [{ specKey: "720p", cost: 4, enabled: true }] }
      : undefined;

  it("returns per-shot price + a known-subtotal and an unknown-shot count", () => {
    const projection = projectMultiShotPreview({
      shots: [
        { shotId: "shot-a", candidate: candidate({ candidateId: "a", parameters: { resolution: "720p" } }) },
        { shotId: "shot-b", candidate: candidate({ candidateId: "b", modelId: "no-price-model", parameters: {} }) },
      ],
      resolvePricing,
      durationSeconds: (c) => (typeof c.parameters.duration === "number" ? c.parameters.duration : undefined),
    });
    expect(projection.shots.map((shot) => shot.shotId)).toEqual(["shot-a", "shot-b"]);
    expect(projection.shots[0].price).toEqual({ known: true, amount: 14 });
    expect(projection.shots[1].price).toEqual({ known: false });
    expect(projection.total).toEqual({ knownSubtotal: 14, unknownShotCount: 1, currency: "CNY" });
  });

  it("marks durationEstimate unknown when it cannot be estimated", () => {
    const projection = projectMultiShotPreview({
      shots: [{ shotId: "shot-a", candidate: candidate({ parameters: {} }) }],
      resolvePricing,
      durationSeconds: () => undefined,
    });
    expect(projection.shots[0].durationEstimate).toEqual({ known: false });
  });

  it("reports a known durationEstimate when the shot carries a duration", () => {
    const projection = projectMultiShotPreview({
      shots: [{ shotId: "shot-a", candidate: candidate({ parameters: { resolution: "720p", duration: 8 } }) }],
      resolvePricing,
      durationSeconds: (c) => (typeof c.parameters.duration === "number" ? c.parameters.duration : undefined),
    });
    expect(projection.shots[0].durationEstimate).toEqual({ known: true, seconds: 8 });
  });

  it("emits a structured degradation code (no vendor string) when a character shot lacks a reference-image channel", () => {
    const projection = projectMultiShotPreview({
      shots: [
        {
          shotId: "shot-a",
          candidate: candidate({ references: [] }),
          hasCharacter: true,
          supportsReferenceImage: false,
        },
      ],
      resolvePricing,
      durationSeconds: () => 5,
    });
    expect(projection.shots[0].degradations).toEqual([
      { code: "model_cannot_take_character_reference", params: { modelId: "seedance-2.5" } },
    ]);
  });

  it("emits no degradation when the model supports the reference-image channel", () => {
    const projection = projectMultiShotPreview({
      shots: [
        {
          shotId: "shot-a",
          candidate: candidate(),
          hasCharacter: true,
          supportsReferenceImage: true,
        },
      ],
      resolvePricing,
      durationSeconds: () => 5,
    });
    expect(projection.shots[0].degradations).toEqual([]);
  });
});

describe("checkSealAffordability", () => {
  const price = (amount: number) => ({ known: true as const, amount });

  it("passes when no hard maxSpend is set (unbounded)", () => {
    const result = checkSealAffordability({
      shots: [{ shotId: "a", price: price(10) }, { shotId: "b", price: price(10) }],
      maxSpend: null,
    });
    expect(result).toEqual({ ok: true, hasUnknownPrice: false });
  });

  it("passes when the hard maxSpend covers the whole known subtotal", () => {
    const result = checkSealAffordability({
      shots: [{ shotId: "a", price: price(10) }, { shotId: "b", price: price(10) }],
      maxSpend: 25,
    });
    expect(result).toEqual({ ok: true, hasUnknownPrice: false });
  });

  it("rejects with maxAffordableShots counted in checkbox order when maxSpend < known subtotal", () => {
    const result = checkSealAffordability({
      shots: [
        { shotId: "a", price: price(10) },
        { shotId: "b", price: price(10) },
        { shotId: "c", price: price(10) },
      ],
      maxSpend: 25,
    });
    // 10 + 10 = 20 ≤ 25, adding the third (30) exceeds → only the first two fit.
    expect(result).toEqual({ ok: false, maxAffordableShots: 2, knownSubtotal: 30, maxSpend: 25 });
  });

  it("counts an unknown-price shot as affordable (0 cost toward the cap) but flags certainty", () => {
    const result = checkSealAffordability({
      shots: [
        { shotId: "a", price: price(10) },
        { shotId: "b", price: { known: false } },
        { shotId: "c", price: price(10) },
      ],
      maxSpend: 25,
    });
    // Known subtotal is 20 ≤ 25 → passes, but an unknown-price shot exists → certainty flagged.
    expect(result).toEqual({ ok: true, hasUnknownPrice: true });
  });

  it("rejects at the shot whose running known subtotal first breaches the cap, skipping unknown-price shots in the tally", () => {
    const result = checkSealAffordability({
      shots: [
        { shotId: "a", price: price(20) },
        { shotId: "b", price: { known: false } },
        { shotId: "c", price: price(20) },
      ],
      maxSpend: 25,
    });
    // a=20 ≤ 25 fits; b unknown (0 toward cap) still fits; c pushes to 40 > 25 → 2 shots affordable.
    expect(result).toEqual({ ok: false, maxAffordableShots: 2, knownSubtotal: 40, maxSpend: 25 });
  });
});

describe("P4 S4 buildMultiShotGateProjection (the real display.shots for the confirmation card)", () => {
  const resolve = (providerId: string, modelId: string) =>
    modelId === "unpriced-model" ? undefined : { cost: 6, enabled: true, specCosts: [] };

  it("builds serializable per-shot rows with index, human model text, and honest prices", () => {
    const projection = buildMultiShotGateProjection({
      shots: [
        { shotId: "shot-1", sceneOneLiner: "雨夜推门", providerModelText: "APIMart · 即梦（文生图）", candidate: { providerId: "apimart", modelId: "video-model", parameters: {}, references: [] }, durationSeconds: 5 },
        { shotId: "shot-2", sceneOneLiner: "货架对视", providerModelText: "APIMart · 未定价模型", candidate: { providerId: "apimart", modelId: "unpriced-model", parameters: {}, references: [] } },
      ],
      resolvePricing: resolve,
      currency: "CNY",
      planVersion: 3,
      planHash: "sha256:x",
      specs: { durationSeconds: 40, aspectRatio: "9:16", shotCount: 2 },
      hardLimit: 30,
      anchorChips: [{ label: "主角 · 阿雨", price: { known: true, amount: 2 } }],
      waitSeconds: 180,
      frozenItems: ["shots", "models"],
    });

    expect(projection.shots).toHaveLength(2);
    expect(projection.shots[0]).toMatchObject({ shotId: "shot-1", index: 1, sceneOneLiner: "雨夜推门", providerModelText: "APIMart · 即梦（文生图）", durationSeconds: 5, price: { known: true, amount: 6 } });
    // Unpriced model → honest unknown, never a fabricated 0. Missing duration → null.
    expect(projection.shots[1]).toMatchObject({ shotId: "shot-2", index: 2, price: { known: false }, durationSeconds: null });
    // Metadata passes through end-to-end.
    expect(projection).toMatchObject({ planVersion: 3, planHash: "sha256:x", hardLimit: 30, waitSeconds: 180, currency: "CNY" });
    expect(projection.anchorChips).toEqual([{ label: "主角 · 阿雨", price: { known: true, amount: 2 } }]);
    // Serializable (no functions / undefined-only fields).
    expect(() => JSON.stringify(projection)).not.toThrow();
  });

  it("flags the 'model_cannot_take_character_reference' degradation as a STRUCTURED code (not a string)", () => {
    const projection = buildMultiShotGateProjection({
      shots: [{ shotId: "s", sceneOneLiner: "x", providerModelText: "m", candidate: { providerId: "apimart", modelId: "no-ref", parameters: {}, references: [] }, hasCharacter: true, supportsReferenceImage: false }],
      resolvePricing: resolve,
    });
    expect(projection.shots[0].degradations).toEqual([{ code: "model_cannot_take_character_reference", params: { modelId: "no-ref" } }]);
  });
});
