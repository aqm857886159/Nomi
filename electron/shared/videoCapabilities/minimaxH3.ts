import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// MiniMax H3（Hailuo 03）档案。kie.ai 2026-07 上架；契约逐项对账自 kie 官方文档
// （docs.kie.ai/cn/market/minimax-h3/{text,image,reference}-to-video，2026-08-07 核对）。
// kie 把 H3 的 3 个场景做成 3 个 model enum（minimax-h3/text-to-video | image-to-video |
// reference-to-video）——我们合成 1 个 catalog 条目 + 3 个模式，靠 per-mode modelEnum 区分
// （与 HappyHorse 同一结构，评审 M3）。
//
// 三模式契约（kie 文档实证）：
//   - 文生视频：prompt(1-7000) + aspect_ratio(**必填**，21:9/16:9/4:3/1:1/3:4/9:16，**不支持 adaptive**)
//     + duration(**必填**，4-15 整数，默认 6) + resolution(768P/2K，默认 2K)。
//   - 图生视频：prompt + image_url(首帧) + end_image_url(尾帧，可选) + duration。官方示例未含
//     resolution/aspect_ratio（比例随首帧图走）→ 本模式只放文档实证的 duration，不多放（诚实接）。
//   - 参考生视频：prompt + reference_image_urls(**必填**，1-9) + reference_video_urls(≤3，2-15s/段，
//     合计≤15s) + reference_audio_urls(≤3，不可单传) + aspect_ratio(可选，含 adaptive 且为默认)
//     + duration(必填 4-15) + resolution(768P/2K，默认 2K)。
// kie H3 的 reference_* 键**无尾随空格**（与 kie Seedance 2.0 的 `reference_video_urls␣` quirk
// 不同——逐字符照抄各自文档，quirk 不跨模型传染）。
// H3 原生立体声随片生成（无 generate_audio 开关——文档无此键，不瞎编）。

const toOptions = (values: string[]): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: value }));

/** 文生/参考模式的清晰度（kie 文档：768P / 2K，默认 2K——注意大写 P/K，逐字符照抄枚举）。 */
const RESOLUTION: ModelParameterControl = {
  key: "resolution", label: "清晰度", type: "select", options: toOptions(["768P", "2K"]), defaultValue: "2K",
};
/** 文生模式比例：必填，**无 adaptive**（kie 文档：文生不支持 adaptive）。 */
const RATIO_REQUIRED: ModelParameterControl = {
  key: "aspect_ratio", label: "比例", type: "select",
  options: toOptions(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]), defaultValue: "16:9",
};
/** 参考模式比例：可选，adaptive 为默认（kie 文档）。 */
const RATIO_ADAPTIVE: ModelParameterControl = {
  key: "aspect_ratio", label: "比例", type: "select",
  options: toOptions(["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]), defaultValue: "adaptive",
};
/** 时长：4–15 秒整数（kie 文档 enum，默认 6）。 */
const DURATION: ModelParameterControl = {
  key: "duration", label: "时长", type: "number", options: [], min: 4, max: 15, defaultValue: 6,
};

export const MINIMAX_H3_ARCHETYPE: ModelArchetype = {
  // Runway 的 hailuo3 行原挂平台档案 runway-video（已删）；存量节点靠 legacyIds 迁到这里。
  legacyIds: ["runway-video"],
  id: "minimax-h3",
  family: "minimax",
  label: "MiniMax H3",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: [
    "minimax-h3",
    "minimax-h3/text-to-video",
    "minimax-h3/image-to-video",
    "minimax-h3/reference-to-video",
    "hailuo-3",
    "hailuo-03",
    "hailuo3",
  ],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频（2K · 原生立体声）",
      promptRequired: true,
      modelEnum: "minimax-h3/text-to-video",
      slots: [],
      params: [RESOLUTION, RATIO_REQUIRED, DURATION],
    },
    {
      id: "i2v",
      intent: "single",
      vendorTerm: "图生视频",
      hint: "首帧驱动，可加尾帧（比例随图）",
      promptRequired: true,
      modelEnum: "minimax-h3/image-to-video",
      // kie 把 H3 全部场景收在一个 createTask 端点（故本档案不写模式级 transportTaskKind，用档案级
      // text_to_video）；Runway 转售的同一模型把图模式发到 /v1/image_to_video → 只对 runway 覆盖桶。
      vendorTransportTaskKind: { runway: "image_to_video" },
      // kie H3 图生契约用 image_url / end_image_url（非 first_frame_url/last_frame_url）→ inputKey 覆盖。
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "image_url", asArray: false },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "end_image_url", asArray: false },
      ],
      params: [DURATION],
    },
    {
      id: "ref",
      intent: "character",
      vendorTerm: "参考生视频",
      hint: "1–9 图 / ≤3 视频 / ≤3 音频作参考",
      promptRequired: true,
      modelEnum: "minimax-h3/reference-to-video",
      // kie 单端点（走档案级 text_to_video）；Runway 的**多图参考** union 声明在 **text** 端点
      // （POST /v1/text_to_video，PR #342；只有单图 i2v 那个 wire role 才是 image_to_video）。
      // 曾写成 image_to_video → 档案把 ref 路由去 image_to_video 桶，而 seed 把线缆放在
      // text_to_video 桶，selectTaskMapping 永远取不到 → 模式栏把「参考生视频」静默藏掉
      // （2026-09-03 check:orphan-cables 实测；seed 侧是对的，此处跟上）。
      vendorTransportTaskKind: { runway: "text_to_video" },
      // 槽默认 inputKey（reference_image_urls/reference_video_urls/reference_audio_urls）与 kie H3
      // 文档键同名 → 不覆盖。
      slots: [
        { kind: "image_ref", label: "参考图", min: 1, max: 9, characterIndexed: true },
        { kind: "video_ref", label: "参考视频", min: 0, max: 3 },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 3 },
      ],
      params: [RESOLUTION, RATIO_ADAPTIVE, DURATION],
    },
  ],
};
