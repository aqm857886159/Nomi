import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const opt = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

const SOUND_KEYS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
  "Cm", "C#m", "Dm", "D#m", "Em", "Fm", "F#m", "Gm", "G#m", "Am", "A#m", "Bm",
];

export const SUNO_V55_ARCHETYPE: ModelArchetype = {
  id: "suno-v5.5",
  family: "suno",
  label: "Suno V5.5",
  kind: "audio",
  defaultModeId: "music",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["suno-v5.5", "suno-v5-5"],
  sources: [
    {
      url: "https://docs.apimart.ai/en/api-reference/audios/suno/generation.md",
      checkedAt: "2026-08-30",
      vendorKey: "apimart",
      covers: "POST /v1/music/generations with model=suno, version=v5.5 and prompt; async task_id is polled at /v1/music/tasks/{task_id}.",
    },
    {
      url: "https://docs.kie.ai/suno-api/generate-music.md",
      checkedAt: "2026-08-30",
      vendorKey: "kie",
      covers: "KIE V5_5 identity and 10-360 second custom-mode duration; KIE submission is not enabled until its required callback contract is certified.",
    },
  ],
  modes: [
    {
      id: "music",
      intent: "text",
      vendorTerm: "音乐生成",
      hint: "用描述生成完整音乐",
      promptRequired: true,
      slots: [],
      params: [
        { key: "instrumental", label: "纯音乐", type: "boolean", options: [], defaultValue: false },
        { key: "customMode", label: "自定义模式", type: "boolean", options: [], defaultValue: false },
        { key: "style", label: "风格", type: "text", options: [] },
        { key: "title", label: "标题", type: "text", options: [] },
        { key: "duration", label: "时长(秒)", type: "number", options: [], min: 10, max: 360, defaultValue: 30 },
      ],
      fixedParams: { callBackUrl: "https://nomiaqm.com/api/vendor-callbacks/kie/suno/ack" },
    },
    {
      id: "extend",
      intent: "edit",
      vendorTerm: "上传续写",
      hint: "保留原曲风格并延长一段音乐",
      promptRequired: false,
      slots: [{ kind: "audio_ref", label: "原始音频", min: 1, max: 1, inputKey: "uploadUrl", asArray: false }],
      params: [
        { key: "defaultParamFlag", label: "自定义模式", type: "boolean", options: [], defaultValue: false },
        { key: "instrumental", label: "纯音乐", type: "boolean", options: [], defaultValue: false },
        { key: "continueAt", label: "续写起点(秒)", type: "number", options: [], min: 0 },
        { key: "style", label: "风格", type: "text", options: [] },
        { key: "title", label: "标题", type: "text", options: [] },
      ],
      fixedParams: { callBackUrl: "https://nomiaqm.com/api/vendor-callbacks/kie/suno/ack" },
    },
    {
      id: "cover",
      intent: "edit",
      vendorTerm: "上传翻唱",
      hint: "保留原曲旋律并转换为新风格",
      promptRequired: true,
      slots: [{ kind: "audio_ref", label: "原始音频", min: 1, max: 1, inputKey: "uploadUrl", asArray: false }],
      params: [
        { key: "customMode", label: "自定义模式", type: "boolean", options: [], defaultValue: false },
        { key: "instrumental", label: "纯音乐", type: "boolean", options: [], defaultValue: false },
        { key: "style", label: "风格", type: "text", options: [] },
        { key: "title", label: "标题", type: "text", options: [] },
      ],
      fixedParams: { callBackUrl: "https://nomiaqm.com/api/vendor-callbacks/kie/suno/ack" },
    },
  ],
};

export const SUNO_SFX_V55_ARCHETYPE: ModelArchetype = {
  id: "suno-sfx-v5.5",
  family: "suno-sfx",
  label: "Suno Sounds V5.5",
  kind: "audio",
  defaultModeId: "sfx",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["suno-sounds-v5.5", "suno-sounds-v5-5"],
  sources: [
    {
      url: "https://docs.apimart.ai/en/api-reference/audios/suno/sounds.md",
      checkedAt: "2026-08-30",
      vendorKey: "apimart",
      covers: "POST /v1/music/generations/sounds; model=suno, version v5/v5.5, one-shot or loop, tempo 1-300 and sharp-note key enum; shared async music task result.",
    },
    {
      url: "https://docs.kie.ai/suno-api/generate-sounds.md",
      checkedAt: "2026-08-30",
      vendorKey: "kie",
      covers: "POST /api/v1/generate/sounds; V5_5, optional loop/tempo/key and polling through the Suno record endpoint.",
    },
  ],
  modes: [
    {
      id: "sfx",
      intent: "text",
      vendorTerm: "音效生成",
      hint: "生成单次或可循环音效",
      promptRequired: true,
      slots: [],
      params: [
        { key: "sound_type", label: "类型", type: "select", options: opt(["one-shot", "loop"]), defaultValue: "one-shot" },
        { key: "sound_tempo", label: "BPM", type: "number", options: [], min: 1, max: 300 },
        { key: "sound_key", label: "调性", type: "select", options: opt(SOUND_KEYS) },
      ],
    },
  ],
};
