import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// 混元3D v3.1 档案（RunningHub 文生3D）。先垂直打通文生3D 这一模式（纯 prompt + 标量参数、无参考槽）；
// 图生3D（imageUrl 槽）+ HiTem/Meshy 是后续增量。参数逐字照官方注册表（faceCount:INT / enablePbr:BOOLEAN）。
const HUNYUAN3D_PARAMS: ModelParameterControl[] = [
  { key: "faceCount", label: "面数", type: "number", options: [], min: 1000, max: 300000, defaultValue: 40000 },
  { key: "enablePbr", label: "PBR 材质", type: "boolean", options: [], defaultValue: true },
];

export const HUNYUAN3D_ARCHETYPE: ModelArchetype = {
  id: "hunyuan3d",
  family: "hunyuan3d",
  label: "混元3D v3.1",
  kind: "model3d",
  defaultModeId: "text",
  transportTaskKind: "text_to_3d",
  identifierPatterns: ["hunyuan3d-v3.1", "hunyuan3d", "hunyuan-3d"],
  modes: [
    {
      id: "text",
      intent: "text",
      vendorTerm: "文生3D",
      hint: "文字描述生成 3D 模型（输出 .glb）",
      promptRequired: true,
      slots: [],
      params: HUNYUAN3D_PARAMS,
      transportTaskKind: "text_to_3d",
    },
  ],
};
