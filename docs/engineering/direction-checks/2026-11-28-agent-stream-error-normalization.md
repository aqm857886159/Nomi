# 方向检查：Agent 对话流内错误与输出截断归一复盘（RW）

**这一处的全图在哪**：表外（本案补齐交接全图：`上游 HTTP / SSE 字节流 → electron/ai/modelCallFetch.ts 传输留证与请求秘密抹除 → electron/ai/runtimeVendorError.ts + electron/jsonUtils.ts 事实抽取 → electron/shared/vendorFailure.ts 协议类别表 → electron/agentLane/laneModelProvider.mts 诊断槽挂载与截断结算 → electron/shared/agentLane/laneProjection.ts 会话投影 → electron/shared/generationFailure.ts + src/workbench/ai/lane/laneCommandFailure.ts 界面本地化出口`）。

### 0. 一句话根因

传输留证层只认「响应头非 2xx」为上游回答、漏掉了「HTTP 200 建立 SSE 后在流内发出的标准协议错误帧」，叠加模型描述层的假定 16,384 输出上限与线上真实上限不一致，导致流内协议报错和单轮输出截断在下游丢失结构事实、反复掉进泛化未知错误或误报上下文溢出。

### 1. 归类表：bug → 直接原因 → 类

| 提交 / bug | 直接原因 | 类 |
|---|---|---|
| `87be51f7e` / HTTP 非 2xx `model_not_found` 落未知错误 | `laneModelProvider` 过去不挂 `NOMI_VENDOR_ERR_B64`，渲染层只能看到无来源展示串 | 传输事实未穿透诊断槽 |
| `c6e634d4c`（#1617）/ 403·429 余额码误报与半截工具调用执行 | `categorizeVendorFailure` 只看状态码；`length` 截断工具调用被当正常完成执行 | 状态码猜原因 + 截断后半刀悬空 |
| 本案场景 5 / 输出达上限被误报「对话太长」或静默断尾 / 落未知错误 | `createNomiModelDescriptor` 恒写 `maxTokens: 16384`（Anthropic 线上实发 `4096`，OpenAI/Responses 线上不发），`isRecoverableLength` 把服务端 4K/8K 正常输出上限误判成上下文挤压；`nomi.output-truncated` 与纯文本 `length` 在投影层无故障映射 | 描述层与线上请求脱节 + 终局投影缺口 |
| 本案场景 6、7、8 / HTTP 200 SSE 流内报错与 `invalid_request_error` / `context_length_exceeded` 落「没见过的错误」 | `modelCallFetch` 对 200 响应不记录 SSE `error` / `response.failed` 帧，`openai` SDK 抛无状态码异常时丢弃 `type` 与 `code`；`categorizeVendorFailure` 在无 HTTP 状态码时缺标准协议标识查表；HTTP 413 `request_too_large` 被 `detectAssetTooLarge` 误判成素材超限 | 流内协议事实在传输边界丢失 |

### 2. 为什么这一类会一直出现

根本原因不在「面板少写了几个关键词正则」，而在两处**表示层断裂**：
1. **传输留证把「HTTP 状态码非 2xx」当成「服务商报错」的充要条件**：流式 LLM 协议（OpenAI Chat SSE、OpenAI Responses SSE、Anthropic Messages SSE）在 `200 OK` 刷出响应头之后，只能通过 SSE 事件帧传递业务拒绝（参数非法、上下文超长、过载、内容过滤、中继上游失败）。传输层不留这份帧，SDK 把它压成半截裸英文后，下游既无来源凭据（`vendorQuoteProvenance` 必拒）又无 `code`/`type`，只能掉进 `providerUnknownError`。
2. **模型描述层塞了一个未上线发送的魔法数 `16384`**：`onPayload` 为保持目录声明原貌删掉了 SDK 算出的 `max_tokens`（仅 Anthropic 缺省发 `4096`），但描述层仍告诉 `pi-agent-core`「本次期望输出上限是 `16384`」，致使任何服务端默认输出上限小于 `16384` 的模型一旦写满单轮上限就被核心当成「上下文装不下」去压缩并报错。

#### 三条体验铁律（类根因落点）

- 落到 **⑫ 点了=以为的**（失败与截断提示必须说清真实发生了什么与下一步怎么操作，不栽赃网络/素材/上下文，也不静默断尾）；⑩、⑪ 本次不涉及草稿意图抽取与模型参数下拉清单。

### 3. 不改结构的话，接下来会冒出什么（2–3 个可验证预测）

| 预测 | 怎么验证（命令或步骤） |
|---|---|
| 1. 任何接入 OpenAI Responses 或中继 SSE 的模型在 `200 OK` 后返回 `response.failed` 或 `data: {"error":{"type":"invalid_request_error",...}}`，面板必报「服务商返回了一个没见过的错误」 | 在 `electron/agentLane/fcAgentScenarios.test.ts` 用真 HTTP SSE 假上游回放三种协议流内错误，断言 `providerFailureIsUnclassified === false` |
| 2. 未填 `maxOutputTokens` 的 OpenAI 兼容模型（服务端默认 4096 上限）回答长文触发 `finish_reason: "length"`（`input: 100, output: 4096`），第一轮即被改写为 `faultContextOverflow`（「这段对话太长」） | 在 `tests/agent-runtime/lane-resilience.test.mts` 构造 `input: 100, output: 4096, finishReason: "length"` 实跑 `openLane` 验证 |
| 3. Anthropic 协议返回 HTTP 413 `request_too_large` 纯文本超长时，面板误报「这个素材太大，传不上去」 | 在 `electron/agentLane/fcAgentScenarios.test.ts` 喂入 Anthropic 413 结构化载荷验证 `classifyGenerationError` 输出 |

### 4. 靶子独立性检查

- 线上 8 类症状来自真实用户会话反馈样本，出网字节金样来自主线锁定的 `electron/agentLane/modelRequestParity.test.ts`（82 行 × 4 调用方），供应商错误语料基线来自 `electron/vendor/vendorFailureCorpus.test.ts`（24 行三门对拍）与五出口对拍 `failureExits.parity.test.ts`，均非本线自造靶子。
- 注意旧单测 `laneModelCall.test.ts:154`（「200 里 SSE 报错不挂载荷」）与 `lane-resilience.test.mts:381,423`（S4 前半刀临时钉住「截断先落 unknown / 纯文本截断无提示」）明确标明了是前半刀未完成时的阶段性快照，本刀正是完成其注释点名的后半刀，需同步翻转为正面契约断言；而 `vendorQuoteProvenance.test.ts` 与 `laneCommandFailure.test.ts:86,121`（「无传输载荷的裸串/JSON 绝不外露」）属于安全铁律，必须原样全绿保留。

### 5. 这一整块归谁（P0）

这一整块：模型调用的流式传输失败留证、通用协议错误码归一与单轮输出上限截断投影。
归谁：传输留证归 `electron/ai/modelCallFetch.ts:164`，JSON 字段提取归 `electron/jsonUtils.ts:94`，供应商协议类别查表归 `electron/shared/vendorFailure.ts:98`，失败原因与词条决策归 `electron/shared/generationFailure.ts:336`，Agent 回合故障投影归 `electron/shared/agentLane/laneProjection.ts:253`（底层流驱动与重试协议由 `@earendil-works/pi-ai` 0.85 与 `@earendil-works/pi-agent-core` 0.85 持有，见 `electron/agentLane/laneModelProvider.mts:8`）。
我们哪里绕开了它：`electron/ai/modelCallFetch.ts:184` 在 `response.ok` 分支丢弃了 SSE 流内标准错误帧；`electron/ai/runtimeVendorError.ts:20` 另写了一份私有的 `pickBodyMessage` 绕开 `electron/jsonUtils.ts:94`；`electron/agentLane/laneModelProvider.mts:126` 只允许 `attempt.kind === 'http'` 铸造诊断载荷，且 `:238` 用硬编码 `16_384` 绕开了 `:297` 的真实线上输出上限声明。

### 6. 三条路对比表 + 推荐

| 选项 | 做什么 | 代价 | 选了以后同一类还会不会出现、从哪出现 | 风险 | 推荐 |
|---|---|---|---|---|---|
| 沿原方向修 | 在 `laneCommandFailure.ts` 或 `generationFailureDetect.ts` 继续补英文子串正则 | 小 | **会不断复发**：SDK 在 `200` SSE 异常里已剥掉 `type`/`code`，且无来源文本撞 `vendorQuoteProvenance` 门禁；`16384` 假上限仍会把 4K 正常截断判成上下文溢出 | 高（误伤无来源内部报错、破坏 fail-closed） | 不选 |
| 换一种做法 | 由本线在单一传输留证与协议主人处一次性收齐：① `modelCallFetch.ts` 旁路记录脱敏后的标准 SSE 错误帧；② 删 `runtimeVendorError.ts` 重复的 `pickBodyMessage`，统一走 `jsonUtils.ts` + `vendorFailure.ts` 通用协议表（OpenAI Chat/Responses、Anthropic Messages）；③ `laneModelProvider.mts` 对齐描述层与线上真实输出上限，`laneProjection.ts` + `laneAssistantFault.ts` 将工具截断与文本 `length` 截断统一投影为本地化人话 | 中（跨传输、共享归类、车道投影 3 个单点主人，出网字节 0 改动） | **同类不再出现**：无论上游走非 2xx 还是 200 SSE 流内报错、无论哪种标准协议，都经同一份结构化载荷进同一张分类表；服务端任意默认输出上限都不再误触发上下文溢出 | 低（`modelRequestParity` 328 条请求锁死线上字节，五出口对拍锁死存量分类） | **推荐（协调已按换/删口径派单）** |
| 删掉 | 删除 `electron/ai/runtimeVendorError.ts` 内私有的 `pickBodyMessage` 重复解析函数，合并回 `electron/jsonUtils.ts`；不能删掉 SSE 错误解析或截断提示本身，否则用户继续面对静默断尾与「没见过的错误」 | 极小 | 仅删重复副本可消除信封取词漂移，但须配合上一行传输留证与上限对齐才能保住用户结果 | 低 | 合并入推荐项同提交执行 |

### 7. 用户要权衡的核心

不改动任何线上发往服务商的请求参数字节，只把「200 流内协议错误」收进已有的结构化错误通道、把「未声明输出上限」如实标为无上限并在单轮写满截断时明着提示用户发「继续」或分段输出，用一次结构收口换掉后续按报错句子逐条打补丁的循环。

## 特征测试清单（动结构前先锁住）

- `electron/agentLane/modelRequestParity.test.ts`（82 行内置 + 老用户目录请求逐字节对拍）
- `electron/vendor/vendorFailureCorpus.test.ts`（24 行三扇门归类语料 + 空操作/全拦双替身判别器）
- `src/workbench/observability/failureExits.parity.test.ts`（画布/分镜/任务中心/内置助手/外部助手五出口对拍）
- `src/workbench/observability/vendorQuoteProvenance.test.ts`（无来源字符串绝不外露为服务商原话）
- `electron/agentLane/laneDirectorStageShot.test.ts`、`electron/shared/agentCapabilities/modelHandle.test.ts`、`electron/agentLane/laneTools.test.ts`、`electron/capabilityCore/capabilityExecutorRegistry.test.ts`、`src/workbench/timeline/agent/mediaToolCall.test.ts`（场景 1–4 既有防线）
- `electron/agentLane/fcAgentScenarios.test.ts`（本次先红后绿新增：覆盖场景 1–8 全矩阵与反例）
