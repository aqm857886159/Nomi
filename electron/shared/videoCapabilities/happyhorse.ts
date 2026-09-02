import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";
import { runwayRatioControl } from "./runwayWireFacts";

// HappyHorse 1.0 档案（C4）。kie.ai 把它的 4 个端点（text/image/reference/video-to-video）做成
// 4 个 model enum；我们**合成 1 个 catalog 条目 + 4 个模式**，靠 per-mode modelEnum 区分（评审 M3）。
// 参数面取自 kie.ai 文档（docs.kie.ai/market/happyhorse/*）。
//
// 各模式 input 键名不同（HappyHorse 的模型契约）：
//   - image-to-video：`image_urls`（正好 1 张，作首帧）—— 单图槽但序列化成 1 元素数组（asArray）。
//   - reference-to-video / video-edit：`reference_image`（角色/参考图数组）。
//   - video-edit：`video_url`（源视频）。
// 供应商（kie）的尾随空格 quirk（`image_urls ` / `reference_image `，§2 坑1）只在 kieHappyhorse body
// 照抄一次（M1）；这里只写模型契约的逻辑键名。

const toOptions = (values: string[]): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: value }));

const RES = (def: string): ModelParameterControl =>
  ({ key: "resolution", label: "清晰度", type: "select", options: toOptions(["720p", "1080p"]), defaultValue: def });
const RATIO: ModelParameterControl =
  { key: "aspect_ratio", label: "比例", type: "select", options: toOptions(["16:9", "9:16", "1:1", "4:3", "3:4"]), defaultValue: "16:9" };
const DURATION: ModelParameterControl =
  { key: "duration", label: "时长", type: "number", options: [], min: 3, max: 15, defaultValue: 5 };
const SEED: ModelParameterControl =
  { key: "seed", label: "种子", type: "number", options: [], placeholder: "随机" };
const AUDIO_SETTING: ModelParameterControl =
  { key: "audio_setting", label: "音频", type: "select", options: [{ value: "auto", label: "自动" }, { value: "origin", label: "保留原声" }], defaultValue: "auto" };

// Runway 转售的 happyhorse_1_0：Runway union 的 happyhorse 变体只有 ratio / duration——
// **没有 resolution，也没有 seed**；比例是像素式枚举（1280:720…）。
// 且它的 **image_to_video 变体连 ratio 属性都没有**（比例由参考图决定，见
// RUNWAY_FAMILIES_WITHOUT_IMAGE_RATIO——传输层归一器读的是同一条事实），故图生模式不出比例控件。
const RUNWAY_T2V_PARAMS: ModelParameterControl[] = [runwayRatioControl("happyhorse"), DURATION];
const RUNWAY_I2V_PARAMS: ModelParameterControl[] = [DURATION];

export const HAPPYHORSE_ARCHETYPE: ModelArchetype = {
  // Runway 的 happyhorse_1_0 行原挂平台档案 runway-video（已删）；存量节点靠 legacyIds 迁到这里。
  legacyIds: ["runway-video"],
  id: "happyhorse",
  family: "happyhorse",
  label: "HappyHorse 1.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: [
    "happyhorse",
    "happyhorse/text-to-video",
    "happyhorse/image-to-video",
    "happyhorse/reference-to-video",
    "happyhorse/video-edit",
    // Runway 判别串。
    "happyhorse_1_0",
  ],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文本生成",
      promptRequired: true,
      modelEnum: "happyhorse/text-to-video",
      slots: [],
      params: [RES("1080p"), RATIO, DURATION, SEED],
      vendorParams: { runway: RUNWAY_T2V_PARAMS },
    },
    {
      id: "i2v",
      intent: "single",
      vendorTerm: "图生视频",
      hint: "单张首帧图（无尾帧、无比例）",
      promptRequired: true,
      modelEnum: "happyhorse/image-to-video",
      // kie 把 4 个端点收在一个 createTask 上（故档案级 text_to_video 即可）；Runway 转售的同一模型
      // 把图模式发到 /v1/image_to_video → 只对 runway 覆盖桶。
      vendorTransportTaskKind: { runway: "image_to_video" },
      // 单图首帧，但 HappyHorse 的 input 是 image_urls[正好 1] → asArray 包成 1 元素数组。无 aspect_ratio。
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "image_urls", asArray: true }],
      params: [RES("1080p"), DURATION, SEED],
      vendorParams: { runway: RUNWAY_I2V_PARAMS },
    },
    {
      id: "ref",
      intent: "character",
      vendorTerm: "角色参考",
      hint: "1–9 张角色图 → prompt 里按顺序写 @image1…@image9",
      promptRequired: true,
      modelEnum: "happyhorse/reference-to-video",
      slots: [{ kind: "image_ref", label: "角色参考", min: 1, max: 9, inputKey: "reference_image", characterIndexed: true }],
      params: [RES("1080p"), RATIO, DURATION, SEED],
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "视频编辑",
      hint: "源视频 + 0–5 张参考图（无比例、无时长）",
      promptRequired: true,
      modelEnum: "happyhorse/video-edit",
      slots: [
        { kind: "source_video", label: "源视频", min: 1, max: 1, inputKey: "video_url" },
        { kind: "image_ref", label: "参考图", min: 0, max: 5, inputKey: "reference_image" },
      ],
      params: [RES("1080p"), AUDIO_SETTING, SEED],
    },
  ],
};
