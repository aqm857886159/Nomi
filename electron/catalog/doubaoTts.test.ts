import { describe, expect, it } from "vitest";
import { buildDoubaoReqParams, decodeDoubaoNdjsonAudio, splitDoubaoCredential } from "./doubaoTtsCodec";
import { VOLCENGINE_SPEECH_VENDOR_SEED } from "./volcengineVendor";
import { VOLCENGINE_AUDIO_MODELS } from "./volcengineAudios";

describe("豆包语音 2.0 原生接入（契约锁 + 编解码）", () => {
  it("vendor 种子：独立 openspeech 域 + none 鉴权（三头由 runner 手搓，故非 bearer）", () => {
    expect(VOLCENGINE_SPEECH_VENDOR_SEED.key).toBe("volcengine-speech");
    expect(VOLCENGINE_SPEECH_VENDOR_SEED.baseUrl).toBe("https://openspeech.bytedance.com");
    expect(VOLCENGINE_SPEECH_VENDOR_SEED.authType).toBe("none");
  });

  it("模型/mapping：text_to_audio，create 声明 NDJSON 形状 + resource-id=seed-tts-2.0", () => {
    expect(VOLCENGINE_AUDIO_MODELS).toHaveLength(1);
    const m = VOLCENGINE_AUDIO_MODELS[0];
    expect(m.modelKey).toBe("doubao-seed-tts-2.0");
    expect(m.archetypeId).toBe("volcengine-doubao-tts");
    const create = m.mappings[0].create;
    expect(m.mappings[0].taskKind).toBe("text_to_audio");
    expect(create.path).toBe("/api/v3/tts/unidirectional");
    expect(create.audioResponse).toBe("ndjson-base64");
    expect(create.headers?.["X-Api-Resource-Id"]).toBe("seed-tts-2.0");
  });

  describe("splitDoubaoCredential", () => {
    it("APP_ID:ACCESS_KEY → 拆两段并 trim", () => {
      expect(splitDoubaoCredential(" app123 : ak_secret ")).toEqual(["app123", "ak_secret"]);
    });
    it("ACCESS_KEY 含冒号：只在首个冒号切（access key 余下原样保留）", () => {
      expect(splitDoubaoCredential("app:ak:with:colons")).toEqual(["app", "ak:with:colons"]);
    });
    it("缺冒号 / 缺段 → 明确报错（不静默发空头）", () => {
      expect(() => splitDoubaoCredential("justonekey")).toThrow(/APP_ID:ACCESS_KEY/);
      expect(() => splitDoubaoCredential(":ak")).toThrow(/APP_ID:ACCESS_KEY/);
      expect(() => splitDoubaoCredential("app:")).toThrow(/APP_ID:ACCESS_KEY/);
    });
  });

  describe("buildDoubaoReqParams", () => {
    it("无情感：只 text/speaker/audio_params，不带 additions", () => {
      const p = buildDoubaoReqParams({ text: "你好", voice: "zh_female_vv_uranus_bigtts" });
      expect(p).toEqual({ text: "你好", speaker: "zh_female_vv_uranus_bigtts", audio_params: { format: "mp3", sample_rate: 24000 } });
      expect(p.additions).toBeUndefined();
    });
    it("有情感：additions 是序列化 JSON 字符串，含引号也安全转义（不破坏外层 JSON）", () => {
      const p = buildDoubaoReqParams({ text: "晚安", voice: "zh_male_liufei_uranus_bigtts", emotion: '用"撒娇"的语气' });
      expect(typeof p.additions).toBe("string");
      // 反序列化得回原文 → 证明转义正确、可被豆包解析。
      expect(JSON.parse(p.additions as string)).toEqual({ context_texts: ['用"撒娇"的语气'] });
      // 整个 body 序列化也不炸（端到端模拟 runner 的 JSON.stringify）。
      expect(() => JSON.stringify({ user: { uid: "nomi" }, req_params: p })).not.toThrow();
    });
    it("情感全空白 → 视为无情感", () => {
      expect(buildDoubaoReqParams({ text: "x", voice: "v", emotion: "   " }).additions).toBeUndefined();
    });
  });

  describe("decodeDoubaoNdjsonAudio", () => {
    const b64 = (s: string) => Buffer.from(s).toString("base64");

    it("多行 base64 块按序拼接，遇收尾码 20000000 停止", () => {
      const ndjson = [
        JSON.stringify({ code: 0, data: b64("AAA") }),
        JSON.stringify({ code: 0, data: b64("BBB") }),
        JSON.stringify({ code: 20000000 }),
        JSON.stringify({ code: 0, data: b64("SHOULD_NOT_APPEAR") }),
      ].join("\n");
      expect(decodeDoubaoNdjsonAudio(ndjson).toString()).toBe("AAABBB");
    });

    it("空行 / 非 JSON 行跳过，不炸", () => {
      const ndjson = ["", "not json", JSON.stringify({ code: 0, data: b64("X") }), "  "].join("\n");
      expect(decodeDoubaoNdjsonAudio(ndjson).toString()).toBe("X");
    });

    it("code===0 但无 data（元数据行）→ 跳过不累加", () => {
      const ndjson = [JSON.stringify({ code: 0 }), JSON.stringify({ code: 0, data: b64("Y") })].join("\n");
      expect(decodeDoubaoNdjsonAudio(ndjson).toString()).toBe("Y");
    });

    it("非 0 错误码 → 抛错带 code 与 message", () => {
      const ndjson = JSON.stringify({ code: 55000000, message: "resource ID is mismatched" });
      expect(() => decodeDoubaoNdjsonAudio(ndjson)).toThrow(/55000000.*resource ID is mismatched/);
    });
  });
});
