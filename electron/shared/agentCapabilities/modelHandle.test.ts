import { describe, expect, it } from "vitest";
import { modelHandleOf, resolvedModelNameOf, resolveModelForTask, resolveModelHandle } from "./modelHandle";
import { EVERY_VARIANT, installModelNameSourceLookup, resolveModelArchetype } from "../modelArchetypes";
import { modeForInputs } from "../modelArchetypes/modeForInputs";

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
    const refused = resolveModelHandle(rows, "MiniMax-H3");
    expect(refused).toMatchObject({ ok: false, reason: "ambiguous", handles: ["MiniMax-H3@apimart", "MiniMax-H3@minimax"] });
    // 拒收带着对上的那几行本身，调用方（U1 按默认挑）只在这几行里挑，不再扫一遍目录。
    expect(refused.ok ? [] : (refused as { rows?: unknown[] }).rows).toHaveLength(2);
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

// U1（2026-11-17 协调拍 A）：同名多家时只多看「这一种任务」的用户默认，且只在已匹配的几行里挑。
describe("resolveModelForTask：同名多家按这一种任务的默认", () => {
  const taskKindOf = () => "text_to_video" as const;
  const defaultIs = (identity: { vendor: string; modelId: string } | undefined) => ({ taskKindOf, defaultFor: () => identity });

  it("默认恰好是匹配里的一家 → 落它，并带上同名的全部家（回执用）", () => {
    const hit = resolveModelForTask(rows, "MiniMax-H3", defaultIs({ vendor: "minimax", modelId: "MiniMax-H3" }));
    expect(hit).toMatchObject({ ok: true, row: rows[1], via: "user_default", among: ["MiniMax-H3@apimart", "MiniMax-H3@minimax"] });
  });

  it("默认是别的模型 → 照旧歧义；默认是匹配里某一家的别的模型（同供应商）也不许按供应商挑", () => {
    expect(resolveModelForTask(rows, "MiniMax-H3", defaultIs({ vendor: "kie", modelId: "bytedance/seedance-2" }))).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(resolveModelForTask(rows, "MiniMax-H3", defaultIs({ vendor: "apimart", modelId: "gpt-image-2" }))).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("没设默认、或这一种任务定不下来 → 歧义", () => {
    expect(resolveModelForTask(rows, "MiniMax-H3", defaultIs(undefined))).toMatchObject({ ok: false, reason: "ambiguous" });
    expect(resolveModelForTask(rows, "MiniMax-H3", { taskKindOf: () => undefined, defaultFor: () => ({ vendor: "minimax", modelId: "MiniMax-H3" }) }))
      .toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("调用方递一个不在目录里的「默认」想给自己放行 → 不起作用（只在匹配行里挑）", () => {
    expect(resolveModelForTask(rows, "MiniMax-H3", defaultIs({ vendor: "made-up", modelId: "MiniMax-H3" }))).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("两行都等于默认（同一字符串两行）→ 歧义，不挑", () => {
    const clash = [{ vendor: "b", modelId: "x" }, { vendor: "b", modelId: "x" }, { vendor: "c", modelId: "x" }];
    expect(resolveModelForTask(clash, "x", defaultIs({ vendor: "b", modelId: "x" }))).toMatchObject({ ok: false, reason: "ambiguous" });
  });

  it("只有一家时不看默认，也不写 user_default", () => {
    expect(resolveModelForTask(rows, "gpt-image-2", defaultIs({ vendor: "minimax", modelId: "MiniMax-H3" }))).toMatchObject({ ok: true, via: "model_id", row: rows[4] });
  });
});

describe("方式主人只收事实（类型）", () => {
  it("task 只收 {kind, vendor}：递已选好的方式或谓词编不过", () => {
    const archetype = { id: "a", modes: [] } as unknown as Parameters<typeof modeForInputs>[0];
    const call = () => modeForInputs(archetype, [], null, {
      // @ts-expect-error 方式由主人挑；调用方不能把选好的方式塞进来
      task: { kind: "text_to_video", vendor: null, mode: { id: "i2v" } },
    });
    expect(call).toThrow();
  });
});

describe("NF-1119-0001 · declared Wan model names", () => {
  const apimart = [
    { vendor: "apimart", modelId: "wan3.0-video", archetypeId: "wan-3.0-apimart" },
    { vendor: "apimart", modelId: "wan3.0-video-prime", archetypeId: "wan-3.0-prime-apimart" },
    { vendor: "apimart", modelId: "wan2.7", archetypeId: "wan-2.7" },
    { vendor: "apimart", modelId: "wan2.7-image", archetypeId: "wan2.7-image" },
    { vendor: "apimart", modelId: "wan2.7-image-pro", archetypeId: "wan2.7-image-pro" },
  ];

  it.each(["wan-3.0", "wan3.0"])("offers both APIMart tiers for %s without selecting one", (written) => {
    const distractors = ["wan3.0-lite", "wan3.0-alt", "wan3.0-hd"].map(modelId => ({ modelId, vendor: "relay" }));
    const hit = resolveModelHandle([...apimart, ...distractors], written, { preferred: apimart[0] });
    expect(hit).toMatchObject({ ok: false, reason: "unknown", nearest: expect.arrayContaining(["wan3.0-video@apimart", "wan3.0-video-prime@apimart"]) });
  });

  it.each(["wan2.7-r2v", "wan-2.7-r2v", "wan2.7-r2v@apimart"])("preserves the reference mode for %s", (written) => {
    const hit = resolveModelHandle(apimart, written);
    expect(hit).toMatchObject({ ok: true, handle: "wan2.7@apimart", modeId: "ref" });
    if (hit.ok) expect(resolvedModelNameOf(written, hit)).toMatchObject({ model: "wan2.7@apimart", modeId: "ref" });
  });

  it("preserves a separately declared archetype variant", () => {
    const hit = resolveModelHandle([{ vendor: "kie", modelId: "wan/3-0-video", archetypeId: "wan-3.0" }], "wan/3-0-video-prime@kie");
    expect(hit).toMatchObject({ ok: true, handle: "wan/3-0-video@kie", variantId: "prime" });
  });

  it("keeps image tiers distinct and rejects disabled or invented identities", () => {
    expect(resolveModelHandle(apimart, "wan-2.7-image")).toMatchObject({ ok: true, handle: "wan2.7-image@apimart" });
    expect(resolveModelHandle(apimart, "wan-2.7-image-pro")).toMatchObject({ ok: true, handle: "wan2.7-image-pro@apimart" });
    expect(resolveModelArchetype({ modelKey: "wan-2.7-image-pro", vendorKey: null }, { variant: EVERY_VARIANT })?.id).toBe("wan2.7-image-pro");
    expect(resolveModelHandle(apimart, "wan-2.7-r2v@kie").ok).toBe(false);
    expect(resolveModelHandle(apimart.filter((row) => row.modelId !== "wan2.7"), "wan2.7-r2v").ok).toBe(false);
    expect(resolveModelHandle(apimart, "wan-99-ultra").ok).toBe(false);
  });

  it("preserves a non-Wan variant and honors the row-owned name scope", () => {
    const row = { vendor: "apimart", modelId: "qwen-image-3.0", archetypeId: "qwen-image-3" };
    expect(resolveModelHandle([row], "qwen-image-3-0-pro")).toMatchObject({ ok: true, variantId: "pro" });
    const removeLookup = installModelNameSourceLookup(() => "row");
    try {
      expect(resolveModelHandle([row], "qwen-image-3-0-pro").ok).toBe(false);
    } finally {
      removeLookup();
    }
  });

  it("requires a unique enabled owner of a wire name", () => {
    const relays = [...apimart, { ...apimart[2]!, vendor: "relay" }];
    expect(resolveModelHandle(relays, "wan2.7-r2v", { preferred: apimart[2] })).toMatchObject({
      ok: false, reason: "ambiguous", handles: ["wan2.7@apimart", "wan2.7@relay"],
    });
  });
});
