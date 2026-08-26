import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// ---------------------------------------------------------------------------
// FLUX.2 Pro（Black Forest Labs，kie 渠道）图像档案。
// 契约来自官方文档实查（2026-08-26，docs.kie.ai/market/flux2/pro-text-to-image.md
// + docs.kie.ai/market/flux2/pro-image-to-image.md），非记忆。
//
// 新族（仓库此前无任何 FLUX 档案），无旧实现可删。
//
// **kie 的两 id 结构**（同 kieSeedream5）：文生图 `flux-2/pro-text-to-image` 与
// 改图 `flux-2/pro-image-to-image` 是两个 model id，由 per-mode `modelEnum` 承担，
// 上层仍是「一个模型两个 mode」——按能力建模，不为 vendor 的 id 拆法写并行路径。
//
// ⚠️ 两个坑，抄错都是静默错值而不是编译错：
//   1. 改图的输入图字段名是 **`input_urls`**，不是 seedream/nano-banana 一族的 `image_urls`
//      （与 GPT-Image-2 档案同名）。故 slot inputKey 写 input_urls。
//   2. **两个端点的 aspect_ratio 枚举不一样**：t2i 是 7 档（无 auto），i2i 多一档 `auto`。
//      故两个 mode 各带自己的 params，不能共用一份——给 t2i 发 auto 就是 400。
// ---------------------------------------------------------------------------

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RESOLUTION_PARAM: ModelParameterControl = {
  key: "resolution",
  label: "清晰度",
  type: "select",
  options: opt(["1K", "2K"]),
  defaultValue: "1K",
};

const BASE_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3"];

// 文生图：7 档，**无 auto**（pro-text-to-image.md 的枚举里没有它）。
const T2I_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(BASE_RATIOS), defaultValue: "1:1" },
  RESOLUTION_PARAM,
];

// 改图：同 7 档 + auto（跟随输入图比例）。
const EDIT_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt([...BASE_RATIOS, "auto"]), defaultValue: "1:1" },
  RESOLUTION_PARAM,
];

export const FLUX_2_PRO_ARCHETYPE: ModelArchetype = {
  id: "flux-2-pro",
  family: "flux",
  label: "FLUX.2 Pro",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["flux-2/pro-text-to-image", "flux-2/pro-image-to-image"],
  sources: [
    {
      url: "https://docs.kie.ai/market/flux2/pro-text-to-image.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "POST /api/v1/jobs/createTask，model=\"flux-2/pro-text-to-image\"；input {prompt 3–5000 字符, aspect_ratio **7 档** 1:1(默认)|4:3|3:4|16:9|9:16|3:2|2:3（**无 auto**，也无 21:9）, resolution 1K(默认)|2K, nsfw_checker 默认 false}；此端点**无输入图字段**（纯文生图 id）",
    },
    {
      url: "https://docs.kie.ai/market/flux2/pro-image-to-image.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "model=\"flux-2/pro-image-to-image\"（与文生图**不同的 model id**）；输入图字段名是 **input_urls**（非 image_urls），**上限 8 张**（JPEG/PNG/WebP，单张 ≤10MB）；prompt 3–5000 字符；aspect_ratio 比 t2i **多一档 auto**（共 8 档，默认 1:1）；resolution 1K(默认)|2K",
    },
  ],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像",
      promptRequired: true,
      modelEnum: "flux-2/pro-text-to-image",
      transportTaskKind: "text_to_image",
      slots: [],
      params: T2I_PARAMS,
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 8 张）+ 提示词改图",
      promptRequired: true,
      modelEnum: "flux-2/pro-image-to-image",
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 8, inputKey: "input_urls" }],
      params: EDIT_PARAMS,
    },
  ],
};
