import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// GPT Image 2.6（APIMart 官方页 docs.apimart.ai/en/api-reference/images/gpt-image-2.6/generation.md，2026-11-07 核）。
// 只有 APIMart 提供：Flare（快，官方推荐默认）/ Sunburst（细节与多轮编辑一致性）两个并列产品，参数逐字相同。
// 只接位图的文生图 / 改图基础模式。mask_url / markup_url / complexity / GIF / SVG / n 都不声明
// （选区、遮罩、动图、矢量是另一类操作和结果形状，不在这条线里）。
// 与 2.5 的区别：2.5 仍在售（官方页没有下线说明），是上一代；这里是新增一代，不替换。
// quality 默认取 medium：官方写明 auto 会按 max 档预扣款，默认值不替用户挑最贵的一档（同 2.5 档案）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

/** 官方 15 档比例 + auto（另支持 16 的倍数精确像素，不在档案里暴露）。 */
const SIZES = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "21:9", "9:21", "3:1", "1:3"];

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(SIZES), defaultValue: "auto" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K", "4K"]), defaultValue: "1K" },
  { key: "background", label: "背景", type: "select", options: opt(["auto", "transparent", "opaque"]), defaultValue: "auto" },
  { key: "quality", label: "质量", type: "select", options: opt(["low", "medium", "high", "xhigh", "max"]), defaultValue: "medium" },
];

const SOURCE_COVERS =
  "POST /v1/images/generations（扁平 body，文生图与改图同一个 model id，给 image_urls 即进改图模式）；" +
  "model 二选一 `gpt-image-2.6-flare` / `gpt-image-2.6-sunburst`；size 15 档比例 + auto(默认)；" +
  "resolution 小写 1k(默认)|2k|4k；quality low|medium|high|xhigh|max|auto(默认，按 max 档预扣款)；" +
  "background transparent|opaque|auto；image_urls 最多 16 张；响应 data[0].task_id 异步轮询。" +
  "不声明：mask_url / markup_url / complexity / output_format(gif|svg) / n。";

function modes(): ModelArchetype["modes"] {
  return [
    {
      id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true,
      transportTaskKind: "text_to_image", slots: [], params: PARAMS,
    },
    {
      id: "i2i", intent: "edit", vendorTerm: "改图", hint: "给图（最多 16 张）+ 提示词改图", promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 16, inputKey: "input_urls" }],
      params: PARAMS,
    },
  ];
}

function gptImage26(tier: "flare" | "sunburst", label: string): ModelArchetype {
  return {
    id: `gpt-image-2.6-${tier}`, family: "gpt-image", label, kind: "image",
    defaultModeId: "t2i", transportTaskKind: "text_to_image",
    identifierPatterns: [`gpt-image-2.6-${tier}`],
    sources: [{ url: "https://docs.apimart.ai/en/api-reference/images/gpt-image-2.6/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart", covers: SOURCE_COVERS }],
    modes: modes(),
  };
}

/** GPT Image 2.6 Flare —— 更快，官方推荐默认。 */
export const GPT_IMAGE_26_FLARE_ARCHETYPE = gptImage26("flare", "GPT Image 2.6 Flare");
/** GPT Image 2.6 Sunburst —— 细节与多轮编辑一致性优先。 */
export const GPT_IMAGE_26_SUNBURST_ARCHETYPE = gptImage26("sunburst", "GPT Image 2.6 Sunburst");
