import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Seedance 2.0 经 apimart 的视频档案。**独立于 kie 的 seedance-2 档案**：apimart 图生视频用 image_urls
// 数组（≤9），与 kie 的 first/last/omni 多槽分离键结构不同——这是 B/A 混用的合理边界（枚举差异用
// vendorParams=B，能力结构差异用独立档案=A）。比例字段是 size；音频字段 generate_audio。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p", "1080p"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 15, defaultValue: 5 },
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
];

export const SEEDANCE_2_APIMART_ARCHETYPE: ModelArchetype = {
  id: "seedance-2-apimart",
  family: "seedance",
  label: "Seedance 2.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["doubao-seedance-2.0", "doubao-seedance-2-0"],
  modes: SEEDANCE_2_APIMART_MODES,
};

// Seedance 2.0 Fast：同模式同结构，唯一差异——清晰度仅 480/720（无 1080，官方文档）。
// 仿 kie 的 SEEDANCE_2_FAST_ARCHETYPE「同族扩展=改几行数据」。
const FAST_RES: ModelParameterControl = {
  key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p"]), defaultValue: "720p",
};
const withFastRes = (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "resolution" ? FAST_RES : p));

export const SEEDANCE_2_APIMART_FAST_ARCHETYPE: ModelArchetype = {
  ...SEEDANCE_2_APIMART_ARCHETYPE,
  id: "seedance-2-apimart-fast",
  label: "Seedance 2.0 Fast",
  identifierPatterns: ["doubao-seedance-2.0-fast", "doubao-seedance-2-0-fast"],
  modes: SEEDANCE_2_APIMART_MODES.map((mode) => ({ ...mode, params: withFastRes(mode.params) })),
};
