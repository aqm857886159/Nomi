import type { ModelParameterControl } from "./types";
import type { ModelArchetype } from "./types";

// Wan 2.7（apimart 独占）视频档案。比例字段是 size（非 aspect_ratio）；resolution 720P/1080P；duration 2-15。
// 文生视频 / 图生视频（image_urls 1-2，1=首帧 2=首尾帧）/ **角色参考（2026-07-29 加，model=wan2.7-r2v）**。
// 角色参考照 docs.apimart.ai/en/api-reference/videos/wan2.7-r2v/generation.md 对账：图参考走
// image_with_roles [{url,role:'reference_image'}]（combineSlotsInto 通用原语，role 由 kind 派生）、
// 视频参考走 video_urls 裸数组（官方 image_with_roles 的 role 只有 reference_image / first_frame，所以合并只收
// image_ref：combineSlotsInto.kinds；2026-07-31 角色表补上 reference_video 后画布路曾把参考视频也并进
// image_with_roles，2026-11-07 改回）；图+视频合计 ≤5（上游校验，
// 槽系统只能各限 5）；带参考视频时时长上限 10s（上游校验）。reference_voice（按图配音色）本期不接。
// 三模式经 per-mode modelEnum 发不同 model（wan2.7 / wan2.7-r2v），catalog 单行、body 读 request.params.model。
// i2v 的 size 由参考帧决定（官方忽略该字段）→ i2v 不声明 size（诚实 UI，替代旧「声明了但 drop」）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const SIZE: ModelParameterControl = { key: "size", label: "比例", type: "select", options: opt(["16:9", "9:16", "1:1", "4:3", "3:4"]), defaultValue: "16:9" };
const RESOLUTION: ModelParameterControl = { key: "resolution", label: "清晰度", type: "select", options: opt(["720P", "1080P"]), defaultValue: "1080P" };
const DURATION: ModelParameterControl = { key: "duration", label: "时长(秒)", type: "number", options: [], min: 2, max: 15, defaultValue: 5 };
const NEGATIVE: ModelParameterControl = { key: "negative_prompt", label: "负向提示", type: "text", options: [], placeholder: "排除的元素…" };
const SEED: ModelParameterControl = { key: "seed", label: "种子", type: "number", options: [], placeholder: "随机" };

const T2V_PARAMS: ModelParameterControl[] = [SIZE, RESOLUTION, DURATION, NEGATIVE];
const I2V_PARAMS: ModelParameterControl[] = [RESOLUTION, DURATION, NEGATIVE];
const REF_PARAMS: ModelParameterControl[] = [SIZE, RESOLUTION, DURATION, NEGATIVE, SEED];

export const WAN_2_7_ARCHETYPE: ModelArchetype = {
  id: "wan-2.7",
  family: "wan",
  label: "Wan 2.7",
  kind: "video",
  defaultModeId: "t2v",
  transportTaskKind: "text_to_video",
  identifierPatterns: ["wan-2.7", "wan2.7", "wan-2-7", "wan2.7-r2v", "wan-2-7-r2v"],
  modes: [
    {
      id: "t2v", intent: "text", vendorTerm: "文生视频", hint: "纯文字生成视频", promptRequired: true,
      transportTaskKind: "text_to_video", modelEnum: "wan2.7", slots: [], params: T2V_PARAMS,
    },
    {
      id: "i2v", intent: "single", vendorTerm: "图生视频", hint: "参考图驱动（1 张=首帧，2 张=首尾帧）", promptRequired: true,
      transportTaskKind: "image_to_video", modelEnum: "wan2.7",
      slots: [{ kind: "image_ref", label: "首/尾帧", min: 1, max: 2, inputKey: "image_urls" }],
      params: I2V_PARAMS,
    },
    {
      id: "ref", intent: "character", vendorTerm: "角色参考",
      hint: "最多 5 个参考（图+视频合计），角色/风格一致性直出；提示词可用「图1」「视频1」指代", promptRequired: true,
      transportTaskKind: "image_to_video", modelEnum: "wan2.7-r2v",
      slots: [
        { kind: "image_ref", label: "参考图", min: 0, max: 5 },
        { kind: "video_ref", label: "参考视频", min: 0, max: 5, inputKey: "video_urls" },
      ],
      combineSlotsInto: { key: "image_with_roles", kinds: ["image_ref"] },
      params: REF_PARAMS,
    },
  ],
};
