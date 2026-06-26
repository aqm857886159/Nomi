import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// HiTem3D v21 档案（RunningHub 图生3D，无文生3D）。参数+options 逐字照官方注册表：
// requestType:LIST(mesh/both) / resolution:LIST(1536pro/1536fast) / face:INT(默认 2000000) / imageUrl:IMAGE。
const HITEM3D_PARAMS: ModelParameterControl[] = [
  {
    key: "requestType", label: "输出", type: "select",
    options: [{ value: "mesh", label: "网格" }, { value: "both", label: "网格+纹理" }],
    defaultValue: "mesh",
  },
  {
    key: "resolution", label: "精度", type: "select",
    options: [{ value: "1536pro", label: "1536 Pro" }, { value: "1536fast", label: "1536 Fast" }],
    defaultValue: "1536pro",
  },
  { key: "face", label: "面数", type: "number", options: [], min: 10000, max: 5000000, defaultValue: 2000000 },
];

export const HITEM3D_ARCHETYPE: ModelArchetype = {
  id: "hitem3d",
  family: "hitem3d",
  label: "HiTem3D v21",
  kind: "model3d",
  defaultModeId: "image",
  transportTaskKind: "image_to_3d",
  identifierPatterns: ["hitem3d-v21", "hitem3d", "hitem-3d"],
  modes: [
    {
      id: "image",
      intent: "single",
      vendorTerm: "图生3D",
      hint: "上传/连接一张图生成高精度 3D 模型",
      promptRequired: false,
      slots: [{ kind: "first_frame", label: "参考图", min: 1, max: 1, inputKey: "imageUrl" }],
      params: HITEM3D_PARAMS,
      transportTaskKind: "image_to_3d",
    },
  ],
};
