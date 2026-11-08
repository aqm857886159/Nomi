import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// Nano Banana Lite（APIMart 官方页 docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation-lite.md，2026-11-07 核）。
// 两个并列 model id，参数相同：gemini-3.1-flash-lite-image（官方通道）与 gemini-3.1-flash-lite-image-ext。
// Lite 只出 1K：官方说传 2K / 4K / 0.5K 会被静默降到 1K 且不报错，所以不声明 resolution（不给用户一个不起作用的选项）。
// 不支持 google_search / official_fallback / mask_url；n 不声明（节点一次一张）。参考图最多 14 张（官方明写）。
// 官方别名 nano-banana-2-lite / nano-banana-2-lite-ext 与原名等价，目录只登记原名。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const SIZES = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "5:4", "4:5", "21:9"];
const PARAMS: ModelParameterControl[] = [{ key: "size", label: "比例", type: "select", options: opt(SIZES), defaultValue: "auto" }];

function nanoBananaLite(modelId: string, label: string): ModelArchetype {
  return {
    id: modelId, family: "nano-banana", label, kind: "image",
    defaultModeId: "t2i", transportTaskKind: "text_to_image",
    identifierPatterns: [modelId],
    sources: [{
      url: "https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation-lite.md", checkedAt: "2026-11-07", vendorKey: "apimart",
      covers:
        `POST /v1/images/generations，model \`${modelId}\`（文生图与改图同一个 model id，给 image_urls 即改图）；` +
        "size auto|1:1|3:2|2:3|4:3|3:4|16:9|9:16|5:4|4:5|21:9；只支持 1K（resolution 传 2K/4K/0.5K 被静默降到 1K，故不声明）；" +
        "image_urls 最多 14 张；不声明 n / google_search / official_fallback / mask_url；响应 data[0].task_id 异步轮询。",
    }],
    modes: [
      { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像（只出 1K）", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params: PARAMS },
      {
        id: "i2i", intent: "edit", vendorTerm: "改图", hint: "给图（最多 14 张）+ 提示词改图", promptRequired: true, transportTaskKind: "image_edit",
        slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 14, inputKey: "image_urls" }],
        params: PARAMS,
      },
    ],
  };
}

export const NANO_BANANA_LITE_ARCHETYPE = nanoBananaLite("gemini-3.1-flash-lite-image", "Nano Banana Lite");
export const NANO_BANANA_LITE_EXT_ARCHETYPE = nanoBananaLite("gemini-3.1-flash-lite-image-ext", "Nano Banana Lite Ext");
