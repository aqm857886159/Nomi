// 即梦官方 dreamina CLI 的图片档案（文生图 + 改图）。SOURCE：docs/research/2026-09-01-dreamina-cli-v1417-matrix.md
// （CLI v1.4.17，checkedAt 2026-09-01）。模型/参数 enum 以官方 `-h` 为准：
//   text2image：model 3.0/3.1/4.0/4.1/4.5/4.6/4.7/5.0/5.0Pro；ratio 8 种；resolution_type **required**
//     （v1.4.14 破坏性变更，本机 pre-auth 探针实测 `required flag(s) "resolution_type" not set`）：
//       3.0/3.1 → 1k/2k；4.0/4.1/4.5/4.6/4.7/5.0 → 2k/4k；5.0Pro → 1.5k/2k/4k（v1.4.16 起 5.0Pro 加 1.5k、移除 1k）。
//   image2image：1-10 张本地图输入；model 4.0/4.1/4.5/4.6/4.7/5.0/5.0Pro；resolution_type 4.x/5.0→2k/4k，5.0Pro→1.5k/2k/4k。
// 图超清(upscale)无 model，单列在 dreaminaUpscale.ts。
// resolution_type 按变体 paramOverrides 精细收窄（effect-first：不给该模型跑不了的清晰度选项，也杜绝把已移除的 1k 发给 5.0Pro）。
import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const RATIO: ModelParameterControl = {
  key: "ratio", label: "比例", type: "select",
  options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9"]), defaultValue: "1:1",
};

// 基础 params 的 resolution_type 用「全模式并集」的最宽档默认；具体每个变体由 paramOverrides 收窄到该模型合法集。
// t2i 基础含 4.x/5.0 的 2k/4k（默认 2k）；变体收窄：3.0/3.1→1k/2k，5.0Pro→1.5k/2k/4k。
const T2I_PARAMS: ModelParameterControl[] = [
  RATIO,
  { key: "resolution_type", label: "清晰度", type: "select", options: opt(["2k", "4k"]), defaultValue: "2k" },
];
const I2I_PARAMS: ModelParameterControl[] = [
  RATIO,
  { key: "resolution_type", label: "清晰度", type: "select", options: opt(["2k", "4k"]), defaultValue: "2k" },
];

// 按变体收窄 resolution_type（通用 paramOverrides，按 modeId 索引；两模式同样收）。
const resParam = (values: string[], def: string): ModelParameterControl => ({ key: "resolution_type", label: "清晰度", type: "select", options: opt(values), defaultValue: def });
const narrowResolutionTo = (values: string[], def: string) => (params: ModelParameterControl[]): ModelParameterControl[] =>
  params.map((p) => (p.key === "resolution_type" ? resParam(values, def) : p));
// 两个模式 id：t2i / i2i。3.0/3.1 只在 t2i 出现（i2i 无这两档）。
const overrides = (values: string[], def: string): Record<string, (p: ModelParameterControl[]) => ModelParameterControl[]> => ({
  t2i: narrowResolutionTo(values, def),
  i2i: narrowResolutionTo(values, def),
});
const RES_1K2K = overrides(["1k", "2k"], "2k"); // 3.0/3.1
const RES_2K4K = overrides(["2k", "4k"], "2k"); // 4.0/4.1/4.5/4.6/4.7/5.0
const RES_PRO = overrides(["1.5k", "2k", "4k"], "2k"); // 5.0Pro（无 1k）

export const DREAMINA_IMAGE_ARCHETYPE: ModelArchetype = {
  id: "dreamina-image",
  family: "dreamina-image",
  label: "即梦图片",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["dreamina-image"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "用即梦接入，纯文字生成图像",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: T2I_PARAMS,
    },
    {
      id: "i2i",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 10 张）+ 提示词改图（需模型 4.0+）",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "input_images" }],
      params: I2I_PARAMS,
    },
  ],
  // 9 个图片模型版本（变体）。默认 5.0。args 的 --model_version 取 {{request.params.model}}。
  // 3.0/3.1 只在 text2image 有效（image2image 官方 -h 从 4.0 起）——i2i 模式选到 3.0/3.1 时由 resolution 收窄 + 后端拒绝兜底；
  // 主流程默认 5.0（两模式皆有效），不影响正常路径。
  variants: [
    { id: "v5_0pro", label: "5.0 Pro", modelKey: "5.0Pro", paramOverrides: RES_PRO },
    { id: "v5_0", label: "5.0", modelKey: "5.0", paramOverrides: RES_2K4K },
    { id: "v4_7", label: "4.7", modelKey: "4.7", paramOverrides: RES_2K4K },
    { id: "v4_6", label: "4.6", modelKey: "4.6", paramOverrides: RES_2K4K },
    { id: "v4_5", label: "4.5", modelKey: "4.5", paramOverrides: RES_2K4K },
    { id: "v4_1", label: "4.1", modelKey: "4.1", paramOverrides: RES_2K4K },
    { id: "v4_0", label: "4.0", modelKey: "4.0", paramOverrides: RES_2K4K },
    { id: "v3_1", label: "3.1", modelKey: "3.1", paramOverrides: RES_1K2K },
    { id: "v3_0", label: "3.0", modelKey: "3.0", paramOverrides: RES_1K2K },
  ],
  defaultVariantId: "v5_0",
};
