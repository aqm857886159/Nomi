# 自建中转能力覆盖矩阵（常驻真相表）

> 用途：**报「这条线好了」之前必须逐格对账**。空格子要主动说出来，而不是等用户问「视频呢音频呢」。
>
> 起因：2026-09-03 这一轮里，用户连问三次「还有没有别的」「视频呢音频呢」「模式全不全」，每次都问出真空白。
> 根因不是不够细心，是**把任务书当范围、而不是把用户目标当范围**——目标始终是「自建中转这条线要好用」，
> 不是「修好某个 bug」。这张表就是范围本身；它在仓库里，不在谁的脑子里。
>
> 维护纪律：动了自建中转链路的任何一段，**先更新本表再报完成**。格子只有三种值，不许含糊：
> ✅ 有证据 ｜ ⚠️ 部分/降级（写清降级到什么程度） ｜ ❌ 无覆盖。

## 1. 按 kind × 验证层级

| kind | 真中转实测 | CI 台架（严格假中转全链路） | 备注 |
|---|---|---|---|
| 图像 t2i | ✅ 2026-09-03 出真图 | ✅ 认证+生成 | 真中转 `otokapi.com` / `gpt-image-2` |
| 图像 改图/参考 | ✅ 蓝底黄圆→变红 | ✅ multipart 全链路 + 4 条真机拒绝规则 | 修复前 **100% 坏** |
| 视频 t2v | ❌ **无真视频中转可测** | ✅ 含异步生命周期（创建→轮询→产物，真 ffprobe） | |
| 视频 i2v 首帧 | ❌ 同上 | ✅ 行为级：首帧 URL 逐字等于 `body.image` | |
| 视频 参考视频 / 多图参考 | ❌ | ❌ **无覆盖** | 通用中转协议无此形状；见 §3 |
| 音频 TTS | ❌ | ✅ `/v1/audio/speech` + 真 codec 断言 | |
| 音频 转写 transcribe | ❌ | ⛔ **不可达，已钉住** | 中转接入**根本产不出** transcribe 模式（见 §3）；`relayConformanceTranscribe` 把缺口钉成断言 |
| 3D | ❌ | ❌ **通用协议无 3D 端点标准** | 走直连脚本 / ComfyUI 导入，已有中文指路 |
| 文本 chat | ❌ | ⚠️ 仅声明级 | 主路不经模板，走 streamText |

## 2. 按「能力轴」

| 轴 | 状态 | 依据 |
|---|---|---|
| 模式集（哪些模式该显示） | ✅ | 按可达性 derive，fail-open；`channelModeReach` |
| transport（走哪个 mapping 桶） | ✅ | `modeTransportFor` 单点 |
| 参数（取值合法性） | ✅ | `vendorParams` + `paramConsistency` 门岗 |
| 变体轴（切变体是否真生效） | ✅ **中转已补活**（2026-09-03） | 判据仍是「渠道有没有把 model 参数化」；此前中转六个 op 全写死字面量 → 判据正确地把变体栏整条藏掉 → 用户**每次生成都在跑最贵的默认档**。现统一改引 `RELAY_MODEL_REF`，回落在 `taskTemplateParams` 单点补。台架断的是**报文里的 model 串**，不是 UI |
| 参数真到得了 wire（逐参数对账） | ⚠️ 部分（协议边界） | 见 §2.1 |
| 参考声明（referenceParam） | ✅ | 两个生产者共用 `assertAdapterModeInvariants`；穷尽三态分区类型层钉死 |
| 参考**键名语义**正确性 | ⛔ **已决定不做** | 需要「各家每个键什么含义」的表，该表不存在只能编 |
| **目录形状**（用户真能落到的那几种接法） | ✅ | `relayConformanceShapes`：5 形状 × 3 不变量（模式集 / 选线缆 / 参考到不到得了 wire），判据全复用生产的那份 |

## 2.1 逐参数对账：档案声明的参数，通用中转 wire 到底送不送得到

判据**复用生产的那份**（`wireReferencedParamKeys` ∪ `consumedCanonicalKeys` ∪ `paramMap.drops`，与
`paramConsistency.test` 同一个函数，不另写扫描器）。口径：对全部 89 个档案 / 180 个「中转可服务」模式
跑覆盖差集。R5 依据：`doc.newapi.pro/api/kling-jimeng/`（2026-09-03，本仓中转视频用的正是该页的
`POST /v1/video/generations`；**不是** `openai-video/` 那页的 `/v1/videos`，两者字段名不同，别混）。

以 `seedance-2`（任务书的样本模型）为准的逐参数判决：

| 参数 | 判决 | 依据 |
|---|---|---|
| `resolution` | ✅ **翻译**成 `size` | `NEWAPI_VIDEO_PARAM_MAP` 的 `ratioResToOpenAiSize`；实测 4K+9:16 → `2160x3840` |
| `aspect_ratio` | ✅ **翻译**成 `size` | 同上；`adaptive` → 不覆盖（转换返回 undefined），交由站点默认 |
| `duration` | ✅ 直达 | body 直接引用，数字原样进 wire |
| `model`（变体） | ✅ **本轮补活** | 见 §2 变体轴那行 |
| `seed` | ✅ **本轮补上** | 文档明写顶层可选 integer（『随机种子』）；此前**静默丢弃** → 产出不可复现 |
| `negative_prompt` | ✅ **本轮补上**（进 `metadata`） | 文档原文：`metadata` = 『供应商特定/自定义参数（如 negative_prompt, style, quality_level 等）』 |
| `generate_audio` | ❌ **协议真的送不到** | 该页字段表**没有**这个字段，`metadata` 里也未点名。往自由袋里塞臆想的键名不会报错**也不会生效**，只会变成更难发现的静默丢弃 —— 故不假装支持 |

同族「声明了但通用协议无字段」的还有：`return_last_frame`(3 档案)、`audio`/`sound`(3)、`watermark`(2)、
`video_resolution`(2)、`mode`、`frame_rate` 等。一律**不硬塞**，如实记在这里。

⚠️ 一个实测坑（已钉成断言）：`metadata` 必须用**整 token**引用，不能逐键写。模板层丢得掉值为
undefined 的**键**，却丢不掉因此变空的**父对象** —— 逐键写法在用户什么都没填时会发出 `"metadata":{}`，
凭空给严格端点多一个空对象。

## 3. 我们控制不了 / 有意不做的（写明，不假装覆盖）

| 项 | 为什么 | 缓解 |
|---|---|---|
| 供应商单方面改契约 | 外部 | 真 key 抽检 + `radar:models` |
| 用户中转的私有魔改 | 外部 | 第三闸发送前诚实拒发 |
| 付费产物质量（参考图**真的**影响了产出吗） | 假中转不出真图 | 只能真机封印 |
| 视频参考视频/多图参考经通用中转 | 通用协议里没有这个形状 | 无。真要支持得先有标准或逐家契约 |
| `generate_audio` / `return_last_frame` / `audio` 等档案参数经通用中转 | **协议字段表里没有这些字段**（R5 核 kling-jimeng 页 2026-09-03）。`metadata` 是自由袋，但塞未经文档点名的键**不报错也不生效**——那是比缺覆盖更坏的静默丢弃 | 不硬塞、如实标注（§2.1）。要真支持得等供应商文档补字段，或走该模型的直连档案 |
| 首帧/尾帧两帧 + 全能参考（omni）经通用中转 | 通用视频 body 只有**一个** `image` 字段，装不下两帧或参考数组 | 无。这是协议形状限制，不是我们的疏漏 |
| 真视频/音频中转 | **手上没有** | 台架里**零条**供应商拒绝规则——编造供应商行为比没覆盖更糟 |
| 转写经通用中转 | **接入链根本产不出这条模式**：`newapiTransportFor("audio")` 只给 `text_to_audio`，既无 `edit` 也无 `imageToVideo`，而 `modesForKind` 的第二/三条模式完全由这两个字段 derive | 缺口已**钉成断言**（`relayConformanceTranscribe`）：模式集恒等于 `["text_to_audio"]`、根因字段恒为空、UI 上「转写音频」被如实收窄掉。要补是**生产改动**（给音频配方加转写通道），不是补测试；补完这些断言会红，正是提醒 |

## 4. 待办（有主，不是许愿）

- [x] 台架第二步「形状矩阵」：零 mapping / 无 modeId 单端点 / chat 改图 / multipart 改图 / 进程型
      → `electron/providerAdapter/relayConformanceShapes.integration.test.ts`（5 形状 × 3 不变量）。

      ⚠️ **两个真 bug 的回归钉在哪，要说准**（复验时发现归属曾被写错，此处更正）：
      形状台架测的是**判据**（给定三态，`archetypeModeIsVisible` 该显该藏）；而两个真 bug 都在**生产者**
      （`readModeChannelBody` 把「空 mapping 列表」读成「不支持」；`selectTaskMapping` 借别的模式的线缆）。
      实测：把 `list.length === 0 → undefined` 那行删掉，形状台架 **14 条全过**，
      是 `useChannelCreateBody.test.ts` 的「这家一条 mapping 都没有（自建中转）→ undefined」当场红。

      结论：**两层都要有，缺一层就有假绿**——判据层归形状台架，生产者层归
      `useChannelCreateBody.test.ts` / `types.test.ts`。别把前者当成后者的回归。
- [x] `transcribe` 经中转 → **查明是不可达，已钉住**（不是「还没做」）。见上 §1/§3。
- [ ] **产品拍板**：素材外传的同意闸按「谁托管」设，不按「是否变成公开可取」设——匿名图床要同意，
      Nomi 自己那条 `public-provider`（24h 公开可取）不要。自建中转用户默认落在后者。见 §5。

## 4.1 已知判据盲区（形状矩阵量出来的，不是缺陷、是有意的 fail-open）

可达性判据（`modeSlotReach` / `wireReferencedParamKeys`）读的是 **body 与 `process.args`**，
**看不见 `multipart.imageSource`**。multipart 改图的 body 为空 → `referenced.size === 0` →
判据 fail-open 一律放行（`referenceReachability.ts:64-65`）。

这条 fail-open **必须留着**：gpt-image 系真实走的就是 multipart，2026-09-03 真机 200 验证过；
若改成 fail-closed，那条真能用的通道会在 UI 上被藏掉。代价是 multipart 形状下拿不到槽级承载力的
精确判断——已在形状 4 的断言里明写，并由 `multipart.imageSource` 的键名断言兜住参考通道本身。

## 5. 素材外传：用户的参考图到底去了哪

参考图/参考视频**必须**变成公网可达（供应商读不了 `nomi-local://`）。候选按序：

1. 该供应商自己的上传通道（`provider-private`）——**自建中转没有这条**，通用协议无上传端点
2. 用户配了 key 的其他家（kie / apimart）
3. Nomi 自己的 Cloudflare Worker：`visibility: "public-provider"`、TTL 24h、**无 `requiresConsent`**
4. 匿名图床链（litterbox → tmpfiles）：`public-anonymous`、TTL 1h、**`requiresConsent: true`**

**纯自建中转用户（未配别家 key）默认落在第 3 档。**

不一致之处：同意闸按「**谁托管**」设，而非按「**是否变成公开可取**」设。第 3、4 档在用户视角是同一件事
（拿到 URL 的人都能下载），却只有第 4 档要同意。这不是缺陷（功能必须外传），是**产品取舍**，待拍板。
