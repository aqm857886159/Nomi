import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// ---------------------------------------------------------------------------
// Qwen-Image 3.0（apimart 独占）图像档案。
// 契约来自官方文档实查（2026-08-26，docs.apimart.ai/en/api-reference/images/qwen-image-3.0/generation.md），非记忆。
//
// **为什么与既有 `qwen-image`（2.0）分档而不是加变体**——改图槽上限是硬冲突：
//   2.0 档案的改图槽写的是 max 4；3.0 文档明确「1-3 images」，即**上限 3**。
//   槽上限是档案级契约，一个档案给不出两个数；而喂第 4 张给 3.0 就是 400（本地看不出来，线上才炸）。
//   其余标量（size 7 档 / resolution 1K|2K / negative_prompt）两代同形，但不足以合档。
// 2.0 未退役（文档页仍在线、apimart 现役目录里仍有 qwen-image-2.0）→ 保留不删，本档案是新增一代。
//
// 变体轴（标准 / Pro）沿用 2.0 的手法：两个变体只是 model 字符串不同、参数域完全一致，
// 故走档案级 `variants`（body model 读 {{request.params.model}}），不是两个档案也不是两个 mode。
// Pro 官方定位：密集排版与文字渲染更强（海报/字卡这类场景）。
// ---------------------------------------------------------------------------

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

// params 键 = apimart 字段名（size / resolution / negative_prompt）→ mapping body 直通，无需 paramMap。
const PARAMS: ModelParameterControl[] = [
  // 文档 size 支持比例串与像素串（每边 512–2048）两种写法。这里只给比例串：
  // 像素串要求用户自己算边长且受 512–2048 夹逼，属于「让用户学我们格式」——按 D1 砍掉。
  { key: "size", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"]), defaultValue: "1:1" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K"]), defaultValue: "1K" },
  // 负向提示词：与 2.0 档案一致，只暴露这一个高价值可选项（用户已拍板的口径）。
  { key: "negative_prompt", label: "负向提示", type: "text", options: [], placeholder: "排除的元素…" },
];

export const QWEN_IMAGE_3_ARCHETYPE: ModelArchetype = {
  id: "qwen-image-3",
  family: "qwen-image",
  label: "Qwen-Image 3.0",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["qwen-image-3.0", "qwen-image-3-0", "qwen-image-3.0-pro", "qwen-image-3-0-pro"],
  sources: [
    {
      url: "https://docs.apimart.ai/en/api-reference/images/qwen-image-3.0/generation.md",
      checkedAt: "2026-08-26",
      vendorKey: "apimart",
      covers:
        "POST /v1/images/generations（扁平 body）；model 取 \"qwen-image-3.0\" 或 \"qwen-image-3.0-pro\"（Pro 强于密集排版与文字渲染）；size 默认 \"1:1\"，支持比例串 1:1|4:3|3:4|16:9|9:16|3:2|2:3 或像素串（每边 512–2048，本档案不暴露像素串）；resolution 1K(默认)|2K；n 1–6 默认 1；image_urls **1–3 张**（比 2.0 的 4 张少）触发改图；negative_prompt / nsfw_check(默认 false) / prompt_extend(默认 false) / prompt_extend_mode direct|agent（仅文生图）；prompt 上限约 4.5k tokens；响应 data[0].task_id 异步轮询",
    },
  ],
  modes: [
    { id: "t2i", intent: "text", vendorTerm: "文生图", hint: "纯文字生成图像", promptRequired: true, transportTaskKind: "text_to_image", slots: [], params: PARAMS },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 3 张）+ 提示词改图",
      promptRequired: true,
      transportTaskKind: "image_edit",
      // 上限 3：文档原文「1-3 images」。2.0 档案写的是 4，别照抄。
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 3, inputKey: "image_urls" }],
      params: PARAMS,
    },
  ],
  variants: [
    { id: "standard", label: "标准", modelKey: "qwen-image-3.0", identifierPatterns: ["qwen-image-3-0"] },
    { id: "pro", label: "Pro", modelKey: "qwen-image-3.0-pro", identifierPatterns: ["qwen-image-3-0-pro"] },
  ],
  defaultVariantId: "standard",
};
