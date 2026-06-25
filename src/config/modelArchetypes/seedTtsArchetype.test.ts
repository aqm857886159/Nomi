import { describe, expect, it } from "vitest";
import { archetypeParameterControls, resolveArchetypeForModel } from "./index";

// 中转 seed-tts-2.0 配音档案（OpenAI 兼容路，火山音色，无情感字段）。与原生 doubao-seed-tts-2.0 并存且不串。
describe("中转 Seed TTS 档案解析", () => {
  it("按 modelKey 'seed-tts-2.0' 身份解析到 seed-tts 档案（任意中转 vendor）", () => {
    const a = resolveArchetypeForModel({ modelKey: "seed-tts-2.0", vendorKey: "code-newcli-com" });
    expect(a?.id).toBe("seed-tts");
    expect(a?.kind).toBe("audio");
    expect(a?.modes).toHaveLength(1);
  });

  it("不与原生 doubao-seed-tts-2.0 串档（末段精确匹配，互不命中）", () => {
    expect(resolveArchetypeForModel({ modelKey: "doubao-seed-tts-2.0", vendorKey: "volcengine-speech" })?.id).toBe("volcengine-doubao-tts");
    expect(resolveArchetypeForModel({ modelKey: "seed-tts-2.0", vendorKey: "code-newcli-com" })?.id).toBe("seed-tts");
  });

  it("参数 = 火山音色(select)，且**无**情感字段（OpenAI 兼容 body 没这个位）", () => {
    const controls = archetypeParameterControls({ modelKey: "seed-tts-2.0", vendorKey: "code-newcli-com" });
    expect(controls?.map((c) => c.key)).toEqual(["voice"]);
    const voice = controls?.find((c) => c.key === "voice");
    expect(voice?.defaultValue).toBe("zh_female_vv_uranus_bigtts");
    expect(controls?.some((c) => c.key === "emotion")).toBe(false);
  });
});
