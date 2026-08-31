import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const options = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) || "自动" }));

export const ELEVEN_V3_ARCHETYPE: ModelArchetype = {
  id: "eleven-v3",
  family: "elevenlabs-speech",
  label: "Eleven v3",
  kind: "audio",
  defaultModeId: "speech",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["eleven_v3", "eleven-v3"],
  sources: [{ url: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert", checkedAt: "2026-08-30", vendorKey: "elevenlabs", covers: "POST /v1/text-to-speech/{voice_id}; binary audio with output_format and model_id=eleven_v3." }],
  modes: [{
    id: "speech",
    intent: "text",
    vendorTerm: "配音生成",
    hint: "情绪与对白表现力优先",
    promptRequired: true,
    slots: [],
    params: [
      { key: "voice_id", label: "音色 ID", type: "text", options: [], defaultValue: "JBFqnCBsd6RMkjVDRZzb" },
      { key: "language_code", label: "语言", type: "select", options: options(["", "zh", "en", "ja", "ko", "de", "fr", "es"]), defaultValue: "" },
      { key: "stability", label: "稳定度", type: "number", options: [], min: 0, max: 1, defaultValue: 0.5 },
      { key: "similarity_boost", label: "相似度", type: "number", options: [], min: 0, max: 1, defaultValue: 0.75 },
      { key: "style", label: "风格强度", type: "number", options: [], min: 0, max: 1, defaultValue: 0 },
      { key: "speed", label: "语速", type: "number", options: [], min: 0.7, max: 1.2, defaultValue: 1 },
      { key: "use_speaker_boost", label: "增强音色相似度", type: "boolean", options: [], defaultValue: true },
    ],
  }],
};

export const ELEVEN_MUSIC_V2_ARCHETYPE: ModelArchetype = {
  id: "eleven-music-v2",
  family: "elevenlabs-music",
  label: "Eleven Music v2",
  kind: "audio",
  defaultModeId: "music",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["music_v2", "eleven-music-v2"],
    sources: [{ url: "https://elevenlabs.io/docs/api-reference/music/compose", checkedAt: "2026-08-30", vendorKey: "elevenlabs", covers: "POST /v1/music; prompt + music_length_ms 3000-600000ms, model_id=music_v2, binary audio. Seed is intentionally not exposed because the official contract forbids seed with prompt." }],
  modes: [{
    id: "music",
    intent: "text",
    vendorTerm: "音乐生成",
    hint: "生成完整配乐或歌曲",
    promptRequired: true,
    slots: [],
    params: [
      { key: "duration_seconds", label: "时长(秒)", type: "number", options: [], min: 3, max: 600, defaultValue: 30 },
      { key: "force_instrumental", label: "纯音乐", type: "boolean", options: [], defaultValue: false },
    ],
  }],
};

export const ELEVEN_SFX_V2_ARCHETYPE: ModelArchetype = {
  id: "eleven-sfx-v2",
  family: "elevenlabs-sfx",
  label: "Eleven Sound Effects v2",
  kind: "audio",
  defaultModeId: "sfx",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["eleven_text_to_sound_v2", "eleven-sfx-v2"],
    sources: [{ url: "https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert", checkedAt: "2026-08-30", vendorKey: "elevenlabs", covers: "POST /v1/sound-generation; duration 0.5-30s in the upstream docs; Nomi caps the control at 22s to stay within the certified v2 canary envelope." }],
  modes: [{
    id: "sfx",
    intent: "text",
    vendorTerm: "音效生成",
    hint: "生成单次或无缝循环音效",
    promptRequired: true,
    slots: [],
    params: [
      { key: "duration_seconds", label: "时长(秒)", type: "number", options: [], min: 0.5, max: 22, defaultValue: 5 },
      { key: "loop", label: "无缝循环", type: "boolean", options: [], defaultValue: false },
      { key: "prompt_influence", label: "提示词强度", type: "number", options: [], min: 0, max: 1, defaultValue: 0.3 },
    ],
  }],
};

export const ELEVEN_SCRIBE_V2_ARCHETYPE: ModelArchetype = {
  id: "eleven-scribe-v2",
  family: "elevenlabs-scribe",
  label: "Scribe v2",
  kind: "audio",
  defaultModeId: "transcribe",
  transportTaskKind: "transcribe",
  identifierPatterns: ["scribe_v2", "scribe-v2"],
  sources: [{ url: "https://elevenlabs.io/docs/api-reference/speech-to-text/convert", checkedAt: "2026-08-30", vendorKey: "elevenlabs", covers: "POST /v1/speech-to-text multipart with file and model_id=scribe_v2." }],
  modes: [{
    id: "transcribe",
    intent: "single",
    vendorTerm: "音频转写",
    hint: "转写并识别说话人和声音事件",
    promptRequired: false,
    slots: [{ kind: "audio_ref", label: "音频", min: 1, max: 1 }],
    params: [
      { key: "language_code", label: "语言", type: "select", options: options(["", "zho", "eng", "jpn", "kor", "deu", "fra", "spa"]), defaultValue: "" },
      { key: "diarize", label: "区分说话人", type: "boolean", options: [], defaultValue: true },
      { key: "tag_audio_events", label: "识别声音事件", type: "boolean", options: [], defaultValue: true },
      { key: "timestamps_granularity", label: "时间戳", type: "select", options: options(["word", "character"]), defaultValue: "word" },
    ],
  }],
};
