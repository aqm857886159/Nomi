import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Meshy 6 档案（RunningHub 文生3D + 图生3D）。参数+options 逐字照官方注册表。
// 文生与图生公用拓扑/面数/对称/重网格/PBR；文生独有 artStyle，图生独有 shouldTexture。
const TOPOLOGY: ModelParameterControl = {
  key: "topology", label: "拓扑", type: "select",
  options: [{ value: "triangle", label: "三角" }, { value: "quad", label: "四边" }], defaultValue: "triangle",
};
const SYMMETRY: ModelParameterControl = {
  key: "symmetryMode", label: "对称", type: "select",
  options: [{ value: "off", label: "关" }, { value: "auto", label: "自动" }, { value: "on", label: "开" }], defaultValue: "auto",
};
const POLYCOUNT: ModelParameterControl = { key: "targetPolycount", label: "目标面数", type: "number", options: [], min: 1000, max: 300000, defaultValue: 30000 };
const REMESH: ModelParameterControl = { key: "shouldRemesh", label: "重新网格化", type: "boolean", options: [], defaultValue: true };
const PBR: ModelParameterControl = { key: "enablePbr", label: "PBR 材质", type: "boolean", options: [], defaultValue: true };

const MESHY_TEXT_PARAMS: ModelParameterControl[] = [
  { key: "artStyle", label: "风格", type: "select", options: [{ value: "realistic", label: "写实" }, { value: "sculpture", label: "雕塑" }], defaultValue: "realistic" },
  TOPOLOGY, POLYCOUNT, SYMMETRY, REMESH, PBR,
];
const MESHY_IMAGE_PARAMS: ModelParameterControl[] = [
  TOPOLOGY, POLYCOUNT, SYMMETRY, REMESH,
  { key: "shouldTexture", label: "生成纹理", type: "boolean", options: [], defaultValue: true },
  PBR,
];

export const MESHY6_ARCHETYPE: ModelArchetype = {
  id: "meshy6",
  family: "meshy",
  label: "Meshy 6",
  kind: "model3d",
  defaultModeId: "text",
  transportTaskKind: "text_to_3d",
  identifierPatterns: ["meshy6", "meshy-6", "meshy"],
  modes: [
    {
      id: "text",
      intent: "text",
      vendorTerm: "文生3D",
      hint: "文字描述生成 3D 模型（输出 .glb）",
      promptRequired: true,
      slots: [],
      params: MESHY_TEXT_PARAMS,
      transportTaskKind: "text_to_3d",
    },
    {
      id: "image",
      intent: "single",
      vendorTerm: "图生3D",
      hint: "上传/连接一张图生成 3D 模型",
      promptRequired: false,
      slots: [{ kind: "first_frame", label: "参考图", min: 1, max: 1, inputKey: "imageUrl" }],
      params: MESHY_IMAGE_PARAMS,
      transportTaskKind: "image_to_3d",
    },
  ],
};
