import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

<<<<<<< HEAD
// Seedance 2.5 · apimart 通道。**独立档案而非 kie 版的 vendorParams**：两边差的不是参数值，
// 是能力结构——参考通道字段名（image_urls / video_urls / audio_urls vs kie 的 reference_*_urls）、
// 首尾帧表达方式（apimart 用 image_with_roles 角色数组，kie 用独立的 first_frame_url/last_frame_url）。
// 判据沿用 seedanceApimart.ts 立的规矩：「vendorParams=B（只有参数值差），能力结构差异用独立档案=A」。
//
// 契约出处见下方 sources（规则 G1，门岗 check:archetype-sources）。
// 逐项对完的清单（规则 G2 十项）：
//   端点/鉴权  POST /v1/videos/generations，Authorization: Bearer
//   参考通道    image_urls ≤30 · video_urls ≤10 · audio_urls ≤10
//   首尾帧      image_with_roles: [{url, role}]，role ∈ first_frame | last_frame | reference_image
//   标量参数    resolution 480p|720p(默认 720p，1080p/2k/4k 会被拒) · size 7 档(默认 adaptive)
//               · duration 4–30(默认 5) · generate_audio(默认 true) · return_last_frame(默认 false) · seed
//   模式互斥    首尾帧 与 多模态参考 不可混用（与我们的模式结构天然一致）
//   供应商硬约束 首尾帧模式 size **必须** adaptive → 走 fixedParams，不渲染成假装能选的控件
//   轮询        GET /v1/tasks/{task_id}
//   产物位置    data.result.videos[0].url[0]（数组套数组）
//   计费        duration=-1 自动时长：按 30s 预扣、完成后退差价
//
// 刻意**没有**暴露成控件（保持节点底栏极简 R2，需要时再加）：
//   watermark(默认 false) · output_format(mp4|mov) · tools:[{type:web_search}]
//   —— 都是低频项；且加控件必须同时进 mapping body，否则就是死控件（设计系统 C1）。
// 文档未写明：白膜无专用字段（当参考图/参考视频喂入即可，两家文档一致）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

/** 比例控件。首尾帧模式不用它（那边 size 被 fixedParams 钉成 adaptive）。 */
const SIZE: ModelParameterControl = {
  key: "size",
  label: "比例",
  type: "select",
  options: opt(["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]),
  defaultValue: "adaptive",
};

const BASE_PARAMS: ModelParameterControl[] = [
  { key: "resolution", label: "清晰度", type: "select", options: opt(["480p", "720p"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 30, defaultValue: 5 },
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
=======
// APIMart doubao-seedance-2.5 能力档案。与 KIE 的 Seedance 2.5 分开：APIMart 用
// image_with_roles 表达首/尾帧，image_urls 始终是参考图，且 size / output_format / watermark /
// seed / return_last_frame 都是 APIMart 自己的请求字段。

const options = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: options(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"]), defaultValue: "adaptive" },
  { key: "resolution", label: "清晰度", type: "select", options: options(["480p", "720p"]), defaultValue: "720p" },
  { key: "duration", label: "时长(秒)", type: "number", options: [], min: 4, max: 30, defaultValue: 5 },
  { key: "generate_audio", label: "生成音频", type: "boolean", options: [], defaultValue: true },
  { key: "watermark", label: "添加水印", type: "boolean", options: [], defaultValue: false },
  { key: "output_format", label: "输出格式", type: "select", options: options(["mp4", "mov"]), defaultValue: "mp4" },
>>>>>>> origin/codex/apimart-seedance-h3-20260811
  { key: "return_last_frame", label: "返回尾帧", type: "boolean", options: [], defaultValue: false },
  { key: "seed", label: "种子", type: "number", options: [], placeholder: "随机" },
];

<<<<<<< HEAD
const PARAMS: ModelParameterControl[] = [SIZE, ...BASE_PARAMS];
/** 首尾帧模式：官方要求 size 必须 adaptive，所以不给比例控件（由 fixedParams 发常量）。 */
const FRAME_PARAMS: ModelParameterControl[] = BASE_PARAMS;
=======
const MODES: ModelArchetype["modes"] = [
  {
    id: "t2v",
    intent: "text",
    vendorTerm: "文生视频",
    hint: "纯文字生成视频，最长 30 秒",
    promptRequired: true,
    transportTaskKind: "text_to_video",
    slots: [],
    params: PARAMS,
  },
  {
    id: "first",
    intent: "single",
    vendorTerm: "首帧",
    hint: "首帧图驱动生成",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1 }],
    combineSlotsInto: { key: "image_with_roles" },
    params: PARAMS,
  },
  {
    id: "firstlast",
    intent: "firstlast",
    vendorTerm: "首尾帧",
    hint: "首帧 + 尾帧，自动补间过渡",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "first_frame", label: "首帧", min: 1, max: 1 },
      { kind: "last_frame", label: "尾帧", min: 0, max: 1 },
    ],
    combineSlotsInto: { key: "image_with_roles" },
    params: PARAMS,
  },
  {
    id: "omni",
    intent: "character",
    vendorTerm: "全能参考",
    hint: "多模态参考；最多 30 图 / 10 视频 / 10 音频",
    promptRequired: true,
    transportTaskKind: "image_to_video",
    slots: [
      { kind: "image_ref", label: "参考图", min: 0, max: 30, characterIndexed: true, inputKey: "image_urls" },
      { kind: "video_ref", label: "参考视频", min: 0, max: 10, inputKey: "video_urls" },
      { kind: "audio_ref", label: "参考音频", min: 0, max: 10, inputKey: "audio_urls" },
    ],
    params: PARAMS,
  },
];
>>>>>>> origin/codex/apimart-seedance-h3-20260811

export const SEEDANCE_2_5_APIMART_ARCHETYPE: ModelArchetype = {
  id: "seedance-2.5-apimart",
  family: "seedance",
  label: "Seedance 2.5",
  kind: "video",
<<<<<<< HEAD
  sources: [
    {
      url: "https://docs.apimart.ai/cn/api-reference/videos/doubao-seedance-2-5",
      checkedAt: "2026-08-12",
      vendorKey: "apimart",
      covers:
        "POST /v1/videos/generations；image_urls/video_urls/audio_urls 上限 30/10/10；image_with_roles 角色数组表首尾帧；size 默认 adaptive 且首尾帧模式必须 adaptive；resolution 仅 480p/720p；duration 4-30 或 -1 自动；轮询 GET /v1/tasks/{task_id}，产物在 data.result.videos[0].url[0]",
    },
  ],
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["doubao-seedance-2.5", "doubao-seedance-2-5"],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频，最长 30 秒",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: PARAMS,
    },
    {
      id: "first",
      intent: "single",
      vendorTerm: "首帧",
      hint: "单张首帧图驱动生成",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1 }],
      combineSlotsInto: { key: "image_with_roles" },
      // 官方：首尾帧类模式 size 必须 adaptive（输出比例跟随输入图）。
      fixedParams: { size: "adaptive" },
      params: FRAME_PARAMS,
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "首帧 + 尾帧，自动补间过渡",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1 },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1 },
      ],
      combineSlotsInto: { key: "image_with_roles" },
      fixedParams: { size: "adaptive" },
      params: FRAME_PARAMS,
    },
    {
      id: "omni",
      intent: "character",
      vendorTerm: "全能参考",
      // 3D 白膜走这里：两家官方文档都没有白膜专用字段，它当参考图或参考视频喂进来即可。
      hint: "多模态参考；最多 30 图 / 10 视频 / 10 音频，3D 白膜当参考图或参考视频放进来",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "image_ref", label: "角色参考", min: 0, max: 30, characterIndexed: true, inputKey: "image_urls" },
        { kind: "video_ref", label: "参考视频", min: 0, max: 10, inputKey: "video_urls" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 10, inputKey: "audio_urls" },
      ],
      // 官方另有一条我们**测不出来**的约束：参考 + 「编辑/删除/修改」或「延长/续写」类提示词时
      // size 也必须 adaptive。那取决于提示词内容，没法可靠判定 —— 故此处不钉死，只把默认设为
      // adaptive（用户不动就是对的）。宁可默认安全，也不假装我们能识别用户的意图。
      params: PARAMS,
    },
  ],
=======
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["doubao-seedance-2.5", "doubao-seedance-2-5"],
  modes: MODES,
>>>>>>> origin/codex/apimart-seedance-h3-20260811
};
