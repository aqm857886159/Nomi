# 方向检查（RW）：生成请求「拼参数 → 请求体 → 报错说下一步」整条链

- 线：D-check-generation-request-chain（Claude Opus，没参与过前面几轮）。读的是 main `745b3c5b4`，2026-11-08。
- 只读，没改代码、没花钱、没调要 Key 的接口。公开价目接口调过 2 次，不要 Key。
- 触发：`taskParams.ts` 14 天 6 个 fix；概念「headless 请求只把参考投进声明过的 body 键」14 天 7 个 fix；「画布付费生成」14 天 12 个 fix；「型号名从哪来」14 天 6 个 fix。数据都来自 `node scripts/fix-churn.mjs`。报错那一半另有：`classifyError.ts` 14 天 9 个 fix，概念「生成错误怎么说成人话」14 天 10 个 fix，`vendorFailure.ts` 2 个 fix。另外 `docs/fixes/` 里有 16 份根因记录提到引擎 B。
- 实施方案：`docs/plan/2026-11-08-generation-request-chain.md`。

---

## 0. 一句话根因

一个镜头请求有四件事实：用哪个模型、哪种模式、每张参考图是什么角色、参数取什么值。这四件事实没有「一份声明 + 一个把意图变成请求体的函数」。现在渲染层、引擎 A、引擎 B、Agent 准入层各按手头的东西重算一遍，每一层还要在上一层的结果上再投影一次。报错是在抛出的地方临时写一段话，事后再套一个粗码。结果拼参数和报错两半都没有唯一答案。测试只拿我们自己的两条路互相比，没有拿官方字段比，所以两边错得一样时永远是绿的。

## 1. 归类表：bug → 直接原因 → 类

16 份记录的「直接原因」是从 `docs/fixes/*.root-cause.json` 读的。里面的「类根因」写完这节之后才读，见文末对照。

| 记录 / bug | 直接原因 | 类 |
|---|---|---|
| 09-21 generation-executor-one-vendor | Run 路装配写死 `vendors.find(v=>v.key==="apimart")`、8 处硬编码、写死 Bearer、`data[0].task_id` | α 同一件事 Run 路另算一份 |
| 09-29 connection-certification-ownership | 有 `meta.adapter` 的行一律算认证接管 → 引擎 B 不装配，画布正常 | α |
| 10-04 declared-provider-production-handoff | 声明接入的供应商行带 `meta.adapter` → 装配跳过 → Run 路 `configured_provider` | α |
| 10-16 custom-relay-wire-model | 渲染层 `archetypeInput.model` 经 `...refInput` 盖掉连接上的型号名 | α（身份） |
| 10-23 vendor-scoped-model-id | `videoCandidateForPlan` 用档案的 catalogModelKey 改写身份；`buildArchetypeInputParams` 不分家写 model | α（身份） |
| 10-27 first-gate-full-model-identity | `applyHeadlessParamDefaults` 重建了缩水的 meta，丢了自定义能力上限；B 报 `catalog mapping defaults are invalid` | α + β |
| 10-22 reference-leak-hotfix | `buildReferenceExtras` 的 `...meta` 留下残余键；主进程 `referenceInputParams` / `projectReferencesOntoBodyKeys` 再传下去 | β 参考 / 参数各层各算、互相覆盖 |
| 10-22 composer-reference-list-single-owner | 上传存在 3 个键里，「在用」由 4 处各推一次 | β |
| 10-25 outbound-ref-url | `taskTemplateParams` 把带空格的原始 URL 抄进请求体 | β |
| 10-27 openai-derived-image-size | 比例 → 像素尺寸只判了面积上限 | β（降级缺一步） |
| 复现 1（11-07） | 两台引擎调 `modelReferenceSelection` 都不带 modeId（`runtime.ts:296`、`apimartGenerationProvider.ts:271`），按「族」封顶 1 张 | β |
| 复现 2（11-07） | 引擎 B 把合同角色词原样塞进 `[{url, role}]`，渲染层有角色表，B 没有 | β |
| 复现 3（11-08） | 画布路：渲染层已放进 `image_with_roles`，主进程 `projectReferencesOntoBodyKeys` 认不出嵌套的 `url`，又补一份 `image_urls` | β |
| 10-05 provider-explicit-rejection | 供应商 4xx（参数错、余额不足）被记成 `submission_unknown`，锁住这一镜 | γ 失败语义没有闭合码 |
| 10-06 claim-release-unsent-attempt | 发出前失败没有「没写出」证据 → unknown → 拒绝重试 | γ |
| 10-28 sync-landing-not-unknown | 同步结果落地失败在 submit 里 → unknown | γ |
| 报错层热点：`classifyError.ts` 14 天 9 个 fix；概念「生成错误怎么说成人话」14 天 10 个 fix；`vendorFailure.ts` 2 个 fix。全是 `node scripts/fix-churn.mjs` 的结果，这里列 6 个：`86862197b` Agent 上游 HTTP 失败结构化，认出「模型不存在」；`faef843a8` 服务商原话只认有来源证据的话；`55acfcd1e` 超过 3:1 的比例发前拒；`0df4b046c` 中转被拒指去模型接入；`2b8d87975` / `f253df634` 参考素材被拒改走上传；`54bcef6de` / `3797fde0c` 拒绝和恢复统一 | 每一刀都是在文本分类器里认出一种新说法，或者给一种新说法加一条出路 | γ（现役版）：失败含义在每扇门从文本里再认一遍，没有一份在抛出时就写定的码 |
| 10-16 relay-video-result-retrieval | 查询契约照自写 mock 写；原生线路误判 | δ 协议事实来自自写 / 猜，不来自官方 |
| 09-29 settings-address-is-the-users | 只认 seed host、英文报错、页面没有地址栏 | δ |
| 10-22 poll-reupload | 每个操作阶段都 `localizeAssetsForVendor` → 一个任务重传 26 次 | δ（每阶段各算一次） |

16 份记录加 3 个复现，归成四类，底下是同一个根：一件关于请求的事实（身份、槽位、失败含义、协议）没有唯一声明的 owner。α 和 β 占 13 条，就是这次的「拼参数」；γ 是「报错说下一步」的前身，已经在 Run 账本那层收过；δ 说明靶子一直是我们自己写的。

## 2. 为什么这一类会一直出现

1. **「降级」这一步没有 owner。** 从「模型 + 模式 + 参考（带角色）+ 语义参数」到 body，现在有 4 份实现，最后共用 1 份模板渲染（全表见附录 A）：
   - ① 渲染层 `buildArchetypeInputParams`（`archetypeMeta.ts:696`）+ `buildReferenceExtras`（`catalogTaskActions.ts:188`）；
   - ② 主进程 `referenceInputParams` + `projectReferencesOntoBodyKeys`（`taskParams.ts:602–706`，按 body 键名猜「族」）；
   - ③ 引擎 B `projectReferenceUrls` + `PROJECTION_KEYS` + `PARAMETER_ALIASES` + `mirrorApimartReferenceParameterAliases`（`apimartGenerationProvider.ts:249–335`）；
   - ④ Agent 准入把 aspectRatio / durationSec / taskKind 翻成声明参数（`executionContract.ts` 约 201–358、`mcpGenerationVideoResolve.ts:184–205`）。

   ② 在 ① 或 ③ 之后还会再跑一次，而且拿不到 modeId（`modelReferenceSelection` 的返回类型里根本没有 mode，`modelCatalogListing.ts:120–143`）。于是每次出事只能在 ② 里加特例：「对象形状的键跳过」「每族至多一个键」「hasDistinctFlatSource」。这就是 14 天 6 个 fix 的来源。
2. **对拍量的是「用了同一个函数名」，不是「出了同一个 body」。** `engineDifferences.test.ts:94–99` 断言两边源码里都 `includes("applyHeadlessParamDefaults")`。函数名一样，喂进去的东西不一样：一边没有 modeId，一边已经投影过一次，答案就不一样。七项差异表管的是骨架外面那七步，真正分叉的投影被当成了共享骨架。
3. **没有独立靶子。** `generationParity` 和媒体批的 `combineRolesParity` 都是 A 和 B 比，而且只比渲染层那一半，不过主进程投影。官方页写得清清楚楚的约束，没有一条进测试：
   - Seedance 2.0：「`image_urls` and `image_with_roles` cannot be used simultaneously」；
   - Wan 2.7：`image_urls`「Use either this or `image_with_roles`」，而且 1 张就是首帧图生视频；
   - Vidu Q4：只有 1 张图又没写 role，按图生视频处理。

   画布路正好违反这三条，测试全绿。
4. **报错是散文加粗码。** `refuseToModel(GENERATION_ARGUMENT_REFUSAL, "…一段话")` 散在各处。`generation_input_invalid` 一个码装了至少 7 种原因：没默认模型、点名的模型 id 不存在、模式和 taskKind 打架、这个模式没有比例、没有时长、参考超量、参数不在枚举里。面板只能二选一：有 issues 就说字段，没有就说「这个模型不接受这组参数」。画布那边 `classifyGenerationError` 用正则读文本，线上遥测的 `errorType` 也是从正则来的（`taskApi.ts:157`）。
5. **三条铁律都落空：**
   - **⑩ 说的=摆的**：用户说「16:9」，Agent 收到「Leave aspectRatio out」，可火山 Seedream 4.5 / 5.0 的 `size` 枚举里明明有 `2560x1440`。基线里这类错误调用 15 次：
     - **12 次是火山 Seedream。** 原因找到了：比例只有一个 owner `electron/shared/aspectRatioValue.ts`（10-05 起），它只认 `1280:720` 这种冒号写法的像素串，不认 `2560x1440` 这种 x 写法（第 67 行注释自己写着），所以 `size` 不算比例控件。
     - 2 次是火山 Seedance 2.5 的 `ratio`，原因没核。
     - 1 次是 HappyHorse 图生视频，它的画幅跟着首帧走，拒是对的。
   - **⑪ 能选到**：Agent 工具面的 taskKind / modeId / aspectRatio 不是从档案清单生成的，是另一层映射。同一个模式「edit」，Agent 准入说它是 text_to_video，引擎 B 的 `MODE_TO_TASK_KIND` 说 video_edit 是 image_to_video：同一件事两个答案。
   - **⑫ 点了=以为的**：创作者在 Wan 2.7 选「参考生 1 张」，请求体同时带 `image_urls:[A]` 和 `image_with_roles`。按官方页，`image_urls` 1 张就是首帧模式。10-24 那次真付费的 Seedance 2.0 首尾帧请求体里，同一张图出现了 4 次（`imageUrlOccurrences: 4`），出了片，但按哪个字段生成的没人知道。

## 3. 不改结构的话，接下来会冒出什么

| 预测 | 怎么验证 |
|---|---|
| P1 只要渲染层把参考放进对象形状的槽，同时 body 又声明了扁平图片键，就会多出一份 `image_urls`，不止已知的 4 格。所有 `combineSlotsInto` 是 `*_with_roles` 的内置模式都有。 | 媒体批探针（`媒体线的双键探针 probe-source.ts（协调本机，不入库）`）扩到全部内置模型 × 模式，数「同一 URL 出现在 ≥2 个键」的格子。预计 > 4。 |
| P2 #1435 只修了「说不清」，没修「拼不对」。在 main 上重跑 39 题：「contract rejects」和 TypeBox 不点名的报错归零，但「no frame-ratio choice」（15 次）和「taskKind 与 modeId 打架」（10 次）的数量基本不变。 | `node tests/ux/agent-param-eval-real-model.walk.mjs`，再跑 `python3 -I 复盘线的逐站分类脚本 eval_station.py（协调本机，不入库）`（把路径换成新产物）。要花 DeepSeek 额度，属于评测花费。 |
| P3 claude-fable-5.1 的 402「预扣 $40.05」不是用户余额的问题，是我们没发 max_tokens：网关按模型最大输出 100 万 token × $40/M 预扣，正好 $40，再加约 $0.048 输入。 | 免费：`curl -s 'https://api.apimart.ai/api/pricing/model?model=claude-fable-5.1'` 得到 output 40、`max_output_tokens: 1000000`，已核过；`electron/agentLane/laneModelProvider.mts:231–233` 显示 openai 协议在没配上限时不发 max_tokens。最后一步要付费核：带 `max_tokens: 16384` 发 1 次，预计不再 402。只能协调会话做。 |

## 4. 靶子独立性检查

- 现有尺子全是我们自己的：A 对 B、渲染层对引擎 B、请求体对我们写的 mock（10-16 那次就是错在 mock）。两边一起错的时候永远是绿的，复现 3 就是这样。
- 新靶子从官方来。字段名、角色枚举、互斥对、张数上限，由脚本从官方页面（已下载到 `复盘线下载的官方页副本（协调本机，不入库）`）抽出来，有 Key 时再加 `GET /v1/models?expand=parameters` 的快照。每条带出处 URL 和抓取日期，人工复核一遍，绝不从我们的声明里抄。复核的人不能是写声明的那条线。
- 「修对了反而掉分」的先例：10-31 #1402 的夹具把真实形状改绿了，藏住了「升级后模型坏掉」（memory ci-red-before-fixture）。所以靶子红了先问「真实用户有没有这种形状」，不改靶子。
- 列表里有不等于能调用：deepseek-v3.2 在列表里却 404；协调 11-08 实测 deepseek-v3.1-terminus 返回 503 `model_not_found`。类测试证明不了「能调用」，这一层要靠真调用封印，见 plan S10。

## 5. P0：哪些是我们独有的，现成方案有哪些

| 现成方案 | 出处 | 能做 | 做不了（我们独有的） |
|---|---|---|---|
| JSON Schema 2020-12：`if/then/else`、`dependentRequired`、`dependentSchemas`、`oneOf`、`not`、`enum`、`minimum/maximum`、`minItems/maxItems`、`additionalProperties:false` | https://json-schema.org/draft/2020-12/json-schema-validation 、https://json-schema.org/draft/2020-12/json-schema-core | 每个（模型, 模式）一份 schema：哪些字段、枚举、范围、张数，互斥用 `not:{required:["image_urls","image_with_roles"]}`，按模式的条件用 `if modeId … then …` | 降级本身：角色放进哪个键、比例怎么换成像素、默认值怎么挑。跨键的「同一 URL 只出现一次」也表达不了，要一条自写检查。 |
| 面向模型的工具 schema 限制 | OpenAI Structured Outputs：「Composition: `allOf`, `not`, `dependentRequired`, `dependentSchemas`, `if`, `then`, `else`」不支持；「`additionalProperties: false` must always be set」 https://developers.openai.com/api/docs/guides/structured-outputs | 说明按模式的条件 schema 不能塞进给模型的工具 schema（用户 10-29：按通用 OpenAI 协议） | 所以工具面要保持扁平：modeId 加语义字段。按模式的条件放在服务端校验，再把合法值回给模型。 |
| Ajv（含 standalone 代码生成）/ TypeBox `Value.Errors` / Zod | https://ajv.js.org/ ；仓里已有官方 2020-12 元 schema 的编译产物 `electron/capabilityCore/modelSchemaMetaValidator.generated.cjs`；`toolInputIssues.ts` 已经把 TypeBox / Zod / 准入三种来源收成一份 issue 清单 | 编译校验，产出 `instancePath + keyword + params`（allowedValues、limit、additionalProperty），可以直接映射成 `ToolInputIssueKind` | 领域拒收的措辞和下一步（「换模式」「去掉 durationSec」） |
| RFC 9457 Problem Details：`type`、`title`、`status`、`detail`、`instance` 加扩展成员（例子里有 `errors[]` 带 `pointer`） | https://www.rfc-editor.org/rfc/rfc9457 | 一个问题形状：闭合 `type` 登记表 + 字段 pointer + 扩展（allowed、next、charged）。只借形状，不走 HTTP 媒体类型。 | 问题类型词表和「下一步」动作词表是我们的 |
| APIMart `GET /v1/models?expand=category\|parameters`，单模型 `GET /v1/models/{id}/schema` | https://docs.apimart.ai/en/api-reference/texts/models/list.md | 每个模型一份 JSON Schema 2020-12（必填、枚举、范围、默认值），只覆盖图片和视频。单模型版还带幂等和响应契约说明。可以生成或核对内置声明的字段、枚举、范围。 | 官方自己说「best-effort contract; server-side validation is authoritative」，而且 `additionalProperties: true`。互斥只写在正文里（Seedance 2.0、Wan 2.7 页）。模式语义（哪个键是首帧）不在 schema 里。它是单家接口，只能离线喂给声明，不能进运行时分支。 |
| OpenAI 错误对象 `{error:{message,type,param,code}}`；APIMart 文档形状 `{error:{code:<HTTP 数字>,message,type}}`；实测网关码是字符串（`insufficient_user_quota`、`model_not_found`），措辞和 one-api / new-api 一族一致（推断，没逐行核它的源码） | https://docs.apimart.ai/en/api-reference/tasks/status.md ；协调 11-08 文字大脑一问一个的回执（本机，不入库；结果表见 docs/plan/2026-11-07-catalog-audio-text.md「一问一个结果」） 第 45、66 行附近 | 上游归一：HTTP 码 + `type` + 字符串 `code` + `param` → 闭合码 | 码 → 创作者下一步 |
| 先例：Vercel AI SDK 图片调用 | https://ai-sdk.dev/docs/ai-sdk-core/image-generation ：「Depending on the model, you can either specify the size or the aspect ratio」，不支持的参数进 `warnings` | 说明「一份调用 IR + 每家一个降级 + 结构化告警」是业内常规形状 | 不接这个依赖（已删，现役是 pi）。只借形状。 |

**用户问的「收口老收不住，业内有没有模式」。** 有，而且是老模式，叫编译器管线：

- 意图 IR → 一次 parse（parse, don't validate）→ 一个纯函数降级 → 线上格式；
- 一份 schema 当事实源，表单、校验、工具面都从它生成（schema-first）；
- 让非法状态写不出来：modeId 在的时候，taskKind 不该是第二份可以写错的事实；
- 外部错误进门先过一层翻译层（防腐层），变成我们的闭合问题码；
- 测试拿外部真相做靶子（契约测试），不拿另一条自家路；
- 删旧路用绞杀者模式：先让两条路都调新 owner，再删掉多出来的那条。

这套能推广成全局的做法。凡是「两条路都要用的概念」，都给它：

1. 一份声明；
2. 一个纯函数 owner；
3. 一个问题形状；
4. 一条对外部真相的类测试；
5. 一条门岗，按「这项工作的产物由谁写」数入口，而不是按符号名数。

`door-map` 现在按符号名数，数出来 `projectReferencesOntoBodyKeys` 只有 1 扇门，看起来很好；可同一件工作有 4 个不同名字的函数在做，它数不到。这一点交给全局普查线。

## 6. 三条路对比 + 推荐

| 选项 | 做什么 | 代价 | 风险 | 推荐 |
|---|---|---|---|---|
| 沿原方向修 | 复现 1：两处补 modeId。复现 2：角色表搬到 shared（媒体批已做）。复现 3：`archetypeReferenceUrlsByFamily` 认 `{url, role}`。再加对拍。 | 小，3 个 PR，几天 | 改的正是 6-fix 热点 `taskParams.ts` 的第 7、8 刀。下一个模式、下一个模型还会再开口。A 对 B 的对拍还是抓不到「两边一起错」。Agent 那边 25 次比例 / 模式错误一个都不解决。 | 否 |
| **换一种做法** | **一份声明、一个降级函数、一个问题形状。** ① 每个（模型, 模式）的声明 = JSON Schema 2020-12（字段、枚举、范围、张数、互斥）+ 槽位表（角色 → body 键）。从档案和目录映射合成，内置的用 APIMart 参数清单离线核对。② `electron/shared/generationLowering/` 里一个纯同步函数：意图 → body 参数 + issues，两台引擎和 Agent 准入都只调它，渲染层只送意图。③ 一个编译校验器，用 Ajv 或 TypeBox，按声明编译。④ 一个 `GenerationProblem` 形状，闭合码 + pointer + allowed + next + charged。发前由校验器产出，发后由上游归一产出。lane 信封、画布 narrate、遥测都只读码。 | 中，6 片，2 片在 0.25 之后。要删的见 plan。 | 改的是所有视频模型的付费请求体。兜底：官方字段类测试（S0）先红后绿，全部格子逐字节比对前后差异，再加一次免费走查、一条真付费样本。 | **是** |
| 删掉 | 删引擎 B，Run 路像画布那样走 `runTask`（`canvasTransportProvider.ts` 已经是现成的壳）。要保住的结果：Run 门的授权封口、预算账本、同步 transform 规则，这些都在门上，不在传输里。 | 中 | 只删 B 不建降级函数，引擎 A 吃的是渲染层预先投影好的 extras。Run 路的输入是合同（角色词、语义参数），照样要有人把它降级成槽位。双投影只是换了个地方。复现 3 本来就在 A 上。 | 作为「换一种做法」的最后一片（S8，0.26），先建降级函数再删 |

**「七项引擎差异」逐条判**。两条路现在都在 Run 门后面（画布是 `canvas:<vendor>` provider，`canvasShotRunApi.ts:137`），七项里没有一项还剩领域理由要不同：

| # | 差异 | 判 | 理由 |
|---|---|---|---|
| 1 | multipart 上传（B 拒） | 统一 | 传输问题，不是领域问题。S8 删 B 的传输后自然只剩一份。 |
| 2 | antigravity 预检（process op，B 拒） | 统一 | 同上 |
| 3 | 自定义调用脚本（表上写 shared，实际 B 在 `apimartGenerationProvider.ts:290` 拒） | 统一，并改正表述 | 表上写的「shared」是假的：只是符号出现过 |
| 4 | 图生图空参考护栏（符号共享，A 传 `modelModeBodies`，B 不传，见 `runtime.ts:302` 对 `provider:306`） | 删 | 变成声明里的 `minItems`，由同一个校验器判；一个函数两种输入就是两个答案 |
| 5 | 结果缓存（A 指纹缓存 / B 授权信封 + 账本） | 统一到 Run 门账本 | 按镜头的花钱语义是领域，但只该有一个「这次算不算重复」。付费提交删 A 的指纹缓存，不走 Run 的调用方（本地、文本）另核。 |
| 6 | chat-image 失败回落（A 换端点 / B 封死） | 删 | 这是 P1 禁止的 fallback；授权过的请求换端点，等于发一个用户没批过的请求。端点在声明里写对。 |
| 7 | 异步 request_transform（A 预飞 / B 直接拒） | 统一，取 B 的严规则 | 先核有没有声明还在用异步 transform |

真正分叉的地方（参考投影、模式到传输种类、参数别名）不在七项里，所以七项表收完也解决不了这次的问题。

### 两半是不是一件事

是一件事，分两次读同一份声明。拼参数是照声明把意图降级成 body；报错是照同一份声明找出意图哪里不合法，用闭合码说出来。今天两半各有 4–5 份实现，所以 Agent 被拒的理由和画布真正发出去的东西不对得上：Agent 被告知「这个模式没有比例」，画布却给同一个模型摆了比例选择器。

**拼参数：现在 4 份（加 1 份共用的模板渲染），该收成 1 份（加模板渲染）。**

**报错说下一步，现在各方拿到什么：**

| 情形 | Agent 拿到 | 画布拿到 |
|---|---|---|
| 工具形状错 / 参数不在枚举 / 越界（#1435 之后） | 字段路径、合法值或近似键、第 3 次叫停；面板说字段 | 不经过这里 |
| 领域拒收（没默认模型、点名的 id 不存在、模式冲突、没比例 / 没时长、参考超量 `executionContract.ts` 约 350 行） | 一段英文 / 中文散文 + 粗码 `generation_input_invalid`，没有子原因。面板退到「这个模型不接受这组参数，这一步没有执行。」原因不对时这句话也是错的。 | — |
| 发前护栏（`imageEditGuardError`、容量、`validateProfileRequestBeforeSpend`） | B 抛英文 `ApimartGenerationProviderError` | 中文散文 → 正则分类 → narrate，没有字段 |
| 上游 4xx | B：providerAnswer | `pickUpstreamCode`（`jsonUtils.ts:115`）→ 码表只登记了 `model_not_found` 一族（`classifyError.ts:431`），其余按状态码：402 → balance，400 → input |

该在哪一层产出：发前问题由降级函数加校验器产出；发后问题由上游归一产出，归一在 `vendorFailure` 那一层，按 HTTP 码、`type`、字符串 `code`、`param` 归，不按家写分支。消费方三个：lane 信封（给模型读英文行加 allowed，面板按码出本地话）、画布节点（按码出 narrate，高亮字段）、遥测（只记码）。

**截图（「起草镜头卡 ×2 这一步没做成（generation_input_invalid）」）**：

- 来源：这句话出自 #1435（`cdb2d35e1`）之前的兜底词条 `'这一步没做成（{{code}}）…'`。`cdb2d35e1` 在 main 上，但不在任何发布 tag 里（最新是 v0.24.1），所以用户跑的是 0.24.x。反馈缓存里 10-10（0.23.0）就有一模一样的一条，这句话已经在线上露了 4 周。
- main 上的现状：码不再露出来。但领域拒收没有子原因，面板只能说「这个模型不接受这组参数」。轨迹里 16 次「没有配置可用的图片 / 视频模型」，有 9 次其实是 Agent 点名了一个不存在的 id，比如 `apimart` 配 `doubao-seedream-4-5-251128`、不带日期后缀的 `doubao-seedream-5-0-pro`。原因说错了，Agent 就去改错的地方。
- 修法：每个拒收带闭合子原因，面板按子原因出话，比如「没有这个模型 id，最接近的是 X」。见 plan S1。

**402 `insufficient_user_quota`（协调 11-08 实测 claude-fable-5.1）**：

- **归类**：上游账户类。新闭合码 `provider_balance_insufficient`，子类「预扣超过余额」。它不是参数错，也不是限流，Agent 和画布都不该自动重试。上游码表要登记 `insufficient_user_quota`，现在只有 `model_not_found` 一族；`vendorFailure.ts:75` 已经把 402 归到 balance，只是没有数字、没有下一步。
- **先修我们自己（P3）**：这 $40.05 预扣是因为我们没发 max_tokens，网关按 100 万输出 token 预扣，见 §3 P3。内置文本模型要始终发声明里的输出上限（从价目接口的 `limits.max_output_tokens` 和我们的默认取较小值）。修完以后，余额 $2.76 的人能正常用这个模型。
- **界面该说**：「APIMart 余额 $2.76，这个模型这次要先预扣 $40.05（按最长输出预扣，用完按实际退回）。」两个按钮「去充值」「换模型」，不给「重试」。
- **Agent 该说**：失败码 `provider_balance_insufficient`，事实带上 balance 和 required。给模型的正文是：「Do not retry. The account cannot cover this model's pre-hold. Tell the user both numbers; offer top-up or a cheaper model from list_models.」面板显示同一句本地话，不露码。
- **下一步**：①我们这边带 max_tokens；②选大脑或模型时做一次免费预检：用价目接口（不要 Key）算预扣，再拿 `GET /v1/balance`（`apimartVendor.ts:52` 已经在调，探 Key 用）比余额，不够就在选择器上提示；③选择器提示进 0.26。
- **503 `model_not_found`（deepseek-v3.1-terminus）**：已经归到 `model-unavailable-upstream`。它说明「列表里有」不能当「能调用」，要有真调用封印。

### APIMart 接口放哪一站

| 接口（文档） | 我们现在用没用 | 放进哪一站，替掉什么 |
|---|---|---|
| `GET /v1/models?expand=category\|parameters`、`/v1/models/{id}/schema`（https://docs.apimart.ai/en/api-reference/texts/models/list.md ） | 只在离线对账文本模型时用 `expand=category&category=chat`（`electron/catalog/apimartTexts.ts:18,50`）。参数清单没用。 | 声明生成 / 核对（离线，要 Key，由协调跑）：快照进仓，内置声明的字段、枚举、范围、默认值逐项和它比，不一致 CI 红。替掉手抄的 body 字段表和 `PARAMETER_ALIASES`。互斥和模式语义仍然从官方正文人工整理，带 URL。 |
| `GET /v1/tasks/{id}?language=`（https://docs.apimart.ai/en/api-reference/tasks/status.md ）：status、progress、`cost` / `credits_cost`、`error{code,message,type}`、10 种语言，只影响 message | 轮询在用，内置映射 `/v1/tasks/{{providerMeta.task_id}}`。没带 language。实扣读的是 `credits_cost`，走 `electron/vendor/cost.ts:18` 那张按家的表。 | 状态和错误站：映射里声明 `language` 跟界面语言走（zh/en）；cost 路径写进 mapping 的 response_mapping，删掉 `cost.ts` 里的按家表项；`error.type` 进上游归一。 |
| `POST /v1/tasks/batch` | 文档里没查到：llms.txt 索引、中英文任务状态页、搜索都没有 | 不用。哪天出现了，它只是查询站的优化，不属于这次重构。 |
| 公开价目 `GET /api/pricing/model?model=`（不要 Key，https://docs.apimart.ai/en/api-reference/texts/qwen3.8-max/pricing.md ） | 没用 | 预扣预检加文本 max_tokens 上限（`limits.max_output_tokens`）。只读 `data.pricing.effective_rates`。 |
| `Idempotency-Key`（Muse 页：「Strongly recommended」，409 `idempotency_in_progress / key_reused / result_indeterminate`） | 从来没发过：`vendorHttp.ts:193` 只有 `retryOnNotWritten` 时才带，没有调用方设它；B 的 `submitIdempotency: false`（`apimartGenerationProvider.ts:670`）。Seedance 2.0、Wan 2.7、gpt-image-2 页没写支持。 | 提交站：按 mapping 声明 `submit.idempotency`，来源是单模型 schema。Run 门已经有 `providerIdempotencyKey`，接上之后 `submission_unknown` 可以同键重投而不重扣。409 三个码进闭合码。0.26，一个模型一个模型核。 |
| `X-APIMart-Response-Version: 2026-07-27`（Muse 页：带它返回 202 + `data.id` + `data.poll_url`，不带返回 200 + `data[0].task_id`） | 没用，按 `data[0].task_id` 解析（`apimartGenerationProvider.ts:609–615`、内置 mapping） | 暂不采用。Seedance、Wan、gpt-image-2 页上都没有这个头，加了反而要按模型分两种解析。哪天某个模型要求它，就在那条 mapping 的 response_mapping 里声明。 |
| 错误形状：文档写 `{error:{code:<int>,message,type}}`；实测网关层是字符串码（`insufficient_user_quota`，带 request id）；任务失败是 200 + `data.status:"failed"` + `data.error` | `pickUpstreamCode` 读字符串码；码表只有 `model_not_found` 一族 | 上游归一站：数字 code 当 HTTP 码用，字符串 code 查闭合表，`type` 兜底（`payment_required`、`rate_limit_error`、`invalid_request_error`），有 `param` 就带上。 |

## 7. 用户要权衡的核心

0.25 要不要冒「所有视频模型的付费请求体都重排一次」的风险，换来「参考图怎么放、参数错了怎么说」从此只有一个答案。不动，0.25 更稳，但创作者继续发「官方说不能同时出现」的请求，花钱买一个不确定按哪个字段出的结果。

---

## 它占错误率多少（用数说）

**Agent 基线**：39 题，DeepSeek V4 Flash，sourceSha `b08df9ed6`。它比 #1435（`f40fb22ce` 和 `cdb2d35e1`）早 5 分钟，所以是修前的数。产物在协调本机的评测目录（不入库），逐条分类用复盘线的 eval_station.py。

- 可判 31 题，没做对 12 题。逐题判主因：
  - 拼参数 3 题：P04 Seedream 1:1 没翻成尺寸；P21 首尾帧素材绑不上，`referenceBindings` 被形状拒、最后 0 参考；P22 视频参考、模式和 taskKind 冲突、比例、时长连环拒，0 镜。
  - 报错没说清 3 题：P06 6 次「contract rejects」不点名；P07 点名的 id 不存在却被说成「没配置默认模型」；P30 4 次「contract rejects」。
  - 模型自己理解错 5 题：P14、P25 改写了逐字提示词，P15、P16、P18 镜头数不对。其中 P16、P18 的重试超标，也有拼参数和报错的份。
  - 不在本链 1 题：P39 undo。
  - **本链占没做对题的 6/12，P16、P18 算进去是 8/12。**
- 不可判 8 题（P23、P24、P26、P29、P31、P32、P33、P35）：起始态没搭起来，夹具里的草稿不在。这是量具本身的缺口，S0b 要先补，否则修后的数也不可信。
- 101 次错误调用，去掉 19 次熔断（那是后果，不是一站），剩 82 次：
  - **拼参数 32 次（39%）**：比例没翻成尺寸 15（12 次是 x 写法的像素串没被认出，见 §2 ⑩），taskKind 和 modeId 打架 10（omni 5、firstlast 2、first 1、ref 1、edit 1，方向两边都有：Agent 按语义写 taskKind，被拿去和传输桶比），模式没时长 2，anchor 必须是图 2，模型不能做这个任务 1，尺寸不在枚举 1，缺 taskKind 1；
  - **报错没说清 33 次（40%）**：TypeBox 不点名 12，「contract rejects」12，点名的 id 不存在却说「没配置默认模型」9；
  - **起始态 7 次（9%）**：没默认模型，镜头又没点名；
  - 其它 10 次（12%）：正确拦下的时长越界 3，用户拒绝 2，look_at_media 3，undo 1，操作对象不对 1。
  - **本链合计 65/82 = 79%。** #1435 预计消掉其中 24 次（TypeBox 和 contract rejects），见 P2，还没重跑核实。剩下 41 次要靠 S1、S2、S3。

**画布线上**：遥测缓存，2026-09-21 至 11-06，排除自动化启动。

- `generation.completed` 共 3739 次：失败 1550，取消 354，成功 1835。去掉取消，失败率 46%。
- 带 `errorType` 的失败 1174 次：
  - `input` 238 次，占 20.3%（0.23 是 20%，0.24 是 19%，没变）；
  - `unknown` 422 次，占 35.9%。
- `input` 的意思是上游 400/422，或者我们发前的参数拒收被正则归到这一类。
- 粗算：每 100 次画布生成里，大约 8 次死在「参数不被接受」。另有约 15 次是 unknown，分不清是不是参数问题。
- 缺量具：`errorType` 来自正则，分不出子原因。这些也是事件条数，没按会话去重。

**Agent 线上：没有量具。** `agent.tool.failed`（`7bc8d14f2`）只在 main 上，不在任何发布 tag 里，缓存的事件里一条都没有。就算 0.25 发出去，它的 `failureCode` 也只到粗码 `generation_input_invalid`。补量具的是 S1：加 `reason` 格。

**用户反馈**：缓存 32 条，09-27 至 11-05。参数或请求形状这一类 7 条，占 22%。

- 画布 4 条：
  - 09-28「Model not exist」；
  - 09-28 wan3.0-video-prime 参考发不出；
  - 10-10 `image_urls[0]` URL 带空格；
  - 10-16「model … does not support this api」。
- Agent 3 条：
  - 10-10「这一步没做成（generation_input_invalid）」，和这次截图同一句；
  - 10-14「参数不合法」；
  - 10-29「edits.0.value.window：缺少必填字段」。

---

## 附录 A：全链盘点（main `745b3c5b4`）

| 站 | 画布路（引擎 A） | Run 路（Agent / MCP，引擎 B） | owner 今天是谁 |
|---|---|---|---|
| 1 意图 | 节点控件 `parameterControlModel.ts`、`referenceWrites.ts` | `draft_shots` 工具 schema（TypeBox）→ `laneToolInputBoundary.mts` 形状校验 | 两份 |
| 2 身份 / 模式 | 节点 meta（vendor、model、archetype、modeId） | `semanticCandidateFromParams`（`semanticGenerationCandidate.ts:390–420`）、`videoModeForPlan`（`mcpGenerationVideoResolve.ts:184–205`，模式 → 传输由 `modeTransportFor` 决定） | 两份；B 另有 `MODE_TO_TASK_KIND`（`apimartGenerationProvider.ts:105–128`），第三份 |
| 3 参数校验 | 控件约束 `nodeCrossFieldConstraints.ts` | `compileParameters` / `admitPlanCandidate`（`executionContract.ts` 约 201–358），schema 来自 `modelAdmissionSchema.ts` | 两份 |
| 4 参考放置 / 降级 | 渲染层 `buildCatalogTaskRequest`（`catalogTaskActions.ts:308`）→ `buildArchetypeInputParams`（`archetypeMeta.ts:696`）+ `buildReferenceExtras`（`:188`） | `projectionRequest`（`apimartGenerationProvider.ts:249–335`）：`referenceCombineChannelFor:256`、`projectReferenceUrls:262`、`normalizeParameters:263`、`mirrorApimartReferenceParameterAliases:264` | 两份 |
| 5 走哪条 mapping | `findTaskMapping(…, modeId)`（`runtime.ts:294`） | `taskKindForMode`（`:152`），modeId 在 taskKind 里丢了 | 两份 |
| 6 共用投影 | `applyHeadlessParamDefaults`（`runtime.ts:297`）→ `projectReferencesOntoBodyKeys`（`taskParams.ts:602–706`），`modelReferenceSelection(…, kind)`（`runtime.ts:296`，不带模式） | 同一个函数（`apimartGenerationProvider.ts:271`），同样不带模式 | 一个函数，两种输入 |
| 7 发前护栏 | `imageEditGuardError(…, modelModeBodies)`（`runtime.ts:302`）、`validateProfileRequestBeforeSpend`（`:312`）、指纹缓存（`:329`） | `imageEditGuardError`（`:306`，不带 modeBodies）、`assertReferenceParameters` / `assertReferencesReachBody`（`:333`） | 两份 |
| 8 模板渲染 | `taskTemplateParams`（`taskParams.ts:166–243`）→ `buildProfileHttpRequest`（`runtime.ts:226`）→ `buildHttpRequest`（`requestPipeline.ts:430`）→ transform（异步） | 同上（`apimartGenerationProvider.ts:316`），transform 只许同步 | 一份（好） |
| 9 发送 | `vendorHttp`；Idempotency-Key 实际从来不发（`vendorHttp.ts:193`） | 同 | 一份 |
| 10 回执 / 查询 | `buildProfileTaskResult`（`runtime.ts:234–276`）、`taskFailureMessageFromResponse`、`cost.ts:18` | `send`（`:474–504`）→ `CatalogGenerationProviderError`、task id（`:609–615`）、query（`:533–562`） | 两份 |
| 11 报错 | 抛文本 → `classifyGenerationError`（`classifyError.ts`，11 扇门）→ narrate；遥测 `failureTypeOf`（`taskApi.ts:157`）用正则 | `refuseToModel` / `ContractCompilationError` → `safeFailure`（`generationTransportAdapters.ts:128–290`）→ `laneToolFailureEnvelope.ts` → `laneToolFailureText.ts` | 两份 |

还有一个容易漏的情况：Agent 起草的镜头落到画布上，用户在画布点生成，走的是画布路；Agent 自己 generate 走的是 Run 路。同一个镜头，谁按按钮就决定走哪台引擎。

**door-map**（3103 文件）：

| 符号 | 入口数 |
|---|---|
| `applyHeadlessParamDefaults` | 2（`runtime.ts:297`、`apimartGenerationProvider.ts:271`） |
| `projectReferencesOntoBodyKeys` | 1（`taskParams.ts:162`） |
| `modelReferenceSelection` | 3（`runtime.ts:296`、`apimartGenerationProvider.ts:271`、`modelCatalogListing.ts:193`） |
| `buildProfileHttpRequest` | 9 扇 / 11 处（含音频 2、multipart 1、提交 1、物化读 2） |
| `classifyGenerationError` | 11 扇 / 13 处 |
| `imageEditGuardError` | 2（A、B 各 1） |
| `taskFailureMessageFromResponse` | 3（`runtime.ts`、`productionGenerationSubmission.ts`、`taskResultQuery.ts`） |
| `referenceInputParams`、`projectReferenceUrls`、`buildArchetypeInputParams`、`compileParameters`、`normalizeParameters` | 各 1 |

按符号数，每个都只有 1–2 扇门，看着很干净；问题在「同一件工作，4 个名字」。

## 特征测试清单（动结构前先锁住）

| 已有 / 要补 | 路径 | 锁住什么 |
|---|---|---|
| 已有 | `electron/parity/engineDifferences.test.ts` | 七项差异现状。它只断言符号出现，S8 时要改成「同一意图，同一 body」 |
| 已有 | `electron/parity/generationParity.matrix.test.ts`、`referenceChannelByMode.test.ts`、`known-splits.json` | A 对 B 已知分叉 |
| 已有（还没进 main） | 媒体批 `electron/parity/combineRolesParity.test.ts`（分支 `fix/catalog-media-docs-align`），`KNOWN_RUN_PATH_CAPACITY_GAP` 三格 = 复现 1 | 渲染层对 B 的角色和容量 |
| 已有 | 双键探针 `媒体线的双键探针 probe-source.ts（协调本机，不入库）`（四格） | 复现 3 |
| **要补，S0** | `electron/parity/officialWire.matrix.test.ts` 加靶子 `tests/fixtures/vendor-official/apimart/*.json` | 每个内置模型 × 每个模式 × 两条路 × 参考集 {0, 1, 每槽上限}，真渲染 body（抓 fetch），和官方字段逐项比。每个 URL 只能在一个键里出现；互斥对不能同时出现；角色在官方枚举里；张数不超过官方上限；两条路同一意图出同一 body。复现 1、2、3 进已知红并写明原因。 |
| **要补，S0b** | 39 题夹具起始态 | 让 8 道不可判的题能判 |

---

## 和原方案对照

这一节在上面全部写完以后才读原方案。上面的结论没有因为读了原方案而改，只改了一处事实：§2 ⑩ 的比例原因，是读到 `semanticAspectRatio.ts` 以后自己核的。

**类根因汇总（`class_roots.txt`，16 份记录各自的类根因）**

- 它说什么：每份都是「X 没有唯一 owner」，X 是 13 件不同的事，比如型号名、谁归认证、参考在不在用、URL 写法、身份投影、尺寸域、成没成交、发没发出、查询合同。
- 判：**每一份都同意，但合起来才是根。**
- 为什么：
  - 每次修都给一件事实补一个 owner，局部是对的。
  - 可这些事实都属于同一个请求，两条路仍然各自组装。修好一件，下一件又从另一条路漏出来。
  - 10-16「型号名散在五处」和 10-22「没有一条测试把界面在用和真请求体放进同一个断言」，说的就是本篇 §2-1 和 §2-3。

**10-27 first-gate 的类根因**

- 它说什么：各闸门手搓身份，所以改成都读 `modelReferenceSelection` 这一个投影。
- 判：**不同意把它当单一来源。**
- 为什么：
  - 这个投影的类型里没有 mode（`modelCatalogListing.ts:114–135`），收口收到了一个缺字段的 owner 上。复现 1（按族封顶）就是从它出来的。
  - S3 改成容量只读声明，它只留身份用途。
  - 教训：owner 拿到的输入不全，这个收口就是假的。

**10-04 声明供应商方向检查 §5**

- 它说什么：「同一份目录、两台发动机给同一个答案」是我们自己的双引擎结构问题，没有现成库可接。
- 判：**不同意后半句。**
- 为什么：
  - 确实没有现成库，但有现成的模式：编译器那样「一份中间表示 + 一个降级函数」，删旧路用绞杀者模式。双引擎本身不是领域，领域只是声明。
  - 它当时列过「重写（限一个模块）：就绪派生自引擎 A 的可用性」，没有做。方向和本篇一致，只是范围只到就绪。
  - 它的 §4「矩阵里只有内置家，靶子漏了人群」我同意，本篇再补一条：靶子是我们自己写的。

**P-195（10-29）Plan R**

- 它说什么：
  - 静态 schema + 目录当数据 + 服务端同源编译；
  - 一个判据，多个投影；
  - 目录参数由 ParameterField 生成校验（R5）；
  - 落到兜底码，测试就该红（R9）；
  - 形状层用 TypeBox 结构化错误（N1）。
- 判：**同意。本篇是它往下游的延伸。**
- 为什么：
  - R1 和本篇 §5 的 OpenAI 限制是同一个结论：工具 schema 保持扁平，条件放到服务端。
  - R5 就是 S3 的校验器，R9 就是 S1 的「写不出不带码的拒收」。
- 落地情况：
  - N1 已经由 #1435 合入 main，还没进任何 tag；
  - R5、R9、D2、N4 没做。R-agent-quality-025 §1.1 写的是 0/5，11-07 之后只合了 N1。
- 两处补充：
  1. P-195 停在「编译成 Compiled」，没看编译之后由谁把它变成 body。复现 1、2、3 全在这之后。
  2. 基线里有 10 次「taskKind 和 modeId 打架」。按 P-195 的做法，它们会变成带合法值的拒收，模型下次能改对，但这条拒收本身就不该有：传输桶是内部寻址键。S2 的做法是删掉这份多余的事实，而不是把它解释得更清楚。

**R-agent-draft-fail（10-29）**

- 它说什么：同一个作者意图跨 schema、准入、方案适配、渲染 patch、错误投影，没有一个完整的可执行契约贯穿。
- 判：**同意。同一个根，它看的是起草那一半。**
- 为什么：
  - 它数出起草侧「4 个翻译分支、5 类执行入口」，本篇数的是降级侧「4 份实现」。整条链是：起草 4 个分支 → 准入 → 降级 4 份 → 模板 1 份。
  - 它说的「transport 吞掉细节」，#1435 和 S1 接着收。

**R-agent-quality-025（11-07）**

- 它说什么：11 类失败；§6 只列选项、不做选择；「准入层拒收文本合格，形状层不合格」。
- 判：**大体同意，一处不同意。**
- 同意的部分，逐类对上：
  - 第 6 类「模型不在目录，却被说成没有配置可用视频模型」：本篇量出来是 16 次里 9 次。S1 选它的 6A，改错因并给近似项。
  - 第 8 类「供应商拒了之后的指路」：S4。
  - 第 10 类「内码外露」：就是截图那一问。
  - 第 11 类「没量具」：S0b，加 `reason`。
- 不同意的一处：「准入层文本合格」。
  - 基线里准入层自己把原因说错了 9 次；
  - 还有 10 次 taskKind / mode 冲突，那句话让模型去对齐一个内部寻址键；
  - 所以准入层的毛病不是说不清，而是说的事本身不对。
- 它的 1B「宿主侧静默归一键名」本篇不采用，11-07 也明令不做。S2 的比例换算是按已有 owner 的同档规则换值，判不出就拒，不是静默改键。

**媒体批方向检查（11-07，分支 `fix/catalog-media-docs-align`，还没进 main）**

- 它说什么：角色表搬进共享层，Run 路按槽声明翻成线上角色词；加了 `combineRolesParity` 类测试；A4h（Run 路图片张数按模型取、不按模式）另派一条线修。
- 判：**同意它合入。不同意把 A4h 单独派。**
- 为什么同意合入：它删了一份重复的角色表，是换加删。方向正是 S3 要的「两条路读同一张表」，S3 直接在它上面做。
- 它的局限：类测试拿画布路比 Run 路，两边都是我们的，而且只比角色数组、不比整个 body。所以它抓不到复现 3，那个双键出在画布路自己身上。
- A4h 就是复现 1，怎么排取决于 S3：
  - S3 进 0.25：A4h 并进 S3，做反例 4；
  - S3 挪到 0.26：A4h 作为最小修补先单独进 0.25，两处调用补上 modeId。理由是 Seedance 2.5 / Wan 3.0 首尾帧放两张图会被拒，挡住了用户。

**11-07 Agent 工具入参失败边界（#1435）**

- 它说什么：缺的是「一个入参失败边界」；⑩ ⑫ 不适用；领域准备的拒收是异步的，面板信封没法按入参重推，只有正文和熔断。
- 判：**同意。S1 补的就是它留下的那一半。**
- 为什么：
  - 它把形状校验和契约 parse 收成一个边界，这是对的；领域拒收它明着放在了外面。
  - 面板碰到领域拒收只能退回「这个模型不接受这组参数」，就是因为信封要按入参重推，而领域拒收推不出来。S1 改成抛出时就把问题码写进失败本身，面板不用再推。
  - 它说 ⑩ 不适用，是对入参边界那一段说的。到了降级那一段，⑩ 适用，见 §2-5。

**合起来看**

以前的方案各自给一件事实找 owner，或者给一个边界收口，都没错。但没有一份数过「降级」到底有几份实现，也没有一份拿官方文档当靶子。本篇在它们之上加四样：

1. 官方靶子（S0）；
2. 一个读现有槽位声明的降级函数（S3）；
3. 抛出时就写定的闭合码，领域拒收（S1）和上游失败（S4）都算；
4. 删掉多余的那份事实，也就是拿 taskKind 去比传输桶这一步（S2）。

推翻了两处：10-04 说的「没有现成方案」，10-27 把 `modelReferenceSelection` 当成单一来源。

## 批准

- 用户 2026-11-08 原话：「我觉得这个部分必须要0.25处理好 你觉得呢 我说的不一定对」。协调回：同意。
- 批的范围：§6 推荐的「换一种做法」，0.25 做 S0、S0b、S1、S2、S3、S4。S3 不留「挪到 0.26」的退路：闸过不了就停下来回到这份方向检查重想，不延后。
- S8（删引擎 B 的传输）放 0.26 第一片。理由：S3 之后两条路由同一个降级函数出 body，用户看得到的错参数、双键、说错原因都在 S1–S4 里解决；S8 是把剩下的提交、轮询、结果解析收成一套，发版前重写每条 Agent / MCP 付费提交路，风险大。
- 每片最多 3 轮（实现加修补），超过就停下回到这份方向检查。
- 碰到返修线文件的提交带 `Direction-Check: docs/engineering/direction-checks/2026-11-08-generation-request-chain.md`。
