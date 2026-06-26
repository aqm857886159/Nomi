// 即梦官方 dreamina CLI 的多帧视频档案（multiframe2video）。官方 `-h`：2-20 张图，无 model_version/清晰度。
//   - 2 图：shorthand --prompt + --duration（段时长）
//   - 3+ 图：N-1 句 --transition-prompt（每段一句过渡），比例随首图
// 过渡描述用**节点提示词**（本就是多行 textarea）：2 图整段当主提示；3+ 图按行拆，每行一句相邻图过渡——
// 无需新 UI 控件（用户拍板「多行文本，每行一句」即用现有提示框）。无 model_version → 单列无变体模型，
// 不与 dreamina-seedance-2.0 的合并 image_to_video mapping 撞 modelKey。
import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

const PARAMS: ModelParameterControl[] = [
  { key: "duration", label: "段时长(秒,仅2图)", type: "number", options: [], min: 1, max: 8, step: 1, defaultValue: 3 },
];

export const DREAMINA_MULTIFRAME_ARCHETYPE: ModelArchetype = {
  id: "dreamina-multiframe",
  family: "seedance",
  label: "即梦多帧视频",
  kind: "video",
  defaultModeId: "multiframe",
  transportTaskKind: "image_to_video",
  identifierPatterns: ["dreamina-multiframe"],
  modes: [
    {
      id: "multiframe",
      intent: "character",
      vendorTerm: "多帧叙事",
      hint: "2-20 张关键帧串成连贯视频。3+ 张时，提示词每行写一句相邻两图的过渡；2 张写一句即可。",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "关键帧", min: 2, max: 20, inputKey: "mf_images" }],
      params: PARAMS,
    },
  ],
};
