# Wan 3.0 视频接入（kie.ai + APIMart）

日期：2026-08-27 ｜ 分支：`claude/wan30-integration`

## 范围

Wan 3.0 全网只有三个入口，全部接：

| 供应商 | model id | 文档（R5 实抓） |
|---|---|---|
| kie | `wan/3-0-video` | https://docs.kie.ai/market/wan/3-0-video.md |
| kie | `wan/3-0-video-prime` | https://docs.kie.ai/market/wan/3-0-video-prime.md |
| apimart | `wan3.0-video` | https://docs.apimart.ai/cn(en)/api-reference/videos/wan3.0-video/generation |

**不动 Wan 2.x**（`wan-2.7` 档案原样保留）。Wan 3.0 无图像模型、无其他 3.0 派生。

## 架构决策

**两个供应商各自成档**，沿用本仓既有先例（`seedance-2` vs `seedance-2-apimart`）：

- `wan-3.0`（kie）——`wan/3-0-video` 与 `wan/3-0-video-prime` **契约逐字段相同**（已逐项对账，
  差异只有 model id 与「高速」定位），故 **1 条 catalog 行 + 2 个 variants**（`standard` / `prime`），
  照 `volcengine-seedance-2` 的 standard/fast/mini 写法。**不用 per-mode `modelEnum`**——
  modelEnum 是「同一档案不同模式发不同 model」，而这里是「同一模式用户选快慢」，语义是 variant。
- `wan-3.0-apimart`（apimart）——单 model id `wan3.0-video`，模式靠 `generation_type` 区分。

**四模式（两侧一致）**，互斥关系直接长成模式划分（同 Seedance 的做法）：

| 模式 | 槽 | 说明 |
|---|---|---|
| `t2v` 文生视频 | 无 | 纯 prompt |
| `first` 首帧 | first_frame ×1 | |
| `firstlast` 首尾帧 | first_frame ×1 + last_frame ×1 | |
| `ref` 全能参考 | image_ref ×10 + video_ref ×5 + audio_ref ×5 | |

官方硬互斥：`first/last_frame_url` **不能**与 `reference_*_urls` 同时出现。模式划分即保证。

## 契约事实（逐项对账，非记忆）

两侧共有标量：`resolution` 480P/720P/1080P 默认 **1080P**；比例 adaptive/16:9/4:3/1:1/3:4/9:16
默认 **adaptive**；`duration` 整数 2–30 或 -1（模型自定），默认 **5**；`audio` 布尔默认 **true**；
`seed` [0, 2147483647] 可选。参考上限 **10 图 / 5 视频 / 5 音频**。

**kie**：`POST /api/v1/jobs/createTask`，一切嵌在 `input` 下。`first_frame_url` / `last_frame_url`
是**裸字符串 URL**（文档 schema 标 object 是生成产物，正文示例是字符串）→ 槽 `asArray:false`。
结果 `data.resultJson` 是 JSON **字符串**，`resultUrls[0]` 取片——沿用既有 kie job 轮询
（`/api/v1/jobs/recordInfo` + `data.resultJson.resultUrls.0`），不另造机制。`nsfw_checker` 默认 false。

**apimart**：`POST /v1/videos/generations`，**扁平 body**。比例字段是 **`size`**（不是 `aspect_ratio`，
与 Wan 2.7 apimart 同）。首/尾帧走 `image_with_roles [{url, role}]`，role 取 `first_frame` / `last_frame`；
参考族走 `image_urls` + `video_urls` + `audio_urls`。`generation_type` 取 `frame` / `reference`，
由 **per-mode `fixedParams`** 钉死——因为 `image_urls` 在两族之间是重载的，只有这个字段能区分。
另有 `watermark` 默认 false。

## 与任务书的两处文档纠正

1. apimart 的比例字段是 **`size`**，不是 `aspect_ratio`（文档全部示例用 `size`，
   `aspect_ratio` 仅作别名提及）。按文档取 `size`。
2. apimart 的内容审核字段是 **`nsfw_check`**，kie 那侧才叫 `nsfw_checker`。两侧都不声明该控件
   （默认关，属安全开关不该给创作者当参数拨）。

## 已知缺口（诚实标注，D4）

- **`reference_file_urls`（文档参考，kie 最多 1 个）不接**：本仓参考槽只有
  first_frame/last_frame/image_ref/video_ref/audio_ref/source_video，没有「文档资产」这一类，
  硬造一个新 slot kind 会牵动整条资产管线。留作后续。
- **`reference_link_urls`（网页参考）不接**——实测证据如下。

### `reference_link_urls` 为什么砍掉（实测，不是猜）

它要求 wire 上是数组。模板层想发数组只能写成 `["{{request.params.link}}"]`。
我在 `electron/ai/requestPipeline.ts` 的 `renderTemplateValue` 上直接跑了探针：

| 参数状态 | 渲染结果 |
|---|---|
| 未设置 | `{"arr":[]}` —— 键仍在，变空数组 |
| 空字符串（用户填了又清空） | `{"arr":[""]}` —— **发出 `[""]`** |
| 有值 | `{"arr":["https://…"]}` |

`renderTemplateValue` 的数组分支只 `flatMap` 掉 `undefined`，空串会原样留在数组里；
而 `taskTemplateParams` 是 `...extras` 原样铺开，用户清空输入框后 `extras` 里就是 `""`。
即「用户填过再清空」必然把 `[""]` 发给供应商。任务书的判据是「做不到空安全就不做」——
做不到，故不做。（要做需在模板层加「空数组/空串整键丢弃」的通用能力，那是另一个根因级改动。）

## 不动项

Wan 2.x 全系、其他档案、模板引擎本身、资产管线。

## 验收门

- `pnpm run gen:archetype-defaults` 重生成产物
- 契约锁测试：真实数字（10/5/5、duration 2–30、枚举与默认值），每条注释标出处文档
- kie 两变体 → 正确 model id 的断言
- `pnpm run gates` 全绿，无基线抬高、无 allowlist 新增

## 回滚

单分支纯新增（档案 + catalog 行 + 测试），删除新增文件并还原 4 处注册点即可。
