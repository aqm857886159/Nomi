import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Veo 3.1（apimart 独占）视频档案。
// 变体（官方 model 枚举 veo3.1-fast/quality/lite）：fast 默认。注：lite 仅文生、quality 不支持「参考图」
//   ——这类「变体×模式」禁忌当前未做门控（变体轴只做 paramOverrides），误选 vendor 会明确报错（错误透传）。
// duration：官方固定 8s（仅此一值）→ 不出控件、不发字段，走 API 默认 8（极简且不会发非法值）。
// generation_type（C 类）：图模式分「参考图 reference」（≤3 张）与「首尾帧 frame」（image_urls[0]首[1]尾）。
//   由模式 fixedParams 注入，不需用户选 1 项下拉（R2 极简）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(["16:9", "9:16"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["720p", "1080p", "4k"]), defaultValue: "720p" },
];

export const VEO_3_1_ARCHETYPE: ModelArchetype = {
  id: "veo-3.1",
  family: "veo",
  label: "Veo 3.1",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["veo-3.1", "veo3.1", "veo3.1-fast", "veo3.1-quality", "veo3.1-lite"],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
    {
      id: "reference", intent: "single", vendorTerm: "参考图", hint: "参考图驱动（最多 3 张）", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 3, inputKey: "image_urls" }],
      params: PARAMS,
      fixedParams: { generation_type: "reference" },
    },
    {
      id: "frame", intent: "firstlast", vendorTerm: "首尾帧", hint: "首帧（+可选尾帧）补间生成", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1 },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1 },
      ],
      // 首尾帧 → image_urls 有序扁平数组 [首url, 尾url]（位置语义，非 role 对象）。
      combineSlotsInto: { key: "image_urls", flat: true },
      params: PARAMS,
      fixedParams: { generation_type: "frame" },
    },
  ],
  // 变体：fast（默认）/ quality / lite。modelKey = 实际发请求的 model 字符串。
  variants: [
    { id: "fast", label: "快速", modelKey: "veo3.1-fast", identifierPatterns: ["veo3.1", "veo-3.1"] },
    { id: "quality", label: "高质", modelKey: "veo3.1-quality", identifierPatterns: ["veo3.1-quality"] },
    { id: "lite", label: "轻量", modelKey: "veo3.1-lite", identifierPatterns: ["veo3.1-lite"] },
  ],
  defaultVariantId: "fast",
};
