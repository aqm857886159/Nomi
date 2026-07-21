# 通用 `/v1/images/edits`（multipart）图生图支持

> 2026-07-21 · 起因：用户接第三方中转站的 GPT Image 2 图生图失败。R5 查实这是 Nomi 一个**通用缺口**（不止 GPT Image 2）。

## 1. 为什么要做（底层逻辑，非功能罗列）

**真实摩擦**：用户在某中转站接 GPT Image 2，文生图可能通、图生图必挂。

**根因（R5 已核）**：
- OpenAI 官方 + 主流中转站（new-api / apiyi / packyapi）的图生图**标准通道是 `/v1/images/edits`，首选 multipart/form-data**（`image[]=@文件`，可多图 + 可选 mask）。来源：
  - OpenAI 官方 https://developers.openai.com/api/reference/resources/images/methods/edit
  - new-api https://doc.newapi.pro/en/api/openai-image/
  - apiyi gpt-image-2 https://docs.apiyi.com/api-capabilities/gpt-image-2/overview
- Nomi 现在图生图**只押 `/v1/chat/completions` 多模态一条线**（[newapiTransport.ts:69](../../electron/catalog/newapiTransport.ts) `NEWAPI_IMAGE_EDIT_OP`）。而有的站（packyapi）**明确不支持** chat/completions 出图 → 必然失败。
- 架构断层：Nomi 全链路是「参考图=URL 塞进 JSON」。`executeProfileOperation` → `requestJson` **只发 `JSON.stringify(body)`**（[vendorHttp.ts:120](../../electron/vendor/vendorHttp.ts)）。而 edits 要的是把图片**原始字节当文件上传**（multipart），模板引擎产不出。

**做完的通用价值**：任何暴露 OpenAI 标准 `/v1/images/edits` 的模型/站（gpt-image-1/1.5/2、dall-e-2、以及未来同契约模型）都能图生图，不是给某一家打补丁（P4）。

## 2. 现有可复用地基

- `executeProfileOperation`（[runtime.ts:311](../../electron/runtime.ts)）已有 **process transport** 声明式分支（`op.process` → CLI），multipart 照此再开一支即可，不新造并行 runner。
- 手搓 multipart 先例：`audioTaskRunner`（Whisper 读参考音频字节 → `FormData` → 同步 JSON），`postMultipartForAssetUpload`（[localAssetFile.ts:170](../../electron/assets/localAssetFile.ts)）。
- 参考图字节：`readNomiLocalAsset` 取本地字节；远程 URL 需 fetch→Buffer（沿用 `localizeAssetsForVendor` 前置）。
- 协议分流已有骨架：`newapiImageEditProfileForModel`（[newapiTransport.ts:131](../../electron/catalog/newapiTransport.ts)）现返回 `xai-json-edits` / `chat-completions-image-url`，加第三种即可。
- 响应形状：edits 返回 `data[*].url` / `b64_json`，与 `/v1/images/generations` 同 → 现有 `extractAssetUrl` + `response_mapping: { image_url: "data[*].url" }` 直接复用。

## 3. 设计（声明式 multipart 传输模式）

**取「声明式 multipart body 模式」而非再手搓一个 image-edit runner**（P1：不加并行传输版；P4：任何未来 multipart 端点声明即用）：

1. **`HttpOperation` 加可选 `multipart` 描述符**（类型层）：声明哪些字段是普通 form 字段（值走模板渲染），哪个字段是**二进制图片文件**（值是参考图 URL，发送时取字节）、字段名（`image[]` 多图 / `image` 单图）、可选 `mask`。
2. **`executeProfileOperation` 加 multipart 分支**：`op.multipart` 存在 → 渲染 form 文本字段 + 把图片 URL 取成 Buffer 塞进 `FormData`（复用 localize 把 `nomi-local://` 变可读）→ 新 `requestMultipart`（vendorHttp 里，`fetch` 不带 Content-Type 让 boundary 自动生成，鉴权头照 vendor 声明）。
3. **新种子 op**：`OPENAI_IMAGE_EDIT_MULTIPART_OP`（`POST /v1/images/edits`，form: model/prompt/size/quality/n/`image[]`），协议名 `openai-multipart-edits`。
4. **协议分流（§4 待拍）**：`newapiImageEditProfileForModel` 加第三档；`relayImageEditMigration` 给命中模型标 `imageEditProtocol: "openai-multipart-edits"`。

**v1 诚实边界（D4 明标）**：
- 不做 mask（Nomi 节点无 mask 概念；gpt-image mask 本可选，纯 prompt 改图能用）。
- 参考图 >25MB 各站会拒（沿用现有大小护栏 + 错误透传）。

## 4. 决策（2026-07-21 用户拍板：全权推进 G1，不再逐项问）

**决策 A — 内部架构 = 声明式 multipart 模式**（§3）。锁定。

**决策 B — 协议判定 = 免费探测优先 + 智能默认兜底 + 手动逃生口**（三层，锁定）：
1. **免费端点探测**（`probeImageEditProtocol`）：接入/自动拉取时，往 `{base}/v1/images/edits` 发**故意缺 image 的请求**，读报错形状——`400/"missing image"` = 站有 edits 端点（走 multipart）；`404/路由不存在` = 没有（走 chat）。**在参数校验就被挡下，不触发付费生成**。多信号防御 + 缓存在模型 meta，拿不准不猜。
2. **智能默认兜底**（探测不可用/歧义时）：`gpt-image*`/`dall-e*`→multipart；`gemini`/`nano-banana`→chat；`grok-imagine`→xai-json。
3. **手动逃生口**（UI，最后做）：模型编辑面板「改图协议」下拉，默认=探测/智能结果，用户可改。**到这步先读真实面板组件 + 出样张 + 走查（R8/R13）**，不 pre-ask 打断。

## 4b. 执行顺序（自主推进）
1. 类型 `HttpOperation.multipart` + 种子 `OPENAI_IMAGE_EDIT_MULTIPART_OP`（+ 单测）
2. `executeProfileOperation` multipart 分支 + `requestMultipart`（参考图 URL→字节）（+ 单测）
3. `newapiImageEditProfileForModel` 加第三档 + `relayImageEditMigration` 标协议（+ 单测）
4. `probeImageEditProtocol` 免费探测 + 接入时调用 + 缓存（+ 单测 mock 各报错形状）
5. UI 改图协议下拉（读真实面板→样张→实现→走查）
6. 真机验（真中转 key，GPT Image 2 图生图，抽帧人眼）+ 五门

## 5. 验收门

- 单测：multipart body 组装（form 字段 + 二进制）、协议分流三档、response mapping。
- 真机（额度默认授权）：用真实中转站 key，参考图 → GPT Image 2 图生图，抽帧人眼确认「按参考图改」而非无中生有。
- 五门 + R13 走查图生图节点旅程。

## 6. 回滚

纯新增声明式分支 + 新种子 op，不改现有 chat/completions 路。回滚 = 撤 `op.multipart` 分支 + 协议档回退两档。
