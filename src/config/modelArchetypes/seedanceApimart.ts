import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Seedance 2.0 经 apimart 的视频档案。**独立于 kie 的 seedance-2 档案**：apimart 图生视频用 image_urls
// 数组（≤9），与 kie 的 first/last/omni 多槽分离键结构不同——这是 B/A 混用的合理边界（枚举差异用
// vendorParams=B，能力结构差异用独立档案=A）。比例字段是 size；音频字段 generate_audio。
//
// **变体合并（2026-07-18）**：catalog 始终只有 1 个 Seedance 2.0 行，节点内用通用「变体轴」
// 切换 Seedance 2.0 / Fast / Mini。变体的 modelKey 决定实际发请求的 model（catalog body 用
// {{request.params.model}} 读它，同 happyhorse modelEnum 通道）。旧项目 node.meta.modelKey 钉的是具体变体串
// → identifierPatterns/variantIdAliases 收纳旧 face/fast-face 串，迁移层归一到当前有效变体。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]), defaultValue: "16:9" },
  // PARAMS = 标准版全能力清晰度（含 4k）；Fast/Mini 收窄到 480/720。
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p", "4k"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 15, defaultValue: 5 },
  { key: "seed", label: "种子", type: "number", options: [], placeholder: "随机" },
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
];

// 三模式共用（t2v/i2v/全能参考）。全能参考(omni)：多模态参考数组（官方文档「全能参考」模式）——
// image_urls≤9 + video_urls≤3 + audio_urls≤3，走档案级 image_to_video 桶（与 i2v 同一 mapping，
// 一条 body 覆盖；非当前模式的空数组键由模板自动丢弃，同 kie Seedance omni）。
const SEEDANCE_2_APIMART_MODES: ModelArchetype["modes"] = [
  { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
  {
    id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "首帧/参考图驱动（最多 9 张）", promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 9, inputKey: "image_urls" }],
    params: PARAMS,
  },
  {
    id: "omni", intent: "character", vendorTerm: "全能参考", hint: "多模态参考；最多 9 图 / 3 视频 / 3 音频", promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "image_ref", label: "角色参考", min: 0, max: 9, characterIndexed: true, inputKey: "image_urls" },
      { kind: "video_ref", label: "参考视频", min: 0, max: 3, inputKey: "video_urls" },
      { kind: "audio_ref", label: "参考音频", min: 0, max: 3, inputKey: "audio_urls" },
    ],
    params: PARAMS,
  },
  {
    // 首尾帧（官方 image_with_roles）：首帧 + 尾帧自动补间。结构化角色数组靠通用 combineSlotsInto 原语
    // 在构造层组装（first_frame_url/last_frame_url 两个扁平槽 → [{url,role}]），删扁平键避免与 image_urls
    // 并存触发互斥（官方：image_urls ⊥ image_with_roles）。走 image_to_video 桶（同 i2v body 一条覆盖）。
    id: "firstlast", intent: "firstlast", vendorTerm: "首尾帧", hint: "首帧 + 尾帧，自动补间过渡", promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1 },
      { kind: "last_frame", label: "尾帧", min: 0, max: 1 },
    ],
    combineSlotsInto: { key: "image_with_roles" },
    params: PARAMS,
  },
];

// 变体清晰度收窄（运行时按 variantId 叠加，specializeArchetypeForVariant；不档案级 spread——变体是正交轴）。
// Fast / Mini 仅支持 480/720；标准版保留 480/720/1080/4k。
const makeResNarrower = (values: string[]) => {
  const res: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(values), defaultValue: "720p" };
  return (params: ModelParameterControl[]): ModelParameterControl[] => params.map((p) => (p.key === "resolution" ? res : p));
};
const narrowResolutionToFast = makeResNarrower(["480p", "720p"]);
const FAST_OVERRIDES = Object.fromEntries(SEEDANCE_2_APIMART_MODES.map((m) => [m.id, narrowResolutionToFast] as const));

export const SEEDANCE_2_APIMART_ARCHETYPE: ModelArchetype = {
  id: "seedance-2-apimart",
  family: "seedance",
  label: "Seedance 2.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  // face/fast-face 已从当前文档下线，但继续收纳旧 modelKey，确保旧项目仍能解析并迁移。
  identifierPatterns: [
    "doubao-seedance-2.0", "doubao-seedance-2-0",
    "doubao-seedance-2.0-fast", "doubao-seedance-2-0-fast",
    "doubao-seedance-2.0-face", "doubao-seedance-2-0-face",
    "doubao-seedance-2.0-fast-face", "doubao-seedance-2-0-fast-face",
    "doubao-seedance-2.0-mini", "doubao-seedance-2-0-mini",
  ],
  modes: SEEDANCE_2_APIMART_MODES,
  // 当前官方三模式。旧 face → 标准版，旧 fast-face → Fast；它们只用于迁移，不再显示在 UI。
  variants: [
    {
      id: "standard",
      label: "Seedance 2.0",
      modelKey: "doubao-seedance-2.0",
      identifierPatterns: ["doubao-seedance-2-0", "doubao-seedance-2.0-face", "doubao-seedance-2-0-face"],
    },
    {
      id: "fast",
      label: "Fast",
      modelKey: "doubao-seedance-2.0-fast",
      identifierPatterns: ["doubao-seedance-2-0-fast", "doubao-seedance-2.0-fast-face", "doubao-seedance-2-0-fast-face"],
      paramOverrides: FAST_OVERRIDES,
    },
    { id: "mini", label: "Mini", modelKey: "doubao-seedance-2.0-mini", identifierPatterns: ["doubao-seedance-2-0-mini"], paramOverrides: FAST_OVERRIDES },
  ],
  defaultVariantId: "fast",
  catalogModelKey: "doubao-seedance-2.0",
  variantIdAliases: { face: "standard", "fast-face": "fast" },
};
