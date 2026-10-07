import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

// ---------------------------------------------------------------------------
// 通用图片放大档案（kie 渠道）：Topaz Image Upscale / Recraft Crisp Upscale。契约实查自官方文档（2026-10-06）：
//   docs.kie.ai/market/topaz/image-upscale.md · docs.kie.ai/market/recraft/crisp-upscale.md
//
// 为什么接它们（用户 2026-10-06 拍板）：浮条「改图 ▾ → 高清」要的是**不改内容地放大**这一能力，按能力找模型
// （mode id = "upscale"，同即梦超清 dreaminaUpscale.ts）。没有放大模型时菜单给一条去接入的路；
// 这两款是中转里现成的通用放大，选它们做「一键接入」的推荐预置。
//
// 两款各一档（不是一档两 variant）：输入图字段名不同（Topaz `image_url` / Recraft `image`），Recraft 没有倍率参数。
//
// ⚠️ 否定式判断（文档写了、我们不声明）：
//   - **没有 prompt**：两个端点 input 里没有提示词字段 → promptRequired:false，mapping 不发 prompt。
//   - **Topaz 倍率 1**：文档允许 `1`（只修复不放大），但「高清」的语义是放大，默认 2，1 仍可选（文档值域照实给）。
//   - **输入限制**：jpeg / png / webp，≤10MB（文档原话）；超限由上游拒绝，失败分类走现有那套。
// ---------------------------------------------------------------------------

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: `${value}×` }));

/** Topaz Image Upscale —— 1 / 2 / 4 倍，默认 2 倍。 */
export const TOPAZ_IMAGE_UPSCALE_ARCHETYPE: ModelArchetype = {
  id: "topaz-image-upscale",
  family: "image-upscale",
  label: "Topaz 图片放大",
  kind: "image",
  defaultModeId: "upscale",
  transportTaskKind: "image_edit",
  identifierPatterns: ["topaz/image-upscale"],
  sources: [
    {
      url: "https://docs.kie.ai/market/topaz/image-upscale.md",
      checkedAt: "2026-10-06",
      vendorKey: "kie",
      covers:
        "POST /api/v1/jobs/createTask，model=\"topaz/image-upscale\"；input {image_url 图片 URL(必填，jpeg/png/webp ≤10MB), " +
        "upscale_factor 字符串枚举 1|2|4 **默认 2**(必填)}；**input 里没有 prompt**；结果同 kie 全家桶 data.resultJson.resultUrls.0",
    },
  ],
  modes: [
    {
      id: "upscale",
      intent: "edit",
      vendorTerm: "图片放大",
      hint: "把一张图放大 2 倍或 4 倍，不改内容",
      promptRequired: false,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 1, inputKey: "image_url", asArray: false }],
      params: [
        { key: "upscale_factor", label: "放大倍数", type: "select", options: opt(["1", "2", "4"]), defaultValue: "2" },
      ],
    },
  ],
};

/** Recraft Crisp Upscale —— 只有一张输入图，没有参数。 */
export const RECRAFT_CRISP_UPSCALE_ARCHETYPE: ModelArchetype = {
  id: "recraft-crisp-upscale",
  family: "image-upscale",
  label: "Recraft 清晰放大",
  kind: "image",
  defaultModeId: "upscale",
  transportTaskKind: "image_edit",
  identifierPatterns: ["recraft/crisp-upscale"],
  sources: [
    {
      url: "https://docs.kie.ai/market/recraft/crisp-upscale.md",
      checkedAt: "2026-10-06",
      vendorKey: "kie",
      covers:
        "POST /api/v1/jobs/createTask，model=\"recraft/crisp-upscale\"；input {image 图片 URL(必填，jpeg/png/webp ≤10MB)}；" +
        "**没有 prompt、没有倍率参数**；结果同 kie 全家桶 data.resultJson.resultUrls.0",
    },
  ],
  modes: [
    {
      id: "upscale",
      intent: "edit",
      vendorTerm: "清晰放大",
      hint: "把一张图放大并锐化，不改内容",
      promptRequired: false,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 1, inputKey: "image", asArray: false }],
      params: [],
    },
  ],
};
