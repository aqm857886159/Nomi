import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";
import { LAYER_COUNT_KEY, LAYER_SIZE_KEY, LAYER_SPLIT_MODE_ID, LAYER_SPLIT_WIRE_KEY, TEXT_RECOGNITION_KEY } from "./layerSplit";

// Seedream 5.5（APIMart 官方页 docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md，2026-11-12 核）。
// 单 model id `seedream-5-5`；文生图与改图同端点（image_urls 有无决定），≤10 张参考图，单图输出（n 必须为 1）。
//   · 比例 + 清晰度：size 写比例（1:1 4:3 3:4 16:9 9:16 3:2 2:3 21:9 2:1 1:2），resolution 1K / 1.5K / 2K（默认 2K；3K / 4K 返回 400）。
//     档案不暴露 `auto`：官方「size: auto 等于 2K」，与单独选的 resolution 会打架，不渲染说不清的选项；也不暴露精确像素。
//   · background auto(默认)|transparent|opaque；output_format png(默认)|jpeg，官方写明「transparent 必须 PNG，不能配 jpeg」
//     → 用 optionConstraints 声明：背景选透明时格式只剩 png（文档没写的联动不猜）。
//   · watermark 布尔开关（默认 false）。
// nsfw_check 布尔（默认关，提交前审核提示词与输入图）。替创作者定：optimize_prompt_options 不发（只有 standard 一档，关不掉）、n 恒为 1（文档：必须为 1）。
// 图层分离（2026-11-26 核）：layer_decomposition:true + 恰好 1 张 image_urls、不能带 background；size 只收档位 1K / 1.5K / 2K / auto（默认 auto，
// 比例会 400）；layer_decomposition_options { max_images 2–100 默认 30（含底图，是上限），text_recognition 布尔默认关 }；提示词可空。
// 结果是底图 + 透明图层（按 layers[i].z_index 叠、bounding_box 摆），落成画板里的一组层（设计卡 docs/plan/2026-11-26-layer-split.md）。
// 待定：size auto（文生 / 改图里官方等于 2K，与单独选的清晰度打架）、精确像素。能力表：docs/models/capabilities/seedream-5-5.md。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "2:1", "1:2"]), defaultValue: "1:1" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "1.5K", "2K"]), defaultValue: "2K" },
  { key: "background", label: "背景", type: "select", options: [{ value: "auto", label: "auto" }, { value: "transparent", label: "透明底" }, { value: "opaque", label: "不透明" }], defaultValue: "auto" },
  {
    key: "output_format", label: "格式", type: "select", options: opt(["png", "jpeg"]), defaultValue: "png",
    optionConstraints: [{ when: { key: "background", value: "transparent" }, values: ["png"] }],
  },
  { key: "watermark", label: "添加水印", type: "boolean", options: [], defaultValue: false },
  { key: "nsfw_check", label: "提交前内容审核", type: "boolean", options: [], defaultValue: false },
];

// 图层分离的三个控件（键和普通改图的比例 size 分开：清晰度档存 layer_size，由线缆 paramMap 写成 wire 的 size）。
const LAYER_PARAMS: ModelParameterControl[] = [
  { key: LAYER_COUNT_KEY, label: "拆成几层", type: "number", options: [], defaultValue: 30, min: 2, max: 100, step: 1 },
  { key: LAYER_SIZE_KEY, label: "清晰度", type: "select", options: [{ value: "auto", label: "自动" }, ...opt(["1K", "1.5K", "2K"])], defaultValue: "auto" },
  { key: TEXT_RECOGNITION_KEY, label: "识别文字", type: "boolean", options: [], defaultValue: false },
];

export const SEEDREAM_55_ARCHETYPE: ModelArchetype = {
  id: "seedream-5-5",
  family: "seedream",
  label: "Seedream 5.5",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["seedream-5-5", "seedream-5.5", "doubao-seedream-5-5", "doubao-seedream-5.5"],
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md", checkedAt: "2026-11-12", vendorKey: "apimart",
    covers:
      "POST /v1/images/generations，model `seedream-5-5`；image_urls 最多 10 张；size 比例 10 档(1:1 4:3 3:4 16:9 9:16 3:2 2:3 21:9 2:1 1:2)；" +
      "resolution 1K|1.5K|2K(图像生成默认 2K，3K/4K 返回 400)；background auto(默认)|transparent|opaque；output_format png(默认)|jpeg，" +
      "transparent 必须 png；watermark 布尔；n 必须为 1。不声明：size auto、精确像素。",
  }, {
    url: "https://docs.apimart.ai/en/api-reference/images/seedream-5-5/generation.md", checkedAt: "2026-11-26", vendorKey: "apimart",
    covers:
      "图层分离：layer_decomposition:true，恰好 1 张 image_urls，不能带 background；size 档位 1K|1.5K|2K|auto(默认 auto，比例返回 400)；" +
      "layer_decomposition_options.max_images 2–100(默认 30，含底图，是上限)、text_recognition 布尔(默认关)；prompt 可空；" +
      "结果 data.result.images[0].url[]（0 = 底图）与 layers[] 平行：z_index(底图 0、升序叠)、name、bounding_box.absolute [l,t,r,b] 底图像素、text_recognition.text；" +
      "按层数上限 × 档位单价 + 一次输入图预扣，按实际层数结算，失败退回。",
  }],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: PARAMS,
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 10 张）+ 提示词改图",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "image_urls" }],
      params: PARAMS,
    },
    {
      id: LAYER_SPLIT_MODE_ID,
      intent: "edit",
      vendorTerm: "图层分离",
      hint: "把一张图拆成底图 + 透明图层",
      promptRequired: false,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "要拆的图", min: 1, max: 1, inputKey: "image_urls" }],
      params: LAYER_PARAMS,
      fixedParams: { [LAYER_SPLIT_WIRE_KEY]: "true" },
      layerSplit: { maxLayers: 100 },
    },
  ],
};
