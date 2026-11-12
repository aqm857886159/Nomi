import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";
import { runwayImageParams } from "../imageCapabilities/runwayImageWireFacts";

// Seedream 5.0 Pro（apimart，字节 Seed 2026-07-08 发布）——照 docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md 对账。
// 与 seedream(4.5) 档案分开建：参数域不同——resolution 仅 1K/1.5K/2K（3K/4K 会 400；1.5K 与 1K 同价、画质更好，文档 2026-11-12 页面新增）、size 8 档 + auto
// （无 9:21）。≤10 张参考图多参一图（首张参考免费计费）；单图输出（n>1 不支持）。
// 改图与文生图同端点（image_urls 有无决定），标量同形 → 两模式共用 PARAMS。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

const PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "auto"]), defaultValue: "1:1" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "1.5K", "2K"]), defaultValue: "2K" },
];

// APIMart 通道的整页对齐（2026-11-12，能力表见 docs/models/capabilities/seedream-5-pro-apimart.md）：
// 比例多 2:1 / 1:2 两档；输出格式 jpeg(默认)|png；水印开关；背景 opaque(默认)|transparent 只在改图方式（官方：透明背景只支持
// 「恰好一张、自带 alpha 通道的输入图」的改图，且必须 png）。透明 → 格式只剩 png 用 optionConstraints 声明。
// 只放 vendorParams.apimart：fal 的映射没有这些字段（共享的基础 PARAMS 不能被它们牵连）。
const APIMART_SIZE: ModelParameterControl = { key: "size", label: "比例", type: "select", options: opt(["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "21:9", "2:1", "1:2", "auto"]), defaultValue: "1:1" };
const APIMART_OUTPUT_FORMAT: ModelParameterControl = {
  key: "output_format", label: "输出格式", type: "select", options: opt(["jpeg", "png"]), defaultValue: "jpeg",
  optionConstraints: [{ when: { key: "background", value: "transparent" }, values: ["png"] }],
};
const APIMART_WATERMARK: ModelParameterControl = { key: "watermark", label: "添加水印", type: "boolean", options: [], defaultValue: false };
const APIMART_BACKGROUND: ModelParameterControl = { key: "background", label: "背景", type: "select", options: opt(["opaque", "transparent"]), defaultValue: "opaque" };
const APIMART_NSFW_CHECK: ModelParameterControl = { key: "nsfw_check", label: "提交前内容审核", type: "boolean", options: [], defaultValue: false };
const APIMART_T2I_PARAMS: ModelParameterControl[] = [APIMART_SIZE, PARAMS[1]!, APIMART_OUTPUT_FORMAT, APIMART_WATERMARK, APIMART_NSFW_CHECK];
const APIMART_EDIT_PARAMS: ModelParameterControl[] = [APIMART_SIZE, PARAMS[1]!, APIMART_BACKGROUND, APIMART_OUTPUT_FORMAT, APIMART_WATERMARK, APIMART_NSFW_CHECK];

// Runway 专属参数（B 分层 vendorParams）：Runway 的 seedream5_pro 变体收的是**像素串** ratio
// （1024:1024 / 2304:1728 / auto_1k / auto_2k…共 16 值，字段名 `ratio` 由 aspect_ratio 键喂），
// 而非 apimart 的朝向式 `size`；也没有独立的 resolution 字段（分辨率含在 ratio 里），但有 outputCount（1–4）。
// 取值由官方 OpenAPI 逐字表 derive，UI 给得出的就是发得出去的。
const RUNWAY_PARAMS: ModelParameterControl[] = runwayImageParams("seedream5_pro");

export const SEEDREAM_5_PRO_ARCHETYPE: ModelArchetype = {
  id: "seedream-5-pro",
  family: "seedream",
  label: "Seedream 5.0 Pro",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  sources: [{
    url: "https://docs.apimart.ai/en/api-reference/images/seedream-5-0-pro/generation.md", checkedAt: "2026-11-12", vendorKey: "apimart",
    covers:
      "POST /v1/images/generations，model `seedream-5-0-pro`；resolution 1K(文档默认)|1.5K|2K，3K/4K 返回 400；" +
      "size 为比例 / 档位关键词 / 精确像素；image_urls 最多 10 张；n>1 不支持。档案默认 2K（不变）。" +
      "output_format jpeg(默认)|png；watermark；background opaque(默认)|transparent（仅改图、需自带 alpha 的单张输入、必须 png）。" +
      "nsfw_check 布尔（默认关，提交前审核提示词与输入图）。替创作者定：optimize_prompt_options 只有 standard 一档。待定：layer_decomposition（结果是底图 + 多张透明图层，不是单图）、精确像素 size。",
  }],
  // `seedream5_pro` 是 Runway 侧的判别串（同一个产品的第二家接入，P4：档案 = 模型身份，供应商无关）。
  identifierPatterns: ["doubao-seedream-5-0-pro", "seedream-5-0-pro", "seedream-5.0-pro", "seedream5_pro"],
  // Runway 的这一行原挂平台档案 runway-image（已删）；存量节点靠 legacyIds + 模型身份匹配迁到这里。
  legacyIds: ["runway-image"],
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
      vendorParams: { runway: RUNWAY_PARAMS, apimart: APIMART_T2I_PARAMS },
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
      vendorParams: { runway: RUNWAY_PARAMS, apimart: APIMART_EDIT_PARAMS },
    },
  ],
};
