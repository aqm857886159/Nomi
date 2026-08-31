import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const options = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

// Runway's first-party seed_audio contract is asynchronous and is intentionally
// kept separate from Eleven's synchronous audio profiles. The same model row
// exposes two provider modes through the generic modeId discriminator.
const AUDIO_PARAMS: ModelParameterControl[] = [
  { key: "output_format", label: "输出格式", type: "select", options: options(["mp3", "wav", "ogg_opus"]), defaultValue: "mp3" },
  { key: "sample_rate", label: "采样率", type: "select", options: options([8000, 16000, 24000, 32000, 44100, 48000]), defaultValue: 44100 },
  { key: "speech_rate", label: "语速变化", type: "number", options: [], min: -50, max: 100, defaultValue: 0 },
  { key: "loudness_rate", label: "响度变化", type: "number", options: [], min: -50, max: 100, defaultValue: 0 },
  { key: "pitch_rate", label: "音高变化", type: "number", options: [], min: -12, max: 12, defaultValue: 0 },
  { key: "duration_seconds", label: "时长(秒)", type: "number", options: [], min: 0.5, max: 30, defaultValue: 5 },
  { key: "loop", label: "无缝循环", type: "boolean", options: [], defaultValue: false },
];

export const RUNWAY_AUDIO_ARCHETYPE: ModelArchetype = {
  id: "runway-audio",
  family: "runway",
  label: "Runway 音频模型",
  kind: "audio",
  defaultModeId: "sfx",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["seed_audio", "eleven_text_to_sound_v2", "eleven_multilingual_v2", "eleven_v3", "runway-audio"],
  sources: [
    {
      url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
      checkedAt: "2026-08-30",
      vendorKey: "runway",
      covers: "Runway OpenAPI /v1/sound_effect and /v1/text_to_speech seed_audio request fields, output task lifecycle, and provider model discriminator",
    },
    {
      url: "https://docs.dev.runwayml.com/guides/models/",
      checkedAt: "2026-08-30",
      vendorKey: "runway",
      covers: "Runway official model catalog includes seed_audio",
    },
  ],
  modes: [
    {
      id: "sfx",
      intent: "text",
      vendorTerm: "音效生成",
      hint: "从场景描述生成音效、对白和音乐片段",
      promptRequired: true,
      transportTaskKind: "text_to_audio",
      modelEnum: "seed_audio",
      slots: [{ kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "reference_audio_urls" }],
      params: AUDIO_PARAMS,
    },
    {
      id: "speech",
      intent: "text",
      vendorTerm: "配音生成",
      hint: "将文字生成语音；可在提示词中描述语气",
      promptRequired: true,
      transportTaskKind: "text_to_audio",
      modelEnum: "seed_audio",
      slots: [],
      params: AUDIO_PARAMS,
    },
  ],
};
