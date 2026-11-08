import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// 通义万相 2.7 图像（APIMart 官方页 docs.apimart.ai/en/api-reference/images/wan2.7-image/generation.md，2026-11-07 核）。
// 两个 model id：wan2.7-image（标准，全场景最高 2K）/ wan2.7-image-pro（专业，文生图最高 4K，改图与序列图最高 2K）。
// 比例用 size（7 档比例），清晰度用 resolution（1K / 2K 默认 / 4K）。改图时输出比例跟随最后一张输入图，
// 所以改图模式不声明 size；改图最高 2K，所以 Pro 的 4K 只放在文生图模式。
// 不声明：n（节点一次一张）/ enable_sequential（序列图是另一种结果形状）/ bbox_list（选区编辑）/ thinking_mode /
// color_palette / negative_prompt / seed / watermark（官方默认值即可用）。
// 价格：标准版与 Pro 都是按张固定价，与清晰度档无关（见定价表）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];

const SIZE_PARAM: ModelParameterControl = { key: "size", label: "比例", type: "select", options: opt(RATIOS), defaultValue: "1:1" };
const res = (tiers: string[]): ModelParameterControl => ({ key: "resolution", label: "清晰度", type: "select", options: opt(tiers), defaultValue: "2K" });

const COMMON =
  "POST /v1/images/generations，文生图与改图同一个 model id，给 image_urls（最多 9 张，JPEG/PNG/WEBP/BMP，240–8000px，≤20MB）即改图，输出比例跟随最后一张输入图；" +
  "size 比例 1:1|16:9|9:16|4:3|3:4|3:2|2:3；resolution 1K|2K(默认)|4K；";

function wan27Image(modelId: string, label: string, t2iTiers: string[], detail: string): ModelArchetype {
  return {
    id: modelId, family: "wan-image", label, kind: "image",
    defaultModeId: "t2i", transportTaskKind: "text_to_image",
    identifierPatterns: [modelId],
    sources: [{
      url: "https://docs.apimart.ai/en/api-reference/images/wan2.7-image/generation.md", checkedAt: "2026-11-07", vendorKey: "apimart",
      covers: `model \`${modelId}\`；${COMMON}${detail}不声明 n / enable_sequential / bbox_list / thinking_mode / color_palette / negative_prompt / seed / watermark；响应 data[0].task_id。`,
    }],
    modes: [
      { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params: [SIZE_PARAM, res(t2iTiers)] },
      {
        id: "i2i", intent: "edit", vendorTerm: "改图", hint: "给图（最多 9 张）+ 提示词改图，比例跟随最后一张图", promptRequired: true,
        transportTaskKind: "image_edit",
        slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 9, inputKey: "image_urls" }],
        params: [res(["1K", "2K"])],
      },
    ],
  };
}

/** 万相 2.7 图像 标准版 —— 更快，全场景最高 2K。 */
export const WAN_27_IMAGE_ARCHETYPE = wan27Image("wan2.7-image", "万相 2.7 图像", ["1K", "2K"], "标准版全场景只到 2K；");
/** 万相 2.7 图像 Pro —— 文生图最高 4K，改图最高 2K。 */
export const WAN_27_IMAGE_PRO_ARCHETYPE = wan27Image("wan2.7-image-pro", "万相 2.7 图像 Pro", ["1K", "2K", "4K"], "Pro 文生图可到 4K，改图 / 序列图只到 2K；");
