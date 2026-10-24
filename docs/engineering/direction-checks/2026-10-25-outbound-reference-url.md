# 方向检查：出站参考媒体 URL 序列化边界（2026-10-25）

触发：`electron/catalog/assetLocalization.ts` 近 14 天已有 3 个 fix，本次是第 4 个；`electron/catalog/profileHttpRequest.ts` 近 14 天已有 2 个 fix，本次是第 3 个。两处命中的是文件级 fix-churn。本次改法是**换**：把远端参考 URL 的隐式直通换成统一的 WHATWG URL 序列化边界，不增加供应商 / 模型 / 平台分支，不保留旧直通后备；结构性结论交协调会话代批，事后报用户。

## 0. 一句话根因

参考媒体 URL 的本地上传、profile 渲染、fallback / custom-call JSON 和 multipart 取字节各有出站门，缺少一个按字段形状共享的 URL 序列化不变量，所以新增入口或旧远端值都能绕过空白 / 控制字符校验。

## 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| 本单：参考图文件名含空格时服务商拒绝 | `image_urls` 等远端值在无本地上传时原样进入请求体 | 出站参考媒体 URL 多门直通 |
| 同类潜伏：`first_frame_image`、`image_with_roles[].url`、`video_urls`、`audio_urls`、multipart 文本字段 | 字段形状不同，调用方没有共享序列化合同 | 同上 |

## 2. 为什么这一类会一直出现

`localizeAssetsForVendor` 只负责 `nomi-local://` / `data:` 的物化；已有公网 URL 在 profile 构造和自定义脚本里被当作可信字符串。字段本身分散在数组、字符串、对象 `url`、query 和 multipart 文本字段，局部测试只钉某一家映射，新增门不会自动继承 URL 标准。类级修复把不变量放在 `outboundReferenceUrl.ts`，JSON 写出、profile 构造、multipart source / form-data 都复用它。

| 铁律 | 结论 | 最小证据 |
|---|---|---|
| ⑩ 说的=摆的 | 适用：参考 URL 是生成意图的一部分，出站值必须与用户带入的媒体一一对应；序列化只改变 URL 表示，不改变引用对象 | `electron/catalog/outboundReferenceUrl.test.ts` 表驱动形状测试 |
| ⑪ 能选到 | 不适用：不增加模型参数或入口 | — |
| ⑫ 点了=以为的 | 适用：用户点生成时，请求要么携带可解析参考，要么提交前明确失败；不允许服务商收到半解析值 | `electron/vendor/vendorHttp.test.ts` invalid URL fetch=0 |

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| 新 mapping 使用另一种参考字段后再次把空格透传 | `electron/catalog/outboundReferenceUrl.test.ts` 播种 mapping body 的结构普查 |
| Agent / 自定义脚本绕过 profile 直接发 JSON，复现同样拒绝 | `electron/vendor/vendorHttp.test.ts` requestJson 写出断言 |
| multipart 文本字段仍带未序列化 URL | `electron/vendor/vendorHttp.test.ts` requestMultipart 表单字段断言 |

## 4. 靶子独立性检查

WHATWG URL Standard 是外部尺子；类级测试只断言解析/序列化不变量，结构普查不依赖某一个供应商的成功响应。`check:root-cause-contracts` 和 `check:escape-ledger` 是独立门岗；变异在隔离副本删除 vendor JSON 边界后 2 格红、删除 profile 边界后 1 格红。

## 5. P0：这些是我们独有的吗

URL 解析与序列化不是 Nomi 独有能力，直接使用 Node 内置 WHATWG `URL`，不新增依赖。参考媒体字段如何从 Nomi 的映射 / Agent / multipart 形状汇合，是 Nomi 的领域边界；因此只自写字段识别与失败归属，不自写编码器。

## 6. 接入 / 补 / 重写 / 删对比表 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 接入现成方案 | 直接用 WHATWG `URL` 的 parse → serialize（`https://url.spec.whatwg.org/`） | 无依赖；一次标准化 | 生产者若早已把 `#` / `?` 拼进文件名，边界无法恢复原意 | **是** |
| 补 | 在 APIMart / MiniMax-H3 或 Windows 分支里替换空格 | 小 | 其它 vendor、字段、Agent、旧远端值仍可绕过 | 否 |
| 重写（限一个模块） | 用 `outboundReferenceUrl.ts` 取代各门直通，保留既有本地 / data / ComfyUI 规则 | 新增一个共享模块与调用点 | 需要维护字段形状集合；类级结构测试守着 | 与接入同时执行 |
| 删 | 删除远端参考能力 | 小 | 丢失已有用户工作流 | 不可选 |

## 7. 用户要权衡的核心

是继续让每个出站门自己相信 URL，还是让所有参考媒体都接受同一条标准化和失败前置规则；本次选择统一边界。

## 特征测试清单

- `electron/catalog/outboundReferenceUrl.test.ts`：改前 MiniMax-H3 `image_urls[0]` 空格红；改后数组 / 字符串 / 对象 `url` × 空格、中文、`#`、`%20`、签名 query、`data:` 绿；播种 mapping body 结构普查绿。
- `electron/catalog/profileHttpRequest.test.ts`：profile 构造后的请求体已序列化。
- `electron/vendor/vendorHttp.test.ts`：JSON / multipart 写出前序列化；非法 URL 时 fetch=0。
- `electron/catalog/multipartOperation.test.ts`：multipart source 取字节前序列化。
- `electron/catalog/assetLocalization.test.ts`：本地上传返回的 provider URL 也经过同一 helper，既有上传 / ComfyUI / data 测试保持绿。
- 变异：隔离副本 vendor 边界 2 格红，profile 边界 1 格红。

## 第 2 轮（2026-10-25，实现线 I-ref-url-r2）：收口换到参数层，传输层那一道删掉

> 本节起，上文 §0–§7 与「特征测试清单」作废（第 1 轮的设计），以本节为准。

### 触发（`node scripts/fix-churn.mjs` 当日实数）

- 文件级：`electron/catalog/taskParams.ts` 近 14 天第 3 个 fix；`electron/catalog/customCallIpc.ts` 第 3 个；`electron/tasks/taskResultReading.ts` 第 11 个（`electron/tasks/` 目录第 28 个）。
- 概念级：「发给供应商的型号名从哪来」第 6 个、「异步生成结果取回」第 24 个——本单不改型号名也不改取回判断，只是这两个概念的文件里各多了一处比较写法。
- 改法是**换 + 删**：参数层一处收口换掉第 1 轮的传输层改写；第 1 轮的键表、三个函数和四处调用同提交删掉，四个文件回到 main。不新增供应商 / 模型 / 平台分支、特例或兜底。文件本身命中热点，按 P1 不属于协调代批的例外，结构性结论交协调会话转用户拍板。

### 第 1 轮为什么不成立

1. **两张键表**：第 1 轮按「发出去的字段名」写了 `REFERENCE_MEDIA_KEYS`，和共享键表 `GENERIC_REFERENCE_KEYS` 并存，是同一个问题的第二个答案；字段名是供应商的，表永远补不全。拿第 2 轮的类级测试跑第 1 轮代码：373 格红 51 格（平铺 18 条 mapping、archetypeInput 路同一批 18 条、标准输入键路 14 条 + 覆盖面 1 格），红的全是字段名不在那张表里的（`video_list` / `audio_ids` / `uploadUrl` / `firstImageUrl` / `input_urls` / `audio_setting` …）。
2. **结构测试自证**：第 1 轮的普查用被测函数自己的键判据挑「哪些 mapping 该查」，表漏掉的键普查也一起漏掉。
3. **改写的位置太晚**：传输层改写的是模板 / 脚本已经写好的请求体——自定义调用脚本若对请求体签名，签的是原样写法，发出前被改，签名失效。

### 类根因（改写）

参考链接的出站写法没有唯一的主人：所有模板只搬 `request.params.*`，参数在 `taskTemplateParams` 汇成一份，却没有在那里换成标准写法；拿携带的参考去和参数 / 请求体 / 回包比的地方，各自拿原样字符串比。

### 收口与删除

- **写法**：`taskTemplateParams` 第一步 `serializeReferenceParams(request.extras)`。键只认 `GENERIC_REFERENCE_KEYS`（驼峰 / 下划线归一）；表里的键带进来的值被上游推导抄到表外的键上（参考键形态投影把音频参考落到 Wan 3.0 / Kling 3.0 的 `audio`、RunningHub 的 `generateAudio`），按值认作同一条参考。门表：`taskTemplateParams` 5 扇、`templateContext` 4 扇、`buildProfileHttpRequest` 8 扇，全部模板路径都过它；唯一绕开的是自定义调用试跑（`customCallIpc`：渲染层拼好的参数直接交脚本），交脚本之前过同一个函数。
- **比较**：`comparableReferenceUrl` / `comparableReferenceValues`——第三闸 `unreachableReferenceLabels`、引擎 B 的 `assertReferencesReachBody`、回显过滤 `requestEchoUrls` 两边按同一个序列化比。`prepareAntigravityCreateOperation`（封存、核对、发起时三处都取 `taskTemplateParams`）与 `findReferenceResidue`（在组参数之前、两边都是渲染层的原样写法）本来就一致，各钉一格测试、不改码。
- **删**：`REFERENCE_MEDIA_KEYS`、`normalizeOutboundReferenceMediaUrls`、`normalizeOutboundReferenceFormData`、`isOutboundReferenceMediaKey`，以及 `vendorHttp` / `profileHttpRequest` / `multipartOperation` / `assetLocalization` 里第 1 轮的调用。概念登记 `generation.outbound-reference-url` 把前三个符号列为禁止再定义。`assetLocalization` 那一处整段删：上传得到的链接都会再进 `taskTemplateParams`（引擎 A `buildProfileHttpRequest(effectiveInput)`、自定义调用 `taskTemplateParams(effectiveRequest)`、引擎 B `productionReferenceUrls` → `projectReferenceUrls` → `buildProfileHttpRequest`），代价是上传通道返回解析不了的链接时，失败点从上传那一步挪到组参数（合同 residual_risks）。

### 为什么这几处热点不是「再补一刀」

| 文件 | 近 14 天的 fix 是什么（`git log --since=2026-10-11`） | 这一刀 |
|---|---|---|
| `taskParams.ts` | af998f85d、3fa0516f9：自建中转的线上模型名只由连接契约决定 | 参数层本来就是唯一汇合点，把出站写法收进它（换），不加分支，不碰型号名 |
| `customCallIpc.ts` | a2e601597：脚本顶层 model 走线上模型名 owner；cb95e8829：概念登记清理 | 门表里唯一绕开参数层的门，调同一个函数，不另写规则 |
| `taskResultReading.ts` | #1213 一串：状态词表、结果读法收成一份、回显参考排除连合同字段也算 | 回显集合多认参数层序列化后的那种写法；「本次请求里出现过的地址不当产物」这条判据不变 |

### 特征测试与变异

- 类级 `electron/catalog/outboundReferenceUrl.matrix.test.ts`：全部内置 mapping × 平铺 / archetypeInput / 标准输入键三条路，373 格。main 上红 368，第 1 轮红 51，改后全绿。第 2 轮动手前用当时的 247 格版本（还没有标准输入键路）跑第 1 轮：红 36。
- 单测 `electron/catalog/outboundReferenceUrl.test.ts`：值形状、键写法、被投影抄走的值、非参考键原样、幂等与例外、中文、首尾空白、解析失败点名参数、不改入参、比较函数不抛。
- 比较点各一格：`unreachableReferences.test.ts`、`apimartGenerationProvider.test.ts`（MiniMax-H3 带空格的已批准参考，`buildRequest` 与 fetch 收到的报文）、`taskResultReading.test.ts`、`antigravityCreatePreflight.test.ts`、`archetypeInput.test.ts`（`findReferenceResidue`）、`customCallIpc.referenceUrl.test.ts`（试跑）。
- 变异（`git archive` 副本 + 工作树改动，逐个拿掉、跑完即还原；基线 10 个文件 491 格全绿）：拿掉参数层收口 → 372 格红（矩阵 368 + 引擎 B / Antigravity 预检 / multipart / profile 各 1）；拿掉「按值认参考」→ 7 格红（矩阵 6：Wan 3.0 平铺 ×2、标准输入键路 Kling 3.0 / HappyHorse / RunningHub Seedance / Veo ×4；单测 1）；拿掉第三闸 / 引擎 B 参考到达 / 回显过滤 / 试跑序列化 → 各 1 格红。

### 新发现（不在本单修，报协调）

参考键形态投影（`projectReferencesOntoBodyKeys`）用正则 `classifyReferenceKeyDetailed` 认「请求体里哪个键能装参考」，会把音频参考投到布尔开关上：Wan 3.0 / Kling 3.0 的 `audio`、RunningHub 的 `generateAudio`、HappyHorse 的 `audio_setting`（headless 只给标准输入键或只给模板直读的参考键时）。形状错（开关位收到链接），与空格无关；要改的是「哪些键算参考」的判据，按任务书停点不在本单改。

### 用户要权衡的核心

出站写法由参数层一处决定（模板只搬值），代价是一条解析不了的参考链接会在组参数时就让整次生成停下，而不是交给服务商去拒——本单选前者。
