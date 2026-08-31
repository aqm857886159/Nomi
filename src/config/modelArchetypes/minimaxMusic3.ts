import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const params: ModelParameterControl[] = [
  { key: "lyrics", label: "歌词", type: "text", options: [] },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 1, max: 300, defaultValue: 30 },
  { key: "seed", label: "种子", type: "number", options: [], min: 0 },
  { key: "num_inference_steps", label: "推理步数", type: "number", options: [], min: 1 },
  { key: "guidance_scale", label: "提示词引导", type: "number", options: [], min: 0 },
];

export const MINIMAX_MUSIC_3_ARCHETYPE: ModelArchetype = {
  id: "minimax-music-3",
  family: "minimax-music",
  label: "MiniMax Music 3",
  kind: "audio",
  defaultModeId: "music",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["minimax/music-3", "music-3"],
  sources: [{ url: "https://fal.ai/models/minimax/music-3/api", checkedAt: "2026-08-30", vendorKey: "fal", covers: "fal queue POST /minimax/music-3 with prompt, lyrics, duration, seed, num_inference_steps and guidance_scale; audio.url result." }],
  modes: [{ id: "music", intent: "text", vendorTerm: "音乐生成", hint: "生成带歌词或纯音乐片段", promptRequired: true, slots: [], params }],
};
