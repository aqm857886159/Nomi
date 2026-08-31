import type { ModelArchetype } from "./types";

export const LYRIA_35_ARCHETYPE: ModelArchetype = {
  id: "lyria-3.5",
  family: "lyria",
  label: "Lyria 3.5",
  kind: "audio",
  defaultModeId: "music",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["flowmusic-lyria-3.5"],
  sources: [
    {
      url: "https://docs.apimart.ai/en/api-reference/audios/flow-music/music-lyria-3-5.md",
      checkedAt: "2026-08-30",
      vendorKey: "apimart",
      covers: "POST /v1/music/generations with model=flowmusic, version=lyria-3.5; sound_prompt or lyrics required, length 1-240 seconds; async music task result.",
    },
  ],
  modes: [
    {
      id: "music",
      intent: "text",
      vendorTerm: "音乐生成",
      hint: "用风格描述生成一首音乐",
      promptRequired: true,
      slots: [],
      params: [
        { key: "title", label: "标题", type: "text", options: [], placeholder: "可选" },
        { key: "bpm", label: "BPM", type: "number", options: [], min: 1 },
        { key: "length", label: "时长(秒)", type: "number", options: [], min: 1, max: 240, defaultValue: 60 },
      ],
    },
  ],
};
