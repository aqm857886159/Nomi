import { describe, expect, it } from "vitest";
import { getArchetypeById, resolveArchetypeForModel } from "./index";

// ---------------------------------------------------------------------------
// 2026-08-26 新接入的一批图像模型（Nano Banana 2 族 / kie Seedream 5.0 族 / Qwen-Image 3.0 / FLUX.2 Pro）
// 的**契约锁**。每条数字都出自当天官方文档实查，出处逐条写在断言旁边——改数字前先回文档对账，
// 别照直觉调（这些错本地全都看不出来：参数域错了只在真发请求时 400，槽上限错了只是静默丢参考图）。
// ---------------------------------------------------------------------------

const kie = (modelKey: string) => ({ modelKey, vendorKey: "kie" });
const apimart = (modelKey: string) => ({ modelKey, vendorKey: "apimart" });

const editSlotOf = (archetypeId: string) => {
  const arch = getArchetypeById(archetypeId)!;
  const edit = arch.modes.find((mode) => mode.id === "edit")!;
  return edit.slots[0];
};

const optionValues = (archetypeId: string, modeId: string, key: string) => {
  const arch = getArchetypeById(archetypeId)!;
  const mode = arch.modes.find((m) => m.id === modeId)!;
  return mode.params.find((p) => p.key === key)!.options.map((o) => String(o.value));
};

describe("Nano Banana 2（gemini-3.1-flash-image 代）", () => {
  it("主款与 apimart 认回 nano-banana-2；lite 认回自己的档案，且都不被 2.5 代抢走", () => {
    // 认错档案不报错，只是参数域用错：2.5 档案的改图槽是 10，拿不到本代的 14。
    expect(resolveArchetypeForModel(kie("nano-banana-2"))?.id).toBe("nano-banana-2");
    expect(resolveArchetypeForModel(apimart("gemini-3.1-flash-image-preview"))?.id).toBe("nano-banana-2");
    // lite 单独一档：它没有 resolution/output_format，共用主款档案会在 UI 上摆出无效控件。
    expect(resolveArchetypeForModel(kie("nano-banana-2-lite"))?.id).toBe("nano-banana-2-lite");
    // 老 2.5 代必须还在自己的档案里（本轮是新增一代，不是替换）。
    expect(resolveArchetypeForModel(kie("nano-banana"))?.id).toBe("nano-banana");
    expect(resolveArchetypeForModel(apimart("gemini-2.5-flash-image-preview"))?.id).toBe("nano-banana");
  });

  it("改图参考图上限 14 张 —— 本代最大卖点（全市场最多）", () => {
    // docs.kie.ai/market/google/nanobanana2.md：image_input「Up to 14 images」。
    // docs.apimart.ai gemini-3.1-flash/generation.md：image_urls「Up to 14 reference images」。两边一致。
    const slot = editSlotOf("nano-banana-2");
    expect(slot.max).toBe(14);
    expect(slot.min).toBe(1);
    expect(slot.inputKey).toBe("image_urls");
  });

  it("aspect_ratio 是 15 档且默认 auto（2.5 代是 11 档默认 1:1）", () => {
    // nanobanana2.md 枚举：1:1 2:3 3:2 1:4 4:1 3:4 4:3 4:5 5:4 1:8 8:1 9:16 16:9 21:9 auto(默认)。
    const values = optionValues("nano-banana-2", "t2i", "aspect_ratio");
    expect(values).toHaveLength(15);
    // 极端条幅是本代新增的，2.5 代没有 —— 拿它当「确实是新枚举」的哨兵。
    for (const extreme of ["1:4", "4:1", "1:8", "8:1"]) expect(values).toContain(extreme);
    const arch = getArchetypeById("nano-banana-2")!;
    expect(arch.modes[0].params.find((p) => p.key === "aspect_ratio")!.defaultValue).toBe("auto");
  });

  it("resolution 取 kie∩apimart 交集 1K/2K/4K，默认 1K（apimart 独有的 0.5K 不暴露）", () => {
    expect(optionValues("nano-banana-2", "t2i", "resolution")).toEqual(["1K", "2K", "4K"]);
    const arch = getArchetypeById("nano-banana-2")!;
    expect(arch.modes[0].params.find((p) => p.key === "resolution")!.defaultValue).toBe("1K");
  });

  it("apimart 侧参数用 size 而非 aspect_ratio（vendorParams B 分层）", () => {
    const arch = getArchetypeById("nano-banana-2")!;
    const apimartParams = arch.modes[0].vendorParams!.apimart!;
    expect(apimartParams.map((p) => p.key)).toEqual(["size", "resolution"]);
    // 比例枚举两边同域（15 档），只是字段名不同。
    expect(apimartParams.find((p) => p.key === "size")!.options).toHaveLength(15);
  });

  it("Lite 只声明 aspect_ratio 一个标量，槽上限 10（文档里它没有 resolution / output_format）", () => {
    // 档案 = 能力声明；声明了发不出去的参数 = UI 上按了没反应的控件（比报错更坏）。
    const arch = getArchetypeById("nano-banana-2-lite")!;
    for (const mode of arch.modes) expect(mode.params.map((p) => p.key), mode.id).toEqual(["aspect_ratio"]);
    expect(editSlotOf("nano-banana-2-lite").max).toBe(10);
    // 对照主款：14 张 + 三个标量。两档确实没共用同一份定义。
    expect(editSlotOf("nano-banana-2").max).toBe(14);
  });
});

describe("kie Seedream 5.0（pro / lite 分档）", () => {
  it("四个 model id（两档 × 文生图/改图）各自认回正确的档案", () => {
    // kie 把文生图与改图拆成两个 model id，两个都要能认回同一个档案。
    expect(resolveArchetypeForModel(kie("seedream/5-pro-text-to-image"))?.id).toBe("kie-seedream-5-pro");
    expect(resolveArchetypeForModel(kie("seedream/5-pro-image-to-image"))?.id).toBe("kie-seedream-5-pro");
    expect(resolveArchetypeForModel(kie("seedream/5-lite-text-to-image"))?.id).toBe("kie-seedream-5-lite");
    expect(resolveArchetypeForModel(kie("seedream/5-lite-image-to-image"))?.id).toBe("kie-seedream-5-lite");
    // 4.5 伞档案没被抢走（它仍现役）。
    expect(resolveArchetypeForModel(kie("seedream"))?.id).toBe("seedream");
  });

  it("两个 mode 各自带 kie 的真实 model id 做 modelEnum（这是「两个 id」的收口处）", () => {
    // 上层只见 mode；kie 拆 id 的事实全部收在 modelEnum 里，不外泄成并行代码路径。
    const pro = getArchetypeById("kie-seedream-5-pro")!;
    expect(pro.modes.map((m) => m.modelEnum)).toEqual(["seedream/5-pro-text-to-image", "seedream/5-pro-image-to-image"]);
    const lite = getArchetypeById("kie-seedream-5-lite")!;
    expect(lite.modes.map((m) => m.modelEnum)).toEqual(["seedream/5-lite-text-to-image", "seedream/5-lite-image-to-image"]);
  });

  it("参考图上限：pro 10 / lite 14（方向反直觉，贵的那档反而收得少）", () => {
    // 5-pro-image-to-image.md：image_urls「max 10 items」。
    // seedream-5-lite-image-to-image.md：image_urls「Max 14 items」。
    expect(editSlotOf("kie-seedream-5-pro").max).toBe(10);
    expect(editSlotOf("kie-seedream-5-lite").max).toBe(14);
  });

  it("quality：pro 仅 basic|high；lite 多一档 ultra（pro 发 ultra 必 400）", () => {
    // 这正是两档不能合并成一个档案的根本原因。
    expect(optionValues("kie-seedream-5-pro", "t2i", "quality")).toEqual(["basic", "high"]);
    expect(optionValues("kie-seedream-5-lite", "t2i", "quality")).toEqual(["basic", "high", "ultra"]);
    // 文生图与改图两个端点的 quality 域一致（同档内不分叉）。
    expect(optionValues("kie-seedream-5-pro", "edit", "quality")).toEqual(["basic", "high"]);
    expect(optionValues("kie-seedream-5-lite", "edit", "quality")).toEqual(["basic", "high", "ultra"]);
  });

  it("aspect_ratio 8 档、默认 1:1，两档一致", () => {
    const expected = ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"];
    expect(optionValues("kie-seedream-5-pro", "t2i", "aspect_ratio")).toEqual(expected);
    expect(optionValues("kie-seedream-5-lite", "t2i", "aspect_ratio")).toEqual(expected);
  });
});

describe("Qwen-Image 3.0（apimart）", () => {
  it("标准与 Pro 都认回 3.0 档案，且不与 2.0 混淆", () => {
    expect(resolveArchetypeForModel(apimart("qwen-image-3.0"))?.id).toBe("qwen-image-3");
    expect(resolveArchetypeForModel(apimart("qwen-image-3.0-pro"))?.id).toBe("qwen-image-3");
    expect(resolveArchetypeForModel(apimart("qwen-image-2.0"))?.id).toBe("qwen-image");
  });

  it("改图参考图 1–3 张（2.0 档案写的是 4，别照抄）", () => {
    // qwen-image-3.0/generation.md：image_urls「1-3 images」。
    const slot = editSlotOf("qwen-image-3");
    expect(slot.min).toBe(1);
    expect(slot.max).toBe(3);
    // 对照：2.0 那份仍是 4，证明两档确实没共用同一个槽定义。
    expect(editSlotOf("qwen-image").max).toBe(4);
  });

  it("变体 modelKey = 实际发请求的 model 字符串", () => {
    const arch = getArchetypeById("qwen-image-3")!;
    expect(arch.variants!.map((v) => v.modelKey)).toEqual(["qwen-image-3.0", "qwen-image-3.0-pro"]);
    expect(arch.defaultVariantId).toBe("standard");
  });

  it("size 7 档默认 1:1、resolution 1K|2K 默认 1K", () => {
    expect(optionValues("qwen-image-3", "t2i", "size")).toEqual(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]);
    expect(optionValues("qwen-image-3", "t2i", "resolution")).toEqual(["1K", "2K"]);
  });
});

describe("FLUX.2 Pro（kie）", () => {
  it("两个 model id 都认回同一档案，两 mode 各带自己的 modelEnum", () => {
    expect(resolveArchetypeForModel(kie("flux-2/pro-text-to-image"))?.id).toBe("flux-2-pro");
    expect(resolveArchetypeForModel(kie("flux-2/pro-image-to-image"))?.id).toBe("flux-2-pro");
    const arch = getArchetypeById("flux-2-pro")!;
    expect(arch.modes.map((m) => m.modelEnum)).toEqual(["flux-2/pro-text-to-image", "flux-2/pro-image-to-image"]);
  });

  it("改图槽用 input_urls（非 image_urls）、上限 8 张", () => {
    // pro-image-to-image.md：字段名就是 input_urls，「Max 8 images」。抄成 image_urls 会静默丢参考图。
    const slot = editSlotOf("flux-2-pro");
    expect(slot.inputKey).toBe("input_urls");
    expect(slot.max).toBe(8);
  });

  it("两个端点的 aspect_ratio 域不同：改图比文生图多一档 auto", () => {
    // 这是本档案两个 mode 不共用 params 的原因；给文生图发 auto 就是 400。
    const base = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];
    expect(optionValues("flux-2-pro", "t2i", "aspect_ratio")).toEqual(base);
    expect(optionValues("flux-2-pro", "edit", "aspect_ratio")).toEqual([...base, "auto"]);
    // 21:9 在 FLUX.2 上**不存在**（Seedream 有，别串台）。
    expect(optionValues("flux-2-pro", "t2i", "aspect_ratio")).not.toContain("21:9");
  });
});
