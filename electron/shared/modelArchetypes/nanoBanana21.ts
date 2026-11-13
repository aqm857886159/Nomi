import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// Nano Banana 2.1（APIMart 官方页 docs.apimart.ai/en/api-reference/images/gemini-nano-banana-2.1/generation.md，2026-11-07 核）。
// 两个并列 model id，参数与出图质量相同，只是计费与单次张数不同：
//   gemini-nano-banana-2.1      按实际 token 计费，n 1–4
//   gemini-nano-banana-2.1-ext  按分辨率档逐张计费，n 只能 1
// 一个生成节点一次出一张（全站语义），所以 n 不声明；official_fallback 会让计费从逐张换成 token，也不声明。
// 2.1 是最新一代，Nano Banana 2（nano-banana-2 档案）是上一代，两者都可选；第一代 nano-banana 才是旧代。
// 参考图张数官方未给上限（只限单张 20MB），这里沿用同族 Nano Banana 2 已核的 14，写在 sources.covers 里。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const SIZES = ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "4:1", "1:8", "8:1"];

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(SIZES), defaultValue: "auto" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K", "4K"]), defaultValue: "1K" },
];

const SOURCE_URL = "https://docs.apimart.ai/en/api-reference/images/gemini-nano-banana-2.1/generation.md";

function covers(modelId: string, billing: string): string {
  return (
    `POST /v1/images/generations（扁平 body，文生图与改图同一个 model id，给 image_urls 即进改图模式）；model \`${modelId}\`；` +
    "size 14 档比例 + auto(默认，1:4|4:1|1:8|8:1|1:1|2:3|3:2|3:4|4:3|4:5|5:4|9:16|16:9|21:9)，也收 16x9 写法；" +
    `resolution 1K(默认)|2K|4K（大小写都收；0.5K / 512 会 400）；${billing}；` +
    "image_urls 官方未给张数上限（单张 ≤20MB），本档案沿用 Nano Banana 2 的 14 张；" +
    "不声明：n（节点一次一张）/ official_fallback（会把逐张计费换成 token 计费）；响应 data[0].task_id 异步轮询。"
  );
}

function modes(): ModelArchetype["modes"] {
  return [
    { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params: PARAMS },
    {
      id: "i2i", intent: "edit", vendorTerm: "改图", hint: "给图（最多 14 张）+ 提示词改图", promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 14, inputKey: "image_urls" }],
      params: PARAMS,
    },
  ];
}

function nanoBanana21(modelId: string, label: string, billing: string): ModelArchetype {
  return {
    id: modelId, family: "nano-banana", label, kind: "image",
    defaultModeId: "t2i", transportTaskKind: "text_to_image",
    identifierPatterns: [modelId],
    sources: [{ url: SOURCE_URL, checkedAt: "2026-11-07", vendorKey: "apimart", covers: covers(modelId, billing) }],
    modes: modes(),
  };
}

/** Nano Banana 2.1 —— 官方通道，按 token 计费。 */
export const NANO_BANANA_21_ARCHETYPE = nanoBanana21("gemini-nano-banana-2.1", "Nano Banana 2.1", "按实际 token 计费");
/** Nano Banana 2.1 Ext —— 按分辨率档逐张计费，价格可预估。 */
export const NANO_BANANA_21_EXT_ARCHETYPE = nanoBanana21("gemini-nano-banana-2.1-ext", "Nano Banana 2.1 Ext", "按分辨率档逐张计费（1K/2K/4K 三档单价）");
