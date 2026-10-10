import type { ModelParameterControl } from "./types";
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
  sources: [
    {
      url: "https://platform.minimax.io/docs/api-reference/video-generation-v2-regeneration",
      checkedAt: "2026-09-26",
      vendorKey: "minimax",
      covers: "任务 ID 再生成要求同账号成功的 MiniMax-H3 768P 源任务；不是任意视频超分",
    },
    {
      url: "https://docs.apimart.ai/cn/api-reference/videos/minimax-h3/generation",
      checkedAt: "2026-08-11",
      vendorKey: "apimart",
      covers: "MiniMax-H3-Regeneration 使用同账号 768P task_id 生成 2K 视频的参数与结果契约",
    },
  ],
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
      sourceTask: { inputKey: "source_task_id", modelKey: "MiniMax-H3", params: { resolution: "768P" } },
      transportTaskKind: "text_to_video",
      slots: [],
      params: PARAMS,
    },
  ],
};
