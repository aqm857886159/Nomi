/**
 * 降级函数自己的四条规则，加一条按全部内置档案跑的类测试：
 * 一条参考按声明只进一个键（同一张图出现在两个键里 = 双键，官方字段矩阵的复现 3 那一类，不许从降级函数里出来）。
 * 两条路（画布 / Run）发出去的整条请求体逐格比对在 `electron/parity/officialWire.matrix.test.ts`。
 */
import { describe, expect, it } from "vitest";
import { MODEL_ARCHETYPES } from "../modelArchetypes";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "../videoCapabilities/seedanceApimart";
import { declarationForMode } from "./declarationForMode";
import { lowerGenerationIntent, type GenerationDeclaration, type PreservedReferenceIntent } from "./lowerGenerationIntent";

function modeOf(id: string) {
  const mode = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`Seedance 2.0 has no mode ${id}`);
  return mode;
}

/** 一个地址在请求参数里出现了几次（数 JSON 里的字面量，不管它在哪个键、什么形状里）。 */
function occurrences(bodyParams: Record<string, unknown>, url: string): number {
  return JSON.stringify(bodyParams).split(JSON.stringify(url)).length - 1;
}

describe("lowerGenerationIntent", () => {
  it.each([
    [["image_urls"], []],
    [["imageUrls"], ["imageUrls"]],
    [["image_urls", "imageUrls"], ["image_urls", "imageUrls"]],
  ])("已有同组值只抑制声明的单一标准输入落点：%j", (keys, expected) => {
    const lowered = lowerGenerationIntent({ slots: [], combine: null, joinsCombine: [] }, {
      references: [], preservedReferences: [{ kind: "image_ref", value: ["a.png"], keys, readKeys: keys, selection: "all-read-or-first", retainExistingGroupAt: "image_urls" }],
    });
    expect(Object.keys(lowered.bodyParams)).toEqual(expected);
  });

  it.each([
    ["全部匹配，按声明顺序", ["imageUrls", "image_urls"], "all-read-or-first", ["image_urls", "imageUrls"]],
    ["没有匹配，组首键", [], "all-read-or-first", ["image_urls"]],
    ["首个匹配", ["imageUrls", "image_urls"], "first-read", ["image_urls"]],
    ["没有匹配，不另放角色数组", [], "first-read", []],
  ] as const)("原值参考的落键只在这里决定：%s", (_name, readKeys, selection, expectedKeys) => {
    const value = ["https://cdn.example/a.png", "https://cdn.example/a.png"];
    const lowered = lowerGenerationIntent({ slots: [], combine: null, joinsCombine: [] }, {
      references: [],
      preservedReferences: [{ kind: "image_ref", value, keys: ["image_urls", "imageUrls"], readKeys, selection }],
    });
    expect(Object.keys(lowered.bodyParams)).toEqual(expectedKeys);
    for (const key of expectedKeys) {
      expect(lowered.bodyParams[key]).toEqual(value);
      expect(lowered.bodyParams[key]).not.toBe(value);
    }
    expect(lowered.problems).toEqual([]);
  });

  it.each([
    { value: "https://cdn.example/a.png" },
    { value: ["https://cdn.example/a.png"] },
    { value: [{ url: "https://cdn.example/a.png", role: "character" }] },
  ])(
    "原值参考保留单值 / 数组 / 角色数组形状：$value", ({ value }) => {
      const reference: PreservedReferenceIntent = { kind: "image_ref", value, keys: ["image_urls"], readKeys: [], selection: "all-read-or-first" };
      const lowered = lowerGenerationIntent({ slots: [], combine: null, joinsCombine: [] }, {
        references: [], preservedReferences: [reference, { ...reference, value: "later value" }],
      });
      expect(lowered.bodyParams).toEqual({ image_urls: value });
    },
  );

  it("合并槽：Seedance 2.0 首尾帧只发 image_with_roles，role 只用官方枚举，每张图只出现一次", () => {
    const lowered = lowerGenerationIntent(declarationForMode(modeOf("firstlast")), {
      references: [{ url: "https://cdn.example/first.png", slot: 0 }, { url: "https://cdn.example/last.png", slot: 1 }],
    });
    expect(lowered.problems).toEqual([]);
    expect(lowered.bodyParams).toEqual({
      image_with_roles: [
        { url: "https://cdn.example/first.png", role: "first_frame" },
        { url: "https://cdn.example/last.png", role: "last_frame" },
      ],
    });
  });

  it("容量按这一档模式的槽读：Seedance 2.0 全能参考放 3 张不被封顶", () => {
    const urls = ["https://cdn.example/a.png", "https://cdn.example/b.png", "https://cdn.example/c.png"];
    const lowered = lowerGenerationIntent(declarationForMode(modeOf("omni")), { references: urls.map((url) => ({ url, slot: 0 })) });
    expect(lowered.problems).toEqual([]);
    expect(lowered.bodyParams).toEqual({ image_urls: urls });
  });

  it("超过槽的张数是 problem，不静默截断、不另找一个键", () => {
    const declaration: GenerationDeclaration = {
      slots: [{ kind: "image_ref", inputKey: "image_urls", max: 1 }],
      combine: null,
      joinsCombine: [false],
    };
    const lowered = lowerGenerationIntent(declaration, {
      references: [{ url: "https://cdn.example/a.png", slot: 0 }, { url: "https://cdn.example/b.png", slot: 0 }],
    });
    expect(lowered.problems).toEqual([{ code: "reference_over_capacity", slot: 0, kind: "image_ref", max: 1, count: 2 }]);
  });

  it("合并槽超量：记 problem，地址照样全部并进去（拒不拒由调用方定，降级不替它截）", () => {
    const lowered = lowerGenerationIntent(declarationForMode(modeOf("firstlast")), {
      references: [{ url: "https://cdn.example/a.png", slot: 0 }, { url: "https://cdn.example/b.png", slot: 0 }],
    });
    expect(lowered.problems).toEqual([{ code: "reference_over_capacity", slot: 0, kind: "first_frame", max: 1, count: 2 }]);
    expect(lowered.bodyParams).toEqual({
      image_with_roles: [
        { url: "https://cdn.example/a.png", role: "first_frame" },
        { url: "https://cdn.example/b.png", role: "first_frame" },
      ],
    });
  });

  it("同一张图给两次就是两条：去重是调用方的事", () => {
    const url = "https://cdn.example/a.png";
    const lowered = lowerGenerationIntent(declarationForMode(modeOf("omni")), { references: [{ url, slot: 0 }, { url, slot: 0 }] });
    expect(lowered.bodyParams).toEqual({ image_urls: [url, url] });
  });

  it("指向不存在的槽是 problem", () => {
    const lowered = lowerGenerationIntent({ slots: [], combine: null, joinsCombine: [] }, {
      references: [{ url: "https://cdn.example/a.png", slot: 3 }],
    });
    expect(lowered.problems).toEqual([{ code: "reference_slot_unknown", slot: 3, url: "https://cdn.example/a.png" }]);
    expect(lowered.bodyParams).toEqual({});
  });

  it("全部内置档案的每一档模式：每个槽放一张不同的图，每张图在请求参数里正好出现一次", () => {
    const misplaced: string[] = [];
    for (const archetype of MODEL_ARCHETYPES) {
      for (const mode of archetype.modes) {
        if (!mode.slots.length) continue;
        const references = mode.slots.map((_, slot) => ({ url: `https://cdn.example/${archetype.id}/${mode.id}/${slot}.png`, slot }));
        const lowered = lowerGenerationIntent(declarationForMode(mode), { references });
        for (const reference of references) {
          const count = occurrences(lowered.bodyParams, reference.url);
          if (count !== 1) misplaced.push(`${archetype.id}/${mode.id} 槽 ${reference.slot}（${mode.slots[reference.slot]!.kind}）出现 ${count} 次`);
        }
      }
    }
    expect(misplaced).toEqual([]);
  });
});
