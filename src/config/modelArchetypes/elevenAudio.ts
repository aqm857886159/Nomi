import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";
import {
  runwayElevenSfxParams,
  runwayElevenMultilingualParams,
  runwayElevenV3Params,
} from "../../../electron/shared/audioCapabilities/runwayAudioWireFacts";

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
  // Runway 也转售这个模型，其行原挂平台档案 runway-audio（已删）；存量节点靠 legacyIds 迁到这里。
  legacyIds: ["runway-audio"],
  sources: [
    { url: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert", checkedAt: "2026-08-30", vendorKey: "elevenlabs", covers: "POST /v1/text-to-speech/{voice_id}; binary audio with output_format and model_id=eleven_v3." },
    {
      url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
      checkedAt: "2026-09-02",
      vendorKey: "runway",
      covers:
        "/v1/text_to_speech 的 eleven_v3 变体：promptText maxLength 5000；voice **必填**且只接受 RunwayPresetVoice（49 个 presetId 枚举）；stability/similarityBoost/style number 0..1、speed 0.7..1.2、useSpeakerBoost bool、languageCode 2..5 字符、applyTextNormalization enum [auto,on,off]、seed int。**无** voice_id 自由文本（那是 ElevenLabs 直连的形状）",
    },
  ],
  modes: [{
    id: "speech",
    intent: "text",
    vendorTerm: "配音生成",
    hint: "情绪与对白表现力优先",
    promptRequired: true,
    slots: [],
    // 经 Runway 时参数域完全不同：音色是 49 个预设的枚举（必填）而不是自由 voice_id 文本，
    // 且多出 applyTextNormalization。身份/模式形状不变，只 params 这一层分供应商（P4）。
    vendorParams: { runway: runwayElevenV3Params() },
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
  // Runway 也转售这个模型，其行原挂平台档案 runway-audio（已删）；存量节点靠 legacyIds 迁到这里。
  legacyIds: ["runway-audio"],
    sources: [
      { url: "https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert", checkedAt: "2026-08-30", vendorKey: "elevenlabs", covers: "POST /v1/sound-generation; duration 0.5-30s in the upstream docs; Nomi caps the control at 22s to stay within the certified v2 canary envelope." },
      {
        url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
        checkedAt: "2026-09-02",
        vendorKey: "runway",
        covers:
          "/v1/sound_effect 的 eleven_text_to_sound_v2 变体：promptText maxLength 3000；**只有** duration number 0.5..30 与 loop bool(default false) 两个可调字段；**无** promptInfluence（那是 ElevenLabs 直连才有的），也**不在** /v1/text_to_speech 的 oneOf 里（纯音效模型，没有配音能力）",
      },
    ],
  modes: [{
    id: "sfx",
    intent: "text",
    vendorTerm: "音效生成",
    hint: "生成单次或无缝循环音效",
    promptRequired: true,
    slots: [],
    // 经 Runway 时：无 promptInfluence 字段，且时长上限是 spec 的 30s（直连侧夹到 22s 是
    // 我们已认证的 canary 包线，不是 Runway 这条线缆的约束）。
    vendorParams: { runway: runwayElevenSfxParams() },
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

/**
 * **Eleven Multilingual v2 —— 模型身份档案（新建，2026-09-02 拆 `runway-audio` 平台档案）。**
 *
 * 为什么必须新建而不是复用 `eleven-v3`：这是 ElevenLabs 的**上一代多语种 TTS 模型**，与 v3
 * 是两个不同产品（官方 union 里两个独立的判别串、promptText 上限也不同：1000 vs 5000）。
 * 更硬的分档理由是**参数域根本不同**——照 Runway 官方 spec，`eleven_multilingual_v2` 除
 * `promptText` / `voice` / `model` 外**一个属性都没有**，而 v3 有 stability / similarityBoost /
 * style / speed / useSpeakerBoost / languageCode / applyTextNormalization / seed 一整套。
 * 合档就必然要发一套并集，那正是被删掉的平台档案 `runway-audio` 犯的错。
 *
 * 我们目前**只经 Runway** 提供这个模型（ElevenLabs 直连侧未接），故 params 直接写 Runway 的
 * 形状（仅必填音色），不需要 vendorParams 分家；日后接直连再按 P4 加那一层。
 */
export const ELEVEN_MULTILINGUAL_V2_ARCHETYPE: ModelArchetype = {
  id: "eleven-multilingual-v2",
  family: "elevenlabs-speech",
  label: "Eleven Multilingual v2",
  kind: "audio",
  defaultModeId: "speech",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["eleven_multilingual_v2", "eleven-multilingual-v2"],
  // 这一行原挂平台档案 runway-audio（已删）；存量节点靠 legacyIds + 模型身份匹配迁到这里。
  legacyIds: ["runway-audio"],
  sources: [
    {
      url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
      checkedAt: "2026-09-02",
      vendorKey: "runway",
      covers:
        "/v1/text_to_speech 的 eleven_multilingual_v2 变体：required=[promptText,voice,model]；promptText maxLength 1000；voice 只接受 RunwayPresetVoice（49 个 presetId 枚举）；**除此之外没有任何可调属性**（无 stability/speed/languageCode 等，那些是 eleven_v3 才有的）；**不在** /v1/sound_effect 的 oneOf 里（纯 TTS 模型，没有音效能力）",
    },
  ],
  modes: [{
    id: "speech",
    intent: "text",
    vendorTerm: "配音生成",
    hint: "多语种配音；音色从官方预设中选择",
    promptRequired: true,
    transportTaskKind: "text_to_audio",
    modelEnum: "eleven_multilingual_v2",
    slots: [],
    // 官方 spec 里这个模型唯一可调的就是必填音色——**一个控件**，不多给。
    params: runwayElevenMultilingualParams(),
  }],
};
