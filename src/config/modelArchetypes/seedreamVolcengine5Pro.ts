import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// ---------------------------------------------------------------------------
// 火山方舟 Seedream 5.0 **pro** 图像档案（`doubao-seedream-5-0-pro-260628`）。
// 契约来自官方文档实查（2026-08-26，docs.volcengine.com doc 1541523「图片生成 API」页脚更新
// 2026.08.12 + doc 2582774「Seedream 5.0 pro 教程」+ doc 1330310 模型列表），非记忆。
//
// **为什么必须与 volcengine-seedream（5.0 lite / 4.5 / 4.0）分档而不是加一个变体**——参数域是反的：
//   - pro 的总像素域 [921600, 4624220]；lite / 4.5 是 [3686400, 16777216]。
//     即 lite 的**下限**(368万) 已接近 pro 的**上限**(462万)，两者只有很窄一段重叠，
//     同一份 size 清单不可能同时对；把 4K 档给了 pro 就是必 400（InvalidParameter）。
//   - pro **不支持** sequential_image_generation（组图）与 stream；lite / 4.5 / 4.0 支持。
//   - pro **独有** background:transparent（透明底）与 layer_decomposition（图层拆分）。
// 这与 seedream5Pro.ts（apimart 渠道那份）分档同理，只是那份的 size 是比例串、这份是像素串
// ——不同 vendor 不同契约，各自独立档案（既有 vendor-scoped 惯例）。
//
// ⚠️ identifierPatterns 是**严格相等**匹配（archetypeIdentity.identifierMatchesPattern），不是前缀。
// 必须写完整 key。（现存 seedream5Pro.ts 的 "doubao-seedream-5-0-pro" 前缀形就命中不了真实 key
// `doubao-seedream-5-0-pro-260628`，是同一族坑。）
// ---------------------------------------------------------------------------

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

// 像素串（而非 1K/1.5K/2K 档位串）：档位串拿不到比例控制，而比例对做视频的人是刚需
// （竖屏 9:16 / 横屏 16:9 是分镜的基本盘）。下面每档都逐一验过落在 [921600, 4624220] 内：
//   2048x2048=4194304 · 2304x1728=3981312 · 1728x2304=3981312 · 2048x1152=2359296 · 1152x2048=2359296
// 比例也都在官方 [1/16, 16] 内。**改这里必须重算像素数**——超上限就是 400，本地看不出来。
const SIZE_PARAM: ModelParameterControl = {
  key: "size",
  label: "尺寸",
  type: "select",
  options: opt(["2048x2048", "2304x1728", "1728x2304", "2048x1152", "1152x2048"]),
  defaultValue: "2048x2048",
};

// 透明底是 pro 独有（官方 background: transparent | opaque，默认 opaque）。
// 做合成/贴纸/UI 素材时省一道抠图，是真实差异化能力，故给控件。
const BACKGROUND_PARAM: ModelParameterControl = {
  key: "background",
  label: "背景",
  type: "select",
  options: [
    { value: "opaque", label: "不透明" },
    { value: "transparent", label: "透明底" },
  ],
  defaultValue: "opaque",
};

const PARAMS: ModelParameterControl[] = [SIZE_PARAM, BACKGROUND_PARAM];

export const SEEDREAM_VOLCENGINE_5_PRO_ARCHETYPE: ModelArchetype = {
  id: "volcengine-seedream-5-pro",
  family: "seedream",
  label: "Seedream 5.0 Pro",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  identifierPatterns: ["doubao-seedream-5-0-pro-260628"],
  sources: [
    {
      url: "https://docs.volcengine.com/docs/82379/1541523",
      checkedAt: "2026-08-26",
      vendorKey: "volcengine",
      covers:
        "POST /api/v3/images/generations（同步，data[0].url）；image 字段 string|string[] 参考图上限 10；size 总像素域 [921600, 4624220]；background transparent|opaque 为 pro 独有；不支持 sequential_image_generation 与 stream；watermark 默认 true 故显式发 false",
    },
    {
      url: "https://docs.volcengine.com/docs/82379/2582774",
      checkedAt: "2026-08-26",
      vendorKey: "volcengine",
      covers: "Seedream 5.0 pro 教程：模型 id doubao-seedream-5-0-pro-260628；size 档位 1K/1.5K/2K 默认 2K；交互编辑与图层拆分为 pro 独有（本轮未接）",
    },
  ],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "火山 Seedream 5.0 Pro 文生图",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: PARAMS,
    },
    {
      // 改图 / 多图融合：与文生图同端点，多一个 image 字段（官方字段名就是 `image`，
      // 类型 string | string[]）。pro 的参考图上限是 **10** 张（lite / 4.5 / 4.0 是 14）。
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 10 张）+ 提示词改图 / 多图融合",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 10, inputKey: "image_urls" }],
      params: PARAMS,
    },
  ],
};
