import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";
import { runwayImageParams } from "../../../electron/shared/imageCapabilities/runwayImageWireFacts";

// ---------------------------------------------------------------------------
// kie 渠道的 Seedream 5.0（pro / lite 两档）图像档案。
// 契约来自官方文档实查（2026-08-26，docs.kie.ai/market/seedream/5-pro-text-to-image.md
// + 5-pro-image-to-image.md + 5-lite-text-to-image.md + seedream-5-lite-image-to-image.md），非记忆。
//
// **kie 与 apimart/火山的结构性差异（这是本文件存在的根本原因）**：
//   apimart / 火山：一个 model id + 有没有 `image_urls` 决定文生图还是改图。
//   kie：**文生图和改图是两个不同的 model id**（`seedream/5-pro-text-to-image` vs
//        `seedream/5-pro-image-to-image`）。
//   → 建模方式：**按能力（mode）建模，不按 model id 建模**。档案仍是「一个模型两个 mode」，
//     两个 kie model id 由 per-mode `modelEnum` 承担（既有 seedream.ts / nanoBanana.ts 同款手法）。
//     绝不因为 kie 拆了 id 就在上层写两套并行代码路径（那是 P1 违规 + P4 违规）。
//
// **为什么 pro 与 lite 分两档而不是一档两变体**——参数域在两个维度上冲突：
//   1. **quality 枚举不同**：lite 是 basic|high|**ultra**（三档），pro 只有 basic|high。
//      合档就得取交集（丢掉 lite 的 ultra，即丢掉它最高画质）或取并集（pro 发 ultra 必 400）。
//   2. **参考图上限相反**：pro **10** 张，lite **14** 张。槽上限是档案级契约，一档容不下两个数。
//      （注意这个方向反直觉：贵的 pro 反而收得更少，别照"pro 什么都更多"的直觉写。）
//   3. prompt 上限也不同（pro 5000 / lite 3000），虽不进 UI 但记在 sources 里备查。
//   与 seedreamVolcengine.ts / seedreamVolcengine5Pro.ts 分档同理，只是那两份按像素域分，这两份按 quality+槽域分。
//
// 与既有伞档案 `seedream`（kie 4.5）的关系：4.5 未退役（文档页仍在线、model id 仍现役），
// 故**保留不动**，本文件是新增 5.0 代，非替换。4.5 的改图 `seedream/4.5-edit` 早已接好
// （kieSeedream.ts 的 SEEDREAM_EDIT_MAPPING），本轮无需补。
// ---------------------------------------------------------------------------

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

// 两档共用：aspect_ratio 8 档（1:1 默认）与 output_format（png 默认）在 pro/lite 四个端点上完全一致。
const ASPECT_RATIO_PARAM: ModelParameterControl = {
  key: "aspect_ratio",
  label: "比例",
  type: "select",
  options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"]),
  defaultValue: "1:1",
};

const OUTPUT_FORMAT_PARAM: ModelParameterControl = {
  key: "output_format",
  label: "格式",
  type: "select",
  options: opt(["png", "jpeg"]),
  defaultValue: "png",
};

// pro：quality 仅 basic|high（basic=1K / high=2K，见 5-pro-image-to-image.md 的字段说明）。
const PRO_PARAMS: ModelParameterControl[] = [
  ASPECT_RATIO_PARAM,
  { key: "quality", label: "质量", type: "select", options: opt(["basic", "high"]), defaultValue: "basic" },
  OUTPUT_FORMAT_PARAM,
];

// lite：quality 多一档 ultra —— 这是 lite 独有，pro 发它会 400。
const LITE_PARAMS: ModelParameterControl[] = [
  ASPECT_RATIO_PARAM,
  { key: "quality", label: "质量", type: "select", options: opt(["basic", "high", "ultra"]), defaultValue: "basic" },
  OUTPUT_FORMAT_PARAM,
];

// Runway 专属参数（B 分层 vendorParams）：Runway 也提供 Seedream 5 Lite，但它的 union 变体收的是
// **像素串** ratio（2048:2048 起、全部 ≥3.68M 像素，共 16 值），上面 kie 的朝向式 `1:1`/`16:9`
// 在 Runway 上一个都不合法（实测发共享默认恒 400，见 runwayRatio.ts 的实测记录）；
// 也没有 quality / output_format 字段，但有 outputCount（1–4）。取值由官方 OpenAPI 逐字表 derive。
const LITE_RUNWAY_PARAMS: ModelParameterControl[] = runwayImageParams("seedream5_lite");

export const KIE_SEEDREAM_5_PRO_ARCHETYPE: ModelArchetype = {
  id: "kie-seedream-5-pro",
  family: "seedream",
  label: "Seedream 5.0 Pro",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // 严格相等匹配：两个 mode 的 kie model id 都要能认回本档案。
  identifierPatterns: ["seedream/5-pro-text-to-image", "seedream/5-pro-image-to-image"],
  sources: [
    {
      url: "https://docs.kie.ai/market/seedream/5-pro-text-to-image.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "POST /api/v1/jobs/createTask，model=\"seedream/5-pro-text-to-image\"；input {prompt 3–5000 字符, aspect_ratio 8 档 1:1(默认)|4:3|3:4|16:9|9:16|2:3|3:2|21:9, quality basic(默认)|high, output_format png(默认)|jpeg, nsfw_checker 默认 false}；**此端点无 image_urls 字段**（文生图专用 id，改图是另一个 id）",
    },
    {
      url: "https://docs.kie.ai/market/seedream/5-pro-image-to-image.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "model=\"seedream/5-pro-image-to-image\"（与文生图**不同的 model id**）；input.image_urls 必填、**上限 10 张**（lite 是 14，方向与直觉相反）；prompt 3–5000 字符；quality basic=1K / high=2K，仅两档无 ultra；aspect_ratio / output_format / nsfw_checker 同文生图",
    },
  ],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像",
      promptRequired: true,
      modelEnum: "seedream/5-pro-text-to-image",
      transportTaskKind: "text_to_image",
      slots: [],
      params: PRO_PARAMS,
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 10 张）+ 提示词改图",
      promptRequired: true,
      modelEnum: "seedream/5-pro-image-to-image",
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "image_urls" }],
      params: PRO_PARAMS,
    },
  ],
};

export const KIE_SEEDREAM_5_LITE_ARCHETYPE: ModelArchetype = {
  id: "kie-seedream-5-lite",
  family: "seedream",
  label: "Seedream 5.0 Lite",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // `seedream5_lite` 是 Runway 侧的判别串（同一个产品的第二家接入，P4：档案 = 模型身份，供应商无关）。
  identifierPatterns: ["seedream/5-lite-text-to-image", "seedream/5-lite-image-to-image", "seedream5_lite"],
  // Runway 的这一行原挂平台档案 runway-image（已删）；存量节点靠 legacyIds + 模型身份匹配迁到这里。
  legacyIds: ["runway-image"],
  sources: [
    {
      url: "https://docs.kie.ai/market/seedream/5-lite-text-to-image.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "POST /api/v1/jobs/createTask，model=\"seedream/5-lite-text-to-image\"；input {prompt 3–3000 字符（比 pro 的 5000 短）, aspect_ratio 同 pro 8 档默认 1:1, quality basic(默认)|high|**ultra**（ultra 为 lite 独有，pro 无此档）, output_format png(默认)|jpeg, nsfw_checker 默认 false}；此端点无 image_urls",
    },
    {
      url: "https://docs.kie.ai/market/seedream-5-lite-image-to-image.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "model=\"seedream/5-lite-image-to-image\"（独立 model id；注意此页 URL 在 market/ 下是扁平路径 seedream-5-lite-image-to-image.md，不是 seedream/ 子目录——按 seedream/ 子目录拼会 404）；input.image_urls 必填、**上限 14 张**（比 pro 的 10 张多）；prompt 3–3000；quality basic(默认)|high|ultra",
    },
  ],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像，快档",
      promptRequired: true,
      modelEnum: "seedream/5-lite-text-to-image",
      transportTaskKind: "text_to_image",
      slots: [],
      params: LITE_PARAMS,
      vendorParams: { runway: LITE_RUNWAY_PARAMS },
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 14 张）+ 提示词改图",
      promptRequired: true,
      modelEnum: "seedream/5-lite-image-to-image",
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 14, inputKey: "image_urls" }],
      params: LITE_PARAMS,
      vendorParams: { runway: LITE_RUNWAY_PARAMS },
    },
  ],
};
