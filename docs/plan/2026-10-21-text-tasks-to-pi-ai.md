# 文本任务整体迁到 pi-ai 单次调用，删掉 ai@4 文本栈

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 线 I-textmigrate · 2026-10-21 · 第一段（只出方案，未改产品代码）。用户 10-21 拍板：不打补丁，直接迁移。
> 自写登记：`ai-sdk-text-stack`（`docs/engineering/self-written.json`，status `to-replace`）。
> 复盘草稿约定放在 `D:/Nomi-coord-state/handoff/textstream-liveness/`，本线开工时该目录尚不存在，第二段提交的 `Direction-Check:` trailer 等它落地后指过去。

```
改动名：文本任务迁 pi-ai 单次调用 + 删 ai@4 栈   线/负责人：I-textmigrate（nomi-deep）   类别：[长跑][可打断][新增功能]（不碰花钱闸，见 ★2）
```

## 起因（一句话）

写作区 AI 改写接 DeepSeek V4，30 秒后报「首字未响应」被掐。ai@4 栈判断连接是否还活着只看**正文** token（`electron/ai/streamTextTask.ts:173` 只读 `textStream`，`node_modules/ai/dist/index.js:6172` 里 `textStream` 只放 `text-delta`），会思考的模型先吐 reasoning，正文晚到，于是被误杀。Agent（lane）那台发动机 10-06 已经把这件事做对了（`electron/agentLane/laneStreamObserver.mts:137`：任何事件都算活着）。同一个文件 14 天修了 4 次，这是第二台发动机在逐个重新踩第一台已经踩过的坑。

---

## 一、调用方普查（origin/main `9adca4202b`）

普查方法：`git grep` 这几个入口——`streamTextTask`、`executeTextTask`、`runTextTaskStream`、`runWorkbenchTextTaskStream`、`runTask(` 里带文本 kind（`chat` / `prompt_refine` / `image_to_prompt`）的调用、`getTextBrain`、从 `ai` / `@ai-sdk/*` 导入的任何东西；再跑 `node scripts/door-map.mjs streamTextTask`（1 扇门：`electron/textTaskRunner.ts`）、`executeTextTask`（2 扇：`runtime.ts:407`、`textTaskRunner.ts:76`）、`buildLanguageModelForVendor`（2 扇：`streamTextTask.ts:96`、`providerAdapter/serviceLanguageModels.ts:32,40`）。

**结构结论：所有文本任务最后都收口到 `electron/textTaskRunner.ts` 的 `executeTextTask`（一扇门）。** 上面分两条路进来：流式 IPC（`nomi:tasks:text:stream`）和一次性的 `runtime.runTask` 文本分支。ai@4 另外还有一个**不走文本任务**的消费者：接入说明卡编译器（`generateObject`）。

公共事实（下表不再每行重复）：
- 主进程超时（ai@4 栈）：首字 30s、整体 120s（`streamTextTask.ts:52-53`），所有 HTTP 文本调用方同一套。
- 主进程重试（ai@4 栈）：`maxRetries` 缺省 = SDK 默认 2 次，只重试「流开始前」的 408/409/429/5xx/连不上，间隔 2s、4s，**这两次等待不响应取消**（`node_modules/ai/dist/index.js:363-403`）。拆解路径显式传 0。
- 流式路的错误：主进程 `describeAgentError` 把 `APICallError` 编成 `NOMI_VENDOR_ERR_B64::…:: （HTTP xxx）上游原话`（带结构化类别）。
- 一次性路（`nomi:tasks:run`）的错误：`runTaskIpcGuard` 只认 `VendorRequestError`，**ai@4 的 `APICallError` 不认**，于是渲染层拿到的是 SDK 裸文案（如 `Bad Request`），没有结构化类别。——这是现存缺陷，迁移后一并消失（见二、错误行）。

| # | 功能（用户叫法） | 入口 文件:行 | 流式 | 怎么取消 | 怎么重试（含 429） | 超时：首字 / 整体 | 出错怎么显示 | 现有测试 |
|---|---|---|---|---|---|---|---|---|
| 1 | 画布文本节点：续写 / 重写 / 加工预设（扩写、看图写描述、翻译成…、拆成多条） | `src/workbench/generationCanvas/runner/textActions.ts:54` → `catalogTaskActions.ts:559`（`TEXT_STREAM_KINDS`）→ `taskApi.ts:356` → `electron/ai/textStreamIpc.ts:33` | 是 | 节点「停止」→ `onTaskCancelRequested` → `AbortController` → `nomi:tasks:text:cancel` → 主进程真掐 HTTP；渲染层抛 `LocalTaskCancelledError` | 主进程 SDK 2 次；**渲染层运行控制器再整体重提 ≤3 次**，判据是错误文案里含 `timeout`/`rate limit`/`socket` 等（`generationRetryPolicy.ts:14`、`generationRunController.ts:348`） | 主进程 30s / 120s；渲染层「提交中」阶段 ≈16 分钟，每来一段字重新计时（`generationPhaseDeadline.ts`，`clock.heartbeat()`） | 节点错误卡，`classifyError` 认 B64 标记给人话 + 动作 | `textActions.test.ts`、`catalogTaskActions.test.ts`、`taskApi.textStream.test.ts`、`textStreamIpc.test.ts`、`textStreamCancel.integration.test.ts`、`tests/ux/text-document-generation-ownership.test.mjs`（全部桩掉 SDK） |
| 2 | 画布文本节点：**改写选区**（疑即任务书里的「写作区 AI 改写」，见待拍板 D6；**10-21 起改走 #1 同一扇流式门，见六**） | `textActions.ts:48`（`mode === 'rewrite'` 不传 `onTextDelta`）→ `catalogTaskActions.ts:586` → `canvas-submit` 或 `nomi:tasks:run` → `runtime.ts:405` | **否**（完成后一次性替换选区） | 只有渲染层不再等；**主进程那次调用没有取消信号**，跑到 SDK 自己结束或 120s | 同 #1（SDK 2 次 + 渲染层 ≤3 次） | 主进程 30s / 120s；渲染层同 #1 | 节点错误卡；一次性路**没有结构化标记**，SDK 裸文案靠关键词猜 | `textActions.test.ts`（桩） |
| 3 | 提示词优化（节点提示词框里的魔法棒） | `src/workbench/generationCanvas/nodes/NodePromptOptimizer.tsx:77` | 是 | 再点一次按钮 = abort → 主进程真掐 | SDK 2 次；无渲染层重试 | 主进程 30s / 120s；渲染层无 | 面板里 `e.message` 原样——**vendor 错误时会把 `NOMI_VENDOR_ERR_B64::…` 标记串直接露给用户**（推断，第二段先写测试证实，见 D7） | `NodePromptOptimizer.test.ts`（桩） |
| 4 | 提示词翻译（中英互译按钮） | `NodePromptTranslator.tsx:73` | 是（只攒不显示，完成后整段替换） | 运行中再点 = abort → 主进程真掐 | 同 #3 | 同 #3 | 节点上方反馈条：`failedWithReason` 带 `e.message` 原样（同 #3 的标记串问题） | `promptTranslate.test.ts`（只测纯函数，无调用测试） |
| 5 | 接入设置 → 自定义调用脚本 → 「AI 起草 / 修复脚本」 | `src/ui/onboarding/CustomCallEditor.tsx:203` | 是 | 再点 = abort → 主进程真掐 | 同 #3 | 同 #3 | 编辑器下方 `aiError` = `e.message` 原样（同上） | 无调用测试（`customCallModeEditor.test.ts` 等不碰 AI） |
| 6 | 视频拆解：逐镜读图（每镜 3 帧，并发 4） | `electron/video/deconstructVideo.ts:466`（`image_to_prompt`，`maxRetries: 0`，`temperature 0.2`） | 否 | **无**（拆解整体没有停止） | **主进程不重试**（10-11 拍板：失败原话落表，用户点重试 = 新报价）；无渲染层重试 | 主进程 30s / 120s | 分镜表那一格写失败原话（`failureReason`）；授权闸失败则整体抛 | `deconstructVideo.test.ts`、`deconstructVisionLeg.test.ts`、`deconstructLegResolution.test.ts`、`tests/ux/video-deconstruct.e2e.mjs`、`deconstruction-*.walk.mjs` |
| 7 | 浏览器 → 画面复刻 / 画面风格（提取提示词进提示词库） | `src/ui/browser/prompt/browserPromptExtractionRunner.ts:93`（`runWorkbenchTaskByVendor` → `nomi:tasks:run`） | 否 | 无主进程取消；换项目只丢弃结果 | SDK 2 次 | 主进程 30s / 120s；渲染层无 | 内联提示 `promptExtractionFailedToast` + `e.message`（一次性路裸文案） | `browserPromptExtractionRunner.test.ts`（桩） |
| 8 | 外部 Agent（MCP）`nomi_try_model` 试跑一个文本模型 | `electron/capabilityCore/modelOnboarding/tryModel.ts:174`（`deps.runTask`，kind 取声明的第一个） | 否 | 无；40s 预算到点只回话不中止（`TRY_MODEL_WAIT_BUDGET_MS`） | SDK 2 次；工具层不重试 | 主进程 30s / 120s；工具 40s 回话 | MCP 工具结果 `submissionUnknown` / 错误原文 | `tryModelAsyncQueued.test.ts`、`tryModelSubmitBudget.test.ts`（桩） |
| 9 | 画布单镜 Run（canvas-submit）里的文本节点执行 | `electron/capabilityCore/canvasTransportProvider.ts:167`（`runTask(…, RUN_APPROVED_ADMISSION)`） | 否 | Run 撤回只管还没交出去的；已在跑的文本调用无取消 | SDK 2 次 | 30s / 120s | 经 Run 回到 #2 的错误卡 | 画布 Run 系列测试（桩运行时） |
| 10 | Antigravity（本机官方 CLI 当文本模型） | `streamTextTask.ts:89`（`vendor.key === ANTIGRAVITY_VENDOR_KEY` 分支 → `runAntigravityTask`） | 是（CLI 增量） | 传 signal 给 CLI 进程 | CLI 自己 | CLI 自己的时限 | 同所在调用方 | `streamTextTask.test.ts:11`、`antigravityTask.test.ts` |
| 11 | 接入新模型时「Nomi 自己读文档写说明卡」（适配器编译器） | `electron/providerAdapter/compiler.ts:55`（ai@4 `generateObject`，mode json）；模型来自 `serviceLanguageModels.ts:32,40` → `buildLanguageModelForVendor` | 否 | `input.signal`（接入会话取消） | `maxRetries` 由编译器传；多候选模型逐个试 | 无 30/120 闸（不走 `streamTextTask`）；会话层自己的时限 | 接入流程的失败卡 | `compiler.test.ts`、`serviceHangingModel.integration.test.ts`、`service*.test.ts`（注入假 `LanguageModelV1`） |
| 12 | 网络冷启动代理探针（测试资产） | `tests/network/proxy-cold-main.cjs:170-173`（`buildAiSdkModel` + `generateText`） | — | — | — | — | — | 它本身就是测试 |

查过、**不是** ai@4 文本栈的（列出来是为了证明没漏）：
- 已在 pi 上：Agent 面板（lane 主路）、`laneDesktopRuntime.ts:105` 的单次调用 → 渲染层 `shotVerifyJudge.ts`、`runDirectionPlanner.ts`（`mode:'chat'` 单次调用）。
- 不调文本模型：`integrationSession.ts:470`（只有 ComfyUI 认证）、`comfyCandidateTest.ts`、`providerAdapter/verifier.ts`（09-11 起不再向上游发生成请求，`builtinOpenAiCompatibleDraft.ts:21`、`service.ts:376` 里「验证走 streamTextTask」是过时注释，第二段顺手改）。
- 文本但不走 ai@4：`customCallDispatch.ts`（用户脚本自己发请求）。
- 只引类型 / 错误类的测试与渲染层测试：`classifyGenerationError.test.ts`、`agentError.test.ts`、`upstreamEvidenceParity.test.ts`、`offLedgerEgress.structure.test.ts`——删包时一起改。
- `tests/ux/_mcpJourney.mjs:190` 注释说 shot-verify 判官走 `streamTextTask`，实际已走 lane 单次调用，注释过时。

**测试现状的一句话**：上面 12 行，没有一条测试用**真 SDK 走真 HTTP** 跑过「先思考再出字」；唯一真往返的是 `aiSdkErrorWire.test.ts`（只测错误形状）。这正是 30s 误杀能活到真机走查才被发现的原因。

---

## 二、两栈事件语义对照（ai@4 `streamTextTask` ⇄ pi-ai `models.streamSimple` + lane 看门狗）

| 项 | ai@4（今天） | pi-ai 单次调用（lane 今天） | 差别 → 迁移时怎么对齐 |
|---|---|---|---|
| 正文 | `textStream` 逐段字符串 | `text_start` / `text_delta` / `text_end` 事件；结果在 `AssistantMessage.content[type=text]` | `text_delta` → `onDelta`；IPC 事件形状（`delta`/`done`/`error`）不变，渲染层零改动 |
| 思考 | 进 `result.reasoning`（Promise），**不在** `textStream`，所以不算「活着」 | `thinking_start/delta/end`（`reasoning_content` / `reasoning` / `reasoning_text` 都认，`openai-completions.js:411-434`），**算活着** | 思考事件只当心跳，不进正文、不过 IPC（渲染层当前不显示思考，见 D5）；`reasoning` 今天下游没人用（`textTaskRunner.ts:38` 只取 `finishReason`），不再返回 |
| 元数据 | `finishReason`、`reasoning` 两个 Promise，可能永不 settle（10-09 修过两次，2s 宽限） | `done` 事件一次给全：`stopReason`（stop/length/toolUse/error/aborted）、`usage`、`rawStopReason` | 映射回 TaskResult 的 `finishReason`：`stop→stop`、`length→length`；`content_filter` 在 pi 是 error（`openai-completions.js:1221`）。2s 宽限、`Promise.race` 收口这一整套删掉 |
| 结束 | `textStream` 读完 + 等元数据 | `done` 事件 / `result()` resolve | 一个事件，一个出口 |
| 错误 | 三种形态：`onError` 回调、`APICallError`、`RetryError` 套壳；流发不出去时**不抛也不关**（10-09 修） | 永远是一条 `stopReason:'error'` 的消息 + `errorMessage` 字符串（`formatProviderError`：`"<status>: <body>"`，`error-body.js:111`）；看门狗把它归一后**追加** `[nomi-classified: …]` 标记 | 不解析 pi 的字符串。主人里包一层 fetch：非 2xx 响应记下 `{status, body, url}`（同时写 `logVendorCall`，补上 lane 现在没有的失败留证），出错时用这份事实造 `VendorRequestError`（分类仍只查 `categorizeVendorFailure` 那一张表）。流式路、一次性路都抛同一种对象 → `runTaskIpcGuard` 自动编码，**一次性路从此也有结构化类别**。`[nomi-classified]` 标记只给 pi 内部重试判据用，不进用户文案 |
| 取消 | 外部 signal → 内部 controller；ai@4 abort 后流可能不 settle，靠「已中止」Promise 竞速收口；抛 `AbortError` | signal 直达 SDK + 看门狗 `AbortSignal.any`；被取消产出 `stopReason:'aborted'`，**pi 永不对 aborted 重试**，重试等待本身可打断（`provider-retry.js:49-63`） | 主人看到 `aborted` / signal 已触发 → 抛 `DOMException('…','AbortError')`，IPC 层照旧不发 done/error |
| 超时 | 首字 30s（只认正文）+ 整体 120s | 三相看门狗（`laneProviderGuard.mts:54-56`）：发出→响应头 90s；响应头→第一个事件 300s（思考期）；之后两事件间 120s。没有整体上限 | **直接用 lane 那一份常量**，不再有第二份数。整体上限见 D2（推荐所有调用统一一个 10 分钟兜底，只为没有取消手段的一次性路收尾，不当存活判据） |
| 重试 | SDK 默认 2 次、2s/4s、不可打断、不看 `Retry-After` | `retryProviderRequest`：缺省 **0 次**；可打断；认 `Retry-After`（上限 60s）；判据同为 408/409/429/5xx/无状态（`provider-retry.js:9-21,75-93`）。只重试流开始之前 | 主人显式传 `maxRetries`：缺省 2（保持现有策略），拆解 0（保持 10-11 拍板）。注意：重试发生在「响应头之前」，被 90s 首字节闸一起计时——两次 60s 的 `Retry-After` 会撞闸，按超时失败（可接受，写进 6 外部数据） |
| 凭据 | `findExecutableModelForTask` 解出明文 key → provider 构造参数；`authType:none` 不发 Authorization | 同一个 key → 每次调用一个 `InMemoryCredentialStore`；`authType:none` 显式把 Authorization 置空 | 来源不变（`revalidatePendingCredential` + `findExecutableModelForTask`），只换装配。key 不落盘、不进日志（fetch 包装只记主机 / 模型 / 状态 / 耗时） |
| 选模型 | 调用方给 vendor+modelKey（`getTextBrain` / 节点选的 / 拆解 `resolveVisionLeg` / 浏览器 `getTextBrain`）→ `findExecutableModelForTask` | lane：`chooseTextModel(preference)` → `selectModel` 拼 `NomiModelConfig`（`laneDesktopRuntime.ts:62-78`） | 选谁不变；**拼配置**抽成一个共用函数（从 `selectModel` 抽出），lane 和文本任务调同一个 → 同一模型两边请求体一致 |
| 请求体差异 | 只在调用方给了才发 `max_tokens`；温度缺省 0.7；`modelProfiles`（o1/o3 温度、kimi `enable_thinking`）在 `buildProfiledFetch` 里套 | pi 额外发 `stream_options.include_usage`；`max_tokens` = 调用方给的 ?? 目录声明的 `maxOutputTokens` ?? anthropic 4096；`modelProfiles` 只在 lane 的 `rewritePayload` 里套（`laneDesktopInput.ts:113`） | 温度缺省 0.7 由主人传；`modelProfiles` 挪进 `createNomiProvider` 的 `onPayload`（一处，lane 删掉自己那行）；目录声明的 `maxOutputTokens` 文本任务也开始发（与 Agent 对齐，见 D9） |
| Anthropic 地址 | `anthropicBaseUrl()` 把只存了根（`https://api.anthropic.com`）的补成 `/v1` | `anthropicFetch` 假定配置里**已带** `/v1`；存的是根时会请求 `…/messages` → 404（`laneModelProvider.mts:72-75` + `vendorModelConnection.ts:25-26`，推断，第二段用测试证实） | 规范化挪进 `vendorModelConnection`（两台共用的那一处），顺手修掉 lane 的同一个潜伏 bug |
| 图片输入 | `nomi-local://` 读字节；`http(s)` **按 URL 引用**交给上游自己去取；`data:` 原样 | `ImageContent` 只收 base64（`types.d.ts:251`） | 见 D4：推荐本机取回再内联（复用 `antigravityTask.ts:14-37` 的 `hardenedFetch` 取图，抽成共用的读图函数），保留「要了图却一张都读不出就报错、不让模型瞎编」的闸 |
| 进程边界 | CJS 直接 `import { streamText } from "ai"` | pi 是 ESM，CJS 经 `laneNativeLoader.cts` 动态 import，入口登记在 `laneNativeLoader.entries.json` | 新入口登记为 `use` 阶段，不进打开项目的路径 |
| 结构化输出（仅 #11） | `generateObject({mode:'json'})` + `experimental_repairText` + `NoObjectGeneratedError` 兜底 | 无 `generateObject`；单次调用拿文本 | 编译器改为单次调用 → `parseAdapterContractText`（已有）→ zod 校验（已有）；`response_format: json_object` 经 `onPayload` 照旧发 |

---

## 三、设计卡（九格全填）

### 功能分类
- [ ] 新界面 / 改交互
- [ ] 花钱
- [x] 长跑 / 可打断
- [ ] Agent 行为
- [ ] 大数据量 / 画布 / 长列表
- [ ] 生成效果
- [ ] 数据格式
- [x] 新增功能 / 性能

### 先查别人（★0）

- pi-ai 的子路径导出（协调 10-21 要求先查能不能只装用得到的部分）：`node_modules/@earendil-works/pi-ai/package.json` 的 exports 只开放 `./api/*` `./utils/*` `./providers/*` 等；我们要的 `createModels` / `createProvider` / `InMemoryCredentialStore` 住在 `dist/models.js` / `dist/auth/credential-store.js`，只经入口 index 导出（实测 models.js 单装 12ms、index 冷装约 0.6–2.4s）· **改了**冷启动的做法：绕过 exports 深引会破坏包封装（ERR_PACKAGE_PATH_NOT_EXPORTED），不采用；改为窗口加载后空闲预热核心 + 三条协议 + 离线空跑一次（electron/ai/modelCallPrewarm.ts），并在登记表 model-call-boundary 的 revisitWhen 写明「pi 提供按需子路径时删预热」。

- 我们自己的 lane：`electron/agentLane/laneStreamObserver.mts:137` 把「响应头之后的任何事件」算作活着，三相预算在 `electron/agentLane/laneProviderGuard.mts:54-56`（10-06 NF-1001-0004 踩过：120s 空闲表把长思考当卡死）· **确认了**「存活判据看任意事件、思考期单独给 300s」这一决定，文本任务直接复用这一份常量，不另起数。
- pi-ai 的重试：`node_modules/@earendil-works/pi-ai/dist/utils/provider-retry.js:75` 缺省 0 次、可打断、认 `Retry-After`（上限 60s，`provider-retry.js:22-43`）；SDK 自己的重试被关掉（`openai-completions.js:211`）· **改了**「重试次数靠 SDK 默认」→ 主人按调用方显式传（缺省 2、拆解 0），并且停止键在退避等待中也立刻生效。
- ai@4 的反例：`node_modules/ai/dist/index.js:6172` `textStream` 只放正文；`index.js:363-403` 重试等待不响应取消、不认 `Retry-After` · **确认了**类根因是「判活信号选错」而不是「30s 太短」，所以不调数、换实现。
- pi 编程助手的传输层：`node_modules/@earendil-works/pi-coding-agent/dist/core/http-dispatcher.js:3` 默认 300s 按字节空闲 · **确认了**不加比 300s 更紧的思考期闸。
- pi-ai 对断流更严：`openai-completions.js:494-501` 流结束却没有 `finish_reason` 直接报错，ai@4 当成功收 · **改了**「半截流算成功」→ 算失败（D3）。
- OpenAI SDK 在 SSE 里遇到 `data.error` 直接抛 `APIError`（`node_modules/.pnpm/openai@6.40.0_ws@8.21.3_zod@3.25.76/node_modules/openai/core/streaming.js:49-50`）· **确认了**「200 里包着的错误」不会被当成空正文，6 外部数据按这条写测试。
- 我们自己的读图先例：`electron/ai/antigravityTask.ts:14-37` 用 `hardenedFetch`（20MB、限类型、不跟跳转、20s）把远程图取成字节 · **改了**图片输入的做法（D4 推荐复用它，不新写一个下载器）。

### ★1 用户怎么用

- 当我在画布里让文本节点续写 / 改写、给提示词点优化或翻译、拆解一段视频、在浏览器里提取一张图的提示词时，我想用我接好的任何文本模型（包括先思考很久的那种），以便拿到结果，或者在真出问题时看到一句说得清的原因、并能随时停下。
- 步骤：①选好或跟随 Agent 的文本模型；②点动作；③（流式的）看到字一段段出来，思考型模型先安静一阵；④完成落地 / 失败看到原因 / 点停止立刻停。
- 不做什么：不改任何界面和文案；不改选模型规则；不改花钱闸位置；不显示思考内容；不改渲染层的重试策略（主进程 2 次 × 文本节点渲染层 ≤3 次的叠加是现状，另记跟进）。
- 已知坑：中转不发 `finish_reason`（D3）；`Retry-After` 大于 60s；只存了根地址的 Anthropic 接入；远程图要本机取回（D4）。
- 真实任务（第二段走查用）：① 写作区一段 600 字说明文，用 DeepSeek V4（思考型）改写（协调 10-21 定：写作区改写是 #1264 的新功能、还没进 main；本迁移合入后 #1264 合 main，由那条线重跑演练、协调跑真模型。本线演练拿 #1 流式与 #2 改写选区当替身）；② 一个分镜文本节点续写，用普通 chat 模型；③ 一段 20 秒、4 镜的真实短视频拆解。素材用仓库里已有的走查素材，模型由协调带 key 跑（本线不跑真模型）。
- 指标：主指标「思考型模型文本任务不被误杀的比例」目标 100%（量具：本机假上游「先想 35s 再出字」夹具，每个调用方一条，`electron/ai/` 下新集成测试）；质量指标「停止后主进程无悬挂 await」0 个（量具：同一组夹具 + 句柄计数）；护栏「首个可见反馈时延」不比 ai@4 差（量具：★7 的 perf 场景）；「429 请求次数」与现状一致（量具：假上游计数）。

### ★1b 连带界面

- 文本节点错误卡、提示词优化面板、翻译反馈条、自定义脚本编辑器错误行、拆解分镜表失败格、浏览器提取内联提示、MCP 试跑回执：**文案一律不变**；变的只有「一次性路的错误从此带结构化类别」，错误卡标题会从关键词猜测变成按类别给（与流式路一致）。
- 超时那句：今天是 `文本生成超时（首字 30s 未响应），已中断。请重试或更换模型。`（`streamTextTask.ts` 写死中文，i18n 基线里登记过 1 条）。迁移后改为按相位说（连不上 / 思考太久 / 出字中断），文案走 `desktopT` zh/en，旧那条基线随文件删除。这是唯一一处新文案，列进 ★4。

### ★2 谁说了算

- 概念「调文本模型（一次调用）」→ 唯一主人：`electron/agentLane/laneModelCall.mts`（新，从 `laneSingleShot.mts` 抽出的核心：装配 provider + 看门狗 + `models.streamSimple` + 事件归一 + 错误事实）。消费者：lane 单次调用（`laneSingleShot.mts`）、文本任务执行器（`textTaskRunner.ts` 的 `executeTextTask`）、适配器编译器（`compiler.ts`）。lane 主路（AgentHarness 多轮）继续用同一个 `createNomiProvider` + 看门狗，不经这个函数（它是循环，不是一次调用）。
- 「模型连接配置」→ 唯一主人：`vendorModelConnection.ts` + 新抽出的 `nomiModelConfigFor()`（lane 的 `selectModel` 与文本任务都调它）。
- 状态归主进程；渲染层只经既有 IPC（`nomi:tasks:text:*`、`nomi:tasks:run`）。同一份事实存几份：1（超时常量、重试判据、错误分类表都只一份）。
- 花钱闸：`runtime.ts:405` 的 `admission.spendGate` 在执行层**之前**，本次不动；流式路今天不过闸（文本被当作不花钱的那几条，`taskIpcHandlers.ts:36`），也不动。
- 不靠「东西不见了」猜意图：取消走显式 signal。
- **硬约束（协调 10-21 定）**：`nomi:tasks:text:*` 的 IPC 契约一字不变——事件只有 `delta{delta}` / `done{result}` / `error{message}` 三种，形状不变；取消语义不变（`cancel` 后不发 done、不发 error，渲染层自己按取消收尾）。#1264 的写作区改写（`src/workbench/creation/aiRewrite/rewriteModel.ts:42` 调 `runWorkbenchTextTaskStream`）靠这条约束不改一行就走新核心；`textStreamIpc` 的契约测试钉住它。
- 整体上限（D2）：核心总接受 signal；调用方**没传** signal 时核心自加 `MODEL_CALL_CEILING_MS`（10 分钟，`AbortSignal.timeout`）兜底；传了 signal 的流式入口（#1 #3 #4 #5 #11）不设整体上限，只靠三相看门狗。常量与 `LANE_STREAM_WATCHDOG` 同住 `laneProviderGuard.mts`，只有一份。
- 门表（迁完）：`door-map.mjs` 对新核心应只剩 3 扇写门（lane 单次、文本任务、编译器）；`streamTextTask` / `buildLanguageModelForVendor` 0 扇（文件已删）。

### ★3 一致与复用

- 复用：pi-ai（已是依赖，lane 在用）、`createNomiProvider`、`LANE_STREAM_WATCHDOG`、`categorizeVendorFailure`、`hardenedFetch`、`parseAdapterContractText`。不新增任何依赖。
- 删除（P1 同 PR 删旧）：`electron/ai/streamTextTask.ts`、`buildAiSdkModel.ts`、`vendorLanguageModel.ts`、`aiSdkVendorError.ts`（`upstreamMessageFromBody` / `upstreamCodeFromBody` 挪到 `runtimeVendorError.ts`）、`agentError.ts` 里 AI SDK 那段、相关测试；`package.json` 删 `ai`、`@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/openai-compatible`（前提 D1 选 A）。
- `self-written.json` 的 `ai-sdk-text-stack` 改成已替换；`check:self-written` 证据。

### ★4 全状态

| 状态 | 用户看到什么 |
|---|---|
| 空（模型回了空正文） | 各入口现有的「空结果」文案不变（优化器 `emptyResult`、翻译 `emptyResult`、拆解 `visionUnparseable`、提取 `promptModelEmpty`、脚本 `aiEmpty`、文本节点不落地） |
| 加载（连上前 / 思考中） | 现状不变：流式入口显示「提交中」/ 按钮转圈；思考期不再在 30s 被掐 |
| 成功 | 不变 |
| 失败 | 错误卡 / 反馈条，带上游原话；一次性路新增结构化类别 |
| 部分成功（字出到一半断流） | 新：按失败处理（D3），流式入口已出现的半截字由各入口现有失败路径收掉，不当成功落地 |
| 取消中 | 不变：点停止立刻停，不发 done，不显示错误 |
| 过期 | 不适用：文本任务没有可找回的上游任务号 |
| 能力不可用（没配文本模型 / 凭据失效） | 不变：`getTextBrain strict` 报「没有可用的文本模型」并带去设置的入口 |
| 超时（新文案） | 「服务商一直没有响应」/「模型思考超过 5 分钟没有出字」/「出字中途停了 2 分钟」三句，zh/en，`check:i18n` |

### 5 中途表

格式：今天（ai@4）→ 迁移后。「花费」指上游按 token 计费：没出字的失败一般不计，已出字的部分可能计（不由我们决定）。

| 调用方 | 停止 | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| #1 文本节点续写/重写/预设 | 真掐 HTTP、不发 done · 已出字部分可能计 · 回执：节点回到可再跑 → **不变**；且重试退避中点停也立刻生效（今天要等完 2s/4s） | `destroyed` 监听掐流 → **不变** | 连不上：SDK 重试 2 次后失败；出字中断网：可能挂到 120s → 连不上：重试 2 次后失败；出字中：120s 空闲闸 | 进行中的丢失，节点在重启时收敛到终态，不续跑，不重复扣 → **不变** | 运行控制器对同一节点去重 → **不变** |
| #2 改写选区（一次性） | 渲染层不等了，主进程那次跑到结束或 120s → 跑到结束或空闲闸（D2 的 10 分钟兜底保证一定收尾）；结果到了也不落地 | 主进程继续跑完、结果丢弃 → 不变 | 同 #1 | 同 #1 | 同 #1 |
| #3 提示词优化 | 再点 = 真掐 → 不变 | 同 #1 | 同 #1 | 面板态丢失，不续跑 → 不变 | 运行中再点 = 停止 → 不变 |
| #4 翻译 | 同 #3 | 同 #1 | 同 #1 | 同 #3 | 同 #3 |
| #5 AI 起草脚本 | 同 #3 | 同 #1 | 同 #1 | 同 #3 | 同 #3 |
| #6 视频拆解读图 | 无停止 → 不变 | 主进程继续跑完全部镜头 → 不变 | 不重试，该镜失败原话落表 → 不变（失败原话变为结构化后的人话） | 拆解中断，已有恢复路径 `deconstruction-interrupted-recovery.walk.mjs` → 不变 | 面板防重入 → 不变 |
| #7 浏览器提取 | 无 → 不变 | 跑完丢弃 → 不变 | SDK 重试 2 次 → pi 重试 2 次（可打断） | 丢失 → 不变 | 每次点一张新请求 → 不变 |
| #8 MCP 试跑 | 无；40s 回话不中止 → 不变 | 不相干（外部 Agent 进程） | 同 #7 | 丢失，结果未知 → 不变 | 每次调用一次请求 → 不变 |
| #9 画布 Run 文本 | 撤回只管未交出的 → 不变 | 主进程观察者收完 → 不变 | 同 #1 | 同 #1 | Run 去重 → 不变 |
| #10 Antigravity | 不变（不走 HTTP） | 不变 | 不变 | 不变 | 不变 |
| #11 编译器 | 会话取消 → signal → pi 真掐 | 会话取消 → 不变 | 候选模型逐个试 → 不变 | 接入会话已有恢复 → 不变 | 会话去重 → 不变 |

### 6 外部数据与失败

外部来源：OpenAI 兼容 chat completions（SSE）、OpenAI Responses、Anthropic Messages、各类中转、本机 Ollama 类免鉴权端点、远程图片 URL。规范：OpenAI streaming 与 Anthropic streaming 官方文档（第二段在测试注释里贴链接与查阅日期）。

| 情形 | 我们的偏差 / 处理 | 用户看到 |
|---|---|---|
| 思考型模型（`reasoning_content` 先流 35s） | 思考事件算心跳；300s 思考期预算 | 等到正文，不被误杀 |
| 思考但**不流**思考（静默想） | 响应头后 300s 内出第一个事件即可 | 超过 5 分钟：「模型思考超过 5 分钟没有出字」 |
| 429（带 / 不带 `Retry-After`） | 缺省重试 2 次（拆解 0），可打断，`Retry-After` ≤60s 照等，>60s 直接失败；连带 90s 首字节闸 | 失败时结构化「额度 / 限流」类人话 + 上游原话 |
| 空回包（200 + 空正文 + stop） | 不报错，正文空 | 各入口现有「空结果」文案 |
| 包装过的回包（200 里 SSE `data.error`，或 200 + 非 SSE 的 JSON 错误体） | 前者 SDK 抛 `APIError`（无状态码）→ 上游原话；后者流里读不到事件 → 「流结束却没有 finish_reason」→ 归「服务商流中途断了」 | 上游原话 / 断流人话；不甩锅给 key |
| 4xx/5xx（含 body 里的人话） | fetch 包装记 `{status, body}` → `VendorRequestError` | 与图片 / 视频同一张分类表的人话 |
| 不发 `finish_reason` 的中转 | 按失败（D3） | 「服务商的流中途断了」，可重试 |
| 超时三相 | 见二、超时行 | 三句按相位的人话 |
| 远程图 403 / 过大 / 非图片 | 本机取回失败 → 该图跳过；全部失败则报错不让模型瞎编（保留现有闸） | 现有「图片读不出」文案 |
| **谁去取图变了**（D4，协调 10-21 定） | 今天 `http(s)` 图按 URL 交给上游自己取；迁移后由**本机**经 `hardenedFetch` 取回再内联：默认跟跳转、每跳重新过外发授权，内网 / 回环被拒，跨域跳转剥凭据头；类型 png / jpeg / webp / gif，上限 20MB | 防盗链 / CDN 跳转的图更稳；指向内网的图被拒（测试：URL 直指内网、跳转到内网各一条） |
| 失败留证 | fetch 包装记 `{status, body, url}`：URL 去掉查询串（有的厂商把 key 放 `?key=`），body 截断并过现有脱敏 | 日志与 `logVendorCall` 里不出现 key（测试：key 在查询串 / 请求头两种） |

### ★7 性能

1. 新增 / 改变的用户操作：「点文本动作 → 第一段可见反馈」（流式入口 = 第一段字出现在节点 / 面板；一次性入口 = 结果落地）。
2. 最坏规模：冷启动后第一次文本调用（pi 岛首次动态 import + OpenAI SDK 首次加载）；拆解并发 4 路同时首调。
3. 预算：本机假上游「立刻吐第一段字」时，从主进程收到请求到 IPC 发出第一个 `delta`：热 p95 ≤ ai@4 基线 + 10ms；冷 p95 ≤ ai@4 冷基线（不许变差）。没有可借的现成量具（现有量具都是渲染层手势）：在 `scripts/perf-scenarios-lib.mjs` 的 `DRIVERS` 补一个驱动，驱动脚本 `tests/perf/text-first-delta-bench.mjs` 只做「起假上游 → 调 `executeTextTask` → 记时间」，不写剖析器。
4. 场景：`text-task-first-delta-warm`、`text-task-first-delta-cold`，`budgetStatus: proposed`。**第一个提交先在 ai@4 上量基线**，迁移后同场景再量一次，PR 交两组数。

### 8 真实条件

- Windows：是（本机）；英文界面：Electron 演练 zh/en 各截一轮；最小窗口：不适用（不改界面）；真规模：拆解 4 镜并发；干净安装：Electron 演练用隔离的 settings / projects 目录；真付费：本线不跑，写好真模型走查脚本交协调带 key 跑（key 只从运行时环境变量读）；键盘全程：不适用。
- 没跑的项一律记 `unverified`。

### 拍板图清单

不适用：不改界面布局与组件，唯一新文案是超时三句（★4），走 i18n。

### ★9 验收与回滚

验收清单（动手前写全；实现线按它自验，附「反例 → 结果 → 证据」表；验收线 Codex V-textmigrate 只核这份）：

1. 本机假上游 + **真 SDK 走真 HTTP**，每个调用方（#1–#9、#11）各一条：
   - 先思考 35s 再出字 → 成功，不被误杀（先在 ai@4 上跑红，钉住症状）；
   - 响应头后断连 / 出字中断连 → 被掐，失败人话；
   - 停止 / 取消（流式入口 + 编译器）→ 收口，测试结束时无挂起的 Promise / 定时器 / socket；
   - 429（无 `Retry-After`、`Retry-After: 1`、`Retry-After: 120`）→ 请求次数：缺省 3 次、拆解 1 次、120s 那条 1 次后失败；退避中停止立刻生效；
   - 空回包、200 包错误、4xx JSON 错误体 → 各入口提示写清楚，一次性路带结构化类别。
   上一条线的测试与夹具若到时已落在 `D:/Nomi-coord-state/handoff/textstream-liveness/`，直接接入。
2. 反例（这一类会从哪回来）：
   - 另一个协议：OpenAI Responses、Anthropic（含只存根地址的旧接入）各跑「先思考再出字」；
   - 另一个入口：任何新代码 `import 'ai'` / `@ai-sdk/*` → 依赖已删，编译即红；任何文件在主人之外调 `streamSimple` / `stream` → 门岗红；
   - 旧数据：已有项目、已保存的模型设置（含 `maxOutputTokens`、自定义 headers、免鉴权、Anthropic 根地址）迁完照常可用；
   - 多图：拆解 3 帧，一帧读不出照跑、全读不出报错；远程 http 图取回 / 取不回。
3. Electron 整机零花费演练（本机假上游）：写作区改写、翻译、提示词优化、文本节点、拆解五个入口 + 浏览器提取、AI 起草脚本，zh/en 截图存 `docs/evidence/2026-10-21-text-tasks-pi-ai/`，自己 Read 过。
4. 真模型走查脚本：`tests/ux/text-tasks-real-model.walk.mjs`（名称第二段定），key 只读环境变量，本线不跑。
5. perf：两个场景的 ai@4 基线与迁移后数字。
6. 门岗：`pnpm run gates`、`pre-push-contracts.mjs` exit 0、`check-pr-judgement` 无 ✖、`check:self-written`、`check:root-cause-contracts`（schema-v3 合同 `docs/fixes/2026-10-21-text-task-liveness.root-cause.json`）、`check:framework-surface`（pi 新用到的 `maxRetries` / `temperature` / `onResponse` 等字段各下裁决）。

回滚：一个 PR、按批分提交（见四）。没有开关、没有并行旧栈（P1）。回滚 = revert 合并提交；本次不改任何落盘格式（目录、模型设置、项目文件都不动），revert 后旧数据照常可读。

---

## 四、迁移顺序与回滚

**为什么不「按调用方分批」**：普查结论是全部文本调用方只经过一扇门（`executeTextTask`），切换天然是一次；按调用方分批只会制造「一半走 ai@4、一半走 pi」的并行期。所以按**层**分提交，一个 PR，最后一个提交删 ai@4：

| 提交 | 内容 | 本批怎么验 |
|---|---|---|
| C0 | 真 HTTP 假上游夹具 + 每个调用方的特征测试（在 ai@4 上跑：思考 35s 那条红，其余绿钉住现状）；perf 驱动 + 两个场景，量 ai@4 基线 | 红绿截图 / 输出贴 PR；`perf:scenarios` 数字 |
| C1 | 共用层：从 `laneSingleShot` 抽出 `laneModelCall.mts`；抽 `nomiModelConfigFor()`；Anthropic 根地址规范化挪进 `vendorModelConnection`；`modelProfiles` 挪进 `createNomiProvider`；fetch 包装（失败留证 + HTTP 事实） | lane 全部测试（`tests/agent-runtime/`、`electron/agentLane/*.test.ts`）不变绿；新增 Anthropic 根地址测试 |
| C2 | `executeTextTask` 改走核心（Antigravity 分支原样保留）；图片取回；错误映射成 `VendorRequestError` / 超时 / `AbortError`；IPC 不动 | C0 全套转绿（含思考 35s）；一次性路错误带结构化标记 |
| C3 | 编译器改走核心（D1=A 时） | `compiler.test.ts`、`serviceHangingModel` 改用真 HTTP 假上游 |
| C4 | 删 ai@4：四个文件 + 测试 + `package.json` 四个依赖 + lockfile；门岗改写（`check-llm-stream-owner.mjs` → 「pi 单次调用唯一主人」）；登记表（self-written、boundary-owners-ledger、outbound-policy-baseline、i18n 基线、laneNativeLoader entries、framework-boundaries）；过时注释 | `pnpm run gates:full`、`pre-push-contracts.mjs` |
| C5 | 证据：Electron 演练截图、真模型走查脚本、perf 迁移后数字、root-cause 合同 | 对照 ★9 逐项 |

回滚粒度：整体 revert 合并提交（推荐）。若只需撤编译器，revert C3 + C4 中删依赖那部分即可（C3 独立）。

---

## 五、要协调拍板的点（每条带推荐）

| # | 问题 | 选项与代价 | 推荐 |
|---|---|---|---|
| D1 | 编译器（#11，`generateObject`）是否一起迁 | A 一起迁：`ai` 与三个 `@ai-sdk/*` 整体删掉，主进程只剩一台发动机，0.24 的 S5「AI SDK 版本裁决」变成「主进程不再装」；多改一个文件和它的测试。B 不迁：`ai` 包留着只给编译器，`buildAiSdkModel` / `vendorLanguageModel` 也得留，第二台发动机没删干净，门岗只能拦 `streamText` 不能拦整个包 | **A**。不迁就不是「删掉 ai@4 栈」 |
| D2 | 整体上限 | A 不设整体上限，只靠三相看门狗（与 lane 一致）：一次性路（#2 #6 #7 #8 #9）没有取消手段，遇到「一直慢慢滴字」的上游理论上不收尾。B 统一一个 10 分钟兜底（只为保证收尾，不当存活判据）。C 保留 120s：长文本合法输出会被掐（今天已经会） | **B**。今天 120s 会掐掉慢中转上的长剧本；10 分钟够任何正常文本任务 |
| D3 | 没有 `finish_reason` 就断的流 | A 照 pi：算失败（可重试）。B 打补丁让它当成功 | **A**。半截文字当成功落地是「静默骗人」那一类 |
| D4 | `http(s)` 图片输入 | A 本机取回再内联（复用 `hardenedFetch` 读图，20MB / png·jpeg·webp）：防盗链的图更稳，请求体变大；gif 等类型会被拒。B 经 `onPayload` 把 URL 原样写回请求体（仿 PDF 标记改写）：线上行为与今天一致，多一层改写 | **A**，类型白名单放宽到 `image/*` 的常见四种（加 gif） |
| D5 | 思考期要不要给界面一个「在思考」信号 | A 不给（本次不改界面）。B IPC 加 `thinking` 心跳事件 + 新文案 = 新界面，要走设计流程 | **A**，另记跟进 |
| D6 | 任务书「写作区 AI 改写」指哪个入口 | 写作区（创作文档）里的 AI 走 Agent lane，报不出「首字 30s 未响应」这句；会报这句的是画布文本节点的「改写选区」（#2）| 请确认按 #2 理解 |
| D7 | 提示词优化 / 翻译 / AI 起草脚本把错误标记串原样露给用户（推断） | A 本 PR 顺手修：这三处与文本节点一样走 `stripVendorErrorMarker` / 分类后的人话，不加新文案。B 另开线 | **A**（同一类「文本任务错误怎么显示」，第二段先写测试证实再修） |
| D8 | 文本节点的双层重试（主进程 2 次 × 渲染层 ≤3 次） | 本 PR 不动（任务书「照现在的策略」）| 另记跟进 |
| D9 | 目录里声明的 `maxOutputTokens` 文本任务也开始发 | A 与 Agent 对齐（一份配置一个行为）。B 文本任务刻意不发（两处行为不同） | **A** |

### 拍板结果（协调 10-21 定，第二段照此实现）

- **D1 → A**（协调 10-21 定）：编译器一起迁；`ai` 与三个 `@ai-sdk/*` 整体删。
- **D2 → 改过的 B**（协调 10-21 定）：核心总接受 signal；没传 signal 时核心自加 10 分钟上限（`AbortSignal.timeout`）；传了 signal 的流式入口（#1 #3 #4 #5 #11）不设整体上限，只靠三相看门狗。理由：流式入口有停止键、进度看得见，思考 5 分钟加慢中转出长文可能合法超过 10 分钟；一次性入口（#2 #6 #7 #8 #9）没有取消手段，才需要兜底。常量与 `LANE_STREAM_WATCHDOG` 同处、只一份。
- **D3 → A**（协调 10-21 定）：没有 `finish_reason` 就断的流算失败，与「出字中途断连」走同一条现有失败路径，不加新界面。仓库里有录好的 APIMart 流形状就写测试，没有就记 unverified，由协调的真模型走查证实。
- **D4 → A**（协调 10-21 定）：本机取回后内联，直接用 `hardenedFetch` 的默认跳转处理（不照抄 antigravity 的「不跟跳转」，结果图常走 CDN 跳转）；类型 png / jpeg / webp / gif，上限 20MB；6 外部数据补一行；补「URL 指向内网被拒」「跳转到内网被拒」两条测试。
- **D5 → A**（协调 10-21 定）：不加「在思考」信号，另记跟进。
- **D6 → 纠正**（协调 10-21 定）：「写作区 AI 改写」是 #1264（`feat/creation-ai-rewrite`）的新功能，未进 main；它调 `runWorkbenchTextTaskStream`，与 #1 同一扇流式门。`nomi:tasks:text:*` IPC 契约一字不变写进 ★2 作硬约束；本线演练拿 #1 与 #2 当替身；★1 真实任务①改由 #1264 合 main 后那条线重跑、协调跑真模型。
- **D7 → A**（协调 10-21 定）：先写测试证实，再在本 PR 修，不加新文案。
- **D8 → 不动**（协调 10-21 定），另记跟进。
- **D9 → A**（协调 10-21 定）；另列目录里文本模型声明的 `maxOutputTokens`，明显会截断长文的写进 PR，不私改目录。

补充要求（协调 10-21 定）：复盘草稿进 `docs/audit/2026-10-21-text-stream-first-token-gate.md`，碰热点的提交带 `Direction-Check:`；渲染层重试判据不许被文案改动带偏——超时 / 429 / 5xx 带结构化类别，「错误种类 → 渲染层是否重提」对照测试迁移前后结果一致，`classifyError` 按类别给人话与动作；失败留证不漏 key；perf 预算按 ★7 批准，冷启动变差就在窗口显示后空闲时预热 pi 岛（不进打开项目路径），不许放宽；真模型走查用 `tests/ux/_paidRun.mjs` 的 `openPaidWalk` / `_paidEnvKey`，命名 `*.paid.mjs`，最小花费；文档同步 `ARCHITECTURE-NOW.md`、`GLOSSARY.md`、`self-written.json`。

## 六、第二段结果（实现线自验，2026-10-21）

- **调用方矩阵**（`electron/ai/textTaskCallers.integration.test.ts`，真 pi-ai + 真 HTTP 假上游，9 个调用方 × 正常 / 空回包 / 429 / 503 / 401 / SSE 包错 / 断流 / 无 finish_reason / 停止 / IPC 契约）：ai@4 上 19 红 → 迁移后全绿；计时类（`textTaskCallers.timing.integration.test.ts`：三相看门狗、整体兜底只给一次性入口、渲染层不自动重提）36 绿。
- **真墙钟「先想 35 秒」**：9 个调用方在 ai@4 上全部 30 秒被掐 → 迁移后全过（`docs/evidence/2026-10-21-text-tasks-pi-ai/`）。
- **Electron 零花费演练**（`tests/ux/text-tasks-pi-ai.rehearsal.walk.mjs`）：#1 扩写（流式，先想 35 秒）、#4 翻译、#3 优化中英两轮都过；#2 改写选区第一轮被付费闸挡（**迁移前就有**，见下），按拍板 A 修后中英两轮都过（`walk/04-zh-04-rewrite-done.png`、`walk/10-en-04-rewrite-done.png`）；#6 拆解被本机磁盘余量闸挡（no-disk-space，环境问题，记 unverified，等用户清盘后补）。
- **perf**（合 main 784dde0b1 之后）：热 中位 2.7 / p95 4.8ms（ai@4 基线 5.2 / 10.2，预算 20）；冷（预热完成后）中位 18.7 / p95 20.7ms（ai@4 基线 50.5 / 99.8，预算 100）；**刚启动就点、预热还没装**（真 App 主进程，10 次）：中位 174 / p95 207ms——唯一比 ai@4 差的情形（Node 子进程同量法 595–679ms，多出来的 pi-ai 入口在真 App 启动时已被别的模块装好）。
- **预热的触发（协调 10-21 第 3 条，`docs/evidence/2026-10-21-text-tasks-pi-ai/c6-prewarm-trigger.txt`）**：启动后固定 4 秒预热 = Electron 主进程一段 250–290ms 同步阻塞，撞上「启动后几秒打开项目」时冷打开 100 节点中位 946 → 1341ms；照协调改成「带文本动作的界面一挂上就在空闲回调里预热」——这些界面随项目一起挂，仍落在打开过程里（1257ms），不采用；最终改为**指针移进 / 焦点进文本动作**（提示词优化、翻译、文本节点输入框、Agent 输入框，`src/workbench/api/textActionIntent.ts`）时在渲染层空闲回调里预热，主进程只装目录里启用了的文本模型用到的协议、逐条装：打开项目时不开火，冷打开回到中位 963–1022ms；预热本身最长阻塞中位 184 / 最大 231ms（单个 openai SDK 的模块图，主进程里拆不小——仍高于 100ms 线，选项见交付报告）。
- **D9 目录里的 maxOutputTokens**：内置目录（seedBuiltins / apimartTexts / modelscopeTexts 等）没有任何文本模型声明 `meta.maxOutputTokens`，只有用户在目录里手填才会有；所以迁移后不会因为它把长文截断。
- **pi-ai 子路径**：`createModels` / `createProvider` / `InMemoryCredentialStore` 不在 exports 子路径里，只能经入口导入；深引会破坏包封装，不采用（见「先查别人」）。

### 演练发现的迁移前缺陷（协调 10-21 定：#2 选 A 本 PR 修；#7 另线）

- **文本节点「改写选区」一律失败**：改写不走流式门、走 `nomi:tasks:run` → `runtime.runTask` 文本分支的令牌付费闸（`TOKEN_ADMISSION`）；画布自「发动机收敛第一刀」起不再铸令牌，`assertAndConsumeQuotedSpend` 拿不到令牌直接抛 `SpendNotAuthorizedError`，错误卡归 unknown（截图 `docs/evidence/2026-10-21-text-tasks-pi-ai/walk/04-zh-04-rewrite-blocked-by-spend-gate.png`）。同类：浏览器「提取提示词」（#7）也走同一个闸、也没人铸令牌，推断同样失败（未在整机上跑）。矩阵测试直接调执行器、绕过了付费闸，所以没抓到——整机演练才暴露。
  - 选项 A：文本节点改写也走流式门（与 `paidNodeLedger` 文档里「文本不进 Run、不要授权、走它自己的流式口」一致；改写可停、也不再需要整体兜底）。代价：一次 IPC 路由改动，花钱语义与流式文本一致。
  - 选项 B：保留闸，在点击处铸令牌并弹确认。代价：每次改写多一次确认，与扩写 / 重写不一致。
  - 推荐：#2 选 A；#7 浏览器提取在 taskSpend 的注释里登记为「附属付费口」，按设计应走 B（铸令牌）——两条都属花钱边界，交协调定。
  - **拍板（协调 10-21）**：#2 → **A，本 PR 修**（只是让代码对齐 paidNodeLedger 已定的设计，不是新的花钱决策）；#7 → 本 PR 不动，属 M9（附属付费口例外，2026-11-15 到期），协调另排一条线先真机核实再交用户定 A / B。
  - **#2 修法**：走哪扇门只看 kind——文本 kind 在 `runCatalogGenerationTask` 里一律走文本流式门（`nomi:tasks:text:*`），`onTextDelta` 只决定增量给不给调用方看；改写不给增量、完成后照旧交编辑器一次性替换选区；停止照流式那套（`onTaskCancelRequested` → abort → `nomi:tasks:text:cancel`，主进程真掐 HTTP）。先写的真入口测试 `electron/ai/textEntries.ipc.integration.test.ts`（渲染层 generateText → 真 preload 桥 → 真 IPC handler → 真 runtime 准入 → 真 pi-ai → 本机假上游）修前抛 `SpendNotAuthorizedError`（`docs/evidence/2026-10-21-text-tasks-pi-ai/rewrite-ipc-before.txt`）、修后绿。
  - **为什么矩阵没抓到、以后怎么防**：矩阵的一次性门直接调 `executeTextTask`（注释写着「闸不在本测试范围」），测的是执行器往下，入口之上的准入整层看不见。现在矩阵每一行都登记 `entry`（谁发起、真入口测试是哪份、没有就写缺口），渲染层发起的调用方没有真入口测试就红（登记的例外只有 #7），测试见 `textTaskCallers.integration.test.ts`「真入口登记」。
