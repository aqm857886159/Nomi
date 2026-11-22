/**
 * 文本模型行能力声明的读法与初值（设计卡 docs/plan/2026-11-22-model-meta-declaration.md ★2 / ★9）。
 *   · 读：只认合法形状，某一格不对就当那一格没声明，其余照常；覆盖只收白名单两个键、键序固定；
 *   · 初值：只有写入口调用；覆盖按当时的名字（别名优先）重算，PDF 只补缺（显式布尔优先，其次名单）；
 *   · 一次性修正：有收据就不跑，跑过落收据，非文本行、没什么要补的行原样不动。
 */
import { describe, expect, it } from "vitest";
import { readModelDeclaration } from "./modelDeclaration";
import { repairModelDeclarationDefaults, withModelDeclarationDefaults } from "./modelDeclarationDefaults";
import type { CatalogState, Model } from "./types";

function textRow(modelKey: string, modelAlias: string | null, meta?: unknown): Model {
  return { vendorKey: "relay", modelKey, modelAlias, labelZh: modelKey, kind: "text", enabled: true, createdAt: "a", updatedAt: "a",
    ...(meta === undefined ? {} : { meta }) };
}

function catalog(models: Model[], receipt?: true): CatalogState {
  return { version: 13, vendors: [], models, mappings: [], apiKeysByVendor: {}, ...(receipt ? { modelDeclarationDefaultsApplied: receipt } : {}) };
}

describe("readModelDeclaration", () => {
  it("没有 meta 或 meta 不是对象 → 什么都没声明", () => {
    for (const meta of [undefined, null, "x", 3, ["pdf"]]) expect(readModelDeclaration(meta)).toEqual({});
  });

  it("合法的六格原样读出", () => {
    const meta = {
      textProtocol: "anthropic", reasoning: true, thinkingLevelMap: { off: null, high: "high" },
      compat: { supportsDeveloperRole: false }, inputModalities: ["pdf", "audio"], requestBodyOverrides: { temperature: 0.5, enable_thinking: true },
      supportsImageInput: true, contextWindow: 1000,
    };
    expect(readModelDeclaration(meta)).toEqual({
      textProtocol: "anthropic", reasoning: true, thinkingLevelMap: { off: null, high: "high" },
      compat: { supportsDeveloperRole: false }, inputModalities: ["pdf", "audio"], requestBodyOverrides: { temperature: 0.5, enable_thinking: true },
    });
  });

  it("覆盖只收白名单两个键，键序固定为温度在前", () => {
    const read = readModelDeclaration({ requestBodyOverrides: { enable_thinking: false, model: "evil", max_tokens: 9, temperature: 1 } });
    expect(read.requestBodyOverrides).toEqual({ temperature: 1, enable_thinking: false });
    expect(Object.keys(read.requestBodyOverrides!)).toEqual(["temperature", "enable_thinking"]);
  });

  it("覆盖里两个键都不合法 → 这一格没声明", () => {
    expect(readModelDeclaration({ requestBodyOverrides: { temperature: "1", enable_thinking: "no" } })).toEqual({});
    expect(readModelDeclaration({ requestBodyOverrides: { temperature: Number.NaN } })).toEqual({});
    expect(readModelDeclaration({ requestBodyOverrides: { model: "x" } })).toEqual({});
  });

  it("某一格形状不对只丢那一格，其余照常", () => {
    expect(readModelDeclaration({ textProtocol: "gemini", reasoning: "yes", thinkingLevelMap: { high: 3 }, compat: ["x"], inputModalities: ["pdf"] }))
      .toEqual({ inputModalities: ["pdf"] });
    expect(readModelDeclaration({ reasoning: false, inputModalities: ["pdf", "image"] })).toEqual({ reasoning: false });
    expect(readModelDeclaration({ inputModalities: "pdf", textProtocol: "openai-responses" })).toEqual({ textProtocol: "openai-responses" });
  });

  it("空的 inputModalities 是合法声明（明说只收文本）", () => {
    expect(readModelDeclaration({ inputModalities: [] })).toEqual({ inputModalities: [] });
  });
});

describe("withModelDeclarationDefaults", () => {
  it("覆盖按别名算：模型键随便起、别名是 o1 系 → 温度 1；别名不是 → 没有覆盖", () => {
    expect(withModelDeclarationDefaults(textRow("relay-x", "o1-preview"))).toEqual({ inputModalities: ["pdf"], requestBodyOverrides: { temperature: 1 } });
    // PDF 名单撞的是键和别名的拼接（和旧运行时一样），覆盖只看别名优先的那个名字。
    expect(withModelDeclarationDefaults(textRow("o1", "my-o"))).toEqual({ inputModalities: ["pdf"] });
  });

  it("kimi-k2 → 温度 1 + enable_thinking: false；o3 / o3-mini 撞，o30 不撞", () => {
    expect(withModelDeclarationDefaults(textRow("kimi-k2-turbo", null))).toEqual({ requestBodyOverrides: { temperature: 1, enable_thinking: false } });
    expect(withModelDeclarationDefaults(textRow("o3", null))).toMatchObject({ requestBodyOverrides: { temperature: 1 } });
    expect(withModelDeclarationDefaults(textRow("o3-mini", null))).toMatchObject({ requestBodyOverrides: { temperature: 1 } });
    expect(withModelDeclarationDefaults(textRow("o30", null))).toEqual({ inputModalities: ["pdf"] });
  });

  it("显式 supportsPdfInput 布尔优先于名单", () => {
    expect(withModelDeclarationDefaults(textRow("gemini-2.5-pro", null, { supportsPdfInput: false })))
      .toEqual({ supportsPdfInput: false, inputModalities: [] });
    expect(withModelDeclarationDefaults(textRow("relay-x", null, { supportsPdfInput: true })))
      .toEqual({ supportsPdfInput: true, inputModalities: ["pdf"] });
  });

  it("已经声明了 inputModalities 就不重算（创作者 / 声明卡写的不被名单改回去）", () => {
    const meta = { inputModalities: [] };
    expect(withModelDeclarationDefaults(textRow("gemini-2.5-pro", null, meta))).toBe(meta);
  });

  it("名字改了覆盖跟着变：旧覆盖删掉", () => {
    const meta = { requestBodyOverrides: { temperature: 1 }, contextWindow: 8 };
    expect(withModelDeclarationDefaults(textRow("relay-x", "deepseek-chat", meta))).toEqual({ contextWindow: 8 });
  });

  it("非文本行、没什么要补的行：原样返回同一个对象；没有 meta 还是没有", () => {
    const meta = { supportsPdfInput: true };
    expect(withModelDeclarationDefaults({ ...textRow("gemini-2.5-pro", null, meta), kind: "image" })).toBe(meta);
    const plain = { contextWindow: 8 };
    expect(withModelDeclarationDefaults(textRow("deepseek-chat", null, plain))).toBe(plain);
    expect(withModelDeclarationDefaults(textRow("deepseek-chat", null))).toBeUndefined();
  });

  it("协议、推理三格一律不写", () => {
    for (const key of ["o1", "kimi-k2", "gemini-2.5-pro", "claude-sonnet-4", "deepseek-reasoner"]) {
      const meta = withModelDeclarationDefaults(textRow(key, null)) as Record<string, unknown> | undefined;
      for (const field of ["textProtocol", "reasoning", "thinkingLevelMap", "compat"]) expect(meta ?? {}, `${key}.${field}`).not.toHaveProperty(field);
    }
  });
});

describe("repairModelDeclarationDefaults", () => {
  it("补一次、落收据；不用补的行保持同一个对象", () => {
    const plain = textRow("deepseek-chat", null, { contextWindow: 8 });
    const state = catalog([textRow("o1", null), plain]);
    const repaired = repairModelDeclarationDefaults(state);
    expect(repaired.modelDeclarationDefaultsApplied).toBe(true);
    expect(repaired.models[0]!.meta).toEqual({ inputModalities: ["pdf"], requestBodyOverrides: { temperature: 1 } });
    expect(repaired.models[1]).toBe(plain);
  });

  it("有收据就不跑：之后改过的声明不被改回初值", () => {
    const state = catalog([textRow("o1", null, { inputModalities: [] })], true);
    expect(repairModelDeclarationDefaults(state)).toBe(state);
  });

  it("再跑一次（幂等）结果不变", () => {
    const once = repairModelDeclarationDefaults(catalog([textRow("kimi-k2", null), textRow("gemini-2.5-pro", null, { supportsPdfInput: false })]));
    const twice = repairModelDeclarationDefaults({ ...once, modelDeclarationDefaultsApplied: undefined });
    expect(twice).toEqual(once);
  });
});
