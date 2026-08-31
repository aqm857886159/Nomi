import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const PARAMS: ModelParameterControl[] = [
  { key: "source_task_id", label: "源任务 ID", type: "text", options: [], placeholder: "MiniMax-H3 的 768P 成片 task_id" },
];

/** APIMart MiniMax-H3-Regeneration：不是通用超分，只接受本账号 H3 768P 成片任务。 */
export const MINIMAX_H3_REGENERATION_ARCHETYPE: ModelArchetype = {
  id: "minimax-h3-regeneration",
  family: "minimax",
  label: "MiniMax H3 再生成",
  kind: "video",
  defaultModeId: "regenerate",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["MiniMax-H3-Regeneration"],
  modes: [
    {
      id: "regenerate",
      intent: "single",
      vendorTerm: "再生成（768P → 2K）",
      hint: "只接受本账号 MiniMax-H3 768P 成片的 task_id",
      promptRequired: false,
      transportTaskKind: "text_to_video",
      slots: [],
      params: PARAMS,
    },
  ],
};
