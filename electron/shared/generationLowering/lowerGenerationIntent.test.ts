/**
 * 解析写入过程自己的规则（目标、编码、已有值、张数、未知绑定），加两条按全部内置档案跑的类测试：
 * 一条参考按绑定只进一个键（同一张图出现在两个键里 = 双键，官方字段矩阵的复现 3 那一类）；
 * 进合并的槽自己的键不与留在扁平键上的槽撞（撞了，旧写法会连扁平槽的值一起删）。
 * 三个入口共用同一份绑定的验收合同在 `referenceBinding.contract.test.ts`，旧行为的字面量在
 * `referencePlacement.characterization.test.ts`，整条请求体逐格比对在 `electron/parity/officialWire.matrix.test.ts`。
 */
import { describe, expect, it } from "vitest";
import { MODEL_ARCHETYPES } from "../modelArchetypes";
import { combineChannelForMode, slotJoinsCombine } from "../videoCapabilities/referenceChannels";
import { SEEDANCE_2_APIMART_ARCHETYPE } from "../videoCapabilities/seedanceApimart";
import { declarationForMode } from "./declarationForMode";
import { lowerGenerationIntent, loweringInputKey, type GenerationDeclaration, type ReferenceBinding } from "./lowerGenerationIntent";

const A = "https://cdn.example/a.png";
const B = "https://cdn.example/b.png";

function modeOf(id: string) {
  const mode = SEEDANCE_2_APIMART_ARCHETYPE.modes.find((candidate) => candidate.id === id);
  if (!mode) throw new Error(`Seedance 2.0 has no mode ${id}`);
  return mode;
}

/** 一个地址在请求参数里出现了几次（数 JSON 里的字面量，不管它在哪个键、什么形状里）。 */
function occurrences(bodyParams: Record<string, unknown>, url: string): number {
  return JSON.stringify(bodyParams).split(JSON.stringify(url)).length - 1;
}

function only(binding: ReferenceBinding, readKeys: readonly string[] = []): GenerationDeclaration {
  return { bindings: [binding], readKeys };
}

const LIST_GROUP = ["image_urls", "imageUrls"];
const POSITIONS = [["image_urls", "imageUrls", "referenceImageUrls"]];

describe("lowerGenerationIntent · 目标", () => {
  it.each([
    ["全部读到，按组声明序", ["imageUrls", "image_urls"], "every-read-or-head", ["image_urls", "imageUrls"]],
    ["都不读，组首键", [], "every-read-or-head", ["image_urls"]],
    ["第一个读到的", ["imageUrls", "image_urls"], "first-read", ["image_urls"]],
    ["都不读，不写", [], "first-read", []],
  ] as const)("%s", (_name, readKeys, select, expectedKeys) => {
    const lowered = lowerGenerationIntent(
      only({ kind: "image_ref", target: { select, keys: LIST_GROUP }, encoding: { shape: "url-list" } }, readKeys),
      { references: [{ binding: 0, value: A }, { binding: 0, value: A }] },
    );
    expect(lowered.snapshot()).toEqual(Object.fromEntries(expectedKeys.map((key) => [key, [A, A]])));
    // 每个键各一份，不共用同一个数组对象。
    const placed = lowered.snapshot();
    if (expectedKeys.length === 2) expect(placed.image_urls).not.toBe(placed.imageUrls);
    expect(lowered.problems).toEqual([]);
  });

  it("声明键后写的盖先写的、位置不动；兼容目标只补没写过的键，先出现的为准", () => {
    const lowered = lowerGenerationIntent({
      bindings: [
        { kind: "image_ref", target: { select: "declared", key: "image" }, encoding: { shape: "url", pick: "first" } },
        { kind: "image_ref", target: { select: "every-read-or-head", keys: ["extra"] }, encoding: { shape: "url-list" } },
        { kind: "image_ref", target: { select: "every-read-or-head", keys: ["extra"] }, encoding: { shape: "url-list" } },
        { kind: "first_frame", target: { select: "declared", key: "image" }, encoding: { shape: "url", pick: "first" } },
      ],
      readKeys: [],
    }, { references: [{ binding: 2, value: B }, { binding: 1, value: A }, { binding: 0, value: A }, { binding: 3, value: B }] });
    expect(Object.entries(lowered.snapshot())).toEqual([["image", B], ["extra", [B]]]);
  });
});

describe("lowerGenerationIntent · 编码", () => {
  it.each([
    [{ shape: "url-list" }, [A, B, A]],
    [{ shape: "url", pick: "first" }, A],
    [{ shape: "url", pick: "last" }, A],
    [{ shape: "url-in-list" }, [A]],
    [{ shape: "content-items", media: "video", role: "reference_video" }, [
      { type: "video_url", video_url: { url: A }, role: "reference_video" },
      { type: "video_url", video_url: { url: B }, role: "reference_video" },
      { type: "video_url", video_url: { url: A }, role: "reference_video" },
    ]],
    [{ shape: "content-item", role: "first_frame" }, { type: "image_url", image_url: { url: A }, role: "first_frame" }],
  ] as const)("%j", (encoding, expected) => {
    const lowered = lowerGenerationIntent(
      only({ kind: "image_ref", target: { select: "declared", key: "k" }, encoding }),
      { references: [A, ` ${B} `, "", A].map((value) => ({ binding: 0, value })) },
    );
    expect(lowered.snapshot()).toEqual({ k: expected });
  });

  it("角色对象：地址带合并槽的 role；调用方给的对象原样（键序、role 不改）", () => {
    const given = { role: "character", url: B };
    const lowered = lowerGenerationIntent({
      bindings: [
        { kind: "first_frame", target: { select: "combined", key: "roles", role: "first_frame" }, encoding: { shape: "role-objects" } },
        { kind: "image_ref", target: { select: "first-read", keys: ["roles2"] }, encoding: { shape: "role-objects" } },
      ],
      readKeys: ["roles2"],
    }, { references: [{ binding: 1, value: given }, { binding: 0, value: A }] });
    expect(lowered.snapshot()).toEqual({ roles: [{ url: A, role: "first_frame" }], roles2: [{ role: "character", url: B }] });
    expect(Object.keys((lowered.snapshot().roles2 as Array<Record<string, unknown>>)[0]!)).toEqual(["role", "url"]);
    expect((lowered.snapshot().roles2 as unknown[])[0]).not.toBe(given);
  });
});

describe("lowerGenerationIntent · 已有参数", () => {
  const list: ReferenceBinding = {
    kind: "image_ref", target: { select: "every-read-or-head", keys: LIST_GROUP }, encoding: { shape: "url-list" }, keepGroupValueAt: "image_urls",
  };

  it.each([
    [[], []],
    [["imageUrls"], ["imageUrls"]],
    [["image_urls", "imageUrls"], ["image_urls", "imageUrls"]],
  ])("同一参考位已有值：唯一落点是沿用键才不补（body 读 %j → 写 %j）", (readKeys, expectedKeys) => {
    const lowered = lowerGenerationIntent(
      { bindings: [list], readKeys, existingValues: { positions: POSITIONS, onConflict: "reject" } },
      { references: [{ binding: 0, value: A }] },
      { referenceImageUrls: [A] },
    );
    expect(Object.keys(lowered.snapshot())).toEqual(expectedKeys);
    expect(lowered.problems).toEqual([]);
  });

  it("要写的键上已有值 → 不写（keep 不报冲突）", () => {
    const lowered = lowerGenerationIntent(
      { bindings: [list], readKeys: LIST_GROUP, existingValues: { positions: [], onConflict: "keep" } },
      { references: [{ binding: 0, value: A }] },
      { image_urls: [B] },
    );
    expect({ bodyParams: lowered.snapshot(), problems: lowered.problems }).toEqual({ bodyParams: { imageUrls: [A] }, problems: [] });
  });

  it.each([[[]], [["imageUrls"]]])("授权地址冲突 → problem（含沿用那条路；body 读 %j）", (readKeys) => {
    const lowered = lowerGenerationIntent(
      { bindings: [list], readKeys, existingValues: { positions: POSITIONS, onConflict: "reject" } },
      { references: [{ binding: 0, value: A }] },
      { referenceImageUrls: [B] },
    );
    expect(lowered.problems.map(({ code }) => code)).toContain("reference_conflicts_existing");
  });
});

describe("lowerGenerationIntent · 档案模式", () => {
  it("合并槽：Seedance 2.0 首尾帧只发 image_with_roles，role 只用官方枚举，每张图只出现一次", () => {
    const lowered = lowerGenerationIntent(declarationForMode(modeOf("firstlast")), {
      references: [{ binding: 0, value: "https://cdn.example/first.png" }, { binding: 1, value: "https://cdn.example/last.png" }],
    });
    expect(lowered.problems).toEqual([]);
    expect(lowered.snapshot()).toEqual({
      image_with_roles: [
        { url: "https://cdn.example/first.png", role: "first_frame" },
        { url: "https://cdn.example/last.png", role: "last_frame" },
      ],
    });
  });

  it("容量按这一档模式的槽读：Seedance 2.0 全能参考放 3 张不被封顶", () => {
    const urls = [A, B, "https://cdn.example/c.png"];
    const lowered = lowerGenerationIntent(declarationForMode(modeOf("omni")), { references: urls.map((value) => ({ binding: 0, value })) });
    expect(lowered.problems).toEqual([]);
    expect(lowered.snapshot()).toEqual({ image_urls: urls });
  });

  it("超过绑定的张数是 problem，不静默截断、不另找一个键", () => {
    const lowered = lowerGenerationIntent(
      only({ kind: "image_ref", target: { select: "declared", key: "image_urls" }, encoding: { shape: "url-list" }, max: 1 }),
      { references: [{ binding: 0, value: A }, { binding: 0, value: B }] },
    );
    expect(lowered.problems).toEqual([{ code: "reference_over_capacity", binding: 0, kind: "image_ref", max: 1, count: 2 }]);
  });

  it("合并槽超量：记 problem，地址照样全部并进去（拒不拒由调用方定）", () => {
    const lowered = lowerGenerationIntent(declarationForMode(modeOf("firstlast")), {
      references: [{ binding: 0, value: A }, { binding: 0, value: B }],
    });
    expect(lowered.problems).toEqual([{ code: "reference_over_capacity", binding: 0, kind: "first_frame", max: 1, count: 2 }]);
    expect(lowered.snapshot()).toEqual({ image_with_roles: [{ url: A, role: "first_frame" }, { url: B, role: "first_frame" }] });
  });

  it("同一张图给两次就是两条：去重是调用方的事", () => {
    const lowered = lowerGenerationIntent(declarationForMode(modeOf("omni")), { references: [{ binding: 0, value: A }, { binding: 0, value: A }] });
    expect(lowered.snapshot()).toEqual({ image_urls: [A, A] });
  });

  it("指向不存在的绑定是 problem", () => {
    const lowered = lowerGenerationIntent({ bindings: [], readKeys: [] }, { references: [{ binding: 3, value: A }] });
    expect({ bodyParams: lowered.snapshot(), problems: lowered.problems }).toEqual({ bodyParams: {}, problems: [{ code: "reference_binding_unknown", binding: 3 }] });
  });

  it("全部内置档案的每一档模式：每个槽放一张不同的图，每张图在请求参数里正好出现一次", () => {
    const misplaced: string[] = [];
    for (const archetype of MODEL_ARCHETYPES) {
      for (const mode of archetype.modes) {
        if (!mode.slots.length) continue;
        const references = mode.slots.map((_, binding) => ({ binding, value: `https://cdn.example/${archetype.id}/${mode.id}/${binding}.png` }));
        const lowered = lowerGenerationIntent(declarationForMode(mode), { references });
        for (const reference of references) {
          const count = occurrences(lowered.snapshot(), reference.value);
          if (count !== 1) misplaced.push(`${archetype.id}/${mode.id} 槽 ${reference.binding}（${mode.slots[reference.binding]!.kind}）出现 ${count} 次`);
        }
      }
    }
    expect(misplaced).toEqual([]);
  });

  it("全部内置档案：进合并的槽自己的键不与留在扁平键上的槽撞", () => {
    const collisions: string[] = [];
    for (const archetype of MODEL_ARCHETYPES) {
      for (const mode of archetype.modes) {
        if (!combineChannelForMode(mode)) continue;
        const joined = mode.slots.filter((slot) => slotJoinsCombine(mode, slot)).map(loweringInputKey);
        for (const slot of mode.slots.filter((candidate) => !slotJoinsCombine(mode, candidate))) {
          if (joined.includes(loweringInputKey(slot))) collisions.push(`${archetype.id}/${mode.id} ${loweringInputKey(slot)}`);
        }
      }
    }
    expect(collisions).toEqual([]);
  });
});
