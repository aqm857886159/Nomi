import type { ModelParameterControl } from "../modelCatalogMeta";
import type { ModelArchetype } from "./types";

// 火山方舟 Seedream 5.0 图像档案。真实 API 验证（2026-06-19，用户 key，doubao-seedream-5-0-260128 出图）：
// **同步**出图（data[0].url，无轮询），size 必须像素 WxH 且像素数 ≥ ~370 万
// （实测 1024x1024 → HTTP 400「image size must be at least N pixels」；2048x2048 / 2304x1728 / 2560x1440 → 200）。
// 与 apimart/kie 的 seedream 档案（比例串 size）是不同 vendor 不同契约，故独立档案（P4）。

const opt = (values: string[]): ModelParameterControl["options"] => values.map((value) => ({ value, label: value }));

// 官方总像素域（doc 1541523，2026-08-26 实查）：5.0 lite / 4.5 = [3686400, 16777216]，
// 4.0 = [921600, 16777216]。本档案三个模型共用，故清单取**交集** [3686400, 16777216]。
// 逐档验过（改这里必须重算，超界就是 400 InvalidParameter，本地看不出来）：
//   2K 档 1:1 2048x2048=4194304 · 4:3 2304x1728=3981312 · 3:4 同 · 16:9 2560x1440=3686400（正好压下限）· 9:16 同
//   4K 档 1:1 4096x4096=16777216（正好压上限）· 16:9 3840x2160=8294400 · 9:16 同 · 4:3 3584x2688=9633792 · 3:4 同
// 用像素串而非 2K/4K 档位串：档位串拿不到比例控制，而比例是分镜刚需（竖屏 9:16 / 横屏 16:9）。
const SIZE_PARAM: ModelParameterControl = {
  key: "size",
  label: "尺寸",
  type: "select",
  options: opt([
    "2048x2048", "2304x1728", "1728x2304", "2560x1440", "1440x2560",
    "4096x4096", "3840x2160", "2160x3840", "3584x2688", "2688x3584",
  ]),
  defaultValue: "2048x2048",
};

export const SEEDREAM_VOLCENGINE_ARCHETYPE: ModelArchetype = {
  id: "volcengine-seedream",
  family: "seedream",
  label: "Seedream 5.0",
  kind: "image",
  defaultModeId: "t2i",
  transportTaskKind: "text_to_image",
  // 显式 archetypeId 优先（seed 模型已带），patterns 仅给用户自接火山同名模型兜底。
  // ⚠️ 匹配是**严格相等**（archetypeIdentity.identifierMatchesPattern），不是前缀——早先这里只写了
  // "doubao-seedream-5"/"-4" 两个前缀形，于是真实 key doubao-seedream-5-0-260128 一个都匹配不到：
  // 经中转接入的 Seedream 完全认不出是 Seedream（没有正确尺寸/改图模式/原生报文）。故列**完整 key**，
  // 与 Seedance 档案同做法。新增变体要在这里补一行（seededModelIdentity.test 会红）。
  identifierPatterns: [
    "doubao-seedream-5-0-260128",
    "doubao-seedream-4-5-251128",
    "doubao-seedream-4-0-250828",
  ],
  sources: [
    {
      url: "https://docs.volcengine.com/docs/82379/1541523",
      checkedAt: "2026-08-26",
      vendorKey: "volcengine",
      covers:
        "POST /api/v3/images/generations（同步，data[0].url）；改图字段名是 image（string|string[]），参考图上限 14（5.0 lite/4.5/4.0）；size 总像素域 5.0 lite 与 4.5 = [3686400,16777216]、4.0 = [921600,16777216]，比例域 [1/16,16]；sequential_image_generation auto|disabled；watermark 默认 true 故显式发 false",
    },
    {
      url: "https://docs.volcengine.com/docs/82379/1330310",
      checkedAt: "2026-08-26",
      vendorKey: "volcengine",
      covers: "在售模型 id：doubao-seedream-5-0-260128（5.0 lite）/ doubao-seedream-4-5-251128 / doubao-seedream-4-0-250828；SeedEdit 3.0 与 Seedream 3.0 已过 EOS 下线，不接",
    },
  ],
  modes: [
    {
      id: "t2i",
      intent: "text",
      vendorTerm: "文生图",
      hint: "火山 Seedream 高清文生图",
      promptRequired: true,
      transportTaskKind: "text_to_image",
      slots: [],
      params: [SIZE_PARAM],
    },
    {
      // 图生图/改图（2026-06-30 补：火山官方统一生成-编辑架构，图传 image 字段数组；
      // 真机验证 doubao-seedream-5-0-260128 + image:[url] → 服务端识别并下载该图，字段契约确认）。
      // 多图融合也走这条（image 数组放多张参考图 → 主体一致重组）。输入图槽 inputKey=image_urls。
      // 参考图上限 **14** 张（官方 doc 1541523，2026-08-26 实查：5.0 lite / 4.5 / 4.0 = 14，
      // 5.0 pro = 10 —— pro 在 seedreamVolcengine5Pro.ts 单独一档，别把两边的上限混了）。
      id: "edit",
      intent: "edit",
      vendorTerm: "改图",
      hint: "给图（最多 14 张）+ 提示词改图 / 多图融合",
      promptRequired: true,
      transportTaskKind: "image_edit",
      slots: [{ kind: "image_ref", label: "输入图", min: 1, max: 14, inputKey: "image_urls" }],
      params: [SIZE_PARAM],
    },
  ],
};
