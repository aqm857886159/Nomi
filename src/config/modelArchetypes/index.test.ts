import { describe, it, expect } from "vitest";
import { getArchetypeById, resolveArchetypeForModel } from "./index";

// 钉死「通用第一」：同一个模型，经任意供应商接入，都解析到同一套档案 —— 解析器**不看 vendor**。
// 认不出的模型 → null（渲染层走通用回退）。'seedance-2' 不误命中 'seedance-2-fast'。

describe("resolveArchetypeForModel — 供应商无关的识别桥", () => {
  it("显式 meta.archetypeId（我们 seed 的记录）直接命中", () => {
    const a = resolveArchetypeForModel({ modelKey: "bytedance/seedance-2", meta: { archetypeId: "seedance-2" } });
    expect(a?.id).toBe("seedance-2");
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

  it("seedance-2 与 seedance-2-fast 是两份档案，互不误命中（前缀相近也分得清）", () => {
    expect(resolveArchetypeForModel({ modelKey: "bytedance/seedance-2-fast" })?.id).toBe("seedance-2-fast");
    expect(resolveArchetypeForModel({ modelKey: "bytedance/seedance-2" })?.id).toBe("seedance-2");
  });

  it("seedance-2-fast 同族扩展：同模式形状，唯清晰度收成 480/720（无 1080）", () => {
    const fast = getArchetypeById("seedance-2-fast");
    expect(fast?.modes.map((m) => m.id)).toEqual(["first", "firstlast", "omni"]);
    const firstRes = fast?.modes[0].params.find((p) => p.key === "resolution");
    expect(firstRes?.options.map((o) => o.value)).toEqual(["480p", "720p"]);
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
