import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// FLUX 3 图像（APIMart 官方页 docs.apimart.ai/en/api-reference/images/flux-3-image/generation.md 与
// flux-3-image-klein/generation.md，2026-11-07 核）。两个并列产品：标准版（支持 grounding 联网检索）/ Klein（快、便宜，
// 可调 steps / seed / 输出格式，不支持 grounding）。
// 只接位图文生图 / 改图基础模式；prompt 里写 bbox / tag 的选区编辑是另一类操作，不在这里。
// 官方明写会 400 的字段一律不声明：width / height / 像素 size / negative_prompt / prompt_upsampling / mask_url（两版），
// 标准版另有 seed / steps / guidance / output_format，Klein 另有 grounding / guidance。n 只能 1，不声明。
// 官方的 size 是 aspect_ratio 的兼容别名，二选一，这里只发 aspect_ratio。
// safety_tolerance（0–4，默认 2）不暴露：默认即可用，调高放宽审核不是创作者要摸的开关。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RATIOS = ["auto", "21:9", "2:1", "16:9", "3:2", "7:5", "4:3", "5:4", "1:1", "4:5", "3:4", "5:7", "2:3", "9:16", "1:2", "9:21"];
const RESOLUTIONS = ["768sq", "1k", "1.5k", "2k", "4k"];

const BASE_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(RATIOS), defaultValue: "auto" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(RESOLUTIONS), defaultValue: "1k" },
];

const KLEIN_PARAMS: ModelParameterControl[] = [
  ...BASE_PARAMS,
  { key: "output_format", label: "格式", type: "select", options: opt(["jpeg", "png"]), defaultValue: "jpeg" },
  { key: "steps", label: "步数", type: "number", options: [], min: 1, max: 16, step: 1, defaultValue: 16 },
  { key: "seed", label: "随机种子", type: "number", options: [], min: 0, max: 4294967295, step: 1 },
];

const STANDARD_PARAMS: ModelParameterControl[] = [
  ...BASE_PARAMS,
  { key: "grounding", label: "联网检索", type: "boolean", options: [], defaultValue: true },
];

function modes(params: ModelParameterControl[]): ModelArchetype["modes"] {
  return [
    { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params },
    {
      id: "i2i", intent: "edit", vendorTerm: "改图", hint: "给图（最多 10 张）+ 提示词改图", promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "image_urls" }],
      params,
    },
  ];
}

const COMMON =
  "POST /v1/images/generations（扁平 body，文生图与改图同一个 model id，给 image_urls 即进改图模式，最多 10 张）；" +
  "aspect_ratio 15 档比例 + auto(默认)；resolution 768sq|1k(默认)|1.5k|2k|4k（大小写都收，决定计费档，其他值 400）；" +
  "n 只能 1；响应 data[0].task_id 异步轮询。";

/** FLUX 3 —— 标准版（grounding 联网检索，默认开）。 */
export const FLUX_3_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "flux-3-image", family: "flux", label: "FLUX 3", kind: "image",
  defaultModeId: "t2i", transportTaskKind: "text_to_image",
  identifierPatterns: ["flux-3-image"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/images/flux-3-image/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers: `model \`flux-3-image\`；${COMMON}grounding 布尔(默认 true，必须是布尔不能是字符串)；不声明 seed/steps/guidance/output_format/negative_prompt/mask_url（发了 400）。`,
  }],
  modes: modes(STANDARD_PARAMS),
};

/** FLUX 3 Klein —— 快、便宜，可调步数 / 种子 / 格式。 */
export const FLUX_3_IMAGE_KLEIN_ARCHETYPE: ModelArchetype = {
  id: "flux-3-image-klein", family: "flux", label: "FLUX 3 Klein", kind: "image",
  defaultModeId: "t2i", transportTaskKind: "text_to_image",
  identifierPatterns: ["flux-3-image-klein"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/images/flux-3-image-klein/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
    covers: `model \`flux-3-image-klein\`；${COMMON}steps 1–16(默认 16，不影响价格)；seed 0–4294967295；output_format jpeg(默认)|png（webp 400）；不声明 grounding/guidance/negative_prompt/mask_url（发了 400）。`,
  }],
  modes: modes(KLEIN_PARAMS),
};
