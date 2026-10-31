# 文本模型默认走 Responses，不支持才走 Chat Completions · 设计卡

```
改动名：OpenAI 系文本模型按模型实测协议——接入时发一次最小 Responses 请求，过了记 Responses，否则记 Chat
线/负责人：responses-default（Claude Opus）        类别：[花钱][其他]（不新增界面）
状态：已实现未推送（实现线按 ★9 自验完毕；独立验收与真付费抽检待安排）
```

## 0. 一句话

今天 Agent、文本任务、编译器三处共用 `nomiModelConfigFor`，协议只看连接的 `providerKind`，缺省 `openai-compatible`。所以除非用户在高级区手选，OpenAI 系模型一律走 `/chat/completions`。改成：接入认证时，对每个 OpenAI 系文本模型发一次最小的 `/responses` 请求，回包按 Responses 协议解析成功就记这个模型走 Responses，其余任何结果都记 Chat。

## 拍板记录（用户 2026-10-27）

- 默认 Responses，不支持再用 Chat。
- 判定在**接入时**做一次、按模型存档；不做运行时失败再降级（协议不对的中转回 502，pi 把 502 当可重试，运行时分不清「协议不对」和「上游宕机」）。
- 判定**按模型**，不按连接：聚合型平台（new-api、OpenRouter、one-api、LiteLLM）一个地址后挂多家模型，`/responses` 路由对所有模型都开着，背后渠道支不支持因模型而异。
- 判据只认**协议本身**，不读任何平台的错误文案（P0：不与具体供应商耦合）。代价是要发一次真实请求。
- **2026-09-11「删掉所有会花用户钱的自动逻辑」的例外**：用户 2026-10-27 拍板允许这一次文本最小请求（每个 OpenAI 系文本模型、每次认证一次，约几十 token）。图片 / 视频 / 音频仍然不发任何付费验证。
- 已有连接不自动升级；用户下次重新认证模型时才探测。
- 思考强度另开一条线（本卡不做）。

## 先查别人

1. [AI SDK OpenAI provider](https://ai-sdk.dev/providers/ai-sdk-providers/openai) · AI SDK 5 起 `openai(model)` 缺省走 Responses，自定义地址只支持 Chat 时要显式 `openai.chat()` · **确认了**「默认 Responses」的方向；也说明业界把「地址只支持 Chat」当成需要显式切换的特例，而我们的用户大多接中转，所以不能只靠用户手选，要实测。
2. [OpenAI 迁移指南](https://developers.openai.com/api/docs/guides/migrate-to-responses) · 从 GPT-5.4 起，Chat Completions 上带工具调用时 `reasoning_effort` 只能是 `none` · **确认了**为什么 Agent（工具循环 + 推理）必须走 Responses：留在 Chat 上，后续的思考强度线在新模型上根本发不出去。
3. [new-api #4535](https://github.com/QuantumNous/new-api/issues/4535)、[#2043](https://github.com/QuantumNous/new-api/issues/2043)、[#6562](https://github.com/QuantumNous/new-api/pull/6562) · 中转对每个渠道都开 `/v1/responses`，非 OpenAI 渠道的转换函数是空桩，回 `400 convert_request_failed`；按渠道陆续补 · **改了**判定粒度：从「按连接」改成「按模型」；也**改了**判据：不能用「路由存在」或状态码判，只能看真实请求的回包。
4. [OpenAI Agents JS · Models](https://openai.github.io/openai-agents-js/guides/models/) · 缺省 Responses，`setOpenAIAPI('chat_completions')` 全局切换 · **确认了**「用户手选优先于实测」：手选过协议的连接不探测。
5. Codex CLI 的 `wire_api = "responses" | "chat"`（按 provider 配置）· 由用户在配置里写死 · **确认了**手选要按连接存（`providerKindPinned`），不在每个模型上让用户再选一次。

## ★1 用户怎么用

当我接一个中转站或官方 OpenAI 兼容地址、选了文本模型并保存时，我想让 Nomi 自己弄清每个模型该走哪条协议，以便 Agent 用上 Responses 的推理与工具能力，又不会因为某个模型不支持 Responses 而坏掉。

1. 模型设置 → 添加连接 → 填地址和 key（不碰高级区的协议选择）。
2. 拉模型列表，勾若干文本模型，确认。
3. 认证跑完：每个文本模型的验证档案里记下协议（Responses / Chat）。
4. 打开 Agent，选这个模型对话：请求发到 `/responses` 或 `/chat/completions`，与档案一致。
5. 想强制某个协议：高级区手选 → 保存；此后这条连接不再探测，全部模型走手选的协议。

**不做什么**：不做运行时降级；不探测图片 / 视频 / 音频；不改 Anthropic 连接；不加界面；不做思考强度；不探测没走认证的内置种子供应商（它们的 `providerKind` 由种子写死）。
**已知坑**：①探测只发一句话、不带工具，转换层把工具调用弄坏时探测发现不了；②探测超时（20 秒）或网络失败一律记 Chat（与今天一致，不更差）；③认证中途崩溃后从账本复用的结果不带协议，按 Chat 走；④认证批次只有 5 分钟（`serviceLifecycle.ts`），20 个模型 × 20 秒会吃光它——剩余时间不够「一次探测 25 秒 + 给后面模型的自检留 60 秒」就不探、记 Chat（`textProtocolProbeFits`），绝不把本来能过的模型拖成到点失败；⑤上游回 `incomplete` 且原因不是 `max_output_tokens`（如内容过滤）时 pi 判错误 → 记 Chat，保守。

**真实任务**（缺真实 key，全部 `unverified`，见格 8）：
- T1 官方 OpenAI 地址接 `gpt-5` 系 → 档案记 Responses，Agent 请求打到 `/v1/responses`。
- T2 new-api 中转同时勾一个 OpenAI 渠道模型和一个 DeepSeek / Claude 渠道模型 → 前者 Responses、后者 Chat，两者 Agent 都能对话。
- T3 官方 DeepSeek 地址 → `/responses` 404 → Chat，Agent 照常可用。

**指标**：
- 主指标：OpenAI 系文本模型里走 Responses 的比例（目标：上游真支持的都走）。量具：未验证：缺量具（没有按协议分的使用遥测）。
- 护栏：认证后 Agent 首次对话因协议失败的比例 = 0。量具：`electron/providerAdapter/textProtocolProbe.test.ts` 的 HTTP 夹具三形状 + 人工 T2。
- 质量：探测给出的协议与运行时实际发出的协议一致率 100%。量具：`electron/ai/vendorModelConnection.test.ts` 判定表。

## ★1b 连带界面

- 模型认证进度：不新增状态文案；探测紧跟在「Model self-check」之后（同一个模式的「测试中」状态里，内部步骤名 `Text protocol probe`），每个模型至多多 20 秒。
- Agent 面板、文本任务、编译器：不改界面；请求的协议变化对用户不可见。
- 错误卡：不改。Responses 走不通的模型被记成 Chat，不会出现新错误。

## ★2 谁说了算

- 「某个文本模型走哪条协议」唯一 owner：目录里该模型的验证档案 `meta.adapter.modes[chat].wireProtocol`，由认证流程（`providerAdapter/service.ts` 的 `verifyDraft`）写，经 `promotionMeta` 落库。
- 「这条连接的协议是不是用户手选的」唯一 owner：`vendor.meta.providerKindPinned`，由连接保存（`serviceCatalog.register/stage` 的 `providerKindPinMeta`）写。输入 `true` 置位、`false` 清掉、缺省保留——驱动 Agent 重新登记、已有连接重认证都不带这一位，不许因此抹掉用户的选择。
- 向导只在「自定义 / 中转」的高级区亲手选协议时传 `true`；选「自动」或用具名预设都传 `false`。
- 唯一读者：`electron/ai/vendorModelConnection.ts` 的 `vendorModelConnection`（Agent、文本任务、编译器都经它）。
- 同一份事实存几份：1。不靠「状态变了」猜意图：手选由向导显式传 `providerKindPinned`。

## ★3 一致与复用

- 发请求：复用唯一模型调用核心 `callModelOnce` + `modelCallTransport`（与编译器同一条，`providerAdapter/compiler.ts:69`），不自写 fetch。
- 判协议：复用 pi-ai 的 `openai-responses` 适配器解析回包。回包不是合法的 Responses 事件流 → pi 报错 → 记 Chat。不自写协议解析。
- 存档：复用认证的模式结果（`AdapterModeResult`）与落库链（`persistedModeResult` → `sanitizeMode` → `adapterModelMetadataForPromotion`），不新开存储。
- 第二份定义：无。

## ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 探测中 | 认证进度停在该模式「测试中」（已有状态），至多多 20 秒；批次剩余时间不够就跳过 |
| 成功（Responses） | 模型照常进模型框；Agent 走 Responses |
| 成功（Chat） | 同上；Agent 走 Chat（与今天一样） |
| 失败（探测出错 / 超时 / 网络） | 不算认证失败；记 Chat |
| 取消中 | 认证取消照旧；探测随 `signal` 中止，不落协议 |
| 能力不可用（key 无效 / 余额不足） | 免费自检那一步已经判死，探测不发 |
| 部分成功 | 每个模型各记各的协议 |
| 过期 | 不适用：协议档案随下一次认证刷新 |

## 5 中途表

| 状态 \ 打断 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 探测请求在路上 | 认证取消，探测随 signal 中止；不落协议 · 已发出的那一次可能计费（几十 token）· 回执：认证记录 cancelled | 主进程仍在则照旧；退出则同重启 | 探测失败 → 记 Chat · 不扣 · 认证记录 | 认证从账本恢复，复用结果不带协议 → Chat · 已发出的那一次可能计费 · 认证记录 | 同一模型同一认证只探一次（在 executeSubmission 的幂等键里） |

## 6 外部数据与失败

| 来源 | 规范 | 我们的偏差 | 失败时用户看到什么 |
|---|---|---|---|
| OpenAI Responses API | [API reference](https://platform.openai.com/docs/api-reference/responses) | 只发 `input` + `max_output_tokens: 16`，`store: false`（pi 缺省） | 无新提示；记 Chat |
| 聚合平台的转换层 | 各家不同（new-api #4535 等） | 不读其错误文案 | 无新提示；记 Chat |

未知失败一律落 Chat，不报给用户、不甩给 key。

## 8 真实条件

Windows ✔（本机）；英文界面 / 最小窗口：不适用（无界面改动）；真付费：`unverified`——本机没有可解密的真实文本 key（凭据是 safeStorage 密文），T1–T3 交给有 key 的验收线或用户跑一次。

## ★9 验收与回滚

**验收清单（实现线按它自验；验收线只核它）**：

| # | 检查项 / 反例 | 期望 | 证据 |
|---|---|---|---|
| A1 | 端点按 Responses 协议回事件流 | 记 `openai-responses` | `textProtocolProbe.test.ts`（HTTP 夹具） |
| A2 | 端点 `/responses` 回 404 | 记 `openai-compatible` | 同上 |
| A3 | 端点 `/responses` 回 200，但正文是 Chat Completions 形状（反例：路由存在但协议不对） | 记 `openai-compatible` | 同上 |
| A4 | 端点回 400 `convert_request_failed`（反例：聚合平台渠道不支持） | 记 `openai-compatible` | 同上 |
| A5 | 探测超时 / 被取消 | 记 `openai-compatible`，不抛 | 同上 |
| A6 | 连接 `providerKindPinned` | 不发探测 | `service` 单测 |
| A7 | Anthropic / `openai-responses` 连接 | 不发探测 | `service` 单测 |
| A8 | 图片 / 视频模式 | 不发探测 | `service` 单测 |
| A9 | 免费自检失败（401） | 不发探测 | `service` 单测 |
| A10 | 档案写 Responses、连接未手选 | `nomiModelConfigFor().kind === 'openai-responses'` | `vendorModelConnection.test.ts` |
| A11 | 档案写 Responses、但连接后来被手选成 Chat | `kind === 'openai-compatible'`（手选优先，旧档案失效） | 同上 |
| A12 | 档案缺失（存量连接） | 维持连接的 `providerKind` | 同上 |
| A13 | 模式结果经 `persistedModeResult` / `sanitizeMode` / 落库 | `wireProtocol` 不丢；非法值被剔 | 单测 |
| A14 | 保存连接：`providerKindPinned` 为 true / false / 缺省 | 置位 / 清掉 / 保留已存的 | `registrationCatalog.test.ts`；向导一侧见 UI 验证清单 |
| A15 | 认证批次剩余不足一次探测加 60 秒预留（反例：20 个模型把 5 分钟吃光） | 不发探测，记 Chat，模型照常通过 | `service.test.ts` |
| A16 | 探出的协议经真目录发布落进模型 meta，再由运行时读回 | `nomiModelConfigFor().kind === 'openai-responses'` | `serviceCatalogLifecycle.integration.test.ts` |

**自验结果（2026-10-28，实现线）**：A1–A16 全部有单测，且逐条演示过「去掉修复即变红」（连接推导、service 接线、批次时限守卫、`sanitizeMode` 白名单、钉住位保留语义、探测判据各删一处，对应用例都红）。A1–A5 走真 pi-ai → 真 HTTP（本机假上游 `tests/fixtures/textTasks/textUpstream.ts`），另含「200 但回 Chat SSE」「流里报错」「连接被重置」三个反例。

**这一类会从哪回来**：另一个调用者（新加的模型调用入口不经 `vendorModelConnection` → 由 `check:llm-stream-owner` 守唯一出网核心）；另一个版本（pi 升级改了 Responses 解析 → A1/A3 夹具会红）；旧数据（存量连接无档案 → A12）。

**回滚**：revert 本 PR。档案里多出的 `wireProtocol` / `providerKindPinned` 字段旧代码不读，无需迁移。

**独立验收**：花钱类，合并前需另一条线按上表核；`spend-paid-sample` 需一次真付费抽检（T1 或 T2），本线无 key，交协调会话安排。

### 功能分类
- [x] 花钱
- [x] 新增功能 / 性能
- [x] 新界面 / 改交互（路径推出：向导多传 `providerKindPinned`，界面无可见变化）
- [x] 长跑 / 可打断（路径推出：探测接认证的取消信号，取消即记 Chat，见 A5）
- [x] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [x] 数据格式

## ★7 性能

①新增操作：无用户操作；认证流程每个 OpenAI 系文本模型多一次网络请求。②最坏规模：一次认证勾 20 个文本模型。③预算：每个探测 ≤20 秒硬上限（外层等待 25 秒），串行在既有的逐模式自检循环里；批次总时限仍是 5 分钟，剩余不够 85 秒就不再探测（A15），所以最坏情况是后面的模型记 Chat，而不是认证超时；不占渲染层、不阻塞主进程（全异步）。④性能场景：不适用——没有交互帧或渲染路径，耗时上限由超时常量直接钉死（单测 A5）。

## 实现记录与偏离（2026-10-28）

- **偏离：具名预设也探测。** 早先答复里说过「官方预设按文档写死协议」。实现时改为：所有 OpenAI 家连接（含 OpenAI 官方预设）只要用户没亲手选，就按模型探测。理由：预设表里除 OpenAI 外都是「同一个地址后挂多种模型」的形状（OpenRouter、SiliconFlow、阿里百炼、火山），写死就回到按连接判的老路；OpenAI 官方地址探测必过，写死与探测结果相同，没有收益。`providerPresets.ts` 头注释已改。
- 内置种子供应商（不走认证）照种子写的 `providerKind` 走，不探测。
- 文件：新增 `electron/providerAdapter/textProtocolProbe.ts`（判定者，永不抛）；`vendorModelConnection.ts` 加推导（只升不降）；`service.ts` 在自检通过后接线；`types.ts` / `verifier.ts` / `serviceVerificationResults.ts` / `store.ts` 让 `wireProtocol` 一路落库；`ipc.ts` / `serviceCatalog.ts` / 向导传 `providerKindPinned`。
- 预热（`textStreamIpc.ts`）与 PDF 原生载荷（`nativePdfPayload.ts`）都从 `vendorModelConnection` / pi 的 api 取协议，自动跟随，不用改。
