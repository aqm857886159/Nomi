import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";
import { RUNWAY_GENERATE_AUDIO_CONTROL, runwayRatioControl } from "./runwayWireFacts";

// ---------------------------------------------------------------------------
// Wan 3.0 视频档案（kie.ai）。契约来自官方文档实查（2026-08-27，R5）：
//   docs.kie.ai/market/wan/3-0-video.md 与 .../3-0-video-prime.md 逐项对账，非记忆。
//
// **为什么用 variants 而不是 per-mode modelEnum**：`wan/3-0-video` 与 `wan/3-0-video-prime`
// 的字段表**逐项相同**（参数名/枚举/默认/上限全等），差异只有 model id 与「高速」定位。
// modelEnum 的语义是「同一档案的不同**模式**发不同 model」（如 Wan 2.7 的 t2v vs r2v）；
// 这里是「同一模式下用户选快/慢」——那是 variant。故 1 条 catalog 行 + 2 变体。
//
// **四模式即互斥**：官方硬约束「first_frame_url/last_frame_url 不能与 reference_*_urls 同时出现」。
// 不靠运行时校验，直接长成模式划分（同 Seedance 的做法）——用户选了模式就不可能凑出违法组合。
//
// **首/尾帧是裸字符串 URL**：文档 schema 标 "type: object" 是生成器产物，正文请求示例是字符串
// （"first_frame_url": "https://..."），故槽不加 asArray（默认单串）。
//
// 本轮**不接**两个官方字段，理由见 docs/plan/2026-08-27-wan-3-0-integration.md：
//   - reference_file_urls（文档参考）：本仓无「文档资产」槽类型，硬造 slot kind 会牵动整条资产管线。
//   - reference_link_urls（网页参考）：wire 要数组，模板层 ["{{...}}"] 在参数为空串时会发出 [""]
//     （已在 renderTemplateValue 上跑探针实测），做不到空安全 → 不做。
// ---------------------------------------------------------------------------

const opt = (values: Array<string | number>): ModelParameterControl["options"] =>
  values.map((value) => ({ value, label: String(value) }));

// 官方默认：resolution 1080P、aspect_ratio adaptive、duration 5、audio true。
// seed 无默认（不填则模板整键丢弃 → 供应商侧随机）。
const RESOLUTION: ModelParameterControl = {
  key: "resolution",
  label: "清晰度",
  type: "select",
  options: opt(["480P", "720P", "1080P"]),
  defaultValue: "1080P",
};

const ASPECT_RATIO: ModelParameterControl = {
  key: "aspect_ratio",
  label: "比例",
  type: "select",
  options: opt(["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"]),
  defaultValue: "adaptive",
};

// duration 官方 [2,30]，另允许 -1 = 由模型自定。number 控件表达不了「区间 + 哨兵值」，
// 取区间为准（-1 属高级用法，不给控件；不填 -1 不影响任何常规创作）。
const DURATION: ModelParameterControl = {
  key: "duration",
  label: "时长(秒)",
  type: "number",
  options: [],
  min: 2,
  max: 30,
  defaultValue: 5,
};

const AUDIO: ModelParameterControl = { key: "audio", label: "生成音频", type: "boolean", options: [], defaultValue: true };
const SEED: ModelParameterControl = { key: "seed", label: "种子", type: "number", options: [], placeholder: "随机" };

const BASE_PARAMS: ModelParameterControl[] = [ASPECT_RATIO, RESOLUTION, DURATION, AUDIO, SEED];

// 首/尾帧模式：比例由参考帧决定 → **不声明 aspect_ratio 控件，也不发这个字段**，
// 由官方默认（adaptive）接管。不留「只有一个选项的假下拉」（设计系统 C1「可点即有效」）。
// 注意这里是「不发」而不是「发常量」：官方文档写明 aspect_ratio 缺省即 adaptive，
// 少发一个字段比发一个我们自己钉死的值更诚实——将来官方改默认，我们跟着走而不是钉在旧值上。
const FRAME_PARAMS: ModelParameterControl[] = BASE_PARAMS.filter((p) => p.key !== "aspect_ratio");

// Runway 转售的 wan3：Runway union 的 wan 变体只有 ratio / duration / audio——**没有 resolution，
// 也没有 seed**；而它的音频开关在线缆上叫 `generate_audio`（kie 侧叫 `audio`）。档案原样声明的
// resolution / seed / audio 三个键在 Runway 上全部发不出去（audio 是键名不同，另两个是压根没有）。
// 比例枚举同样是 Runway 自己的像素式一套，从 shared 的同一张表 derive。
const RUNWAY_PARAMS: ModelParameterControl[] = [
  runwayRatioControl("wan"),
  DURATION,
  RUNWAY_GENERATE_AUDIO_CONTROL,
];

// 首/尾帧模式：Runway 的 image_to_video 仍收 ratio（与 happyhorse 不同），故沿用同一组。
const RUNWAY_FRAME_PARAMS: ModelParameterControl[] = RUNWAY_PARAMS;

const KIE_SOURCE_COVERS =
  "POST /api/v1/jobs/createTask，参数全部嵌在 input 下；first_frame_url / last_frame_url 为裸字符串 URL；" +
  "reference_image_urls 最多 10、reference_video_urls 最多 5（每段 1-15s、合计 ≤15s）、reference_audio_urls 最多 5；" +
  "resolution 480P|720P|1080P 默认 1080P；aspect_ratio adaptive|16:9|4:3|1:1|3:4|9:16 默认 adaptive；" +
  "duration 整数 [2,30] 或 -1 默认 5；audio 默认 true；seed [0,2147483647]；nsfw_checker 默认 false；" +
  "首/尾帧与 reference_* 互斥；结果 data.resultJson 是 JSON 字符串，取 resultUrls[0]";

export const WAN_3_0_ARCHETYPE: ModelArchetype = {
  // Runway 的 wan3 行原挂平台档案 runway-video（已删）；存量节点靠 legacyIds + 模型身份匹配迁到这里。
  legacyIds: ["runway-video"],
  id: "wan-3.0",
  family: "wan",
  label: "Wan 3.0",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  // "wan3" 是 Runway 的判别串：裸串接入同名模型也认到本档案。
  identifierPatterns: ["wan/3-0-video", "wan/3-0-video-prime", "wan-3.0", "wan3.0", "wan3"],
  catalogModelKey: "wan/3-0-video",
  variants: [
    { id: "standard", label: "Wan 3.0", modelKey: "wan/3-0-video" },
    // 高速版：契约与标准版逐项相同，故无 paramOverrides（variant 只换 model id）。
    { id: "prime", label: "Wan 3.0 高速", modelKey: "wan/3-0-video-prime" },
  ],
  defaultVariantId: "standard",
  sources: [
    {
      url: "https://docs.kie.ai/market/wan/3-0-video.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers: `model=wan/3-0-video；${KIE_SOURCE_COVERS}`,
    },
    {
      url: "https://docs.kie.ai/market/wan/3-0-video-prime.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers: `model=wan/3-0-video-prime（高速变体）；字段表与标准版逐项相同：${KIE_SOURCE_COVERS}`,
    },
  ],
  modes: [
    {
      id: "t2v",
      intent: "text",
      vendorTerm: "文生视频",
      hint: "纯文字生成视频，最长 30 秒，自带音轨",
      promptRequired: true,
      transportTaskKind: "text_to_video",
      slots: [],
      params: BASE_PARAMS,
      vendorParams: { runway: RUNWAY_PARAMS },
    },
    {
      id: "first",
      intent: "single",
      vendorTerm: "首帧",
      hint: "单张首帧图驱动生成（比例由首帧决定）",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [{ kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_url" }],
      params: FRAME_PARAMS,
      vendorParams: { runway: RUNWAY_FRAME_PARAMS },
    },
    {
      id: "firstlast",
      intent: "firstlast",
      vendorTerm: "首尾帧",
      hint: "首帧 + 尾帧，过渡更可控（比例由首帧决定）",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "first_frame", label: "首帧", min: 1, max: 1, inputKey: "first_frame_url" },
        { kind: "last_frame", label: "尾帧", min: 0, max: 1, inputKey: "last_frame_url" },
      ],
      params: FRAME_PARAMS,
      vendorParams: { runway: RUNWAY_FRAME_PARAMS },
    },
    {
      // 全能参考：官方上限 10 图 / 5 视频 / 5 音频。与首/尾帧互斥（故各自成模式）。
      // 官方另注「音频不建议单独使用，应与图或视频搭配」——属建议非硬约束，不做 requiresAnyOf 拦截。
      id: "ref",
      intent: "character",
      vendorTerm: "全能参考",
      hint: "多模态参考；最多 10 图 / 5 视频 / 5 音频（视频与音频每段 1-15 秒）",
      promptRequired: true,
      transportTaskKind: "image_to_video",
      slots: [
        { kind: "image_ref", label: "参考图", min: 0, max: 10, characterIndexed: true, inputKey: "reference_image_urls" },
        { kind: "video_ref", label: "参考视频", min: 0, max: 5, inputKey: "reference_video_urls" },
        { kind: "audio_ref", label: "参考音频", min: 0, max: 5, inputKey: "reference_audio_urls" },
      ],
      params: BASE_PARAMS,
      vendorParams: { runway: RUNWAY_PARAMS },
    },
  ],
};
