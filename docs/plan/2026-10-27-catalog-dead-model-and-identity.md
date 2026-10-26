# 设计卡：下架调不通的 deepseek-v3.2；Agent 认得出「模型不存在」；第一道闸用完整模型身份

改动名：目录退役死模型 + Agent 上游失败走统一载荷 + headless 第一闸完整身份
线/负责人：I-catalog-dead-model-and-identity（Mac，Claude）· 分支 `fix/catalog-dead-model-and-identity`
类别：[花钱][长跑（路径推出：`electron/catalog/taskParams.ts` 命中 `task`）][其他：Agent 行为]
复盘：[docs/engineering/direction-checks/2026-10-27-catalog-dead-model-and-identity.md](../engineering/direction-checks/2026-10-27-catalog-dead-model-and-identity.md)（用户 10-27 拍板：三件都照推荐修；雷达 0.24 不加付费探针）

### 功能分类
- [ ] 新界面 / 改交互
- [x] 花钱
- [x] 长跑 / 可打断
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

花钱：C 是发给供应商之前的拒发（超量参考不许出门）。长跑 / 新增功能·性能 / Agent 行为是扫描器按路径推出的下限（`taskParams.ts` 名字里有 task；`electron/agentLane/` 归 Agent），照勾；本次不改时机、不新增交互，对应证据在 PR 正文按「不适用 / 未验证」逐项写理由。

## 三件事一句话

- **B1**：`deepseek-v3.2` 仍在 APIMart 的 `/v1/models` 列表里，但调用确定性 404 `model_not_found`（10-18 付费走查实录，`tests/ux/_agentVideoPaid.mjs:12`）。照 09-06 先例（`af48ff336` 下架 `deepseek-v3.2-think`）：删种子行 + 同提交进 `RETIRED_APIMART_TEXT_MODEL_KEYS` + 存量行走同一条一次性迁移（只落 `unlisted` 旁注与 legacy，**不碰用户的 enabled**）。
- **B2**：Agent 车道（工作区对话 + 单次提问）拿到上游 HTTP 失败时，把**这一次调用**的传输事实按文本任务同一个映射（`modelCallFailure` → `describeAgentError`，即 `NOMI_VENDOR_ERR_B64` 载荷）铸好，挂在 pi 自己的 `AssistantMessage.diagnostics` 上；投影的错误段读它。渲染层一行不改，`classifyGenerationError` 走「源头保留的事实」分支，404 `model_not_found` 落进「模型在上游不可用」。
- **C**：`applyHeadlessParamDefaults` 改收 `modelReferenceSelection(vendorKey, model, taskKind)` 产出的完整身份（与清单、第三闸同一个 helper），删掉只传 `{ archetypeId }` 的缩减对象；两个调用口（引擎 A `runtime.ts`、引擎 B `apimartGenerationProvider.ts`）都改，自写合同声明的上限在第一闸就拒。

## 先查别人（★0）

- `node_modules/@earendil-works/pi-ai/dist/api/openai-codex-responses.js:229`、`pi-messages.js:230` · pi 自己把传输层失败的结构化细节挂在 `AssistantMessage.diagnostics`（`provider_transport_failure` / `pi_messages_response_failure`），`errorMessage` 只留展示串；帧编解码原样带上 `diagnostics`（`utils/assistant-message-frame.js:37`），随转录落盘 · **确认了** B2 的载荷挂点用 pi 的一方槽位，不另加 IPC 字段、不改 lane 契约形状。
- `node_modules/@earendil-works/pi-ai/dist/utils/retry.js:1-40,167-173` · 重试判据是对**整段 `errorMessage`** 跑一条无词边界的正则（`"429"|"500"|"502"|"503"|"504"|"524"|…`，`new RegExp(patterns.join("|"), "i")`）；`utils/overflow.js` 的上下文溢出也读 `errorMessage` · **改了** B2 最初「把标记前缀进 `errorMessage`」的想法：base64 里随机出现的 `500` / `502` 会让一次确定的 404 被重试、白等三轮，所以 `errorMessage` 一个字都不动，载荷只进 `diagnostics`。
- [OpenAI API · Error codes](https://platform.openai.com/docs/guides/error-codes) 与 OpenAI 兼容网关（new-api 一族）的错误信封 `{"error":{"message","type","param","code"}}` · 机器可读的 `code`（`model_not_found`）才是上游自己说的原因，`message` 是给人读的、措辞各家不同 · **确认了** B2 只把上游 `code` 结构化带过边界，由已有的 `UPSTREAM_CODE_KINDS` 码表归类（`src/workbench/observability/classifyError.ts:430`），渲染层不加任何 `model_not_found` 字符串判断。
- [RFC 9457 Problem Details for HTTP APIs](https://www.rfc-editor.org/rfc/rfc9457) · 错误身份走结构化字段（type / status / detail），消费者不解析人读文本 · **确认了** 「结构化载荷在最早拿到事实的那一层铸、下游只读结构」的方向，与 2026-10-21 文本任务迁 pi-ai 时的留证口径（`electron/ai/modelCallFetch.ts` 文件头）一致。
- 先例 `af48ff336`（2026-09-06 下架 `deepseek-v3.2-think`）+ `imagen-4.0-apimart` 先例 + 09-21「种子不碰 enabled」改法（`electron/catalog/seedBuiltins.ts:603-613`） · 删 curated 行与进 RETIRED 清单必须同提交，否则启动时插回来来回抖；存量只落旁注 · **确认了** B1 原样照做，不发明第二种退役方式。
- [JSON Schema · `maxItems`](https://json-schema.org/understanding-json-schema/reference/array#length) / OpenAPI 客户端校验 · 调用方按**同一份**输入声明在发送前校验数组长度，不同入口不各拿一份缩减声明 · **确认了** C 只换身份来源（第一闸改用第三闸、清单同一个 `modelReferenceSelection`），容量判据仍是已有的 `referenceKeyCapacityDeclarationFor` + `assertReferenceCapacity`，不在 `taskParams.ts` 另写自写合同解析。

## ★1 用户怎么用

当创作者在 Agent 面板里用一个服务商已经调不通的模型说话时，我想**看到「这个模型服务商这边取不到」和服务商原话**，以便知道该换模型而不是干等重试；当外部 Agent / MCP 用自写能力合同的模型、带超过合同上限的参考发起生成时，我想**在花钱之前就被拒**，以便不为一张发不进去的图付钱。

步骤：
1. 老装机用户的大脑正选着 DeepSeek V3.2（新装机根本看不到它）。
2. 在 Agent 面板发一句话 → 请求到 APIMart → HTTP 404 `{"error":{"code":"model_not_found",…}}`。
3. 主进程传输层记下这一次的状态码与原话（已抹密），按文本任务同一个映射铸成结构化载荷，挂在这条失败助手消息的 `diagnostics` 上。
4. 投影的错误段文字取这份载荷；面板红字：「这个模型服务商这边取不到：The model deepseek-v3.2 does not exist」（en：「The provider cannot reach this model: …」）。
5. 用户在输入框的模型选择里换一个模型继续（模型设置里那一行写着「供应商清单里暂时没有它」）。
6. headless：自写合同声明 `image_urls` 最多 8 张，调用方给 9 张 → 引擎 A / 引擎 B 第一闸都在出网前拒：「这个模型最多收 8张图片参考。」

**不做**：不加付费 liveness 探针（用户 10-27 拍板）；不换默认大脑；不删容量拒发、不改第三闸；不改渲染层分类器与面板文案；不迁移文本任务 / 编译器自己的留证（它们已经结构化）。**已知坑**：面板错误行只印「原因：原话」，不印 hint（全部错误类别现状如此，不在本卡）；退役判据仍靠人工发现（列表不是 liveness，雷达只做零额度列表发现）。

真实任务：① 老装机、大脑选着 DeepSeek V3.2，在 Agent 面板发一句话（真实上游 404）；② 新装机打开模型设置 / 大脑选择，确认没有 V3.2；③ MCP 调一个自写合同上限 8 的视频模型带 9 张参考。三条都要真账号 / 真上游，本线不花钱：**unverified**（录下来的 404 原文走本机回环重放代替，真调用核对交协调）。

指标（目标 → 信号 → 指标）：
- 主指标（B2）：Agent 车道上游 HTTP 失败里「错误段带结构化载荷」的比例。基线 0（工作区与单次提问两扇门都只交 pi 的展示串）→ 目标 100%。量具：本机回环 `electron/agentLane/laneModelCall.test.ts`（三协议 × 404）+ `tests/agent-runtime/lane-resilience.test.mts` / `lane-single-shot.test.mts`（真 lane / 真单次提问）。真实流量占比：未验证：缺量具（渲染层「认不出」只记日志 `lane-unclassified-failure`，没有可聚合的遥测）。
- 质量指标（B2）：404 `model_not_found` 判成 `model-unavailable-upstream` 的比例，基线 0 → 100%。量具：`src/workbench/ai/lane/laneCommandFailure.test.ts`（喂主进程真产物）。
- 护栏（B2）：pi 的重试 / 溢出判定逐字不变（404 不重试、429 / 5xx 照旧重试、余额 5xx 不重试）。量具：`tests/agent-runtime/lane-resilience.test.mts` G4 / G-12 两组 + 新增的 404 请求数断言。
- 主指标（B1）：新装机目录里「已证实调用必失败、仍可选」的 APIMart 文本模型数，基线 1 → 0。量具：`electron/catalog/seedBuiltins.test.ts`、`electron/catalog/apimartTextMigration.test.ts`。供应商侧真实存活：未验证：缺量具（用户拍板 0.24 不加付费探针）。
- 主指标（C）：带声明上限的自写合同、超量参考在第一闸拒发的调用口比例，基线 0/2 → 2/2。量具：`electron/catalog/taskParams.test.ts`、`electron/runtime.referenceSelection.test.ts`（引擎 A，本机回环计数）、`electron/capabilityCore/apimartGenerationProvider.test.ts`（引擎 B，本机回环计数）。
- 护栏（C）：内置档案的 headless 投影结果逐字不变。量具：`referenceKeyProjectionCensus.test.ts`、`outboundReferenceUrl.matrix.test.ts`、`referenceSentWithinInUse.property.test.ts`、`agnes.test.ts`、`onboardingSweepFixes.test.ts`、`customRelayWireModel.test.ts`、`apimartVideoSharedContracts.test.ts`、`generateParamsE2E.test.ts` 原断言不改。

## ★1b 连带界面

- Agent 面板错误行（`useAgentPanelV4Data.ts:242` → `providerFailureText`）：HTTP 失败从「服务商返回了一个没见过的错误」变成按结构化类别给的那句（404 `model_not_found`：「这个模型服务商这边取不到：<服务商原话>」/ en「The provider cannot reach this model: …」）；429 / 401 / 402 / 5xx 同样按载荷的类别说，不再靠关键词或 pi 的瞬时判定兜。文案全部是已有 i18n 词条，不新增。
- 设计实验室同一函数（`agentPanelV4LabKit.tsx:102`）：同上，夹具里没有 HTTP 失败载荷，画面不变。
- 单次提问的四个消费者（`capabilityApplyHandler` / `runDirectionPlanner` / `runStoryboardPlanner` / `shotVerifyJudge`）：错误 message 从 pi 的 `"404: {…}"` 变成带标记的载荷串；它们都是 catch 后降级或记日志（制作 Run 只记 `needs_attention` 原因码），不给人看原文。
- 模型设置：老装机那一行出现「供应商清单里暂时没有它」，仍是启用状态（用户自己决定停不停）；新装机没有这一行。
- MCP / headless（C）：工具错误正文是「这个模型最多收 8张图片参考。」（引擎 A 原样；引擎 B 不再把它改写成 `catalog mapping defaults are invalid`）。

## ★2 谁说了算

- 「这一次模型调用的上游 HTTP 事实」：唯一记录器 `observeModelFetch`（`electron/ai/modelCallFetch.ts`），一次调用一份；本卡让 provider 装配点（`createNomiProvider`，门 2 扇：`laneHost.mts:191` 工作区、`laneModelCall.mts:34` 单次）对**每一次** `stream` 调用都确保有一份记录器——调用方已经包过的（文本任务 `textTaskRunner.ts:102`、编译器 `compiler.ts:69`）**复用同一份**，不叠第二层（同一份事实存 1 份，日志不记两遍）；单次提问 `laneDesktopRuntime.ts:109` 那层包装此后无人读，删。
- 「失败 → 结构化载荷」：唯一映射 `modelCallFailure`（`electron/ai/runtimeVendorError.ts`）+ 唯一编码 `encodeVendorErrorMessage`（经 `describeAgentError`），与文本任务 IPC 同一份。
- 「载荷挂在哪」：pi 的 `AssistantMessage.diagnostics`，类型常量与读函数住中立层 `electron/shared/agentLane/laneAssistantFault.ts`（浏览器也 import，不依赖 pi 运行时）。
- 「错误段说什么」：唯一生产者 `projectLaneSnapshot`（`electron/shared/agentLane/laneProjection.ts`；`projectSingleShotResponse` 复用它）。渲染层两扇读门（`providerFailureText`）不改。
- 「APIMart 文本种子 / 退役清单 / 存量迁移」：`APIMART_TEXT_MODELS`（读门 2：`seedBuiltins.ts:193`、设计实验室 `01-listing.tsx:19`）、`RETIRED_APIMART_TEXT_MODEL_KEYS`（读门 1：`seedBuiltins.ts:610`），同一文件同一边界。
- 「模型参考身份」：唯一 helper `modelReferenceSelection`（`electron/catalog/modelCatalogListing.ts:111`；门：清单 `:180`、第三闸 `runtime.ts:319`），本卡加两扇：第一闸 `runtime.ts:314`、`apimartGenerationProvider.ts:269`。`applyHeadlessParamDefaults` 写门仍是这 2 扇，入参从「archetypeId + taskKind + vendorKey + modelKey」四个散参数换成这一份身份。
- 不靠「东西不见了」猜意图：没有。退役靠显式清单，失败类别靠上游自己的码。
- 门表证据：`node scripts/door-map.mjs createNomiProvider` / `observeModelFetch` / `modelCallTransport` / `providerFailureText` / `projectLaneSnapshot` / `applyHeadlessParamDefaults` / `modelReferenceSelection` / `APIMART_TEXT_MODELS` / `RETIRED_APIMART_TEXT_MODEL_KEYS`。

## ★3 一致与复用

复用：`observeModelFetch`、`modelCallFailure`、`describeAgentError` / `encodeVendorErrorMessage`、pi `diagnostics`、渲染层 `parseVendorErrorFromMessage` + `classifyGenerationError` + `UPSTREAM_CODE_KINDS`、`modelReferenceSelection`、`referenceKeyCapacityDeclarationFor`、`assertReferenceCapacity`、`applyBuiltinSeeds` 的退役迁移。新增的只有：中立层一个诊断类型常量 + 一个读函数；provider 里一个按调用记录、在终止事件上挂诊断的薄包装；`observeModelFetch` 的「已包过就复用」一条规则；`modelReferenceSelection` 一个「带 taskKind 时类型上必有 taskKind」的重载。没有第二份分类、第二份编码、第二份身份。证据：`git grep -n "NOMI_VENDOR_ERR_B64"`、`git grep -n "modelReferenceSelection("`、`pnpm run check:self-written`（不新增自写登记）。

实现中追加（10-27，卡上没预见到）：provider 住在 pi 的 NodeNext 岛里，岛编译会把 import 到的整张图一起查；`runtimeVendorError` / `agentError` 原来从 `vendor/vendorHttp` 拿错误类与类别表，一引就把整条 HTTP 传输（目录、代理……里的无扩展名动态 import）拖进岛编译、当场红（`pnpm run test:agent-runtime` 7 处 TS2835）。所以把「失败长什么样」那几样（`VendorRequestError`、类别查表、穿 IPC 的编码，逐字不改）搬进轻模块 `electron/shared/vendorFailure.ts`，`vendorHttp` 照旧转出、已有 import 一行不改；岛这一侧（`runtimeVendorError`、`agentError`）直接引轻模块，`runtimeVendorError` 的 `desktopT` 改从 `desktopStrings` 引（`i18n` 会带进 electron）。同一个原因早先让 `logging/diskSafeFailure.ts` 抄过一份类别表——那份留作后续（不在本卡范围）。

## ★4 全状态

- 空 / 加载：不变。
- 成功：不变（成功的调用不挂诊断）。
- 失败 · 上游 HTTP 非 2xx：错误段文字 = 结构化载荷；404 `model_not_found` →「这个模型服务商这边取不到：<原话>」；其余状态码按载荷类别（额度 / 鉴权 / 余额 / 服务端）说；载荷类别是 unknown 且原话认不出 → 仍是「服务商返回了一个没见过的错误」（fail-closed 不变）。
- 失败 · 非 HTTP（200 里 SSE 报错、连不上、看门狗、断流、上下文溢出）：不挂诊断，行为与文案逐字不变。
- 部分成功：一回合里先错后好（pi 重试成功）→ 错误段仍标 recovered，文案不变。
- **取消中**：用户点停 → `aborted`，不挂诊断，不变。
- 过期 / 重开项目：诊断随转录落盘，重开后同一条错误照样分对；本卡之前的旧转录没有诊断 → 仍按原文分（大概率「没见过的错误」），不回填。
- **能力不可用**：模型在上游不可用 → 显示「这个模型服务商这边取不到：<原话>」，下一步：在输入框的模型选择里换一个模型（模型设置里该行带「供应商清单里暂时没有它」）。headless 超量参考 → 出网前拒「这个模型最多收 N 张…参考」，下一步：减到 N 张以内或换槽位更多的模型。文案都是已有 zh / en 词条，不写费用断言。
- 新装机：目录里没有 V3.2；老装机：V3.2 行保留、启用状态保留、带旁注、归 legacy。

## 5 中途表

| 状态 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| B2 · 请求发出、等响应头 | 中止 → aborted，不挂诊断 · 花费同修前（上游没出字不计） · 回执：面板「已停止」 | lane 关闭，未落盘的流丢弃（同修前） · 同修前 · 无 | 连接异常 → thrown，不挂诊断，pi 判瞬时照旧重试 · 同修前 · 面板网络类文案 | 重开后转录里只有落定的消息 · 同修前 · 无 | 每次调用各自一份记录器，事实不串 · 同修前 · 各自错误段 |
| B2 · 已拿到 4xx/5xx、终止事件推出前 | 终止事件已在路上，停止不改变它 · 同修前 · 错误段 | 落盘的是带诊断的消息 · 同修前 · 重开可见 | 不适用（响应已到） | 诊断已随转录落盘 → 重开后同样分对 · 不扣（上游拒了） · 错误段 | 同上，互不影响 |
| C · 第一闸（纯函数、出网前） | 同步执行，无可停窗口 · 不扣（没发） · 拒发错误 | 不适用 · 不扣 · 无 | 不出网，不受影响 · 不扣 · 拒发错误 | 不落任何状态 · 不扣 · 无 | 每次各自拒，不出网 · 不扣 · 每次一条拒发 |
| B1 · 启动播种迁移 | 不适用（启动期同步） | 迁移只在 `unlisted === undefined` 时写一次 · 无 · 无 | 不出网 | 幂等：第二次启动不再改（测试钉住） · 无 · 无 | 不适用 |

## 6 外部数据与失败

- APIMart / OpenAI 兼容中转的错误体：规范 [OpenAI error codes](https://platform.openai.com/docs/guides/error-codes)；偏差：中转可能不给 `code`、或给数字码 → `pickUpstreamCode` 取不到时载荷只有状态码与原话，按状态码类别说（404 落 unknown 类别时仍可能被 `MODEL_UNAVAILABLE_WORDS` 从原话认出「does not exist」）。
- Anthropic / Responses 协议的错误体：形状不同，传输层照录正文，`pickUpstreamCode` 认 `error.type` 一类键；认不出码就按状态码。
- 正文回显密钥：记录时已按「这次真正发出去的秘密」抹掉（`observeModelFetch` 的 redact），载荷只带 ≤256 字原话、去查询串地址；pi 的 `errorMessage` 本来就原样落盘整段正文，本卡不新增泄漏类别（trace / 遥测只取闭合类别，不读 `diagnostics`）。
- 正文超长：按 2000 字截断（既有）。非 JSON 正文：原话取清洗后的前 300 字（既有 `upstreamMessageFromBody`）。
- 自写能力合同（C）：用户写的合同坏了 → `resolveArchetypeForModel` 解不出，退回键形状推断（与第三闸、清单同一个结论，修前修后一致）。
- 未知失败不甩锅用户的 key：载荷类别 unknown 时文案是「服务商返回了一个没见过的错误」，不说 key 无效。

## ★7 性能

不适用：纯 bug 修复，不新增用户操作。代价只在失败路径上多建一个诊断对象；成功路径多了一层流事件转交（每个事件一次 `push`，与看门狗那层同量级）和传输层的响应体包装（文本任务已在用同一包装）。不登记新场景。

## 8 真实条件

- Windows：unverified（本线在 Mac）。英文界面：文案全是已有 en 词条，测试用 en 表断言过拼法（`laneCommandFailure.test.ts` 既有用例）。最小窗口 / 键盘：不适用（界面不变）。
- 真规模 / 干净安装：B1 用空目录 `applyBuiltinSeeds` 跑新装机，用存量目录跑老装机。
- 真付费：**unverified**——真实 APIMart 404 只用录下来的原文本机重放；真调用核对交协调（用户拍板 0.24 不加付费探针）。

## 拍板图清单

不适用：pure-bugfix（不改布局、元素、文案；只修错误段按什么事实取词、目录少一行、发送前多一次拒发）。

## ★9 验收与回滚

**验收清单（动手前列全，验收线只核这份）**

B1
1. 新装机：`applyBuiltinSeeds(空目录)` 里没有 `apimart/deepseek-v3.2`；`deepseek-v4-pro`、`deepseek-v4-flash`、`deepseek-v3.1-terminus`、`gemini-3.5-flash` 仍在、`enabled`。（`seedBuiltins.test.ts`，翻转特征测试「现状：deepseek-v3.2 仍在可选目录里」）
2. 老装机：存量 `apimart/deepseek-v3.2`（`enabled: true`）播种后 → `enabled: true`、`unlisted: true`、`meta.catalogLifecycle: "legacy"`，其余 meta 原样；同族 `deepseek-v3.1-terminus` 不被连坐；别家同名行不动。（`apimartTextMigration.test.ts`）
3. 迁移一次性：用户之后把 `unlisted` 改回 false / 改 label，再播种不覆盖；第三次播种 `changed === false`。
4. 先例对齐：`RETIRED_APIMART_TEXT_MODEL_KEYS` 与 `APIMART_TEXT_MODELS` 互斥；`LEGACY_MODEL_KEYS` 不再含已不种的 key；`modelContextWindowCatalog` 的 V3.2 事实保留（与 v3.2-think 先例一致：存量行仍能读到窗口事实）。
5. 默认值核查：默认大脑 / 首选 / 推荐位 / 引导示例里没有 `deepseek-v3.2`（`git grep`，结论写进报告）。付费走查镜像表 `tests/ux/_paidEnvKey.mjs` 与产品目录一致（`_paidEnvKey.test.mjs` 交叉核对绿）。

B2
6. 本机回环重放录下来的 404（`{"error":{"code":"model_not_found","message":"The model deepseek-v3.2 does not exist","type":"invalid_request_error"}}`），openai-compatible / openai-responses / anthropic 三协议：失败消息带 `nomi.vendor-failure` 诊断；渲染层解析器解出 `httpStatus: 404`、`upstreamCode: "model_not_found"`、`upstreamMsg: "The model deepseek-v3.2 does not exist"`；`classifyGenerationError(...).kind === "model-unavailable-upstream"`；pi 的 `errorMessage` 不含 `NOMI_VENDOR_ERR_B64`；上游只收到 1 次请求。（`laneModelCall.test.ts`）
7. 工作区 lane（真 `openLane` + 夹具 HTTP）：404 `model_not_found` → 投影错误段文字带载荷、分类成 `model-unavailable-upstream`；不重试（请求数 1）。单次提问（真 `runLaneSingleShot`）同样。（`tests/agent-runtime/lane-resilience.test.mts`、`lane-single-shot.test.mts`）
8. 翻转特征测试「现状：HTTP 404 的 model_not_found 原始 JSON 落进『服务商返回了一个没见过的错误』」：改为喂主进程真产物 → `providerFailureText` 不是兜底句、`providerFailureIsUnclassified === false`、en / zh 拼出「原因：原话」。（`laneCommandFailure.test.ts`）
9. 投影：带诊断的失败消息 → 错误段文字 = 诊断里的载荷；不带诊断（旧转录）→ 仍是 `errorMessage`；`transient` / `fault` / `recovered` 照旧按 `errorMessage` 与 pi 判定。（`laneProjection.test.ts`）
10. 记录器复用：对一个已包过的 fetch 再 `observeModelFetch` → 同一份记录器（同一 `lastAttempt`，秘密合并），日志不记两遍。（`modelCallFetch.test.ts`）

C
11. 翻转特征测试「现状：带上限 8 的自写合同，headless 给 9 张参考时第一闸不拒」：现在 `applyHeadlessParamDefaults(9 张, modelReferenceSelection(...))` 抛「这个模型最多收 8张图片参考。」——与把同一身份直接交给投影边界（`projectReferencesOntoBodyKeys`）抛的同一句。（`taskParams.test.ts`）
12. 引擎 A：`runTask` 对自写合同模型（`meta.customCapabilityContract`，`image_urls` 上限 8）带 9 张参考 → 以同一句拒，本机回环上游请求数 0；阳性对照 8 张 → 上游收到 1 次且 `image_urls` 恰 8 张。（`runtime.referenceSelection.test.ts`）
13. 引擎 B：`buildRequest` 对同一模型 9 张 → 以同一句拒（不再是 `catalog mapping defaults are invalid`），本机回环 0 次；阳性对照 8 张 → `submit` 到回环 1 次。（`apimartGenerationProvider.test.ts`）
14. 缩减对象已删：`git grep -n "modelMeta: archetypeId ?"` 无结果；`applyHeadlessParamDefaults` 的所有调用（产品 2 + 测试 / 脚本）都传完整身份。

全量回归：`electron/catalog`、`electron/capabilityCore`、`electron/agentLane`、`electron/ai`、`electron/shared/agentLane`、`src/workbench/ai/lane`、`src/workbench/generationCanvas/runner` 相关 vitest；`tests/agent-runtime` 的 resilience / single-shot 两个文件；`node scripts/typecheck.mjs`；ESLint（改到的文件）；`check-root-cause-contracts` / `check-concept-owners`；`git diff --check`；推送前快检。

**反例（这一类会从哪回来）→ 结果 → 证据**（实现线自验时逐条填）

| 反例 | 期望 |
|---|---|
| 另一个调用者：单次提问（不是工作区 lane） | 同样带载荷（第 7 条） |
| 另一个协议：Responses / Anthropic | 同样带载荷（第 6 条） |
| 另一种失败：HTTP 200 + SSE 里报错 | 不挂诊断、文案不变（只认 HTTP 事实） |
| 另一种失败：连接被重置（thrown） | 不挂诊断，仍按 pi 瞬时判定走网络类 |
| 重试后成功：429 → 重试 → 出字 | 成功消息不挂诊断；上一次 429 不串到之后的失败上 |
| 正文回显 API key 的 401 | 载荷解码后不含该 key |
| 用户点停 | `aborted` 不挂诊断 |
| 旧版本：本卡之前落盘的转录 | 无诊断 → 仍按原文分，不报错、不回填 |
| 渲染层特例 | `git grep -n "model_not_found" src/` 只在已有码表与测试里出现，不新增 |
| 重试语义 | 404 不重试；429 / 普通 5xx 照旧重试；余额 5xx 照旧不重试（`errorMessage` 未动） |
| C · 另一个调用口（引擎 B） | 同一句拒，不被改写成 defaults invalid |
| C · 另一种族（视频 / 音频声明上限） | 同一条容量循环，族由声明给出（`assertReferenceCapacity` 三族共用） |
| C · 内置档案（只有 archetypeId 的 meta） | 投影结果与修前逐字相同（护栏测试原断言不改） |
| C · 显式写在 `image_urls` 里的 9 张（不是投影来的） | 同样拒（显式值容量循环读同一身份） |
| B1 · 只删种子不进 RETIRED / 只进 RETIRED 不删种子 | 互斥约束 + 迁移测试红 |

**花钱走查**：本卡不跑付费；真调用核对（真实 APIMart 对 V3.2 回 404、面板说「服务商这边取不到」）记 `unverified` 交协调。免费演练：本机回环重放。

**独立验收**：待协调派验收线（四类：花钱 / 长跑）。

**回滚**：`git revert` 实现提交即可，无开关。B1 的存量迁移只写过 `unlisted` 与 `catalogLifecycle`：回滚后 V3.2 重新进种子，供应商列表对账（`modelListReconcile`，中转仍列出它）会把 `unlisted` 改回 false；诊断字段留在已落盘的转录里，旧代码不读它，无害。
