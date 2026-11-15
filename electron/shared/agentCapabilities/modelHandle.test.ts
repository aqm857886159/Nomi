import { describe, expect, it } from "vitest";
import { modelHandleOf, resolveModelHandle } from "./modelHandle";

const rows = [
  { vendor: "apimart", modelId: "MiniMax-H3", modelAlias: null },
  { vendor: "minimax", modelId: "MiniMax-H3", modelAlias: null },
  { vendor: "kie", modelId: "bytedance/seedance-2", modelAlias: null },
  { vendor: "kie", modelId: "bytedance/seedance-2-fast", modelAlias: null },
  { vendor: "apimart", modelId: "gpt-image-2", modelAlias: null },
];

describe("modelHandleOf", () => {
  it("writes model id then vendor, joined by @", () => {
    expect(modelHandleOf({ vendor: "kie", modelId: "bytedance/seedance-2" })).toBe("bytedance/seedance-2@kie");
    expect(modelHandleOf({ vendor: null, modelId: "x" })).toBe("x");
  });
});

describe("resolveModelHandle", () => {
  it("accepts the full name exactly and case-insensitively", () => {
    expect(resolveModelHandle(rows, "MiniMax-H3@minimax")).toMatchObject({ ok: true, via: "handle", row: rows[1] });
    expect(resolveModelHandle(rows, "minimax-h3@APIMART")).toMatchObject({ ok: true, via: "handle", row: rows[0] });
  });

  it("accepts a bare model id carried by exactly one vendor and says so", () => {
    expect(resolveModelHandle(rows, "gpt-image-2")).toMatchObject({ ok: true, via: "model_id", handle: "gpt-image-2@apimart" });
  });

  it("refuses a bare model id carried by several vendors and lists their full names", () => {
    expect(resolveModelHandle(rows, "MiniMax-H3")).toEqual({
      ok: false, reason: "ambiguous", handles: ["MiniMax-H3@apimart", "MiniMax-H3@minimax"],
    });
  });

  it("never lets a different tier collapse onto its sibling", () => {
    const fast = resolveModelHandle(rows, "bytedance/seedance-2-fast");
    expect(fast).toMatchObject({ ok: true, row: rows[3] });
    const unknown = resolveModelHandle(rows, "seedance-2-turbo@kie");
    expect(unknown.ok).toBe(false);
  });

  it("gives up to three full names when nothing matches, and an empty list when nothing is close", () => {
    const wrongVendor = resolveModelHandle(rows, "gpt-image-2@kie");
    expect(wrongVendor).toMatchObject({ ok: false, reason: "unknown" });
    if (!wrongVendor.ok && wrongVendor.reason === "unknown") {
      expect(wrongVendor.nearest).toContain("gpt-image-2@apimart");
      expect(wrongVendor.nearest.length).toBeLessThanOrEqual(3);
      expect(wrongVendor.nearest.every((handle) => handle.includes("@"))).toBe(true);
    }
    expect(resolveModelHandle(rows, "zzqq")).toEqual({ ok: false, reason: "unknown", nearest: [] });
  });

  it("treats two rows producing the same string as ambiguous instead of picking one", () => {
    const clash = [{ vendor: "b", modelId: "a@b" }, { vendor: "b", modelId: "a@b" }];
    expect(resolveModelHandle(clash, "a@b@b")).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("accepts near spellings of the id itself, never a different vendor prefix", () => {
    expect(resolveModelHandle(rows, "Seedance_2")).toMatchObject({ ok: true, via: "model_id", row: rows[2] });
    expect(resolveModelHandle(rows, "ByteDance/Seedance2")).toMatchObject({ ok: true, row: rows[2] });
    expect(resolveModelHandle(rows, "apimart/bytedance/seedance-2").ok).toBe(false);
  });

  it("answers the legacy vendor/model spelling with the full name as the first suggestion", () => {
    const legacy = resolveModelHandle(rows, "kie/bytedance/seedance-2");
    expect(legacy.ok).toBe(false);
    if (!legacy.ok && legacy.reason === "unknown") expect(legacy.nearest[0]).toBe("bytedance/seedance-2@kie");
  });
});
