import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// ---------------------------------------------------------------------------
// Nano Banana 2（Google `gemini-3.1-flash-image` 代）图像档案。
// 契约来自官方文档实查（2026-08-26，docs.kie.ai/market/google/nanobanana2.md
// + .../nano-banana-2-lite.md + docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation.md），非记忆。
//
// **为什么与既有 `nano-banana`（Gemini 2.5 flash image）分档而不是加一个变体**——三处硬冲突：
//   1. **参考图上限 10 → 14**。2.5 档案的改图槽 max=10；2.x 代拿不到 14。而「一次喂 14 张参考图」
//      正是这代对我们最有价值的能力（跨镜身份一致性：主角脸 + 服装 + 场景 + 道具同时锁）。
//      槽上限是档案级契约，同档案不能一边 10 一边 14。
//   2. **比例枚举扩了 4 档**（1:4 / 4:1 / 1:8 / 8:1 这类极端条幅），且**默认从 1:1 变成 auto**。
//      同一份 options + defaultValue 不可能同时对两代。
//   3. **多了 resolution（1K/2K/4K）**：2.5 那代 kie 侧无此字段、apimart 侧固定 1K 不暴露。
// 老档案 `nano-banana` 保留不删（2.5 仍在两个 vendor 的现役目录里、文档页仍在线，非退役）——
// 这是**新增一代**，不是替换，P1 的「加新必删旧」不适用（没有旧实现被取代）。
//
// **kie 侧的结构特点：t2i 与 edit 是同一个 model id**（`nano-banana-2`），靠 `image_input` 是否有值切换，
// 与 seedream/nano-banana 那种「两个 model id」不同 → 本档案**不设 per-mode modelEnum**，
// 两个 mode 共用档案 identifier，由 catalog 侧两条 mapping（taskKind 不同、body 差一个字段）承担差异。
// 这正是「按能力建模、不按模型名建模」：mode 表达能力，model id 是 vendor 细节。
//
// ⚠️ kie 的输入图字段名是 **`image_input`**，不是全家桶惯用的 `image_urls`
//    （同页 lite 变体反而叫 `image_urls`——同一 vendor 同一族两个名字，抄错即静默丢参考图）。
//    故 slot inputKey 按 vendor 分：kie 主款 image_input / apimart + lite 走 image_urls。
//    档案只能声明一个 inputKey → 取 `image_urls`（多数派），kie 主款在 catalog body 里做键名转接。
//
// **Lite 为什么另立档案（NANO_BANANA_2_LITE_ARCHETYPE）而不是共用这份**——2026-08-26 被
// paramConsistency 不变量当场抓出来的设计错：lite 的文档里**根本没有 resolution / output_format 字段**，
// 也没有 14 张的槽（是 10 张）。共用这份档案的后果不是报错，是 **UI 上摆着两个按了没反应的控件**
// （用户调了清晰度、发出去的 body 里压根没这个键）——「静默无效控件」比报错更坏，用户会以为模型不听话。
// 档案 = 能力声明，声明了就必须发得出去；发不出去的能力不许声明。
// ---------------------------------------------------------------------------

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

// kie `nanobanana2.md` 的 aspect_ratio 全枚举（15 档，默认 auto）。apimart 的 size 枚举是同一组
// （auto/1:1/3:2/2:3/4:3/3:4/16:9/9:16/5:4/4:5/21:9/1:4/4:1/1:8/8:1）——两边完全一致，故共用一份。
const ASPECT_RATIO_VALUES = ["auto", "1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1"];

// kie: resolution 1K(默认)/2K/4K。apimart 多一档 0.5K，但 0.5K 对分镜没用（比预览还小）
// 且两边取交集才能让同一档案在两个 vendor 都发得出去 → 只暴露 1K/2K/4K。
const PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(ASPECT_RATIO_VALUES), defaultValue: "auto" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K", "4K"]), defaultValue: "1K" },
  { key: "output_format", label: "格式", type: "select", options: opt(["png", "jpg"]), defaultValue: "png" },
];

// apimart 专属 params（B 分层，同 nanoBanana.ts 惯例）：apimart 字段名是 `size` 不是 `aspect_ratio`，
// 且无 output_format（响应格式由平台定）。resolution 同名同域故保留。
const APIMART_PARAMS: ModelParameterControl[] = [
  { key: "size", label: "比例", type: "select", options: opt(ASPECT_RATIO_VALUES), defaultValue: "auto" },
  { key: "resolution", label: "清晰度", type: "select", options: opt(["1K", "2K", "4K"]), defaultValue: "1K" },
];

export const NANO_BANANA_2_ARCHETYPE: ModelArchetype = {
  id: "nano-banana-2",
  family: "nano-banana",
  label: "Nano Banana 2",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // 严格相等匹配（archetypeIdentity.identifierMatchesPattern），必须写完整 key，不能靠前缀。
  // `nano-banana-2-lite` **不在这里**（它有自己的档案，见文件末尾）。
  identifierPatterns: [
    "nano-banana-2",
    "gemini-3.1-flash-image",
    "gemini-3.1-flash-image-preview",
    "gemini-3.1-flash-image-preview-official",
  ],
  sources: [
    {
      url: "https://docs.kie.ai/market/google/nanobanana2.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "POST /api/v1/jobs/createTask，model=\"nano-banana-2\"（t2i 与改图**同一个 id**，靠 image_input 是否有值切换，非两个 id）；input.image_input 为 URI 数组，**上限 14 张**（JPEG/PNG/WebP，单张 ≤30MB）；prompt ≤20000 字符；aspect_ratio 15 档 auto|1:1|2:3|3:2|1:4|4:1|3:4|4:3|4:5|5:4|1:8|8:1|9:16|16:9|21:9，**默认 auto**；resolution 1K(默认)|2K|4K；output_format jpg(默认)|png——本档案默认改 png（无损，供后续合成）；结果路径同 kie 全家桶 data.resultJson.resultUrls.0",
    },
    {
      url: "https://docs.kie.ai/market/google/nano-banana-2-lite.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "model=\"nano-banana-2-lite\"；输入图字段名是 **image_urls**（与主款的 image_input 不同名，同族两个名字），**上限 10 张**（非主款的 14）；aspect_ratio 同主款 15 档默认 auto；prompt ≤20000；**无 resolution / output_format 字段**",
    },
    {
      url: "https://docs.apimart.ai/en/api-reference/images/gemini-3.1-flash/generation.md",
      checkedAt: "2026-08-26",
      vendorKey: "apimart",
      covers:
        "POST /v1/images/generations（扁平 body）；model 取 \"gemini-3.1-flash-image-preview\"（别名 nano-banana-2-ext）或 \"gemini-3.1-flash-image-preview-official\"（别名 nano-banana-2）；size 枚举与 kie 的 aspect_ratio 同 15 档、默认 auto；resolution 0.5K|1K(默认)|2K|4K——本档案不暴露 0.5K（低于预览价值且 kie 无此档，取两 vendor 交集）；image_urls **上限 14 张**（URL 或 base64 DataURI，单张 ≤10MB）触发改图；n 默认 1；响应 data[0].task_id 异步轮询",
    },
  ],
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
      vendorParams: { apimart: APIMART_PARAMS },
    },
    {
      // 参考图上限 14 = 全市场最多，本代对 Nomi 的核心价值：一次把主角脸 / 服装 / 场景 / 道具
      // 全喂进去锁跨镜身份，不用分多轮拼。lite 变体上限是 10（catalog 行侧不发超过 10 张即可，
      // 档案取主款上限；超发由 vendor 报错而非静默截断——宁可报错也不悄悄丢参考图）。
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 14 张）+ 提示词改图，跨镜身份一致性最强",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 14, inputKey: "image_urls" }],
      params: PARAMS,
      vendorParams: { apimart: APIMART_PARAMS },
    },
  ],
};

// ---------------------------------------------------------------------------
// Nano Banana 2 **Lite**：同代快档，但契约是主款的真子集，**只有 aspect_ratio 一个标量**。
// 单独一档的理由见上文件头：共用主款档案会在 UI 上摆出「按了没反应」的清晰度/格式控件
// （lite 的 body 里根本没有这两个键）。声明即承诺发得出去。
// ---------------------------------------------------------------------------

const LITE_PARAMS: ModelParameterControl[] = [
  { key: "aspect_ratio", label: "比例", type: "select", options: opt(ASPECT_RATIO_VALUES), defaultValue: "auto" },
];

export const NANO_BANANA_2_LITE_ARCHETYPE: ModelArchetype = {
  id: "nano-banana-2-lite",
  family: "nano-banana",
  label: "Nano Banana 2 Lite",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["nano-banana-2-lite"],
  sources: [
    {
      url: "https://docs.kie.ai/market/google/nano-banana-2-lite.md",
      checkedAt: "2026-08-26",
      vendorKey: "kie",
      covers:
        "POST /api/v1/jobs/createTask，model=\"nano-banana-2-lite\"；input {prompt ≤20000 字符, aspect_ratio 15 档 auto(默认)|1:1|1:4|1:8|2:3|3:2|3:4|4:1|4:3|4:5|5:4|8:1|9:16|16:9|21:9, image_urls 默认 [] **上限 10 张**（主款是 14 且字段名叫 image_input——同族两个名字）}；**无 resolution / output_format 字段**（故本档案只声明 aspect_ratio 一个标量）",
    },
  ],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "纯文字生成图像，快档",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: LITE_PARAMS,
    },
    {
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 10 张）+ 提示词改图",
      promptRequired: true,
      transportTaskKind: "image_edit",
      // 上限 10（主款是 14）——文档实证，别照主款抄。
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "image_urls" }],
      params: LITE_PARAMS,
    },
  ],
};
