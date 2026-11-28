# 设计卡：Agent 对话剩余线上参数、回答截断与流内报错收口（F-C）

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 适用范围：0.25 切版必带件 3.3b（#1586）——逐一核实 8 类真实对话反馈场景现状，已由前序 PR（#1632、#1669、#1673、#1617）闭合的计入回归对账表，剩余未修透的输出长度截断（场景 5）与流内/协议级报错落入未知错误（场景 6、7、8）按单一主人从结构上一次性收口。

### 功能分类

- [x] Agent 行为
- 改动类型：Bug 修复与协议级错误归一收口（非新增功能；触及 `src/i18n/locales/` 用户可见文案词条，按 `check-pr-judgement.mjs` 走**标准档**，并补齐 ★0 外部协议核查与 ★1–★9 关键格）。

---

## ★0 先查别人（外部协议与 SDK 行为核查）

1. **OpenAI Python / JS SDK `openai/core/streaming.mjs:45-47` & OpenAI API Error Codes 文档（`https://platform.openai.com/docs/guides/error-codes`）· 它怎么做**：Chat Completions 建立 `HTTP 200 text/event-stream` 后，中继或上游在流内发 `event: error` 或 `data: {"error":{"message":"...","type":"invalid_request_error","code":"context_length_exceeded"}}`；`openai` SDK 抛 `new APIError(undefined, data.error, undefined, headers)`（`status === undefined`），`@earendil-works/pi-ai` 的 `formatProviderError` 因无 HTTP 状态码只保留 `message` 字符串，丢弃 `error.type` 与 `error.code`。· **对哪个决定的影响**：必须在我们自己的传输包装 `electron/ai/modelCallFetch.ts` 旁路记录 SSE 错误帧原文（经同一抹密器脱敏），让 `runtimeVendorError` 与 HTTP 非 2xx 共用同一套 `pickUpstreamCode` / `pickUpstreamType` / `categorizeVendorFailure` 铸造 `NOMI_VENDOR_ERR_B64` 结构化载荷，不靠解析 SDK 拼出的残缺英文字符串。
2. **OpenAI Responses Streaming 事件规范（`https://platform.openai.com/docs/api-reference/responses-streaming`）与 `@earendil-works/pi-ai` `openai-responses-shared.js:488-505` · 它怎么做**：Responses 流内失败有三种标准事件：`type: "error"`（顶层 `{code, message}` 或嵌套 `{error}`）、`type: "response.failed"`（错误在 `response.error.{code, message}`）、以及 `type: "response.incomplete"`（当 `incomplete_details.reason === "max_output_tokens"` 时映射 `stopReason: "length"`，为 `"content_filter"` 等其他原因时抛错）。· **对哪个决定的影响**：`electron/jsonUtils.ts` 的唯一键优先级表补齐 `response.error.{message,code,type}` 与非长度截断的 `response.incomplete_details.reason`；`modelCallFetch.ts` 同时识别这三类标准 SSE 错误帧，且把 `max_output_tokens` 留给 `stopReason: "length"` 通路。
3. **Anthropic Messages Streaming 错误与 `max_tokens` 规范（`https://docs.anthropic.com/en/api/messages-streaming`）及 `@earendil-works/pi-agent-core` `drive/response.js:111-142` · 它怎么做**：Anthropic 流内报错发 `event: error` + `{"type":"error","error":{"type":"overloaded_error"|"invalid_request_error"|...,"message":"..."}}`；截断发 `stop_reason: "max_tokens"`（映射 `stopReason: "length"`）。而 `pi-agent-core` 用 `isRecoverableLength(response, model.maxTokens)` 判断「输出未达模型 `maxTokens` 的 `length`」并将其改写为上下文溢出错误。· **对哪个决定的影响**：① `laneModelProvider.mts` 的 `createNomiModelDescriptor` 必须与 `onPayload` 对齐真实声明的输出上限（Anthropic 未配置上限时线上发 `4096`，描述层同样记 `4096`；OpenAI Chat/Responses 未配置上限时线上不发 `max_tokens`，描述层记 `0`，仅在调 SDK 流函数时提供内部思考预算基数 `16384`），彻底消除「服务端默认 4K/8K 输出上限被误判成上下文太长」；② 投影层对落盘的 `stopReason === "length"` 保留已生成正文并追加清晰的「达到单次输出长度上限，可发『继续』或分段输出」人话提示。

---

## ★1 目标、指标与老数据兼容

- **★1a 要保住的用户结果**：
  1. 场景 1–4（导演 `stage_shot` 窗口结构、`wan-…` 模型同义词与变体解析、工具单步超时竞态）维持前序修复全绿并锁入 8 场景回归矩阵。
  2. 场景 5（上游因单次输出长度上限截断）：无论带工具调用还是纯文本回答、无论 Anthropic 默认 4096 还是 OpenAI/Responses 未声明上限，半截工具调用绝不执行，已写出的正文完整保留，且界面给出直白可操作的中英双语人话（提示可发「继续」接着写、拆小步骤分段输出或换更高输出上限模型），不再静默断尾、不再误报「对话太长」、不再落入「服务商返回了一个没见过的错误」。
  3. 场景 6、7、8（`HTTP 200` SSE 流内结构化报错，以及通用协议 `invalid_request_error`、`context_length_exceeded`、`request_too_large`、`overloaded_error`、`content_filter`）：对话侧与生成侧共用同一份协议分类与载荷编码，给出直白中英人话（参数不被接受 / 输入超过模型上下文上限 / 服务商故障 / 提示词被拦截）并附带清洗后的有来源上游原话，8 类场景落入 `unknown`（「服务商返回了一个没见过的错误」）条数降为 **0**。
- **★1b 可验证指标与量具**：
  - 8 类场景回归矩阵落入 `unknown` 或静默无提示截断数 = `0`（量具：`VITEST_MAX_WORKERS=2 npx vitest run electron/agentLane/fcAgentScenarios.test.ts` 与 `node --import tsx --test tests/agent-runtime/lane-resilience.test.mts`）。
  - 全部内置与旧版目录行出网请求逐字节零变化（量具：`VITEST_MAX_WORKERS=2 npx vitest run electron/agentLane/modelRequestParity.test.ts`）。
  - 五出口失败对拍表与供应商原话来源门禁零退化（量具：`VITEST_MAX_WORKERS=2 npx vitest run src/workbench/observability/failureExits.parity.test.ts src/workbench/observability/vendorQuoteProvenance.test.ts electron/vendor/vendorFailureCorpus.test.ts`）。
  - 真模型线上付费回合对照：`未验证：真模型线上付费回合对照交协调统一跑`（本线先跑 `NOMI_PAID_REHEARSAL=no-key` 免费演练确认退出码 0）。
- **★1c 老用户与历史转录怎么过**：
  - 历史会话中已落盘的 `stopReason: "length"` 助手条目在重开项目投影时自动获得「达到单次输出长度上限」提示且原有正文一字不丢。
  - 历史会话中无 `NOMI_VENDOR_ERR_B64` 诊断槽的旧 `stopReason: "error"` 转录仍保持 fail-closed（不把无来源英文裸串或原始 JSON 印上界面，`laneCommandFailure.test.ts` 既有断言保留）。
  - 历史会话中前序版本写下的 `nomi.output-truncated` 诊断槽条目自动识别为 `output-truncated` 故障并展示本地化人话。

---

## ★2 全局清单（door-map 实扫）

全部入口由 `node scripts/door-map.mjs` 实扫确认：

1. **传输留证门**：`electron/ai/modelCallFetch.ts`（`observeModelFetch` / `modelCallTransport`）——被 `electron/agentLane/laneModelProvider.mts`、`electron/textTaskRunner.ts`、`electron/ai/textStreamIpc.ts`、`electron/creation/storyboard/llmCall.ts` 共用。
2. **模型失败铸造门**：`electron/ai/runtimeVendorError.ts`（`modelCallFailure` / `vendorErrorFromRuntimeFacts`）+ `electron/jsonUtils.ts`（`pickUpstreamMessage` / `pickUpstreamCode` / `pickUpstreamType`）——删除 `runtimeVendorError.ts` 私有的重复 `pickBodyMessage`，统一收归 `jsonUtils.ts`。
3. **供应商协议归类门**：`electron/shared/vendorFailure.ts`（`categorizeVendorFailure`）——媒体请求 `vendorHttp.ts`、模型调用 `runtimeVendorError.ts`、素材上传 `localAssetFile.ts` 三扇门共用同一张表。
4. **失败决策与原因检测门**：`electron/shared/generationFailure.ts`（`decideGenerationFailure`）+ `electron/shared/generationFailureDetect.ts`——画布、分镜、任务中心、内置助手、外部助手五出口共用。
5. **Agent 车道装配、投影与面板红字门**：
   - `electron/agentLane/laneModelProvider.mts`（`createNomiModelDescriptor` / `createNomiProvider` / `withVendorFailure` / `truncatedToolCallFailure`）
   - `electron/shared/agentLane/laneAssistantFault.ts`（`laneAssistantFaultOf` / `laneOutputTruncatedOf`）
   - `electron/shared/agentLane/laneProjection.ts`（`projectLaneSnapshot`）
   - `src/workbench/ai/lane/laneCommandFailure.ts`（`providerFailureText` / `providerFailureIsUnclassified`）
   - `src/i18n/locales/agentResident.ts`、`src/i18n/locales/generationCommon.ts`（zh/en 双轨同步）

---

## ★3 三条路选择

- **沿原方向散点打补丁（不选）**：在 `laneCommandFailure.ts` 里对 SDK 抛出的英文裸串加正则猜词。违反 P0/P1，且 OpenAI SDK 在 `HTTP 200` SSE 报错时已把 `type` 与 `code` 丢光，猜词既漏报又破坏 `vendorQuoteProvenance` 来源铁律。
- **换一种做法：在单一传输留证与单一协议分类主人处收口（选用）**：
  1. `modelCallFetch.ts` 在 `200 text/event-stream` 流经时无损旁路记录标准 SSE 错误帧（`event: error`、顶层 `{error}`、`response.failed`、非长度 `response.incomplete`），复用同一请求秘密脱敏器；
  2. `runtimeVendorError.ts` 与 `laneModelProvider.mts` 对「HTTP 非 2xx」与「SSE 流内结构化错误」一视同仁铸造 `NOMI_VENDOR_ERR_B64` 载荷，删掉 `runtimeVendorError.ts` 的私有 `pickBodyMessage` 副本；
  3. `vendorFailure.ts` 与 `generationFailure.ts` 按通用 OpenAI Chat/Responses、Anthropic Messages 标准错误类型/错误码归类（含 `invalid_request_error`、`context_length_exceeded`、`request_too_large`、`overloaded_error`、`content_filter`），并把上下文超长排在 `HTTP 413` 素材超限嗅探之前，防止纯文本 413 被误报成「参考素材太大」；
  4. `laneModelProvider.mts` 对齐真实声明输出上限与内部推理预算基数，`laneProjection.ts` + `laneAssistantFault.ts` + `laneCommandFailure.ts` 将工具截断与纯文本 `length` 截断统一映射为可操作的本地化提示。
- **删掉（部分采纳）**：同提交删除 `electron/ai/runtimeVendorError.ts` 内与 `electron/jsonUtils.ts` 重复的 `pickBodyMessage` JSON 取词副本。

---

## ★4 明确不做（硬分寸）

1. **不为任何单个供应商写私有正则或模型名分支**：只认通用 OpenAI Chat/Responses、Anthropic Messages 及标准 SSE JSON `error` 协议结构。
2. **不改动任何出网请求线上字节**：`onPayload` 发送给上游的字段、路径、头与金样 `tests/fixtures/model-request-parity/requests.json` 保持 100% 逐字节一致。
3. **不重做报错折叠与详情卡片 UI**：界面结构保持现行单行红字/提示，报错折叠重做归属后续独立排期（0.26）。
4. **不碰零冲突红线文件**：不修改 `package.json`、`pnpm-lock.yaml`、`eslint-suppressions.json`、`docs/engineering/self-written.json`、`scripts/boundaries-baseline.json`、`scripts/vocabularies-baseline.json`、任何 `.board.json`、`src/ui/onboarding/*`、`electron/workspace/*`。

---

## ★9 验收清单与反例（动手前写死，先红后绿）

| 编号 | 场景 / 反例 | 预期行为（判据同时拒绝「什么都不做」与「全拦」） | 验证测试文件 |
|---|---|---|---|
| C1 | 场景 1 & 2：导演 `stage_shot` 入参 `edits.0.value.window` / `kind` 与 `/shots/<id>/window` schema | 合法窗口编辑通过 schema 与准入，缺字段或错枚举给出精确字段问题 | `electron/agentLane/laneDirectorStageShot.test.ts`、`electron/agentLane/fcAgentScenarios.test.ts` |
| C2 | 场景 3：`wan-…` 模型名同义词与变体解析 | `wan-2.7-*` / `wan2.6-*` 等家族标识在单一模型解析入口闭合，不被当未知参数拒绝 | `electron/shared/agentCapabilities/modelHandle.test.ts`、`electron/agentLane/fcAgentScenarios.test.ts` |
| C3 | 场景 4：工具单步超时竞态（「这一步等太久被停掉了」） | `laneTools.mts` 死锁护栏晚于执行器子阶段超时，保留真实子阶段原因且取消信号贯通 | `electron/agentLane/laneTools.test.ts`、`electron/capabilityCore/capabilityExecutorRegistry.test.ts`、`src/workbench/timeline/agent/mediaToolCall.test.ts` |
| C4 | 场景 5a：工具调用在单次输出上限处被截断（含已声明上限、未声明上限服务端 4K 截断、Anthropic 默认 4096 截断） | 半截工具调用绝不执行、不误判为上下文溢出重试，投影产出 `output-truncated` 故障，面板显示本地化工具截断指引（`providerFailureIsUnclassified === false`） | `tests/agent-runtime/lane-resilience.test.mts`、`electron/agentLane/fcAgentScenarios.test.ts` |
| C5 | 场景 5b：纯文本回答在单次输出上限处被截断（OpenAI Chat `length`、Responses `max_output_tokens`、Anthropic `max_tokens`，含服务端 4096 截断） | 已生成正文完整保留在气泡中，不误触发上下文压缩报错，且紧随其后给出「达到单次输出长度上限，可发『继续』或分段输出」中英人话 | `tests/agent-runtime/lane-resilience.test.mts`、`electron/agentLane/fcAgentScenarios.test.ts` |
| C6 | 场景 6：HTTP 200 SSE 流内报错（OpenAI Chat `data: {"error":...}`、Responses `event: error` 与 `response.failed`、Anthropic `event: error`） | 传输层捕获并脱敏 SSE 错误体，铸造 `NOMI_VENDOR_ERR_B64` 载荷，按协议码/类型精准归类（如 `server` / `input` / `balance` / `quota`），不再因外层 200 漏进 `unknown`；回显密钥全抹除 | `electron/agentLane/laneModelCall.test.ts`、`electron/agentLane/fcAgentScenarios.test.ts` |
| C7 | 场景 7：协议级 `invalid_request_error`（HTTP 400 及 HTTP 200 SSE 流内） | 对话侧与生成侧统一归入 `input`（「参数不被接受」+ 清洗后的上游原话），`unknown` = 0；而 HTTP 401 `invalid_api_key` + `type: "invalid_request_error"` 仍归 `auth`（反例防误伤） | `electron/vendor/vendorFailureCorpus.test.ts`、`src/workbench/ai/lane/laneCommandFailure.test.ts`、`electron/agentLane/fcAgentScenarios.test.ts` |
| C8 | 场景 8：协议级 `context_length_exceeded` / `request_too_large` / `model_context_window_exceeded`（HTTP 400 / 413 / SSE 200）及 `content_filter` | 对话侧与生成侧统一给出「输入内容超过了模型上下文上限」中英人话（HTTP 413 文本请求不再误报「参考素材太大」）；`content_filter` 归入 `content-policy`；无来源裸串与原始 JSON 仍 fail-closed | `electron/agentLane/fcAgentScenarios.test.ts`、`src/workbench/ai/lane/laneCommandFailure.test.ts`、`electron/vendor/vendorFailureCorpus.test.ts` |
