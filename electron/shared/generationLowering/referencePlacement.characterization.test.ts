/**
 * 参考放置的特征测试：动结构之前钉住三个入口今天真发出去的参数（expected 全是手写字面量，不读被测返回值）。
 *
 * 钉的是旧值兼容那一半——官方字段矩阵的 498 份请求体里显式参数全空、只给图片参考，下面这些只有这里看得到：
 * 同组双别名、空 body、重复地址、单图数组、角色对象和调用者的 role、首尾帧、已有同组值优先、授权地址冲突、
 * 合并外的视频 / 音频、模式固定参数、张数边界。
 *
 * 另钉三种自写目录的情形：它们说明 Run 的旧值不能直接改走档案槽——改了就变字节（槽的 inputKey 和 body 读的键不一样、
 * 单图槽发字符串而 Run 发数组、body 读两个同组别名时两个都要写）。
 */
import { describe, expect, it } from "vitest";
import { buildArchetypeInputParams } from "../../../src/workbench/generationCanvas/nodes/controls/archetypeMeta";
import { headlessReferenceOverlay } from "../../catalog/taskParams";
import type { ArchetypeMode, ArchetypeReferenceSlot, ModelArchetype } from "../videoCapabilities/types";
import { placeApprovedRunReferences, RunReferenceError, standardizeExplicitRunReferences } from "./runReferences";

const A = "https://cdn.example/a.png";
const B = "https://cdn.example/b.png";
const F = "https://cdn.example/first.png";
const F2 = "https://cdn.example/first-2.png";
const L = "https://cdn.example/last.png";
const V = "https://cdn.example/v.mp4";
const U = "https://cdn.example/u.mp3";

function body(...keys: string[]): Record<string, string> {
  return { model: "m", prompt: "{{request.prompt}}", ...Object.fromEntries(keys.map((key) => [key, `{{request.params.${key}}}`])) };
}

function slot(kind: ArchetypeReferenceSlot["kind"], extra: Partial<ArchetypeReferenceSlot> = {}): ArchetypeReferenceSlot {
  return { kind, label: kind, min: 0, ...extra };
}

function mode(slots: ArchetypeReferenceSlot[], extra: Partial<ArchetypeMode> = {}): ArchetypeMode {
  return { id: "fixture", intent: "single", vendorTerm: "fixture", hint: "", slots, params: [], promptRequired: false, ...extra };
}

function canvas(fixtureMode: ArchetypeMode, references: Parameters<typeof buildArchetypeInputParams>[2]): Record<string, unknown> {
  const archetype = {
    id: "fixture-archetype", family: "fixture", label: "Fixture", kind: "video",
    modes: [fixtureMode], defaultModeId: fixtureMode.id, transportTaskKind: "image_to_video", identifierPatterns: [],
  } satisfies ModelArchetype;
  return buildArchetypeInputParams({ archetype: { id: archetype.id, modeId: fixtureMode.id } }, archetype, references);
}

function approved(parameters: Record<string, unknown>, references: Parameters<typeof placeApprovedRunReferences>[1], createBody: unknown, fixtureMode: ArchetypeMode | null = null) {
  return placeApprovedRunReferences(parameters, references, createBody, fixtureMode);
}

function rejection(run: () => unknown): { reason: string; message: string } | null {
  try {
    run();
    return null;
  } catch (error) {
    if (!(error instanceof RunReferenceError)) throw error;
    return { reason: error.reason, message: error.message };
  }
}

const ROLES_MODE = mode([slot("first_frame", { max: 1 }), slot("image_ref", { max: 4 })], { combineSlotsInto: { key: "image_with_roles" } });

describe("Run 授权参考（没有档案模式：旧值兼容）", () => {
  it("同组双别名：body 读到的同组写法全部写，键序按组声明序（不按 body 序）", () => {
    for (const createBody of [body("image_urls", "imageUrls"), body("imageUrls", "image_urls")]) {
      const placed = approved({}, [{ url: A, kind: "image" }, { url: B, kind: "image" }], createBody);
      expect(JSON.stringify(placed.parameters)).toBe(`{"image_urls":["${A}","${B}"],"imageUrls":["${A}","${B}"]}`);
      expect(placed.placedKeys).toEqual(["image_urls", "imageUrls"]);
    }
  });

  it("空 body：组首键（图 image_urls、视频 video_urls、音频 audio_urls）", () => {
    const placed = approved({}, [{ url: A, kind: "image" }, { url: V, kind: "video" }, { url: U, kind: "audio" }], { model: "m" });
    expect(JSON.stringify(placed.parameters)).toBe(`{"image_urls":["${A}"],"video_urls":["${V}"],"audio_urls":["${U}"]}`);
  });

  it("重复地址照原样发两次", () => {
    expect(approved({}, [{ url: A, kind: "image" }, { url: A, kind: "image" }], body("image_urls")).parameters).toEqual({ image_urls: [A, A] });
  });

  it("单图也是数组", () => {
    expect(approved({}, [{ url: A, kind: "image" }], body("image_urls")).parameters).toEqual({ image_urls: [A] });
  });

  it("首尾帧：body 有这一帧的写法 → 标准帧键上的字符串；同一帧给两次，后给的为准", () => {
    expect(approved({}, [{ url: F, kind: "image", role: "first_frame" }, { url: L, kind: "image", role: "last_frame" }], body("first_frame_url", "last_frame_url")).parameters)
      .toEqual({ first_frame_url: F, last_frame_url: L });
    expect(approved({}, [{ url: F, kind: "image", role: "first_frame" }], body("firstFrameImage")).parameters).toEqual({ first_frame_url: F });
    expect(approved({}, [{ url: F, kind: "image", role: "first_frame" }, { url: F2, kind: "image", role: "first_frame" }], body("first_frame_url")).parameters)
      .toEqual({ first_frame_url: F2 });
  });

  it("body 没有这一帧的写法 → 拒（不改发成普通参考）", () => {
    expect(rejection(() => approved({}, [{ url: F, kind: "image", role: "first_frame" }], body("image_urls"))))
      .toEqual({ reason: "unsupported-role", message: "catalog mapping has unsupported reference role: first_frame" });
  });

  it("写入顺序 = 每个参考位第一次出现的顺序", () => {
    const frameFirst = approved({}, [{ url: F, kind: "image", role: "first_frame" }, { url: A, kind: "image" }], body("image_urls", "first_frame_url"));
    expect(frameFirst.placedKeys).toEqual(["first_frame_url", "image_urls"]);
    const imageFirst = approved({}, [{ url: A, kind: "image" }, { url: F, kind: "image", role: "first_frame" }], body("image_urls", "first_frame_url"));
    expect(imageFirst.placedKeys).toEqual(["image_urls", "first_frame_url"]);
  });

  it("已有同组值优先：body 只读标准输入键时沿用既有值、不补第二份；读别的同组写法时只补空着的键", () => {
    expect(approved({ imageUrls: [A] }, [{ url: A, kind: "image" }], body("referenceImageUrls"))).toEqual({ parameters: { imageUrls: [A] }, placedKeys: [] });
    expect(approved({ firstFrameImage: F }, [{ url: F, kind: "image", role: "first_frame" }], body("first_frame_url"))).toEqual({ parameters: { firstFrameImage: F }, placedKeys: [] });
    expect(approved({ imageUrls: [A] }, [{ url: A, kind: "image" }], body("image_urls"))).toEqual({ parameters: { imageUrls: [A], image_urls: [A] }, placedKeys: ["image_urls"] });
    expect(approved({ image_urls: [A] }, [{ url: A, kind: "image" }], body("image_urls"))).toEqual({ parameters: { image_urls: [A] }, placedKeys: [] });
  });

  it("授权地址冲突：合同里写死的值和授权时封存的不一样 → 拒（含沿用既有值那条路、合并键）", () => {
    const conflict = { reason: "conflict", message: "catalog reference URL projection conflicts with canonical parameters" };
    expect(rejection(() => approved({ imageUrls: [B] }, [{ url: A, kind: "image" }], body("image_urls")))).toEqual(conflict);
    expect(rejection(() => approved({ imageUrls: [B] }, [{ url: A, kind: "image" }], body("referenceImageUrls")))).toEqual(conflict);
    expect(rejection(() => approved({ firstFrameImage: F2 }, [{ url: F, kind: "image", role: "first_frame" }], body("first_frame_url")))).toEqual(conflict);
    expect(rejection(() => approved({ image_with_roles: [{ url: B, role: "reference_image" }] }, [{ url: A, kind: "image" }], body("image_with_roles"), ROLES_MODE))).toEqual(conflict);
  });
});

describe("Run 授权参考（有档案模式）", () => {
  it("合并槽：按槽声明序拼角色数组，role 用槽的线上 role", () => {
    const placed = approved({}, [{ url: A, kind: "image", role: "reference" }, { url: F, kind: "image", role: "first_frame" }], body("image_with_roles"), ROLES_MODE);
    expect(JSON.stringify(placed.parameters)).toBe(`{"image_with_roles":[{"url":"${F}","role":"first_frame"},{"url":"${A}","role":"reference_image"}]}`);
    expect(placed.placedKeys).toEqual(["image_with_roles"]);
  });

  it("扁平合并：只发地址，按槽声明序", () => {
    const flat = mode([slot("first_frame", { max: 1 }), slot("image_ref", { max: 4 })], { combineSlotsInto: { key: "image_urls", flat: true } });
    expect(approved({}, [{ url: A, kind: "image" }, { url: F, kind: "image", role: "first_frame" }], body("image_urls"), flat).parameters).toEqual({ image_urls: [F, A] });
  });

  it("合并外的视频 / 音频：落 body 读的同组写法，排在合并键后面", () => {
    const imagesOnly = mode([slot("image_ref", { max: 4 }), slot("video_ref", { max: 1 })], { combineSlotsInto: { key: "image_with_roles", kinds: ["image_ref"] } });
    const placed = approved({}, [{ url: V, kind: "video" }, { url: A, kind: "image" }, { url: U, kind: "audio" }], body("image_with_roles", "video_urls", "audio_urls"), imagesOnly);
    expect(JSON.stringify(placed.parameters)).toBe(`{"image_with_roles":[{"url":"${A}","role":"reference_image"}],"video_urls":["${V}"],"audio_urls":["${U}"]}`);
  });

  it("合并里没有收这种参考的槽 → 拒（not-in-use）", () => {
    const framesOnly = mode([slot("first_frame", { max: 1 })], { combineSlotsInto: { key: "image_with_roles" } });
    expect(rejection(() => approved({}, [{ url: A, kind: "image", role: "reference" }], body("image_with_roles"), framesOnly))?.reason).toBe("not-in-use");
  });

  it("模式固定参数不在这一步铺；合并槽单槽超量也不在这一步拒（张数由 Run 按族核）", () => {
    const fixed = mode([slot("first_frame", { max: 1 }), slot("image_ref", { max: 4 })], { combineSlotsInto: { key: "image_with_roles" }, fixedParams: { generation_type: "reference" } });
    const placed = approved({}, [{ url: F, kind: "image", role: "first_frame" }, { url: F2, kind: "image", role: "first_frame" }], body("image_with_roles", "generation_type"), fixed);
    expect(JSON.stringify(placed.parameters)).toBe(`{"image_with_roles":[{"url":"${F}","role":"first_frame"},{"url":"${F2}","role":"first_frame"}]}`);
  });

  it("不合并的模式：授权参考不改走档案槽（三种自写目录情形，改走就变字节）", () => {
    // ①槽的 inputKey 是 image，body 读 image_urls：Run 照旧发 image_urls；画布按槽发 image。
    const imageKey = mode([slot("image_ref", { max: 1, inputKey: "image", asArray: false })]);
    expect(approved({}, [{ url: A, kind: "image" }], body("image_urls"), imageKey).parameters).toEqual({ image_urls: [A] });
    expect(canvas(imageKey, { referenceImages: [A] })).toEqual({ image: A });
    // ②单图槽：画布发字符串，Run 的旧值仍是数组。
    const single = mode([slot("image_ref", { max: 1, inputKey: "image_urls", asArray: false })]);
    expect(canvas(single, { referenceImages: [A] })).toEqual({ image_urls: A });
    expect(approved({}, [{ url: A, kind: "image" }], body("image_urls"), single).parameters).toEqual({ image_urls: [A] });
    // ③body 读两个同组别名：两个都写（一个槽只有一个键）。
    const list = mode([slot("image_ref", { max: 4, inputKey: "image_urls" })]);
    expect(approved({}, [{ url: A, kind: "image" }], body("image_urls", "imageUrls"), list).parameters).toEqual({ image_urls: [A], imageUrls: [A] });
  });
});

describe("Run 显式参考参数（body 不直接读的写法）", () => {
  it("URL 数组 → body 读的同组标准写法全部写；都不读 → 组首键", () => {
    expect(JSON.stringify(standardizeExplicitRunReferences({ input_urls: [A, B] }, ["imageUrls", "image_urls"])))
      .toBe(`{"input_urls":["${A}","${B}"],"image_urls":["${A}","${B}"],"imageUrls":["${A}","${B}"]}`);
    expect(standardizeExplicitRunReferences({ input_urls: [A] }, [])).toEqual({ input_urls: [A], image_urls: [A] });
    expect(standardizeExplicitRunReferences({ videoUrls: [V, V] }, ["video_urls"])).toEqual({ videoUrls: [V, V], video_urls: [V, V] });
  });

  it("帧别名 → 标准帧键（不看 body 读不读）", () => {
    expect(standardizeExplicitRunReferences({ first_frame_image: F, lastFrameImage: L }, ["image_urls"]))
      .toEqual({ first_frame_image: F, lastFrameImage: L, first_frame_url: F, last_frame_url: L });
  });

  it("角色对象：原样（键序、调用者的 role）落 body 读的第一个同组写法；都不读 → 不填", () => {
    const value = [{ role: "first_frame", url: F }, { url: A }];
    expect(JSON.stringify(standardizeExplicitRunReferences({ imageWithRoles: value }, ["image_with_roles"])))
      .toBe(`{"imageWithRoles":[{"role":"first_frame","url":"${F}"},{"url":"${A}"}],"image_with_roles":[{"role":"first_frame","url":"${F}"},{"url":"${A}"}]}`);
    expect(standardizeExplicitRunReferences({ imageWithRoles: value }, ["image_urls"])).toEqual({ imageWithRoles: value });
  });

  it("已有值优先：目标键已有值不覆盖；同一位两种写法，先出现的为准", () => {
    expect(standardizeExplicitRunReferences({ input_urls: [A], image_urls: [B] }, ["image_urls"])).toEqual({ input_urls: [A], image_urls: [B] });
    expect(standardizeExplicitRunReferences({ imageUrls: [A], input_urls: [B] }, ["image_urls"])).toEqual({ imageUrls: [A], input_urls: [B], image_urls: [A] });
  });

  it("body 直接读的、翻译键、空值都不动；新键按参数顺序排在后面", () => {
    expect(standardizeExplicitRunReferences({ referenceImageUrls: [A], imageUrls: [], image_urls: [B] }, ["image_urls"]))
      .toEqual({ referenceImageUrls: [A], imageUrls: [], image_urls: [B] });
    expect(Object.keys(standardizeExplicitRunReferences({ first_frame_image: F, input_urls: [A] }, ["image_urls"])))
      .toEqual(["first_frame_image", "input_urls", "first_frame_url", "image_urls"]);
  });
});

describe("headless（没有模式：按 body 推位）", () => {
  it("每族一个位：优先列表键（body 序第一个），帧放 body 的帧位并从族里取走", () => {
    expect(headlessReferenceOverlay({ referenceImageUrls: [A, B] }, body("image_urls", "imageUrls"))).toEqual({ image_urls: [A, B] });
    expect(headlessReferenceOverlay({ firstFrameUrl: F, referenceImageUrls: [A] }, body("first_frame_url", "image_urls"))).toEqual({ first_frame_url: F, image_urls: [A] });
  });

  it("跳过角色数组；键上已有值不碰", () => {
    expect(headlessReferenceOverlay({ referenceImageUrls: [A] }, body("image_with_roles"))).toEqual({});
    expect(headlessReferenceOverlay({ referenceImageUrls: [A], image_urls: [B] }, body("image_urls"))).toEqual({});
  });
});

describe("画布（按档案模式的槽）", () => {
  it("槽的键与形状：帧发字符串、列表发数组、单图槽发字符串", () => {
    const fixture = mode([slot("first_frame", { max: 1 }), slot("image_ref", { max: 4 })]);
    expect(canvas(fixture, { firstFrameUrl: F, referenceImages: [A, B] })).toEqual({ first_frame_url: F, reference_image_urls: [A, B] });
  });

  it("合并槽与固定参数：角色数组按槽声明序，固定参数最后铺", () => {
    const fixed = mode([slot("first_frame", { max: 1 }), slot("image_ref", { max: 4 })], { combineSlotsInto: { key: "image_with_roles" }, fixedParams: { generation_type: "reference" } });
    expect(JSON.stringify(canvas(fixed, { firstFrameUrl: F, referenceImages: [A] })))
      .toBe(`{"image_with_roles":[{"url":"${F}","role":"first_frame"},{"url":"${A}","role":"reference_image"}],"generation_type":"reference"}`);
  });

  it("张数边界：画布按槽上限截（超出的那张不发）", () => {
    const capped = mode([slot("image_ref", { max: 1, inputKey: "image_urls" })]);
    expect(canvas(capped, { referenceImages: [A, B] })).toEqual({ image_urls: [A] });
  });
});
