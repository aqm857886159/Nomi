import type { ModelArchetype } from "./types";
import {
  runwaySeedAudioParams,
  RUNWAY_SEED_AUDIO_REFERENCE_MAX,
} from "../../../electron/shared/audioCapabilities/runwayAudioWireFacts";

/**
 * **Runway Seed Audio —— 模型身份档案（一个模型一个档案，P4）。**
 *
 * 这是 Runway 自家的一手音频产品，也是本轮拆解里**唯一**真正同时拥有音效与配音两种能力的
 * 模型（官方 union 里 `seed_audio` 同时出现在 `/v1/sound_effect` 与 `/v1/text_to_speech` 两个
 * `oneOf` 中）。被删掉的平台档案 `runway-audio` 把这个**双模态**能力当成了「Runway 音频」的
 * 通用形状，发给另外三个单模态的 Eleven 产品——于是一个纯音效模型对外宣称自己会配音。
 *
 * 参数不在这里重打：由 `runwaySeedAudioParams()` 从
 * `electron/shared/audioCapabilities/runwayAudioWireFacts.ts` 那张官方 OpenAPI 逐字表构建。
 * 注意它**只有 5 个**参数——旧平台档案多给的 `duration_seconds` / `loop` 是
 * `eleven_text_to_sound_v2` 的字段，spec 里 seed_audio 根本没有，实测也到不了 wire。
 *
 * 依据：https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json，checkedAt 2026-09-02。
 */

const RUNWAY_OPENAPI_SOURCE = {
  url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
  checkedAt: "2026-09-02",
  vendorKey: "runway",
} as const;

export const RUNWAY_SEED_AUDIO_ARCHETYPE: ModelArchetype = {
  id: "runway-seed-audio",
  family: "runway-seed-audio",
  label: "Runway Seed Audio",
  kind: "audio",
  defaultModeId: "sfx",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["seed_audio"],
  // 存量画布节点持久化的是 meta.archetype.id="runway-audio"（已删的平台档案）；
  // 靠 legacyIds + 模型身份匹配迁到这里（读时映射，不写库）。
  legacyIds: ["runway-audio"],
  sources: [
    {
      ...RUNWAY_OPENAPI_SOURCE,
      covers:
        "/v1/sound_effect 与 /v1/text_to_speech 两个 oneOf 里的 seed_audio 变体：promptText maxLength 2048；speechRate/loudnessRate int −50..100、pitchRate int −12..12、sampleRate enum 6 值、outputFormat enum [wav,mp3,ogg_opus]；sound_effect 侧有 referenceAudios maxItems 3；text_to_speech 侧的 voice 是可选的 SeedReferenceVoice{type:\"reference-audio\",audioUri}；**无** duration / loop 字段",
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
      // referenceAudios maxItems 3（仅 sound_effect 端点有此字段）。
      slots: [{ kind: "audio_ref", label: "参考音频", min: 0, max: RUNWAY_SEED_AUDIO_REFERENCE_MAX, inputKey: "reference_audio_urls" }],
      params: runwaySeedAudioParams(),
    },
    {
      id: "speech",
      intent: "text",
      vendorTerm: "配音生成",
      hint: "将文字生成语音；可在提示词中描述语气",
      promptRequired: true,
      transportTaskKind: "text_to_audio",
      modelEnum: "seed_audio",
      // text_to_speech 端点的 voice 是可选的**单条**克隆音频（SeedReferenceVoice.audioUri），
      // 与 sound_effect 的 referenceAudios 数组不是同一个字段，故上限 1 且用不同的 inputKey。
      slots: [{ kind: "audio_ref", label: "克隆音色参考", min: 0, max: 1, inputKey: "voice_reference_audio_url" }],
      params: runwaySeedAudioParams(),
    },
  ],
};
