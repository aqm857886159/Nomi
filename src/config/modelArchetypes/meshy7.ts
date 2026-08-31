import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const options = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

export const MESHY_7_ARCHETYPE: ModelArchetype = {
  id: "meshy-7",
  family: "meshy",
  label: "Meshy 7",
  kind: "model3d",
  defaultModeId: "i2m",
  transportTaskKind: "image_to_3d",
  identifierPatterns: ["meshy-7", "meshy7"],
  sources: [{
    url: "https://docs.meshy.ai/en/api/image-to-3d",
    checkedAt: "2026-08-30",
    vendorKey: "meshy",
    covers: "POST /openapi/v1/image-to-3d with model_type=standard, ai_model=meshy-7 and target_formats=[glb]; poll and materialize model_urls.glb.",
  }],
  modes: [{
    id: "i2m",
    intent: "single",
    vendorTerm: "单图生 3D",
    hint: "从单张物体图生成带纹理 GLB",
    promptRequired: false,
    slots: [{ kind: "image_ref", label: "物体图", min: 1, max: 1, inputKey: "image_url", asArray: false }],
    params: [
      { key: "topology", label: "拓扑", type: "select", options: options(["triangle", "quad"]), defaultValue: "triangle" },
      { key: "target_polycount", label: "面数", type: "number", options: [], min: 100, max: 300000, defaultValue: 30000 },
      { key: "enable_pbr", label: "PBR 材质", type: "boolean", options: [], defaultValue: true },
    ],
  }],
};
