import type { ModelParameterControl } from "../videoCapabilities/types";
import type { ModelArchetype } from "./types";
import { runwayImageParams } from "../imageCapabilities/runwayImageWireFacts";

// GPT Image 2 档案（图像，2026-06）。kie.ai 文档：docs.kie.ai/market/gpt/gpt-image-2-{text,image}-to-image。
// 两模式：文生图（无参考槽）/ 图生图（输入图数组 → input_urls）。两模式 model enum + taskKind 不同，
// 靠 per-mode modelEnum + transportTaskKind 区分（档案体系图像支持，见 types）。标量参数复用 ModelParameterControl（规则 1）。
// 注：图生图的输入图槽用 image_ref（数组），inputKey 覆盖成模型契约名 `input_urls`（非 Seedance 的 reference_image_urls）；
// 不 characterIndexed（不是 character1..N 角色图，不标 ①②③）。这样它直接吃到通用的参考槽 + 拖入/连线。

// 铁律：中性 canonical 参数（面向用户、全站一致）。kie + apimart 官方 aspect_ratio 都是这 16 档。
// 各站线缆字段名/值格式的差异（apimart 比例叫 size、resolution 要小写、OpenAI 兼容站要像素）由各 codec
// 的 paramMap 翻译（见 paramTranslate.ts），不再在档案里按供应商焊死参数集。
const ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "5:4", "4:5", "16:9", "9:16", "2:1", "1:2", "3:1", "1:3", "21:9", "9:21"];
const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: ASPECT_RATIOS.map((value) => ({ value, label: value })), defaultValue: "auto" },
  // 清晰度档位（kie 契约 1K/2K/4K）。约束（1:1 不可 4K、auto 仅 1K、5:4/4:5 仅 1K）由 vendor 校验透传报错。
  { key: "resolution", label: "清晰度", type: "select", options: ["1K", "2K", "4K"].map((value) => ({ value, label: value })), defaultValue: "1K" },
];

// Runway 专属参数（B 分层 vendorParams）：Runway 的 /v1/text_to_image 是**按模型判别的 union**，
// gpt_image_2 变体的 ratio 是 31 个**像素串**枚举（2048:880 起，`auto` 收尾）——上面那套朝向式
// `1:1`/`16:9` 在 Runway 上**一个都不合法**，且它没有 `resolution` 字段（尺寸已含在 ratio 里），
// 却有 `outputCount`（1–10）。取值不在这里重打：由官方 OpenAPI 逐字表 derive（单一真相源）。
const RUNWAY_PARAMS: ModelParameterControl[] = runwayImageParams("gpt_image_2");

export const GPT_IMAGE_2_ARCHETYPE: ModelArchetype = {
  id: "gpt-image-2",
  family: "gpt-image",
  label: "GPT Image 2",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // 含旧的两个独立 model key → 老节点按身份自动套上档案（无需数据迁移）。
  // `gpt_image_2` 是 Runway 侧的判别串（同一个产品的第三家接入，P4：档案 = 模型身份，供应商无关）。
  identifierPatterns: ["gpt-image-2", "gpt-image-2-text-to-image", "gpt-image-2-image-to-image", "gpt-4o-image", "gpt_image_2"],
  sources: [{
    vendorKey: "apimart", url: "https://docs.apimart.ai/en/api-reference/images/gpt-image-2/generation.md",
    checkedAt: "2026-11-08", covers: "APIMart accepts up to 15 reference images in image_urls.",
  }],
  // Runway 的这一行原挂平台档案 runway-image（已删）；存量节点靠 legacyIds + 模型身份匹配迁到这里。
  legacyIds: ["runway-image"],
  // fal 的改图请求体读 mask_url（局部重绘蒙版图，electron/catalog/falOfficial.ts 的 openai/gpt-image-2/edit），生成框没有蒙版控件：
  // 画布请求里出现它 = 界面看不见的图，渲染层清、主进程拒（referenceKeys）。
  headlessReferenceKeys: ["mask_url"],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像",
      promptRequired: true,
      modelEnum: "gpt-image-2-text-to-image",
      transportTaskKind: "text_to_image",
      slots: [],
      params: PARAMS,
      vendorParams: { runway: RUNWAY_PARAMS },
    },
    {
      id: "i2i",
      intent: "edit",
      vendorTerm: "图生图",
      hint: "给图 + 提示词改图",
      promptRequired: true,
      modelEnum: "gpt-image-2-image-to-image",
      transportTaskKind: "image_edit",
      // KIE 接受 16 张；APIMart 的 image_urls 合计最多 15 张。
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 16, vendorMax: { apimart: 15 }, inputKey: "input_urls" }],
      params: PARAMS,
      vendorParams: { runway: RUNWAY_PARAMS },
    },
  ],
};
