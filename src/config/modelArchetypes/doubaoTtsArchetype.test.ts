import { describe, expect, it } from "vitest";
import { archetypeParameterControls, resolveArchetypeForModel } from "./index";

// 用户可见面（R8 可在无凭证下验证的切片）：豆包语音模型 → 档案解析 → 节点参数控件正确。
// 渲染本身走现有通用 NodeParams（select/emotion-text 已被数十个模型复用），故只需证「控件集对」。

describe("豆包语音档案解析（用户可见参数面）", () => {
  const model = { modelKey: "doubao-seed-tts-2.0", vendorKey: "volcengine-speech", meta: { archetypeId: "volcengine-doubao-tts" } };

  it("按 modelKey 身份也能解析（不依赖 meta，通用第一 P4）", () => {
    const byIdentity = resolveArchetypeForModel({ modelKey: "doubao-seed-tts-2.0", vendorKey: "volcengine-speech" });
    expect(byIdentity?.id).toBe("volcengine-doubao-tts");
    expect(byIdentity?.kind).toBe("audio");
    expect(byIdentity?.modes).toHaveLength(1); // 只 TTS，无 transcribe
  });

  it("默认模式参数控件 = 音色(select) + 情感(text)，默认音色为 2.0 Vivi", () => {
    const controls = archetypeParameterControls(model);
    expect(controls?.map((c) => c.key)).toEqual(["voice", "emotion"]);
    const voice = controls?.find((c) => c.key === "voice");
    expect(voice?.type).toBe("select");
    expect(voice?.defaultValue).toBe("zh_female_vv_uranus_bigtts");
    expect(voice?.options.every((o) => String(o.value).includes("_uranus_bigtts"))).toBe(true); // 全是 2.0 音色
    const emotion = controls?.find((c) => c.key === "emotion");
    expect(emotion?.type).toBe("text");
    expect(emotion?.placeholder).toMatch(/语气/); // 引导用大白话描述情感
  });
});
