import type { ModelParameterControl } from "../videoCapabilities/types";

/**
 * **Runway 音频 union 的线缆事实：唯一真相源。**
 * （视频侧 `runwayWireFacts.ts` / 图像侧 `runwayImageWireFacts.ts` 的音频对偶，第三次同构）
 *
 * 依据 = Runway 官方 OpenAPI 规范（一手、机读）：
 *   https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json
 *   checkedAt `2026-09-02`。
 *   `/v1/sound_effect` 是 **2 变体**的 `oneOf`（`seed_audio` / `eleven_text_to_sound_v2`），
 *   `/v1/text_to_speech` 是 **3 变体**的 `oneOf`（`seed_audio` / `eleven_multilingual_v2` / `eleven_v3`），
 *   两者 discriminator 均为 `model`。下面每个数字与枚举都是逐字抄自该 spec，
 *   不是记忆、不是推断。
 *
 * **为什么这张表必须存在**（2026-09-02 实测的缺陷）：此前 4 个完全不同的音频产品共用一个
 * **平台档案** `runway-audio`，它给这 4 个产品发**同一套 7 个参数**
 * （`output_format / sample_rate / speech_rate / loudness_rate / pitch_rate /
 * duration_seconds / loop`）。拿官方 spec 逐模型对账，**没有任何一个模型收得下这 7 个**：
 *   - `seed_audio`：收前 5 个，**不收** `duration` / `loop`（这俩是 Eleven SFX 的字段）；
 *   - `eleven_text_to_sound_v2`：只收 `duration` / `loop`，其余 **5 个全是编的**；
 *   - `eleven_multilingual_v2`：官方**一个可调参数都没有**（只有 promptText + voice），7 个全是编的；
 *   - `eleven_v3`：官方给的是 `stability / similarityBoost / style / speed / useSpeakerBoost /
 *     languageCode / applyTextNormalization / seed` 这**另外一套**，与档案给的 7 个**零交集**。
 * 实测这些多余控件**根本到不了 wire**（mapping body 里没有对应模板串），即用户调了没有任何效果、
 * 也不会报错——比发非法值更隐蔽的一类撒谎。
 *
 * 还有**模式**层的并集谎言：该档案同时声明 `sfx` + `speech` 两个模式给全部 4 个模型，而官方
 * union 里 `eleven_text_to_sound_v2` 只在 `/v1/sound_effect`（纯 SFX 模型，**没有** speech），
 * `eleven_multilingual_v2` / `eleven_v3` 只在 `/v1/text_to_speech`（纯 TTS 模型，**没有** sfx）。
 * 即一个音效模型对外宣称自己会配音。
 *
 * 依赖方向（分层纪律 R26）：**catalog 可以 import shared；shared 永远不 import catalog；
 * src/ 只可以 import `electron/shared/`。** 音频档案住 `src/config/modelArchetypes/`、
 * 传输归一器住 `electron/catalog/`——两侧唯一都够得着的中立地就是 `electron/shared/`。
 * 两个消费者：
 *   1. 能力面：各音频档案的 params 由本文件的 `*Params()` **构建**（不重打字面量），UI 只给得出合法值；
 *   2. 传输边界：`electron/catalog/runwayOfficial.ts` 的 `normalizeRunwayAudioReferences`
 *      import 同一张表做纵深防御校验（防绕过 UI 的 headless / MCP 调用方）。
 */

/** Runway 音频两个端点的 union 判别串（5 个变体、4 个不同产品）。 */
export type RunwayAudioModelKey =
  | "seed_audio"
  | "eleven_text_to_sound_v2"
  | "eleven_multilingual_v2"
  | "eleven_v3";

/**
 * 每个模型**在哪个端点上存在**（即它真正拥有哪些能力）。
 * 逐字对应 spec 里两个 `oneOf` 的成员表——这就是「模式并集谎言」的解药：
 * 档案只声明自己在表里为 true 的那个模式。
 */
export const RUNWAY_AUDIO_ENDPOINTS: Record<RunwayAudioModelKey, { soundEffect: boolean; textToSpeech: boolean }> = {
  // /v1/sound_effect 与 /v1/text_to_speech 的 oneOf 里都有 seed_audio → 唯一一个双模态产品。
  seed_audio: { soundEffect: true, textToSpeech: true },
  // 只出现在 /v1/sound_effect 的 oneOf 里。
  eleven_text_to_sound_v2: { soundEffect: true, textToSpeech: false },
  // 以下两个只出现在 /v1/text_to_speech 的 oneOf 里。
  eleven_multilingual_v2: { soundEffect: false, textToSpeech: true },
  eleven_v3: { soundEffect: false, textToSpeech: true },
};

/** `promptText.maxLength`（逐字抄自各变体；同一模型两端点一致）。 */
export const RUNWAY_AUDIO_PROMPT_MAX_LENGTH: Record<RunwayAudioModelKey, number> = {
  seed_audio: 2048,
  eleven_text_to_sound_v2: 3000,
  eleven_multilingual_v2: 1000,
  eleven_v3: 5000,
};

/**
 * `seed_audio` 的 `referenceAudios.maxItems`（spec: 3）。
 * **只有 sound_effect 端点有这个字段**——text_to_speech 端点的 seed_audio 走的是
 * `voice: {type:"reference-audio", audioUri}`（单条克隆音频），是另一个形状。
 */
export const RUNWAY_SEED_AUDIO_REFERENCE_MAX = 3;

/**
 * `RunwayPresetVoice.presetId` 的 49 个官方预设（逐字抄自 spec，顺序照抄便于对账）。
 * `eleven_multilingual_v2` 与 `eleven_v3` 的 `voice` **在 `required` 里**（必填），
 * 且其 `oneOf` 只有 `RunwayPresetVoice` 这一个变体——故必须给用户一个选择器，
 * 不能像旧实现那样把 `Maya` 焊死在 mapping body 里（用户永远只能用一个音色）。
 */
export const RUNWAY_VOICE_PRESETS: readonly string[] = [
  "Maya", "Arjun", "Serene", "Bernard", "Billy", "Mark", "Clint", "Mabel", "Chad", "Leslie",
  "Eleanor", "Elias", "Elliot", "Grungle", "Brodie", "Sandra", "Kirk", "Kylie", "Lara", "Lisa",
  "Malachi", "Marlene", "Martin", "Miriam", "Monster", "Paula", "Pip", "Rusty", "Ragnar", "Xylar",
  "Maggie", "Jack", "Katie", "Noah", "James", "Rina", "Ella", "Mariah", "Frank", "Claudia",
  "Niki", "Vincent", "Kendrick", "Myrna", "Tom", "Wanda", "Benjamin", "Kiana", "Rachel",
];

/** `seed_audio` 的 `sampleRate.enum`（逐字）。 */
export const RUNWAY_SEED_AUDIO_SAMPLE_RATES: readonly number[] = [8000, 16000, 24000, 32000, 44100, 48000];

/** `seed_audio` 的 `outputFormat.enum`（逐字，spec 顺序是 wav 在前）。 */
export const RUNWAY_SEED_AUDIO_OUTPUT_FORMATS: readonly string[] = ["wav", "mp3", "ogg_opus"];

const opts = <T extends string | number>(values: readonly T[]): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

/**
 * `seed_audio` 的可调参数（两个端点共有的那 5 个）。
 * 逐字来源：`speechRate` int −50..100、`loudnessRate` int −50..100、`pitchRate` int −12..12、
 * `sampleRate` enum 6 值、`outputFormat` enum 3 值。
 * **不含** `duration` / `loop`——那是 `eleven_text_to_sound_v2` 的字段，spec 里 seed_audio 没有。
 */
export function runwaySeedAudioParams(): ModelParameterControl[] {
  return [
    { key: "output_format", label: "输出格式", type: "select", options: opts(RUNWAY_SEED_AUDIO_OUTPUT_FORMATS), defaultValue: "mp3" },
    { key: "sample_rate", label: "采样率", type: "select", options: opts(RUNWAY_SEED_AUDIO_SAMPLE_RATES), defaultValue: 44100 },
    { key: "speech_rate", label: "语速变化", type: "number", options: [], min: -50, max: 100, step: 1, defaultValue: 0 },
    { key: "loudness_rate", label: "响度变化", type: "number", options: [], min: -50, max: 100, step: 1, defaultValue: 0 },
    { key: "pitch_rate", label: "音高变化", type: "number", options: [], min: -12, max: 12, step: 1, defaultValue: 0 },
  ];
}

/**
 * `eleven_text_to_sound_v2` 在 Runway 上的可调参数（**只有这两个**）。
 * 逐字来源：`duration` number 0.5..30、`loop` boolean default false。
 * 注意与 ElevenLabs 直连档案 `eleven-sfx-v2` 的差别：直连档案把时长控件夹到 22s
 * （已认证的 canary 包线）且多一个 `prompt_influence`——**Runway 这条线缆没有
 * `promptInfluence` 字段**，故这里不给；上限按 Runway spec 的 30。
 * 这正是 `vendorParams` 这条轴的用途：同一个产品、同一个档案，取值按供应商分家。
 */
export function runwayElevenSfxParams(): ModelParameterControl[] {
  return [
    { key: "duration_seconds", label: "时长(秒)", type: "number", options: [], min: 0.5, max: 30, step: 0.5, defaultValue: 5 },
    { key: "loop", label: "无缝循环", type: "boolean", options: [], defaultValue: false },
  ];
}

/** 音色选择器：`eleven_multilingual_v2` / `eleven_v3` 必填的 `voice.presetId`。 */
export function runwayVoicePresetParam(): ModelParameterControl {
  return {
    key: "voice_preset_id",
    label: "音色",
    type: "select",
    options: opts(RUNWAY_VOICE_PRESETS),
    defaultValue: "Maya",
  };
}

/**
 * `eleven_v3` 在 Runway 上的可调参数（逐字来源见各行）。
 * `eleven_multilingual_v2` **没有**这些——它的 spec 里除 promptText/voice/model 外一个属性都没有，
 * 故那个档案只有音色一个控件。这个差异正是平台档案抹掉的东西。
 */
export function runwayElevenV3Params(): ModelParameterControl[] {
  return [
    runwayVoicePresetParam(),
    // stability / similarityBoost / style: number 0..1；speed: number 0.7..1.2（逐字）。
    { key: "stability", label: "稳定度", type: "number", options: [], min: 0, max: 1, step: 0.05, defaultValue: 0.5 },
    { key: "similarity_boost", label: "相似度", type: "number", options: [], min: 0, max: 1, step: 0.05, defaultValue: 0.75 },
    { key: "style", label: "风格强度", type: "number", options: [], min: 0, max: 1, step: 0.05, defaultValue: 0 },
    { key: "speed", label: "语速", type: "number", options: [], min: 0.7, max: 1.2, step: 0.05, defaultValue: 1 },
    { key: "use_speaker_boost", label: "增强音色相似度", type: "boolean", options: [], defaultValue: true },
    // languageCode: string minLength 2 maxLength 5（spec 未给枚举）。给自由文本会让用户猜格式（D1），
    // 故给一个「自动 + 常用语言」的选择器，值全部是合法的 2~5 位 BCP-47 串。
    {
      key: "language_code",
      label: "语言",
      type: "select",
      options: [
        { value: "", label: "自动" },
        ...opts(["zh", "en", "ja", "ko", "de", "fr", "es"]),
      ],
      defaultValue: "",
    },
    // applyTextNormalization: enum ["auto","on","off"]（逐字）。
    { key: "apply_text_normalization", label: "文本规范化", type: "select", options: opts(["auto", "on", "off"]), defaultValue: "auto" },
  ];
}

/** `eleven_multilingual_v2` 在 Runway 上的可调参数：**只有必填的音色**（spec 无其他属性）。 */
export function runwayElevenMultilingualParams(): ModelParameterControl[] {
  return [runwayVoicePresetParam()];
}
