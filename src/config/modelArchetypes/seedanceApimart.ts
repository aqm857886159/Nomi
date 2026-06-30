import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Seedance 2.0 经 apimart 的视频档案。**独立于 kie 的 seedance-2 档案**：apimart 图生视频用 image_urls
// 数组（≤9），与 kie 的 first/last/omni 多槽分离键结构不同——这是 B/A 混用的合理边界（枚举差异用
// vendorParams=B，能力结构差异用独立档案=A）。比例字段是 size；音频字段 generate_audio。
//
// **变体合并（2026-06-16，用户拍板方案 A）**：Seedance 一族原是 4 个独立 catalog 模型/档案
// （标准 / fast / 真人(face) / 真人快速(fast-face)），picker 里散成 4 项。它们**同能力、仅 model 字符串不同**
// （fast 另限清晰度 480/720），故用通用「变体轴」(types.ts ModelArchetypeVariant) 合成 1 个档案 +
// 1 个 catalog 行 + 4 个变体。变体的 modelKey 决定实际发请求的 model（catalog body 用
// {{request.params.model}} 读它，同 happyhorse modelEnum 通道）。旧项目 node.meta.modelKey 钉的是具体变体串
// → 各变体的 identifierPatterns 收纳旧串，迁移层 normalizeArchetypeVariantMeta 归一到 基 modelKey + variantId。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]), defaultValue: "16:9" },
  // PARAMS = 全能力清晰度（含 4k）。apimart 约束：4k 仅基础档 doubao-seedance-2.0 支持，1080p 仅基础档 + face 支持。
  // 沿用「PARAMS=max，变体往下收窄」既有范式：标准档不收窄（拿全集含 4k）；face 去 4k（留 1080）；fast/fast-face 仅 480/720。
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
// 两档收窄目标（官方约束）：
//   fast / fast-face → 480/720（无 1080/4k）
//   face            → 480/720/1080（有 1080，无 4k；4k 仅基础档独占）
const makeResNarrower = (values: string[]) => {
  const res: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(values), defaultValue: "720p" };
  return (params: ModelParameterControl[]): ModelParameterControl[] => params.map((p) => (p.key === "resolution" ? res : p));
};
const narrowResolutionToFast = makeResNarrower(["480p", "720p"]);
const narrowResolutionToFace = makeResNarrower(["480p", "720p", "1080p"]);
const FAST_OVERRIDES = Object.fromEntries(SEEDANCE_2_APIMART_MODES.map((m) => [m.id, narrowResolutionToFast] as const));
const FACE_OVERRIDES = Object.fromEntries(SEEDANCE_2_APIMART_MODES.map((m) => [m.id, narrowResolutionToFace] as const));

export const SEEDANCE_2_APIMART_ARCHETYPE: ModelArchetype = {
  id: "seedance-2-apimart",
  family: "seedance",
  label: "Seedance 2.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  // 收纳全部 4 变体的旧 modelKey → 旧项目仍解析到本档案（迁移层据 variant.identifierPatterns 落到对应变体）。
  identifierPatterns: [
    "doubao-seedance-2.0", "doubao-seedance-2-0",
    "doubao-seedance-2.0-fast", "doubao-seedance-2-0-fast",
    "doubao-seedance-2.0-face", "doubao-seedance-2-0-face",
    "doubao-seedance-2.0-fast-face", "doubao-seedance-2-0-fast-face",
    "doubao-seedance-2.0-mini", "doubao-seedance-2-0-mini",
  ],
  modes: SEEDANCE_2_APIMART_MODES,
  // 5 变体：标准 / 快速 / 真人 / 真人快速 / mini。modelKey = 实际发请求的 model 字符串。
  // identifierPatterns = 旧项目 modelKey（含无连字符变体 -2-0-*），迁移层据此归一到本变体。
  // mini（2026-06-30 照 docs.apimart.ai 补）：「同标准版功能、无字数限制」，清晰度仅 480/720（同 fast）。
  variants: [
    { id: "standard", label: "标准", modelKey: "doubao-seedance-2.0", identifierPatterns: ["doubao-seedance-2-0"] },
    { id: "fast", label: "快速", modelKey: "doubao-seedance-2.0-fast", identifierPatterns: ["doubao-seedance-2-0-fast"], paramOverrides: FAST_OVERRIDES },
    { id: "face", label: "真人", modelKey: "doubao-seedance-2.0-face", identifierPatterns: ["doubao-seedance-2-0-face"], paramOverrides: FACE_OVERRIDES },
    { id: "fast-face", label: "真人快速", modelKey: "doubao-seedance-2.0-fast-face", identifierPatterns: ["doubao-seedance-2-0-fast-face"], paramOverrides: FAST_OVERRIDES },
    { id: "mini", label: "Mini", modelKey: "doubao-seedance-2.0-mini", identifierPatterns: ["doubao-seedance-2-0-mini"], paramOverrides: FAST_OVERRIDES },
  ],
  defaultVariantId: "standard",
};
