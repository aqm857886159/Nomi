import { describe, it, expect } from "vitest";
import { getArchetypeById, resolveArchetypeForModel, specializeArchetypeForVariant } from "./index";

// 钉死「通用第一」：同一个模型，经任意供应商接入，都解析到同一套档案 —— 解析器**不看 vendor**
// （供应商无关识别是设计特性：seed-tts / 中转 Seedance 等档案就是给任意中转用的）。中转与内置家的
// 传输差异不在识别层解决，而由「标准参考面永远在场」不变量吸收（buildReferenceExtras +
// referenceInputParams，各自测试锁死，2026-07-24 根因收口）。
// 认不出的模型 → null（渲染层走通用回退）。'seedance-2' 不误命中 'seedance-2-fast'。

describe("resolveArchetypeForModel — 供应商无关的识别桥", () => {
  it("显式 meta.archetypeId（我们 seed 的记录）直接命中", () => {
    const a = resolveArchetypeForModel({ modelKey: "bytedance/seedance-2", meta: { archetypeId: "seedance-2" } });
    expect(a?.id).toBe("seedance-2");
  });

  it("画布节点持久化的 meta.archetype.id 直接命中，即使供应商 modelKey 不在 patterns", () => {
    const a = resolveArchetypeForModel({
      modelKey: "vendor-specific-key-not-in-patterns",
      meta: { archetype: { id: "volcengine-seedream", modeId: "edit" } },
    });
    expect(a?.id).toBe("volcengine-seedream");
  });

  it("无 meta，仅靠 modelKey 身份命中（用户自接、非 kie 也行）", () => {
    expect(resolveArchetypeForModel({ modelKey: "bytedance/seedance-2" })?.id).toBe("seedance-2");
  });

  it("同一模型、不同供应商的各种标识都命中同一档案", () => {
    // 不传 vendor —— 解析器根本不关心供应商
    const variants = [
      { modelKey: "seedance-2" }, // 某中转站用短 key
      { modelKey: "seedance2" }, // 无连字符变体
      { modelKey: "x", modelAlias: "fal-ai/seedance-2" }, // fal 风格别名
      { modelKey: "models/bytedance/seedance-2" }, // 带 models/ 前缀
    ];
    for (const v of variants) {
      expect(resolveArchetypeForModel(v)?.id).toBe("seedance-2");
    }
  });

  it("kie Seedance 变体合并：标准/Fast/Mini 三 modelKey 都解析到同一基础档案 seedance-2（不再多份）", () => {
    // 合并后只剩 1 份 seedance-2；标准 + Fast + Mini 的 modelKey 都命中它（identifierPatterns 收纳）。
    expect(resolveArchetypeForModel({ modelKey: "bytedance/seedance-2" })?.id).toBe("seedance-2");
    expect(resolveArchetypeForModel({ modelKey: "bytedance/seedance-2-fast" })?.id).toBe("seedance-2");
    expect(resolveArchetypeForModel({ modelKey: "bytedance/seedance-2-mini" })?.id).toBe("seedance-2");
    expect(getArchetypeById("seedance-2-fast")).toBeNull();
    // 'seedance-2' 不误命中 'seedance-2-mini'（末段相等判定）：mini 串解到档案，但档案 id 仍是 seedance-2。
  });

  it("kie Seedance 变体：标准含 4k（2026-06 4K 升级），fast/mini 收窄到 480/720", () => {
    const base = getArchetypeById("seedance-2")!;
    const resOf = (variantId: string) =>
      specializeArchetypeForVariant(base, variantId).modes[0].params.find((p) => p.key === "resolution")!.options.map((o) => o.value);
    expect(resOf("standard")).toEqual(["480p", "720p", "1080p", "4k"]);
    expect(resOf("fast")).toEqual(["480p", "720p"]);
    expect(resOf("mini")).toEqual(["480p", "720p"]);
    // 三变体齐备，默认标准。
    expect(base.variants?.map((v) => v.id)).toEqual(["standard", "fast", "mini"]);
    expect(base.defaultVariantId).toBe("standard");
  });

  it("apimart Seedance：当前三模式 + 旧 face 串都解析到同一基础档案", () => {
    // catalog 只剩 1 行；当前三模式和历史 face/fast-face modelKey 都命中同一档案。
    for (const modelKey of [
      "doubao-seedance-2.0",
      "doubao-seedance-2.0-fast",
      "doubao-seedance-2.0-mini",
      "doubao-seedance-2.0-face",
      "doubao-seedance-2.0-fast-face",
    ]) {
      expect(resolveArchetypeForModel({ modelKey })?.id).toBe("seedance-2-apimart");
    }
    // UI 只声明三模式，默认 Fast；catalog 基础行仍是标准 modelKey。
    const arch = resolveArchetypeForModel({ modelKey: "doubao-seedance-2.0" });
    expect(arch?.variants?.map((v) => v.id)).toEqual(["standard", "fast", "mini"]);
    expect(arch?.variants?.map((v) => v.label)).toEqual(["Seedance 2.0", "Fast", "Mini"]);
    expect(arch?.defaultVariantId).toBe("fast");
    expect(arch?.catalogModelKey).toBe("doubao-seedance-2.0");
  });

  it("apimart Seedance 清晰度按当前模式约束：标准含 4k；Fast/Mini 仅 480/720", () => {
    const base = getArchetypeById("seedance-2-apimart")!;
    const resOf = (variantId: string) =>
      specializeArchetypeForVariant(base, variantId).modes[0].params.find((p) => p.key === "resolution")!.options.map((o) => o.value);
    expect(resOf("standard")).toEqual(["480p", "720p", "1080p", "4k"]);
    expect(resOf("fast")).toEqual(["480p", "720p"]);
    expect(resOf("mini")).toEqual(["480p", "720p"]);
    // 旧 fast-face id 在迁移完成前也按 Fast 收窄。
    expect(resOf("fast-face")).toEqual(["480p", "720p"]);
  });

  it("Grok Imagine 1.5：官方主键/兼容别名命中同一视频档案", () => {
    expect(resolveArchetypeForModel({ modelKey: "grok-imagine-1.5-video-apimart" })?.id).toBe("grok-imagine-1.5-video");
    expect(resolveArchetypeForModel({ modelKey: "grok-imagine-1.5-video-ext" })?.id).toBe("grok-imagine-1.5-video");
    const arch = getArchetypeById("grok-imagine-1.5-video")!;
    expect(arch.modes.map((m) => m.id)).toEqual(["t2v", "i2v"]);
    expect(arch.modes.find((m) => m.id === "i2v")?.slots[0]).toMatchObject({ inputKey: "image_urls", max: 7 });
    expect(arch.modes.find((m) => m.id === "i2v")?.params.map((p) => p.key)).toEqual(["quality", "duration"]);
  });

  it("火山方舟 Seedance 2.0：标准/Fast/Mini 解析到火山专属档案", () => {
    expect(resolveArchetypeForModel({ modelKey: "doubao-seedance-2-0-260128" })?.id).toBe("volcengine-seedance-2");
    expect(resolveArchetypeForModel({ modelKey: "doubao-seedance-2-0-fast-260128" })?.id).toBe("volcengine-seedance-2");
    expect(resolveArchetypeForModel({ modelKey: "doubao-seedance-2-0-mini-260615" })?.id).toBe("volcengine-seedance-2");
    const arch = getArchetypeById("volcengine-seedance-2")!;
    expect(arch.variants?.map((v) => v.id)).toEqual(["standard", "fast", "mini"]);
  });

  it("火山方舟 Seedance Fast/Mini 变体：resolution 收窄到 480/720", () => {
    const base = getArchetypeById("volcengine-seedance-2")!;
    const resOf = (variantId: string) =>
      specializeArchetypeForVariant(base, variantId).modes[0].params.find((p) => p.key === "resolution")!.options.map((o) => o.value);
    expect(resOf("standard")).toEqual(["480p", "720p", "1080p", "4k"]);
    expect(resOf("fast")).toEqual(["480p", "720p"]);
    expect(resOf("mini")).toEqual(["480p", "720p"]);
  });

  it("认不出的模型 → null（渲染层走通用回退）", () => {
    expect(resolveArchetypeForModel({ modelKey: "acme/some-unknown-video-model" })).toBeNull();
    expect(resolveArchetypeForModel(null)).toBeNull();
    expect(resolveArchetypeForModel({})).toBeNull();
  });

  it("首帧模式的标量参数复用 ModelParameterControl 形状（规则 1，非并行类型）", () => {
    const a = getArchetypeById("seedance-2");
    const first = a?.modes.find((m) => m.id === "first");
    expect(first?.params.map((p) => p.key)).toEqual(["resolution", "aspect_ratio", "duration", "generate_audio"]);
    expect(first?.slots).toEqual([{ kind: "first_frame", label: "首帧", min: 1, max: 1 }]);
  });
});

describe("resolveArchetypeForModel — vendorKey 只做 B 层特化，不改变解析（2026-07-24 钉死）", () => {
  it("自定义中转 vendor 照常按身份命中（seed-tts/中转 Seedance 类档案就是给中转用的）", () => {
    expect(resolveArchetypeForModel({ modelKey: "gpt-image-2", vendorKey: "my-relay" })?.id).toBe("gpt-image-2");
    expect(resolveArchetypeForModel({ modelKey: "bytedance/seedance-2", vendorKey: "one-api-xx" })?.id).toBe("seedance-2");
  });

  it("vendorKey null/undefined/空串与传内置家一致命中（必传只为逼调用点显式表态）", () => {
    expect(resolveArchetypeForModel({ modelKey: "gpt-image-2", vendorKey: null })?.id).toBe("gpt-image-2");
    expect(resolveArchetypeForModel({ modelKey: "gpt-image-2", vendorKey: undefined })?.id).toBe("gpt-image-2");
    expect(resolveArchetypeForModel({ modelKey: "gpt-image-2", vendorKey: "kie" })?.id).toBe("gpt-image-2");
  });
});
