import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// 中转 seed-tts-2.0 配音档案（OpenAI 兼容 /v1/audio/speech，经 Xcode.hk 等 new-api 中转）。
// 与原生 `volcengine-doubao-tts` 的区别（用户拍板「中转为主 + 保留原生」并存）：
//   ① 协议：标准 OpenAI 兼容（Bearer + JSON body + 直接回 mp3 二进制），用中转的现有 key 即接即用——
//      无需用户自己的火山 APP_ID:ACCESS_KEY（原生那条的门槛）；传输 op = NEWAPI_AUDIO_TTS_OP。
//   ② 不带「情感/语气」字段：OpenAI 兼容 body 没有这个位（原生 NDJSON 的 additions 才有）。需要情感控制走原生。
// 音色沿用火山 2.0 官方音色（seed-tts-2.0 本质是火山模型，只是经中转暴露成 OpenAI 形状）。

const VOICE_OPTIONS: ModelParameterControl["options"] = [
  { value: "zh_female_vv_uranus_bigtts", label: "Vivi · 女声·自然（默认）" },
  { value: "zh_male_liufei_uranus_bigtts", label: "刘飞 · 男声" },
  { value: "zh_male_m191_uranus_bigtts", label: "云舟 · 男声" },
];

const SPEECH_PARAMS: ModelParameterControl[] = [
  { key: "voice", label: "音色", type: "select", options: VOICE_OPTIONS, defaultValue: "zh_female_vv_uranus_bigtts" },
];

export const SEED_TTS_ARCHETYPE: ModelArchetype = {
  id: "seed-tts",
  family: "seed-tts",
  label: "Seed TTS 2.0（中转）",
  kind: "audio",
  defaultModeId: "speech",
  transportTaskKind: "text_to_audio",
  // 末段精确匹配：seed-tts-2.0 / seed-tts。不会误命中原生的 doubao-seed-tts-2.0（末段不等）。
  identifierPatterns: ["seed-tts-2.0", "seed-tts"],
  modes: [
    {
      id: "speech",
      intent: "text",
      vendorTerm: "配音生成",
      hint: "文字转语音 · 经中转的火山 Seed TTS 2.0",
      promptRequired: true,
      transportTaskKind: "text_to_audio",
      slots: [],
      params: SPEECH_PARAMS,
    },
  ],
};
