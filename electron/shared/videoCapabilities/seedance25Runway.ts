import type { ModelArchetype } from "./types";
import { SEEDANCE_2_5_ARCHETYPE } from "./seedance25";

// Runway 变体：官方 OpenAPI 把 references/referenceVideos/referenceAudio 声明在 /v1/text_to_video
// 的 seedance2_5 联合体上，omni（全能参考）的传输面因此是 text_to_video——与 kie/apimart
// （job 系端点，image_to_video 面）相反。除此之外模式/槽/参数与共享档案完全一致。
export const SEEDANCE_2_5_RUNWAY_ARCHETYPE: ModelArchetype = {
  ...SEEDANCE_2_5_ARCHETYPE,
  id: "seedance-2.5-runway",
  identifierPatterns: ["seedance2_5"],
  sources: [
    ...(SEEDANCE_2_5_ARCHETYPE.sources ?? []),
    {
      url: "https://raw.githubusercontent.com/runwayml/openapi/main/openapi.json",
      checkedAt: "2026-09-02",
      vendorKey: "runway",
      covers: "seedance2_5 omni references ride the /v1/text_to_video union (typed reference arrays); no reference fields on image_to_video",
    },
  ],
  modes: SEEDANCE_2_5_ARCHETYPE.modes.map((mode) =>
    mode.id === "omni" ? { ...mode, transportTaskKind: "text_to_video" as const } : mode),
};
