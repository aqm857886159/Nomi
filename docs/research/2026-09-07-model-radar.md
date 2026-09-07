# 2026-09-07 供应商模型雷达 · 分诊 + 接入方案

雷达轮次（`pnpm run radar:models`，2026-09-07 本地实跑，结果落 `docs/research/model-radar/latest.json`）：

| 供应商车道 | 盯住 | 新增 | 下架 | 未接入 | 备注 |
|---|---|---|---|---|---|
| kie（文档车道） | 142 | 0 | 0 | 76（image 17 · video 54 · audio 5） | 索引无变化 |
| apimart（文档车道） | 129 | **1** | 0 | 90（image 27 · video 18 · audio 45） | 🆕 `[video] gemini-omni-1.1-flash` |
| **apimart-llm（LLM 车道）** | — | — | — | — | ⚠️ **今天没查成**（原文见下），**不是「没有新模型」** |

`apimart-llm` 车道的错误原文（逐字）：

> 拿不到 apimart 凭据：本机记录是 safeStorage 密文（要 Electron 才解得开）。给这条车道设 APIMART_API_KEY 环境变量后重跑。

按铁律 1，这条车道今天**没有结论**——它的快照未动，修好后必须重跑，不得写成「apimart 的 chat 模型没变化」。修法设计见文末「四、雷达修复」。

**本轮一句话结论**：新增的这一条**不是新模型**——`gemini-omni-1.1-flash` 就是我们 2026-08-30 已建档的 `GEMINI_OMNI_11_ARCHETYPE`（Gemini Omni 1.1 Flash），今天多出来的是 **apimart 这条新渠道**。而且这条渠道的线缆与已在跑的 kie 渠道**不同构、且能力更窄**（丢 `duration`、丢 `seed`）。所以判 🟡 **观望**：现在照搬一条 apimart 复制车道是负收益；真正值得要的是它独有的 **`extend` / `edit`（10 秒续接、最长 40 秒）**，而那被我们自己的 `PROFILE_KINDS` 枚举挡着（无 `video_to_video`），属架构件不属接模型。

---

## 一、逐条分诊

### 🟡 apimart · `gemini-omni-1.1-flash` · video — 已有档案的**新渠道**，本轮不接

- **文档页**（2026-09-07 实抓）：<https://docs.apimart.ai/en/api-reference/videos/gemini-omni-1.1-flash/generation.md>
- **一手出处**（2026-09-07 实抓，铁律 5 交叉核对）：<https://ai.google.dev/gemini-api/docs/omni>；价格与「续接到 40 秒」另见 the-decoder 报道 <https://the-decoder.com/googles-gemini-omni-1-1-flash-makes-ai-video-generation-cheaper-and-more-flexible/>
- **是什么**：Google Gemini Omni 1.1 Flash 视频生成，经 apimart 转售。文生 / 图生 / 参考生 / **编辑** / **续接** 五种 task，带生成音频。

#### 实抓到的能力面（apimart 中转页，2026-09-07）

| 项 | apimart 页写的 |
|---|---|
| 端点 | `POST https://api.apimart.ai/v1/videos/generations` |
| 鉴权 | `Authorization: Bearer <token>` |
| 同步/异步 | **异步**：返回 `task_id` → 轮询 `GET https://api.apimart.ai/v1/tasks/{task_id}`（建议 5–10s 一次、10 分钟超时） |
| 取片 | `result.videos[].url`（带过期时间）；响应另带 `status` / `progress` / `cost` / `credits_cost` |
| 必填 | `model=gemini-omni-1.1-flash`；`prompt` 与媒体（`image_urls` / 首尾帧 / `video_urls`）**至少给一样** |
| **时长** | **没有 duration 参数**——「typically 3–10 seconds」，由模型按内容自己定 |
| 分辨率 | `360p` / `720p`(默认) / `1080p` / `4k`（`2160p` 归一成 `4k`） |
| 比例 | `16:9`(默认) / `9:16`；其它值一律按 16:9 处理 |
| 参考图 | `image_urls[]`，**与首尾帧合计 ≤10 张** |
| 首尾帧 | `first_frame_image` / `last_frame_image`（尾帧必须伴随首帧，触发插值） |
| 角色化槽 | `image_with_roles[] = {url, role}`，role ∈ `first_frame` / `last_frame` / `reference` |
| 视频输入 | `video_urls[]`，**≤1 条、≤10 秒**；与 `extend_from_task_id` 互斥 |
| 编辑/续接 | `metadata.task` ∈ `text_to_video` / `image_to_video` / `reference_to_video` / **`edit`** / **`extend`**；`extend_from_task_id` 指向上一次生成 |
| 错误码 | 400 参数非法 · 401 鉴权失败 · 402 余额不足 · 429 限流 |
| 价格 | 中转页只说「按分辨率档计价」，具体数字**不在页上**，只在响应里回 `cost` / `credits_cost` |

#### 一手交叉核对（铁律 5：中转页上限 ≠ 模型上限）

| 项 | apimart 中转页 | kie 中转页（我们在跑的） | Google 一手 | 判定 |
|---|---|---|---|---|
| 时长 | 无参数，3–10s 由模型定 | `duration` 4/6/8/10 可选 | 3–10s，24fps | **三方不咬合** → apimart 这条车道**没有时长控制** |
| 续接 | `extend` + `extend_from_task_id`，读上一段 ≤10s | 无 | **10 秒一档、最长 40 秒** | apimart 独有，一手证实 |
| 参考图上限 | ≤10（含首尾帧） | ≤7（另有 7 units 配额制） | 未给硬上限；指南示例用到 6 张 | **三方各说各的 → 待实测** |
| 视频参考 | ≤1 条 ≤10s | `video_list` ≤1（≤10s） | 「最多 3 段、每段 ≤3 秒」作风格参考 | **待实测**，别照抄任一家 |
| 分辨率 | 360p/720p/1080p/4k | 同 | 同（1080p 与 4K 是**放大**得到） | 一致；4K 是 upscale 不是原生渲染 |
| seed | 无 | 有 | 未提 | apimart 车道丢失 |
| 价格 | 页上没有 | 页上没有（回调报 `creditsConsumed`） | **$0.03/$0.10/$0.15/$0.30 每秒**（360p/720p/1080p/4K） | 一手有价，两家中转都没有 → **中转加价待实测** |

#### 自媒体实测（TikHub · B 站，2026-09-07 检索）

- 「星小脉」《Gemini Omni 1.1 Flash实测：首尾帧、4K放大与视频编辑到底行不行？》（2026-08-31，555 播放）<https://www.bilibili.com/video/BV1m3t46oEoY> —— 视频自带的分段目录直接把结论写在标题上：`04:16 文字清晰度问题`、`05:09 首尾帧测试` → `05:47 测试效果不佳`、`06:27 变形与场景转换`、`07:03 动作感不足`、`09:05 字幕生成错误`。**即：4K 放大和编辑能打，首尾帧、动作幅度、画面内文字是弱项。**
- 「ai动有动静」《Seedance 2.5 正面对决 Gemini Omni 1.1 Flash：谁才是 AI 视频新王？》（2026-09-01）<https://www.bilibili.com/video/BV1AKtu6MEtR> —— 评论区一条实用限制：「gemini不能做打斗，因为系统提示词限制」。对漫剧/动作向内容是硬约束。

> 两条都是**他人主观实测**，不是我们的验收结论；引在这里是为了给「该不该现在接」提供反方证据，不作为契约。

#### 对 Nomi 哪个痛点

- **命中**：长片续接（`extend` 10s→40s）——这是「30 分钟漫剧真实闭环」路线上唯一一条厂商原生的接续能力；以及 4K 出片档。
- **不命中**：跨镜角色身份一致（实测动作感/首尾帧弱）、动作戏（系统提示词禁打斗）、精确时长控制（apimart 车道压根没有 duration）。

#### 覆盖现状（铁律 7，已 grep 复核）

**已有档案，不是缺口。** `electron/shared/videoCapabilities/geminiOmni11.ts:21-30` 的 `GEMINI_OMNI_11_ARCHETYPE`（`id: "gemini-omni-1.1"`，`family: "gemini-omni"`）已覆盖 t2v / firstlast / reference(≤7) 三模式，注册在 `electron/shared/videoCapabilities/registry.ts:73`、导出在 `index.ts:10`，传输侧走 kie（`electron/catalog/kieGeminiOmni11.ts:9-65`）并另带一条 runway 转售车道（`geminiOmni11.ts:16-19` 的 `RUNWAY_PARAMS`）。

雷达为什么还是报「新增」：`identifierPatterns` 里的是 kie 的 `gemini-omni-flash-1-1`，apimart 的 slug 是 `gemini-omni-1.1-flash`——归一后 `geminiomniflash11` vs `geminiomni11flash`，**词序不同，`isCovered` 的三级判据（全等 / 末段全等 / ≥8 字双向包含）全不命中**（`scripts/model-radar.ts:351-364`）。这正是铁律 7 说的「按签名搜、别按原串搜」；报告里必须写清它是渠道新增而非模型新增，否则下轮会被读成缺口。

顺带确认**不要混档**：apimart 另有一个 `Omni-Flash-Ext`（`electron/shared/videoCapabilities/omniFlashExt.ts:26-45`，apimart 独占，`size` 而非 `aspect_ratio`，参考图 0/1/3 张），那是**另一个模型**，与本条无关。

#### 判断与下一步

🟡 **观望，本轮不接**。理由三条，按「先结构后功能」排：

1. **纯复制车道是负收益**。t2v / 首尾帧 / 参考生三种模式我们**已经在 kie 上跑着**，而 apimart 这条**更窄**：没有 `duration`（时长交给模型猜）、没有 `seed`（同一提示词不可复现）。为一个能力更少的同模型渠道再建一份档案 + 一份传输配方，成本全付、收益为零。
2. **真正值钱的那半接不进来**。`extend` / `edit` 需要一个「视频进、视频出」的任务种类，而 `PROFILE_KINDS`（`electron/shared/contracts/modelAccessCapabilities.ts:17-32`）只有 `text_to_video` / `image_to_video`，**没有 `video_to_video`**；`electron/catalog/apimartVideos.ts:89-118` 的视频传输工厂也只产这两个桶。`omniFlashExt.ts:12-14` 早就把同一堵墙写进注释了（它的 `video_urls` 也因此没接）。所以「接 Gemini Omni 的续接能力」实际上是**先开 `video_to_video` 这条任务通道**，是架构件，不是一次模型接入——不该塞进日课雷达顺手做。
3. **实测反方证据不支持它当主力**。首尾帧效果不佳、动作感不足、画面文字/字幕出错、且禁打斗——这四条正好压在漫剧/分镜的主路上。

**在等什么**（观望的退出条件，写清楚才叫观望）：
- 等 `video_to_video` 任务种类落地（或明确否决）；它落地当天，这条 apimart 车道立刻从 🟡 变 🟢，因为 `extend` 是它独有的。
- 等一手价格在 apimart 侧显形（现在两家中转页都不写价，只有 Google 列表价），否则 4K 档（$0.30/秒 起）的真实中转加价不可估。

---

## 二、接入方案（用户点头后才写码）

> 按技能要求先出方案。**本节不是授权实施**，且方案本身的建议是「先做前置件（`video_to_video`），再接这条车道」。

### 2.1 契约摘要

| 项 | 值 | 出处 | 实抓日期 |
|---|---|---|---|
| 创建 | `POST https://api.apimart.ai/v1/videos/generations` | apimart 文档页 | 2026-09-07 |
| 鉴权 | `Authorization: Bearer {{user_api_key}}` | 同上 | 2026-09-07 |
| 查询 | `GET https://api.apimart.ai/v1/tasks/{task_id}` | 同上 | 2026-09-07 |
| 取片路径 | `result.videos[*].url`；状态 `status`；失败信息字段 | 同上 | 2026-09-07 · **字段名待实测**（铁律 4：kie 文件上传那次官方文档三处与实测不符） |
| model | `gemini-omni-1.1-flash` | 同上 | 2026-09-07 |
| resolution | `360p` / `720p`(默认) / `1080p` / `4k` | 两家中转 + 一手一致 | 2026-09-07 |
| aspect_ratio | `16:9`(默认) / `9:16` | 同上 | 2026-09-07 |
| duration | **该车道无此参数** | apimart 文档页 | 2026-09-07 |
| 图片上限 | 中转写 ≤10（含首尾帧） | apimart 文档页 | 2026-09-07 · **待实测**（kie 写 7，Google 未给硬上限） |
| 视频输入 | ≤1 条 ≤10s | apimart 文档页 | 2026-09-07 · **待实测**（Google 一手写「≤3 段、每段 ≤3s」作风格参考——两者可能是不同用途的两个通道） |
| 续接上限 | 10 秒一档、最长 40 秒 | Google 一手 + the-decoder | 2026-09-07 · **待实测** |
| 价格 | $0.03 / $0.10 / $0.15 / $0.30 每秒（360p/720p/1080p/4K），**Google 列表价** | the-decoder（引 Google 定价） | 2026-09-07 · **apimart 中转加价未知，待实测** |
| 错误码 | 400 / 401 / 402 / 429 | apimart 文档页 | 2026-09-07 |

### 2.2 档案设计

新建 `electron/shared/videoCapabilities/geminiOmni11Apimart.ts`，导出 `GEMINI_OMNI_11_APIMART_ARCHETYPE`：

```
id: "gemini-omni-1.1-apimart"
family: "gemini-omni"          // 与 kie 档案同族，供推荐层按族聚合
label: "Gemini Omni 1.1 Flash"
kind: "video"
identifierPatterns: ["gemini-omni-1.1-flash"]   // 只认 apimart 侧 slug，不与 kie 档案抢
defaultModeId: "t2v"
transportTaskKind: "text_to_video"
sources: [{ url: "https://docs.apimart.ai/en/api-reference/videos/gemini-omni-1.1-flash/generation.md",
            checkedAt: "2026-09-07", vendorKey: "apimart", covers: "..." }]
```

- **参数控件**（对照 `omniFlashExt.ts:19-24` 的写法）：`resolution` select 360p/720p/1080p/4k（默认 720p）、`aspect_ratio` select 16:9/9:16（默认 16:9）。**不声明 `duration`、不声明 `seed`**——该车道没有，声明了就会发一个上游忽略或拒收的字段（`wan30Apimart` 把「官方忽略 → 不声明不发」当成明示约定，同理）。
- **模式**（`modes`，槽的声明方式对照 `geminiOmni11.ts:26-28`）：
  - `t2v`：`intent:"text"`，无槽。
  - `firstlast`：`intent:"firstlast"`，槽 `first_frame`(min1/max1) + `last_frame`(min0/max1)，`inputKey` 走 **`image_with_roles`**（`combineSlotsInto` 产 `[{url,role:'first_frame'|'last_frame'}]`，同 `wan30Apimart` 的做法），`fixedParams: { "metadata.task": "image_to_video" }`。
  - `reference`：`intent:"character"`，槽 `image_ref`(min1/max10) → `image_urls`，`fixedParams: { "metadata.task": "reference_to_video" }`。
  - **`extend`（前置件落地后才加）**：`transportTaskKind: "video_to_video"`，槽 `video_ref`(min1/max1)，或改走 `extend_from_task_id`（更省——不用回传视频文件，直接引用上一次 task）。
- **传输配方**：`electron/catalog/apimartVideos.ts` 的 `videoModel({...})` 工厂（`:89-118`）再加一行，`archetypeId: "gemini-omni-1.1-apimart"`，`t2vBody` / `i2vBody` 按上表字段拼；`metadata.task` 由 `mode.fixedParams` 钉死——理由与 Wan 3.0 的 `generation_type` 完全同构（`apimartVideos.ts:204-212` 注释：`image_urls` 被官方在「首尾帧族」与「参考族」之间重载，只有这个字段能告诉上游属于哪族，**不靠上游猜**）。
- **注册**：`registry.ts` 的数组 + `index.ts` 的 re-export，各加一行（对照 `registry.ts:73/85`、`index.ts:10/21`）。

### 2.3 合还是分：**分**（新建 apimart 档案，不并进现有 `GEMINI_OMNI_11_ARCHETYPE`）

理由是**先例 + 结构**，不是偏好：

1. **本仓已有成文约定**：同一模型经不同中转 = 不同档案。`minimaxH3Apimart.ts:4-5` 把理由写死了——「KIE H3 的 `image_url`/`reference_*` 与 APIMart 的 `first_frame_image`/`image_urls`/`video_urls`/`audio_urls` **不是同一条线缆**，故保留独立档案」。同族还有 `seedance25.ts` / `seedance25Apimart.ts` / `seedance25Runway.ts`，`wan30.ts` / `wan30Apimart.ts`。
2. **这一条的线缆差异比 H3 那条还大**：kie 是 `POST /api/v1/jobs/createTask` + `input{}` 嵌套 + `duration` 必须字符串化（`kieGeminiOmni11.ts:35-38` 的 `paramMap` 就是为这个存在的），apimart 是扁平 body + `POST /v1/videos/generations`；参数集也不同（apimart 少 duration/seed、多 `metadata.task`/`extend_from_task_id`/`image_with_roles`）。
3. **合档会污染已在跑的 kie 车道**。合档的唯一手段是 `vendorParams`（现有档案已用它给 runway 开了个窄车道，`geminiOmni11.ts:16-19`），但那机制只能**减参数**，表达不了「多一个 `extend` 模式 + 换一套 body 形状 + 换一个端点」。硬塞进去等于在一个档案里维护两套模式表——那就是并行版（违 P1）。
4. **family 相同即可满足聚合需求**：推荐层与模型框按 `family: "gemini-omni"` 就能把两条渠道视作同一个模型的两个供应商，不需要它们共用同一个档案对象。

### 2.4 分档理由：默认预设该不该上？**不该。** 和 MiniMax H3 / Seedance 比谁该当默认？**都不该，因为我们刻意没有「默认预设」这个东西。**

先纠一个前提，这是读代码读出来的、不是判断题：

- `electron/settings/generationModelDefaultsContract.ts:40-43` —— `DEFAULT_GENERATION_MODEL_DEFAULTS = { schemaVersion: 1, byTaskKind: {} }`，**空的**。
- 同文件 `:10-11` 的设计注释写死了原因：「**缺席 = 自动选择**。不写默认值进盘……写一份『默认的默认』进文件会产生第二真相源，以后改挑选策略时老用户永远卡在旧值上。」

所以「给某个模型上默认预设」在本仓不是一个可执行动作——它会**直接违反**这条已拍板的契约。用户能设的是**他自己的**默认（四类任务各一条 `(vendorKey, modelKey)`），我们不替他预置。

那么这个问题真正的落点是**推荐排序**（`electron/shared/videoCapabilities/recommendation.ts` 的 `recommendVideoGeneration`，按 references / goals 打分选模式）。就那个口径回答「谁该排前面」：

| 场景 | 该排前面的 | 为什么 |
|---|---|---|
| 跨镜角色身份一致（Nomi 主痛点） | **Seedance 2.5** | 参考图/角色通道最成熟；Gemini Omni 实测在人物动作与首尾帧上弱 |
| 短片主力、要时长可控 + 2K | **MiniMax H3** | `duration` 4–15s 可控、`resolution` 2K（`minimaxH3Apimart.ts:9-10`）；Gemini Omni 的 apimart 车道**连时长参数都没有** |
| 单镜 4K 出片 / 长片续接到 40s | **Gemini Omni 1.1**（且只在 kie 车道有时长控制） | 4K + 原生 extend 是它独有；但 extend 目前接不进来 |
| 动作戏 / 打斗 | 明确**不要** Gemini Omni | 上游系统提示词限制（自媒体实测） |

**一句话**：Gemini Omni 1.1 是一把「4K + 长片续接」的专用刀，不是主力刀。让它当默认会把 Nomi 最常见的「角色一致 + 精确时长」两件事做差。

### 2.5 花费估算

- **接入期实抓/契约验证**：0 元（文档抓取、契约测试用 fixture，不打真上游）。
- **真实付费验收**（按记忆纪律：用户没有即梦账号，付费验收只走 APIMart，且需本地代理）：
  - 冒烟 3 条 × ~8 秒 × 720p ≈ 24 秒 × $0.10 ≈ **$2.4**（Google 列表价，apimart 加价未知）
  - 360p 草稿档同规模 ≈ **$0.72**（官方称 360p 比 720p 快 60%、成本约 1/3）
  - 4K 单条验收 8 秒 ≈ **$2.4**
  - **建议预算上限 $5**，含重试。属「评测/验证类额度」，按 CLAUDE.md 决策自治默认授权，事后报账即可。
- 备注：以上全部按 **Google 一手列表价**估；apimart 中转的真实扣费只能从响应的 `cost` / `credits_cost` 里看到，**首次验收时必须记下来回填本表**（铁律 5）。

### 2.6 验收口径

1. **契约测试**：仿 `src/config/modelArchetypes/seedance25ApimartContract.test.ts` / `seedance25ApimartWire.test.ts` 建一对——档案侧断言模式/槽/参数枚举与文档表逐项一致；线缆侧断言渲染出的 body 形状（含 `metadata.task` 由 `fixedParams` 注入、**不含** `duration`/`seed`）。
2. **真实付费验收**（APIMart + 本地代理）：t2v 一条、首尾帧一条、参考生一条，各取回真 mp4；把 `image_urls` 推到 8 张与 11 张各试一次，**坐实 ≤10 这个上限到底是 10 还是 7**（三方不咬合项）。
3. **回填**：把实测到的取片字段名、图片上限、真实 `cost` 写回 `sources.covers` 与本文 2.1 表，把「待实测」标记摘掉。

---

## 三、`uncovered` 抽样

本轮**不抽**。理由（铁律 6 要求写明）：存量池共 **166 条**（kie 76 + apimart 90），是首次建基线时的存量缺口；本轮唯一的 `added` 已确认是渠道新增而非缺口，与当前痛点（Agent 运行时重做、分镜、MCP 对等）无新增交集。逐条分诊只会把报告变成没人读的收件箱。要清存量另开专项。

## 四、雷达修复：`apimart-llm` 车道拿不到凭据

### 4.1 根因（读代码，不猜）

- `scripts/model-radar.ts:212` —— 该车道打的是 authenticated `GET https://api.apimart.ai/v1/models?expand=category&category=chat`。
- `scripts/model-radar.ts:244-257` —— `resolveApimartApiKey()` 取凭据的顺序是：`APIMART_API_KEY` 环境变量 → 本机 `~/Library/Application Support/{nomi,Nomi}/model-catalog.json` 里的**明文**记录。
- `scripts/model-radar.ts:221-225` —— `usableApiKeyFromRecord()` 见到 `record.enc === "safeStorage"` **直接返回空串**，注释写明「safeStorage 密文要 Electron 主进程才解得开，纯 tsx 脚本拿不到」。
- 于是 `:258-261` 抛出用户看到的那句错误。

**所以这不是 bug，是一个已知的能力缺口**——`docs/plan/2026-08-27-vendor-model-radar.md:35` 早就把它记成「后续增强」：「apimart 另有 `GET /v1/models?expand=…`……但它要 API key，而 key 是 safeStorage 加密存在 Electron 里、独立脚本解不开。」车道本身的 **fail-closed 行为是对的**（明说「今天没查成」、快照不动、绝不静默当成「没有新模型」），符合铁律 1，不要去改它。

### 4.2 修法（三选一，**推荐 A**；本轮不实现）

**A. Electron 侧一次性取数子命令（推荐）**

给雷达加一个前置步骤：用 Playwright 的 `_electron` 启一个 headless 主进程（**本仓已有现成先例**：`scripts/settings-existing-connection-add-walkthrough.mjs:290-295` 就是 `app.evaluate(({ safeStorage }) => …)`；`scripts/staging-ab.mjs` 已在脚本里启 Electron），在**主进程内部**完成三件事：

1. 读 `model-catalog.json`，`safeStorage.decryptString()` 解出 apimart key；
2. **就在主进程里** `fetch` 那个 `/v1/models` 端点；
3. 只把**模型 id 列表**（`data[].id`）写到一个临时 JSON，tsx 脚本读这个文件。

关键性质：**密钥自始至终没有离开拥有它的进程**——不进 argv、不进环境变量、不进 stdout、不进日志、不进聊天。雷达脚本侧只需把 `apimart-llm` 的 `collect` 从「fetch URL」换成「读这份中间产物」，`parseApimartLlm` 一行不用改。

这也正是 R28 的形状（防线建在最早能拦住的那层）：与其在各处小心「别打印 key」，不如让 key 根本不出主进程。代价：雷达从「零依赖 tsx」变成「要能起 Electron」——所以**必须保持可降级**：起不来 Electron 就照旧 fail-closed 报「今天没查成」，绝不因此让文档车道也跑不了（08-31 那次 apimart 崩把 kie 陪葬的教训，隔离已经在 `collectVendors` 里，别破坏它）。

**B. 直接读 macOS Keychain 的 safeStorage 主密钥自行解密** —— `security find-generic-password -s "Nomi Safe Storage" -w` 取主密钥，再在脚本里 AES 解。**不推荐**：这是把 Electron 的加密实现重写一遍（R20 build-vs-buy：不在护城河上、又直接碰密钥 → 用标准实现，而标准实现就是 Electron 自己），且每次都会弹登录钥匙串授权，跨平台还得再写一份 Windows DPAPI 分支。

**C. 手工在 `~/.zshenv` 里 `export APIMART_API_KEY=…`** —— 最省事，和本机 `TIKHUB_API_KEY` 现在的做法一致，**用户自己就能做**（不经聊天传 key）。但它把明文密钥重新落到一个 shell 配置文件里，是**兜底不是修法**。若用户只想今天先看到这条车道的结果，这条最快；长期仍应做 A。

**建议**：把 A 排进雷达自身的维护项（它同时把 `docs/plan/2026-08-27-vendor-model-radar.md:35` 那条挂了 10 天的「后续增强」结清）；在 A 落地前，用 C 作为显式兜底，并在错误文案里保留现有指引（它已经写得很清楚）。

---

## 底部

- **快照纪律**：**未跑 `--update-baseline`**（铁律 3，等用户看过本轮差异）。用户看过后若认可「`gemini-omni-1.1-flash` 是渠道新增、本轮不接」，再更新快照，下轮它就不再显形。
  - ⚠️ 更新前请注意：`apimart-llm` 车道今天没查成，它的快照本来就没动；等该车道修好并成功跑过一次后，**它的首轮结果会一次性报出一大批「新增」**（首次建基线的正常现象），别读成上游一夜之间上了几十个模型。
- **本轮忽略**：0 条。🟢 0 · 🟡 1 · ⚪ 0。
- **给用户的动作项**（都在等点头，未实施）：
  1. 是否认可「本轮不接这条 apimart 复制车道」→ 认可即可更新快照。
  2. 是否把 `video_to_video` 任务种类排进路线（它是 Gemini Omni `extend`、也是 `Omni-Flash-Ext` 的 `video_urls`、以及未来任何「视频进视频出」能力的共同前置件）——这才是本轮真正挖出来的结构性缺口。
  3. 雷达修复选 A（Electron 取数子命令）还是先用 C（本机 env）兜底。
