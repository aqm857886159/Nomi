import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

export const MINIMAX_SPEECH_28_ARCHETYPE: ModelArchetype = {
  id: "minimax-speech-2.8",
  family: "minimax-speech",
  label: "MiniMax Speech 2.8",
  kind: "audio",
  defaultModeId: "speech",
  transportTaskKind: "text_to_audio",
  identifierPatterns: ["speech-2.8-hd", "speech-2.8-turbo"],
  sources: [{
    url: "https://platform.minimax.io/docs/api-reference/speech-t2a-http",
    checkedAt: "2026-08-30",
    vendorKey: "minimax",
    covers: "POST /v1/t2a_v2 synchronous speech-2.8-hd/turbo; data.audio contains hex encoded audio.",
  }],
  modes: [{
    id: "speech",
    intent: "text",
    vendorTerm: "配音生成",
    hint: "高保真多语种配音",
    promptRequired: true,
    slots: [],
    params: [
      { key: "voice_id", label: "音色 ID", type: "text", options: [], defaultValue: "English_expressive_narrator" },
      { key: "speed", label: "语速", type: "number", options: [], min: 0.5, max: 2, defaultValue: 1 },
      { key: "volume", label: "音量", type: "number", options: [], min: 0.1, max: 10, defaultValue: 1 },
      { key: "pitch", label: "音调", type: "number", options: [], min: -12, max: 12, defaultValue: 0 },
      { key: "language_boost", label: "语言", type: "select", options: options(["auto", "Chinese", "English", "Japanese", "Korean"]), defaultValue: "auto" },
    ],
  }],
};
