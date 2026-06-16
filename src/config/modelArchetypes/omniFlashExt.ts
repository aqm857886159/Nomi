import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// Omni-Flash-Ext 经 apimart 的视频档案（apimart 独占）。Omni 类：文生视频 + 可选参考图融合
// （0/1/3 张，2 张报 unsupported_image_count）。比例字段是 size（JSON 模式发 size 不是 aspect_ratio，
// 与 aspect_ratio 同义）；清晰度 720p/1080p/4k。
//
// duration 用 number 控件（合法离散值 4/6/8/10，5/7 报 invalid_duration，故 min 4 / max 10 / step 2）——
// 与 Sora 2 / Hailuo 等既有视频模型同构：number 控件经 parseControlInput 落库为整数，body 模板原样保型，
// 发出整数 6（API 要 integer）。若改用 select 会发字符串 "6"（select 不强转数值），可能触发 invalid_duration。
//
// 注：API 另有 video_urls（运动参考视频，与 duration 互斥），但当前视频传输工厂只产出
// text_to_video / image_to_video 两个 mapping 桶（taskKind 枚举无 video_to_video），故视频参考暂未接，
// 接入主链路是文生 + 图参考——这与 Sora 2 / Veo 3.1 等既有 curated 模型同构。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));
const numOpt = (values: number[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: `${value}` }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1"]), defaultValue: "16:9" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["720p", "1080p", "4k"]), defaultValue: "720p" },
  // duration 合法离散 4/6/8/10（5/7 报 invalid_duration）→ select + 数值 option（parseControlInput 回整数）。
  { key: "duration", label: "时长(秒)", type: "select", options: numOpt([4, 6, 8, 10]), defaultValue: 6 },
];

export const OMNI_FLASH_EXT_ARCHETYPE: ModelArchetype = {
  id: "omni-flash-ext",
  family: "omni",
  label: "Omni-Flash-Ext",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["omni-flash-ext"],
  modes: [
    { id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true, transportTaskKind: "text_to_video", slots: [], params: PARAMS },
    {
      id: "i2v", intent: "single", vendorTerm: "参考图融合", hint: "1 或 3 张参考图驱动（2 张不支持）", promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "image_ref", label: "参考图", min: 1, max: 3, inputKey: "image_urls" }],
      params: PARAMS,
      // 传 1 或 3 图必须带 generation_type:reference，否则官方拒（之前漏发 → 3 图被拒）。
      fixedParams: { generation_type: "reference" },
    },
  ],
};
