import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// 豆包语音 2.0 档案（火山原生配音）。与 nomi-audio（OpenAI 兼容）分开是因为：
//   ① 音色集不同（豆包 2.0 用 *_uranus_bigtts，非 OpenAI 的 alloy/echo）；
//   ② 多一个「情感/语气」自然语言参——这正是走原生而非 OpenAI 兼容的理由：兼容协议没这个字段位。
//   ③ 本切片只做 TTS，无 transcribe 模式（转写仍走 apimart whisper）。
// 仍走现有通用 NodeParams 渲染（P4 通用系统填槽），不写专属 UI。

// 实查确认的 2.0 官方音色（uranus 后缀=2.0；接入手册实测 Vivi/刘飞/云舟 效果好，灿灿几乎无变化故不收）。
const DOUBAO_VOICE_OPTIONS: ModelParameterControl["options"] = [
  { value: "zh_female_vv_uranus_bigtts", label: "Vivi · 女声·自然（默认）" },
  { value: "zh_male_liufei_uranus_bigtts", label: "刘飞 · 男声" },
  { value: "zh_male_m191_uranus_bigtts", label: "云舟 · 男声" },
];

const SPEECH_PARAMS: ModelParameterControl[] = [
  { key: "voice", label: "音色", type: "select", options: DOUBAO_VOICE_OPTIONS, defaultValue: "zh_female_vv_uranus_bigtts" },
  // 情感/语气：用大白话描述，模型据此演绎（豆包 2.0 招牌能力，喂进 req_params.additions.context_texts）。
  // 留空 = 不加情感指令，按音色默认朗读。
  { key: "emotion", label: "情感/语气", type: "text", options: [], placeholder: "用大白话描述，如「用撒娇甜蜜的语气」「沉稳一点，像在讲睡前故事」" },
];

export const DOUBAO_TTS_ARCHETYPE: ModelArchetype = {
  id: "volcengine-doubao-tts",
  family: "doubao-tts",
  label: "豆包语音 2.0",
  kind: "audio",
  defaultModeId: "speech",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["doubao-seed-tts-2.0", "doubao-tts-2.0"],
  modes: [
    {
      id: "speech",
      intent: "text",
      vendorTerm: "豆包配音",
      hint: "文字转语音 · 可用大白话描述情感语气",
      promptRequired: true,
      transportTaskKind: "text_to_audio",
      slots: [],
      params: SPEECH_PARAMS,
    },
  ],
};
