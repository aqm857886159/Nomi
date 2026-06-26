import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// 混元3D v3.1 档案（RunningHub 文生3D + 图生3D）。参数+options 逐字照官方注册表 models_registry.json：
// faceCount:INT(默认 500000) / enablePbr:BOOLEAN(必填) / generateType:LIST(Normal/Geometry/Sketch)。
// 图生3D 用单图槽（first_frame 机制 + inputKey=imageUrl → 单串落 request.params.imageUrl，本地图经
// ANON_UPLOAD_CHAIN 自动传公网）；多视角图(left/right/back...)为可选增强，MVP 先只收主图。
const HUNYUAN3D_PARAMS: ModelParameterControl[] = [
  {
    key: "generateType", label: "生成模式", type: "select",
    options: [{ value: "Normal", label: "标准" }, { value: "Geometry", label: "几何" }, { value: "Sketch", label: "草图" }],
    defaultValue: "Normal",
  },
  { key: "faceCount", label: "面数", type: "number", options: [], min: 1000, max: 1000000, defaultValue: 500000 },
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
    {
      id: "image",
      intent: "single",
      vendorTerm: "图生3D",
      hint: "上传/连接一张图生成 3D 模型",
      promptRequired: false,
      slots: [{ kind: "first_frame", label: "参考图", min: 1, max: 1, inputKey: "imageUrl" }],
      params: HUNYUAN3D_PARAMS,
      transportTaskKind: "image_to_3d",
    },
  ],
};
