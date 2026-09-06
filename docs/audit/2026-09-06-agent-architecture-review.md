# Agent 架构总评审：我们接的是 pi，但我们没在用 pi（2026-09-06）

> 状态：📎 已收录 · **只读评审，一行产品代码未改** · 基线 `origin/main@d974e6a55`
> 起因：2026-09-06 深夜用户原话——「因为我们接的是 pi，你要仔细看 pi。这次是我们没有从底层架构上研究整体方案才出这种问题。」
> 配套方案：[`docs/plan/2026-09-06-agent-architecture-master-plan.md`](../plan/2026-09-06-agent-architecture-master-plan.md)
> 平行进行的工具层专项审计（含真实模型成功率测量）在分支 `docs/agent-tool-layer-audit-20260906`；它的结论出来后并进方案的 P1 段，本文不重复测。

---

## 0. 一句话说清这次的病

**我们把 pi 当成一个「发请求、收字符串」的 HTTP 客户端在用，而 pi 是一个完整的 agent 运行时。**

pi 一路把「模型这一轮说了什么」表达成**有顺序的段落**（说一段话 → 想一下 → 调个工具 → 再说一段话），我们在接缝处把它**压成两堆**：一个 `text: string`，一个 `toolCalls[]` 数组。压扁之后，「先说什么后做什么」这件事在系统里**不再存在**——不是显示层没画，是数据里没有了。面板上「文字一堆、工具一堆」不是 UI bug，是接缝形状的必然结果。

同一个病还有第二面：**pi 已经做好的事，我们关掉了，然后没有补上替代品**。重试关了、思考关了、价格表清零了、会话文件不用了。关掉的理由每一条单看都成立（隔离、可控、不信任 SDK 的默认值），但没有一条后面跟着「那这件事现在谁负责」。于是用户看到的是：一次 429 整轮失败、面板上的「花费」永远是空的、「推理 token」这一行永远不会出现——**不是因为我们诚实地不知道，是因为我们从来没告诉 pi 该怎么算**。

第三面是工具契约。最要命的一处：**模型给分镜表写 24 行，而它看到的 schema 只说「shots 是一个由任意对象组成的数组」**——25 个字段名一个都没告诉它。真正带字段名和说明的那份 schema 在 `electron/harness/tools/canvasDescriptors.ts`，而那个文件**是死的**（只有它自己的测试在 import 它），396 行测试全绿，证明的是一段没人跑的代码。

这三面共用一个根：**每一层都在自己那层做了合理的事，没有人负责「从模型嘴里出来的东西，到用户眼睛里看到的东西，中间不丢」这条纵向不变量。**

---

## 1. pi 到底给了什么

### 1.1 先说清楚 pi 是三个包，我们用的是中间那个

| 包 | 是什么 | 我们用了吗 |
|---|---|---|
| `@earendil-works/pi-ai` | 供应商适配层：39 家 provider、消息/事件协议、模型档案（含**价格表**和上下文窗口）、鉴权、图片 API | 用了一小半（三个 api 适配器 + 类型） |
| `@earendil-works/pi-agent-core` | agent 循环、工具执行、steering/follow-up 队列、压缩、技能加载、**durable session（JSONL 树、崩溃恢复、lane）** | 只用到类型；`AgentHarness` **在 0.84.3 是空壳**（见 §1.5） |
| `@earendil-works/pi-coding-agent` | 把上面两层包成一个 `AgentSession`：模型切换、压缩、**自动重试**、bash、会话文件、分支/fork、`getSessionStats()` | **这是我们真正在用的那层**（`createAgentSession`、`SessionManager`、`ModelRuntime`） |

证据：`electron/harness/runtime/pi/session.mts:2`、`model.mts:6`、`snapshot.mts:4`。

### 1.2 四列表

「另写了一套」= 我们自己实现了一份 pi 已经有的东西；「拆散丢掉」= pi 给了，我们在接缝处没接住。

| pi 提供 | 我们用了 | 我们自己另写了一套 | 我们拆散丢掉了 |
|---|---|---|---|
| **有序内容段**：`AssistantMessage.content: (Text \| Thinking \| ToolCall)[]`（`pi-ai/dist/types.d.ts:309`） | — | — | ⛔ **压成 `text: string` + `toolCalls[]`**（`runtimePort.ts:122-133`、`run.mts:73/201/267`） |
| **有序事件流**：`text_start/delta/end`、`thinking_*`、`toolcall_*`、`done/error`，每个都带 `contentIndex`（`pi-ai/dist/types.d.ts:400-453`） | 只订阅 `text_delta` / `tool_execution_*` / `turn_end` / `compaction_end`（`run.mts:194-233`） | — | ⛔ `contentIndex`（段序号）整个不过接缝 |
| **agent 事件（约 20 种）**：`queue_update`、`compaction_start/end`、`auto_retry_start/end`、`entry_appended`、`thinking_level_changed`、`agent_settled`…（`pi-coding-agent/dist/core/agent-session.d.ts:40-106`） | 6 种（`RuntimeActivityEvent`，`runtimePort.ts:74-80`） | — | ⛔ 其中 4 种（`tool-result`/`tool-error`/`step-finish`/`warning`）**到了宿主还被丢一次**：`projectAgentTurnExecution.ts:168-170` 只认 `content-delta` |
| **thinking（推理内容 + reasoning token 计数）** | — | — | ⛔ **结构性关闭**：`session.mts:37` `thinkingLevel:'off'` + `model.mts:71` `reasoning:false`。契约里已经加好的 `reasoningTokens` 字段（`runtimePort.ts:52`）**永远填不上** |
| **模型价格表 + `calculateCost()`**（39 家 provider 的 `cost`/`contextWindow`，`pi-ai/dist/providers/data/*.json`） | — | Nomi 自己的 catalog（`electron/catalog/`，254 文件） | ⛔ `model.mts:72` 把 cost 写死成 `{0,0,0,0}` → pi 算出 `total=0` → `run.mts:25` 的 `total > 0` 守卫把它当「未知」丢掉。**面板的「花费」行结构性永不出现** |
| **重试与退避**：`RetryPolicy`、`auto_retry_*` 事件、summarization 重试 | — | **没有替代品** | ⛔ `session.mts:32` `retry:{enabled:false, provider:{maxRetries:0}}` + `run.mts:165` `maxRetries:0`。一次瞬时 429/503 = 整轮失败 |
| **durable session（JSONL 文件 + 分支 + fork + label + `getSessionStats()`）** | 只用 `SessionManager.inMemory` | **整个 `electron/projectAgentHost/`（41 个生产文件 + reducer + 命令账本 + 修订号）** | ⛔ pi 的 stats（跨压缩边界的 token/费用汇总）拿不到 |
| **`AgentTool.prepareArguments`**——官方的「校验前把原始参数捏一下」钩子（`pi-agent-core/dist/types.d.ts:346`） | — | `z.preprocess` + `zodToJsonSchema` override 把该字段 schema 抹成 `{}`（`tools.mts:47-49`） | ⚠️ 这个 override 现在**零活跃用户**（唯一用它的文件是死的），但陷阱还在 |
| **steering / follow-up 队列**（`steer()` / `followUp()` / `clearQueue()` / 两种排空模式） | — | 宿主自己的队列（`ProjectAgentQueueItem`：插队/删/暂停） | ⛔ **结构性用不了**：`run.mts:67` 每回合开一个全新 session；主进程 IPC 里 `turn.steer`/`turn.interrupt` 存在（`projectAgentIpc.ts:537-549`），渲染层有封装（`projectAgentTurnCommands.ts:263-279`），面板上没有入口 |
| **压缩（compaction）**：阈值/溢出/手动、切轮保护、摘要重试 | ✅ **用了**（`run.mts:125-126`、`agentChatV2.ts:169`） | — | — |
| **`shouldStopAfterTurn`**（优雅停在回合边界） | ✅ **用了**（`run.mts:138`） | 又加了一条硬抛（`run.mts:151-153`）和一条把正常 `toolUse` 收尾翻译成 `step-limit` 错误的规则（`run.mts:260-262`） | ⚠️ 三条同义防线，第三条会把「刚好到上限的正常结束」报成失败 |
| **skills 加载（`loadSkills` / `formatSkillsForSystemPrompt` / `/skill:` 命令）** | 刻意不用（`resources.mts:3-11` 把 ResourceLoader 全部置空） | `formatNomiSkillIndex` + `load_skill` capability | ✅ **这条是正当分歧**：pi 的加载器会从 cwd 发现磁盘技能，破坏沙箱隔离不变量。理由写在代码里，保留 |
| **图片输入** | ✅ 用了（`run.mts:238`） | PDF 走自己的 native bridge（`attachments.mts`） | — |
| **`Model.input: ('text'\|'image')[]`、`thinkingLevelMap`、`compat`（OpenAI 兼容层探测开关）** | 只填 `input:['text','image']` | 自己的 `modelProfiles.ts`（正则识别 o1/gpt/claude/gemini/kimi 的怪癖） | ⚠️ `compat` 那一族开关（`supportsStore`/`supportsDeveloperRole`/`supportsReasoningEffort`/`supportsFinishReason`/`maxTokensField`）一个没用，我们在 `onPayload` 里手改 body 达到同样目的 |

### 1.3 「重复造轮子」前三

1. **持久化转录**。pi-coding-agent 的 `SessionManager` 是一棵带 id/parentId 的 JSONL 树，原生支持压缩条目、分支摘要、label、fork、跨压缩边界的 token/费用统计。我们用 `SessionManager.inMemory`（`session.mts:27`），每回合把它整棵导出成一个带 sha256 的信封字符串（`snapshot.mts:56`），下一回合再写进临时文件重新加载（`:69-88`），**同时**在旁边维护 `electron/projectAgentHost/` 这套 41 文件的事件溯源存储（`snapshot-v1.json` + `commands-v1.jsonl`，`projectAgentRepository.ts:351-357`）。**同一段对话现在有三份落盘表示**：pi 快照（`<project>/.nomi/agent-thread-context-v1.json`，`contextPaths.ts:17-21`）、宿主快照、以及渲染层 localStorage 里的工具正文缓存（`residentToolProjection.ts:88`）。三份的生命周期、信任级别、清除时机全不一样。
2. **用量与花费**。pi 的 `Usage` 带 `cost` 与 `reasoning`，`calculateCost` 按模型价目表算钱，`getSessionStats()` 跨全会话汇总。我们有**三层**各自的账：`nomiUsage()` 重映射（`run.mts:12-32`）、`agentUsageStore`（App 会话累计、入口就把 `cachedPromptTokens` 丢了）、`projectV4Context()` 按线程再汇总一遍（`agentPanelV4Projection.ts:421`）。三层都算不出钱，因为源头 `cost` 被写死成 0。
3. **重试**。pi 有完整的重试策略、指数退避、可观测的 `auto_retry_*` 事件、以及独立的摘要重试。我们把它整个关掉，然后**没有建任何东西**。

### 1.4 「拆散丢掉」前三

1. **段的顺序**。这是本次的头号病灶，三层各丢一次：
   - **接缝层**：`RuntimeTurnResult` 只有 `text: string` + `toolCalls[]`（`runtimePort.ts:122-133`）。`run.mts:73` 的 `let text = ''` 把八步里所有文字连成一根字符串。
   - **宿主层**：`projectAgentTurnExecution.ts:168-170` 的 `emit` 只处理 `content-delta`，`tool-result` / `tool-error` / `step-finish` / `warning` 当场落地。工具条目在回合**结束时**一次性生成（`:618`）。
   - **投影层**：一个回合只有**一条** assistant item，它的 `createdAt` 是**回合开始时刻**（`:95`），工具条目的 `createdAt` 是**回合结束时刻**（`:616`）。`agentPanelV4Projection.ts:247-254` 按 `createdAt` 排序 → **一个回合内，整段文字必然排在所有工具收据前面**。活的工具再单独接在最后（`:338-352`）。

   所以「文字一堆、工具一堆」是三层叠加的结果，只修任何一层都不够。
2. **思考**。`thinkingLevel:'off'` + `reasoning:false` 两处硬编码，让「思考」这件事在系统里不可能发生。v4 设计里那条「思考行 shimmer + 秒数」实际显示的是**「等第一个 token」的等待时长**，不是模型在推理。契约里的 `reasoningTokens`、面板上的「推理」行，都是给一个结构性不存在的东西留的位置。
3. **失败原因**（已在分支上修好，尚未合入 main）。运行时把「这回合为什么没成」的人话只在 hooks 上说一次，宿主的 `emit` 不认 `error`，于是当场丢弃；收尾又只在**工具级**失败时才建 failure 条目。结果：用户发「帮我做一条 90 秒短片」→ 供应商回 HTTP 400 带完整原因 → 面板只写「发送失败，请检查后重试。」，重启后连这句都没有。修在 `fix/real-env-acceptance-20260906@799564f91`。

### 1.5 一条重要更正：**不要**建议「直接换用 pi 的 AgentHarness」

`pi-agent-core` 的 `AgentHarness`（`dist/harness/agent-harness.d.ts:383`）看起来正是我们想要的东西——durable session、lane、崩溃恢复、deferred、导航树、usage 记账、hooks。**但在锁定的 0.84.3 里它是个空壳**：`prompt` / `skill` / `compact` / `navigateTree` / `resume` / `steer` / `followUp` 等全部 `return this.unavailable(...)`，抛 `HarnessNotImplemented`（实测 `dist/harness/agent-harness.js`，`HarnessNotImplemented` 出现 5 次、`unavailable` 23 次，整个实现只有 7.9 KB）。

**这条必须写进 `ARCHITECTURE-NOW.md` 的「常见误解」列**——它是下一个读 d.ts 的人（人或 AI）一定会踩的坑：类型面完整、实现是空的。

---

## 2. 现状架构：从 composer 一句话到出片

### 2.1 九层，每层的真相源与持久化

```
① 面板 UI            src/workbench/ai/v4/*            无状态，只吃 view model
② 投影层             agentPanelV4Projection.ts:257    宿主快照 → 8 个积木；纯函数，有单测
③ 渲染层状态          projectAgentProjectionStore.ts:106  手写 external store（不是 Zustand）
   ├ 草稿/附件/权限    workbenchStore.ts:253            Zustand
   ├ 活工具登记表      agentPanelV4PendingTools.ts:56   手写；只活在这一次运行里
   └ 工具正文缓存      residentToolProjection.ts:88     localStorage
④ 桥/IPC             projectAgentIpc.ts:39-48         7 个通道；渲染层自己铸造宿主记录
⑤ 宿主状态机          projectAgentHost/（41 生产文件）  reducer + 修订号 + 命令账本
   └ 落盘             projectAgentRepository.ts:351    snapshot-v1.json + commands-v1.jsonl
⑥ 执行协调器          projectAgentExecutionCoordinator.ts:83  排队、抽取、工具决策、发布
⑦ 请求装配            electron/ai/agentChatV2.ts:52     选模型 + 编提示词 + 选工具 + 定步数
⑧ 运行时接缝          electron/harness/runtime/runtimePort.ts  ← 顺序死在这里
   └ pi 侧            harness/runtime/pi/*.mts          每回合一个全新 AgentSession
      └ pi 快照落盘   contextStore.ts / contextPaths.ts:17  <project>/.nomi/agent-thread-context-v1.json
⑨ 能力域              shared/agentCapabilities/registry.ts:65  内外双别名 → 同一批 transport adapter
```

### 2.2 R14.1 七维横扫：同一语义现在有几份定义

| 语义 | 份数 | 各在哪 | 危害 |
|---|---|---|---|
| **「一个镜头长什么样」** | **3** | ① `harness/tools/canvasDescriptors.ts:37`（带 `.describe()`，**死的**）② `shared/agentCapabilities/canvasWrite.ts:144` = `z.array(z.record(z.unknown()))`（**活的、给模型看的、什么都没说**）③ `src/workbench/generationCanvas/agent/storyboardPlanSchema.ts:37`（25 个字段，**活的权威校验**） | 模型盲写 25 个字段名；写错在第③层才报错，模型看不到第①层的说明 |
| **一次对话的转录** | **3** | pi 快照 / 宿主 snapshot-v1.json / localStorage 工具正文 | 清浏览器存储 = 历史收据正文静默清空 |
| **助手这一轮说的话** | **2** 且互相覆盖 | 宿主增量 append（`:128-157`）与运行时自己累加的 `response.text`（`:684`）；reducer 只在两者不一致时 bump 修订号（`projectAgentAssistantFinalReduction.ts:60-63`） | 分歧被容忍且不可见 |
| **流式增量** | **2** | 主进程 `content-delta` 事件；渲染层再对相邻快照做字符串 diff 反推（`workbenchAgentRunner.ts:204-208`） | 文本非前缀变化时整段重发 |
| **步数上限** | **3** | `shouldStopAfterTurn`（`run.mts:138`）/ 硬抛（`:151`）/ 收尾翻译成错误（`:260`） | 正常到顶被报成失败 |
| **「这一轮还是我的吗」** | **4** | `projectAgentTurnCommands.ts:296` / `:338` / `:379`，`sameBinding` 另在 `:316` 与 `projectAgentProjectionStore.ts:29` 各定义一次 | 五处独立实现同一条身份判据 |
| **approvalPolicy 剥离** | **2** | 渲染层 `projectAgentTurnCommands.ts:179` + 主进程 `agentChatPolicy.ts:64` | 纵深防御，可接受；但字段在类型上仍合法，所以两道都得留 |
| **同一能力的工具名** | **2 套词表** | 内部 pi 别名 vs MCP 别名（`registry.ts` 双列声明是好的），但**分解方式不同**：时间轴读 = MCP 1 个 / 内部 3 个；媒体查询 = 1 / 5 | 渲染层要按两套名字对表（`agentPanelV4ActionFamily.ts:6` 自陈） |

### 2.3 死码：绿着的、看起来活的、其实没人跑的

| 东西 | 规模 | 唯一 importer | 为什么危险 |
|---|---|---|---|
| `harness/tools/canvasDescriptors.ts` | 471 行 5 工具 + 分镜/站位 schema | 它自己的 396 行测试 | 它是**唯一**带字段说明的分镜 schema；活的那份是空的。测试全绿，证明的是没人跑的代码 |
| `harness/tools/documentDescriptors.ts` | 86 行 6 工具（含 `author_skill`） | 同上 | 见下一行 |
| `agentChatPolicy.ts:85-86` | 3 行 | — | **活代码里的死分支**：在 `documentAll`（只有 read/edit 两个）里找 `author_skill`，恒 `undefined`。净效果：`creation-chat` 只有一个只读工具，且 **`skill.write` 能力从任何入口都够不着** |
| `modelToolSurfaceManifest.editing`（4 个 zod 描述符） | `:125-185` | MCP 侧 | 内部 agent 走的是 `editingPiDescriptors`，这四个**从不投影给内部模型** |
| `electron/ai/agentChatV2Ipc.ts`（6 个 IPC 通道 + 会话管理器） | 280 行 | 只有测试；`projectAgentCutoverStructure.test.ts:40` 还主动断言 main.ts **不**包含它 | 一整套 start/confirmTool/cancel/clearSession 协议在维护，没有任何窗口能到达 |
| `harness/runtime/pi/nomiSkillResources.mts` | 167 行 | 只有它自己的测试 | 与 `resources.mts` 明写的「这个缝必须空着」不变量直接冲突 |
| `src/config/models.ts:42-55`（12 个 LLM id） | — | 只有 `type` 被 import | 一份永远到不了用户的、写死的 LLM 名单 |
| `tools.mts:47-49` 的 preprocess override | 3 行 | 零活跃用户 | 下一个写 `z.preprocess` 的人会拿到一个被静默抹成 `{}` 的 schema，而且没有任何测试会红 |

### 2.4 `docs/ARCHITECTURE-NOW.md` 该更新的段落（草案）

在「子系统现状」表里，**改写一行、新增四行**：

| 子系统 | 现在跑的是什么 | 权威锚点 | ⚠️ 常见误解 |
|---|---|---|---|
| **Agent 运行时**（改写） | pi SDK `0.84.3`，实际用的是 **`pi-coding-agent` 的 `AgentSession`**（不是 `pi-agent-core` 的 `AgentHarness`）。**每个回合开一个全新 in-memory session**，跨回合靠导出/导入一个 sha256 信封快照 | `electron/harness/runtime/pi/session.mts:27`、`run.mts:67`、`snapshot.mts:56` | ❌「pi 的 `AgentHarness` 能给我们 durable session / lane / 崩溃恢复」——**0.84.3 里它是空壳**，`prompt`/`compact`/`resume` 等全部抛 `HarnessNotImplemented`（`dist/harness/agent-harness.js`）；❌「pi 的 steering 可以用」——每回合新 session，队列跨不过回合边界 |
| **模型回复的形状**（新增） | **一根字符串**。`ProjectAgentAssistantItem = { text, textRevision }`，一个回合一条。pi 的有序段（Text/Thinking/ToolCall）在 `runtimePort.ts` 就被压成 `text` + `toolCalls[]` | `electron/shared/projectAgentContracts.ts:246`、`electron/harness/runtime/runtimePort.ts:122-133`、`run.mts:201` | ❌「#515 无损历史 = 渲染层拿得到 message parts」——那是**主进程侧的不透明快照 blob**，不过 IPC；❌ 以为面板「文字一堆工具一堆」是 UI 排序 bug |
| **重试 / 思考 / 花费**（新增） | **三样都是结构性关闭的**：`retry:{enabled:false}` + `maxRetries:0`；`thinkingLevel:'off'` + `Model.reasoning:false`；`Model.cost` 写死 `{0,0,0,0}` 导致 `usage.cost.total` 恒 0，再被 `total>0` 守卫当「未知」丢弃 | `session.mts:32/37`、`model.mts:71-72`、`run.mts:24-26/165` | ❌「花费/推理 token 是暂时没接线」——**是结构上填不上**；❌ 以为一次 429 会自动重试 |
| **模型脑子的目录新鲜度**（新增） | Agent 自己的文本模型是**唯一没有任何自动新鲜度检查的模型类**。`radar:models` 只盯 image/video/audio（脚本第 30 行 `WATCHED` 明写不含 LLM）；退役靠用户撞到 `Model is retired` 报错，修复靠手改两个数组 | `electron/catalog/apimartTexts.ts:54-62`、`scripts/model-radar.ts:30-33`、`electron/catalog/seedBuiltins.ts:322-332` | ❌ 以为模型雷达覆盖 Agent 的脑子 |
| **给模型看的分镜 schema**（新增） | `nomi_canvas_plan` 的 `shots`/`anchors` 是 `z.array(z.record(z.unknown()))`——**给模型的 JSON Schema 里没有任何字段名**。真正的 25 字段校验在渲染层 `storyboardPlanSchema.ts:37`；带说明的那份在 `harness/tools/canvasDescriptors.ts`，**该文件已死** | `electron/shared/agentCapabilities/canvasWrite.ts:139-146`、`src/workbench/generationCanvas/agent/storyboardPlanSchema.ts:37` | ❌ 读到 `canvasDescriptors.ts` 就以为那是模型看到的契约 |

---

## 3. 技术栈与框架清单

`nomi@0.21.0`，pnpm 10.8.1，Node ≥22.19，主进程 **CommonJS**（package.json 无 `type` 字段——这一条是后面很多约束的根）。

| 层 | 现在 | 上游现役 | 我们卡在哪 |
|---|---|---|---|
| Electron | `43.4.1`（精确） | — | 无阻塞 |
| React | `^18.3.1` | 19 | `JSX.Element` **652 处**（19 删了全局 `JSX` 命名空间）；`@mantine/core@7.13` peer 是 `^18.2.0`（硬阻）；`@react-three/fiber@8` peer 是 `>=18 <19`（硬阻，连带 drei 9→10） |
| Zustand | `^4.5.4` | 5 | 靠 `use-sync-external-store@1.6.0` 垫片（vite dedupe 里钉着，源码零 import） |
| React Flow | `@xyflow/react@12.11.5` | — | peer `>=17`，不阻 React 19。17 个 import 全在 `generationCanvas/reactFlow/` 一个目录里，封装干净 |
| pi | `0.84.3` ×6 包（`pnpm.overrides` 硬锁，含两个非直接依赖 `pi-client`/`pi-tui`） | 更高版本存在（`AgentHarness` 在后续版本可能已实现，**未实查**） | 任何一次 pi 升级必须六个包一起动 |
| Vercel AI SDK | `ai@^4.3.19` | `7.0.93`（**ESM-only**） | 7 进不来（CJS 主进程）；目标是 **6**。**只有 8 个生产文件用它**，其中 5 个只 import 类型 `LanguageModelV1`；真正的运行时调用只有 `streamText`（`electron/ai/streamTextTask.ts:134`）和 `generateObject`（`electron/providerAdapter/compiler.ts:54`）各一处。渲染层零使用 |
| Mantine | `^7.13.1` | 8 / 9 | 8 是 React 19 的前置。**façade 是漏的**：`src/design/*` 8 个包装模块之外，onboarding(9)/settings/taskCenter/canvas 节点都直接 import `@mantine/core`（共 32 文件）。且 `tailwind.config.ts:601` 把暗色模式绑在 `[data-mantine-color-scheme="dark"]` 上，`scripts/build-tailwind.mjs:21` 在构建期拼 Mantine 的 CSS——Mantine 同时是组件库和主题管道 |
| Tailwind | `3`（只锁大版本） | 4 | 111 处 `outline-none` 跨 63 文件需逐个判 a11y；两个门岗脚本**文本解析** `tailwind.config.ts`，配置搬进 `@theme` 会让它们瞎掉 |
| zod | `^3.25.76` | 4 | 62 文件；能力契约的 schema 真相源 |
| Vitest / Playwright | `^4.1.8` / `1.60.0` | — | — |

**#526（`docs/plan/2026-09-06-stack-upgrade-react19-aisdk-tailwind4.md`）的结论现在还成立吗？** 成立，而且本次评审给它补了一条**它自己没说的理由**：

> 该方案的第 7 节把唯一待拍板的问题定成「Agent 面板 v4 要不要长得像 AI Elements」，并倾向选 C（什么都不升）。**本次评审支持选 C，但理由不同**：v4 面板真正缺的不是 AI Elements 的组件长相，是**主进程到渲染层之间的一条有序 parts 通道**。升 React/AI SDK 一寸也不会让那条通道出现。栈升级应当降级成独立的版本债轨（Mantine 8 与 R3F 9 各自单做），**不占用 Agent 主线的任何一个 PR 位**。

---

## 4. 缺什么、要建什么

### 4.1 有序 parts 流与转录持久化 —— 唯一的 P0

**真实摩擦**：用户看不出 Agent 干活的过程。面板上先是一大段文字，然后一排工具收据，读起来像「它先想好了全部，再一口气做完了全部」。真实过程是「说一句、做一件、再说一句」。多步任务（做一条短片会跑到 8 甚至 24 步）里，这个差别就是「我知道它在干嘛」和「我不知道它卡在哪」的差别。

**要建的东西**：一条从 pi 到面板的**有序段通道**。三层各改一处：
- 接缝：`RuntimeTurnResult` 增加 `parts: (TextPart | ToolCallPart)[]`（`text` 保留一段过渡期，用于兼容旧快照；R1 要求同 commit 定死删除时点）。
- 宿主：`emit` 认全 6 种事件；assistant item 从「一条」变成「按段」，或给 item 加一个 `sequence` 让工具收据能插进文字中间。
- 投影：排序键从 `createdAt` 换成显式序号。

**好消息**：数据其实一直都在。pi 快照的 schema（`snapshotSchema.mts:18-26`）**完整保留了有序的 text/thinking/toolCall 段**。所以这不是「要新建持久化」，是「把已经落盘的东西接出来」。

**岔路（R3 表在方案文档 §3.1）**：转录的真相源放 pi session 还是宿主 record。

### 4.2 工具契约规范与「一次写对率」

**真实摩擦**：模型第一次就写对参数的概率，直接决定用户等多久、烧多少 token。今天最贵的那个工具（分镜 24 行）拿到的 schema 是「一个由任意对象组成的数组」。

**要建**：
1. **一条门岗**：任何模型可见的工具，其 JSON Schema 里**不允许出现 `{}` 或无 `items` 的数组**（`z.record(z.unknown())`、`z.any()` 同理）。这条能同时拦住今天的分镜 schema、MCP 侧 `references: {type:"array"}` 无 `items`（`mcpGenerationToolCatalog.ts`）、和未来任何一个 `z.preprocess` 被 override 抹平的字段。
2. **把描述搬回去**：`canvasDescriptors.ts` 里那份带 `.describe()` 的 shot/anchor schema 是资产，不是垃圾。要么它成为 `canvasWrite.ts` 里 `storyboardPlanActionInputSchema` 的真身（推荐），要么同 commit 删掉（P1）。**不能继续两份并存且死的那份更完整。**
3. **拒绝要能自纠**：`tools.mts:74` 直接把 zod 原始错误抛出去。pi 的设计是 `beforeToolCall` 返回 `{block:true, reason}`，`reason` 会变成模型看到的错误正文。zod 的 `path`/`code` 需要翻译成「你少了哪个字段、合法值是什么」——`CANVAS_WRITE_OPERATIONS`（`canvasWrite.ts:283`）已经是为这件事准备的派生名单。
4. **成功率评测**：一次写对率、二次纠正率、按工具分。这条与 `docs/agent-tool-layer-audit-20260906` 分支重合，**等它的真实测量数据，不重复做**。

### 4.3 Agent 可观测性：怎么在零额度层拦住只能真机撞出来的问题

今天的真实教训（`564e57edd` 九条 + `fix/real-env-acceptance-20260906` 五条）里，两条 P0 值得抽象：

| 真机撞到的 | 最早能拦住它的那层（R28） |
|---|---|
| `layout.read` 这个 pi 别名带点 → 不合运行时正则 → `createHostTools` 直接抛 → 整个 timeline/production 工具档一次请求都发不出去，用户只看到「发送失败」 | **注册表单测**：全表遍历，每个能力的 pi 别名过一遍 `tools.mts:39` 那条正则（已在该 commit 补上，带阳性对照）。**推广**：所有「模型可见的字符串」——工具名、枚举值、operation 名——都在注册表处校验，不留到 session 构造时 |
| 有待决工具时整个工作台崩成「工作台加载失败」（`listFor()` 每次返回新数组 → `useSyncExternalStore` 无限重渲染） | **一条门岗**：`useSyncExternalStore` 的 snapshot getter 必须引用稳定。这是可机器检测的一族（手写 store 有 6 个，`projectAgentProjectionStore` / `agentPanelV4PendingTools` / `residentActivity` / `agentUsageStore` / …），不该靠人记得写缓存 |
| 模型名一长，面板被永久裁掉 17px | `overflow-hidden` → `overflow-clip`（已修）。**推广**：滚动容器不该出现在没有滚动条的地方；这一族也可门岗化 |
| 失败卡把 IPC 传输标记 `NOMI_VENDOR_ERR_B64::…` 原样印给用户 | 编码端已在注释里写明「标记段在渲染层剥掉」。**推广**：任何带传输标记的字符串，剥离函数与编码函数应当同文件成对存在并互为单测 |

**结论**：这四条没有一条需要真实模型。它们是**结构性质**（正则、引用稳定性、CSS 属性、成对函数），全部属于 contracts 档，零额度、秒级。今天缺的不是「测不到」，是**没人把「真机撞到的」翻译成「机器判据」**。方案里把这条做成固定动作：每一条真机 P0 修复，必须同 commit 附一条能在 contracts 档里跑的判据，否则不算修完。

### 4.4 上下文与花费预算

现在：`compaction:{enabled:true}` 无参数（用 pi 默认）；上下文窗口来自 Nomi catalog 的 `meta`（`agentChatV2.ts:91`）但**从不过 IPC**，所以面板画不出上下文环的百分比；花费永远是空的（§1.2）。

要建：① `Model.cost` 从 Nomi 的 `pricing` 字段填进 pi（catalog 里已有 `Model.pricing`），让 `calculateCost` 真的算；② `contextWindow` 随 turn 的 usage 一起过 IPC；③ 线程级预算上限与超限行为（今天没有任何上限，一个失控的 24 步 production 回合可以烧到底）。

### 4.5 能力范围：Agent 现在能做什么、不能做什么

35 个内部工具（document 2 / canvas 4 / timeline 16 / production 10 / skills 1 / generation 2），但**按 capability 分档后实际给到的常常远少于此**：

| capability | 实际拿到的工具 |
|---|---|
| `creation-editor` | 2（document read/edit） |
| `creation-chat` | **1**（只有 document read；`author_skill` 那条分支恒空，见 §2.3） |
| `canvas-agent` | canvas 4 + timeline 16 + generation 2 = 22，再按意图正则收窄 |
| `canvas-refine` | 1（`nomi_canvas_edit`） |
| `storyboard` | 2（`nomi_canvas_read` + `nomi_canvas_plan`） |
| `single-shot` | 0 |

**明确不能做**（契约级禁止，不是没实现）：`nomi_operation_gate` / `nomi_operation_execute`——**内部 agent 永远不能自己开付费闸和启动付费生成**（`modelToolSurfaceManifest.ts:236-240`，还有一条断言防止它泄漏进模型面）。这条是好设计，应当写进用户可见的「Agent 能做什么」说明里，而不是只活在代码注释里。

**够不着的**：`skill.write`（无任何入口）、`canvas.addNodes/connect/setPrompt/deleteNodes` 这批低层 dispatcher 操作（`dispatcher.ts:693-709`，没有任何 catalog 工具指向它们）。

### 4.6 MCP 外部宿主与内部 Agent 的对等

**共享的部分是好的**：`shared/agentCapabilities/registry.ts:65-73` 让每个能力契约同时声明 `aliases.pi` 和 `aliases.mcp`，两边最终跑同一批 transport adapter 和同一个 `ProductionService`。这条脊梁不要动。

**不对等的部分**（25 个 MCP 工具 vs 35 个内部工具）：

1. **分解方式不同**：MCP 做过 42→15 的「按对象归并」收敛，内部没有。时间轴读 = MCP 1 个 / 内部 3 个；媒体查询 = 1 / 5；导出检查 = 1 / 2。MCP 侧在 `parseCall` 里**手写**把归并的工具再拆回 pi operation 字符串（`mcpCapabilityProjection.ts:210/227/261`），每一个字符串都可能与它镜像的别名常量漂移。
2. **广播的 schema 弱于执行的 schema**：MCP 的 `tools/list` 广播一份**刻意有损**的 JSON Schema（`mcpCapabilityProjection.ts:151-153` 自陈：避开 `anyOf`/`exclusiveMinimum`，因为自家验证器不实现），而真正执行时用 zod。外部宿主看到的契约比实际执行的松——「range 必须两个帧都给」「end > start」这类约束广播不出去。
3. **信任方向反了**：`nomi_operation_plan` 的 `references` 在 MCP 侧是 `{type:"array"}` 无 `items`（不校验任何东西），在内部侧是严格 typed。**外部宿主比内部 agent 拥有更宽松的输入面**。
4. **production start 是两份不同的输入契约**：MCP 是嵌套 `brief{}` + 运行时枚举的 playbook 名 + `trustLevel`；内部是扁平字段 + 自由字符串 playbook（默认 `"brand.promo"`）+ 没有 `trustLevel` 和 `referenceArtifactIds`。同一个 `createDraft`，两套形状。
5. **只有一边有的**：MCP 独有 6 个（建项目、列项目/模型、导入素材、开 session/lease、接入供应商 ×2）+ 2 个付费转换；内部独有 3 个（导出启停、`load_skill`、`nomi_canvas_plan` 这个多出来的名字）。

**要建**：不是把两边的工具名统一（lease 语义决定了形状必然不同），而是**让「分解方式」变成从契约派生的、而不是两边各手写一份**。

### 4.7 模型接入：一手出处 vs 中转商命名

**最刺眼的一条**：Agent 自己的脑子是全产品**唯一**没有自动新鲜度检查的模型类。

- 唯一来源是 `electron/catalog/apimartTexts.ts:54-62`，注释自陈是 **2026-08-21 一次手动 `GET /v1/models` 探测**的结果。
- `radar:models` 明写 `WATCHED = ["image","video","audio"]`、「不含 LLM」（`scripts/model-radar.ts:30-33`）；`grep -c deepseek docs/research/model-radar/apimart.json` = **0**。
- 而且雷达抓的是 **docs 页**（`llms.txt`），不是带鉴权的 `/v1/models`——文档页在 API 退役后还挂着，读起来就是「还活着」。
- 退役检测 = 用户撞到 `Model is retired`（`executableModel.ts:30`）；修复 = 手改两个**必须互斥**的数组（`seedBuiltins.ts:322-332`）。

**DeepSeek 那五个 id**（`deepseek-v4-pro` / `-v4-flash` / `-v3.2` / `-v3.2-think` / `-v3.1-terminus`）：仓库自己已经把后三个放进 `LEGACY_MODEL_KEYS`（`seedBuiltins.ts:578-580`），但 **`legacy` 只改显示分层，不下架、不禁用、不隐藏**——它们仍然是完全可选的 Agent 脑子。

**一手出处的证据**：pi 自己带一份 39 家 provider 的模型目录，其中 `deepseek` 只有 `deepseek-v4-flash` 和 `deepseek-v4-pro` 两个（`node_modules/@earendil-works/pi-ai/dist/providers/data/deepseek.json`）。这不是权威判决（pi 的目录也会过期），但它是一个**免费的第二信源**，今天完全没有被用。

**要建**：把 LLM 纳入雷达（改一个数组），且改抓带鉴权的 `/v1/models` 而不是 docs 页；`legacy` 分层要有真实后果。**这条需要真实 key，是「才问用户」的一项。**

---

## 5. 漏洞清单（含我自己的设计）

> 纪律：每条写「当时为什么这么定 / 现在为什么不成立 / 怎么改」。不写「应该更小心」这种没有动作的话。

### V1 · 57 张视觉基线全绿，而组件一个回调都没有

- **当时为什么**：把「设计实验室先行、逐板截图对账、用户拍板后才更新基线」当成交付闸。这条纪律本身是对的（它救过很多次长相回归）。
- **现在为什么不成立**：视觉基线是**渲染断言**，它证明「给定 view model，画出来长这样」。而当时缺的是「view model 从哪来、按钮按下去发生什么」——**一个渲染断言无论多少张，都不可能覆盖一个不存在的回调**。我用一道测量「已经对的东西」的闸，替代了对「完全缺失的东西」的检查。
- **怎么改**：视觉基线保留，但**交付定义加一条并列门**：面板类交付必须同时有「真实用户任务走查跑通闭环」（R16），且该走查必须**驱动真实回调**而不是渲染夹具。`design-lab` 的 `ShellStage` 已经把假快照 `install()` 进真 store 再渲染真面板——这个手法是对的，把它变成强制项而不是可选项。

### V2 · 把「回合结束一次性生成 tool items」当成可接受的过渡

- **当时为什么**：宿主状态机要求终态可回放、可校验；回合结束一次写入最简单，也最不容易产生半状态。
- **现在为什么不成立**：这个决定**在数据层杀死了顺序**（§1.4），而 v4 设计的第 4 条裁决明写「工具调用内联在对话流」。设计与宿主的冲突在接线计划里被记成了「⚠️ 本表最难的一处」，然后接线还是做了——**难点被记录了，但没有被当成阻塞**。按硬规矩「设计与宿主真冲突就停下上报」，这里应该停。
- **怎么改**：把它升级成 P0 阻塞项（§4.1），而不是继续在渲染层用一个易失的 `pendingTools` 登记表打补丁。那个登记表冷重启就空——所以历史对话**永远**只能显示「文字一堆、工具一堆」，不只是运行中。

### V3 · 「无损历史（#515）」被当成了渲染层拿得到 message parts

- **当时为什么**：v4 设计定稿的「可行性（实查 file）」一行写着「收据 ← 无损历史 message parts（#515）」。
- **现在为什么不成立**：#515 落地的是**主进程侧的不透明快照 blob**（`StoredAgentContext.snapshot`），**不过 IPC**。接线计划的 §8 自己发现并写下了这条更正，但设计文档的可行性行**没有回改**——于是「一行收据要有输入/输出两段展开体」这条设计，是在一个不存在的能力上做的可行性判断。
- **怎么改**：可行性行必须带 `file:line`，且必须验证「渲染层拿得到」而不只是「主进程有」。这是 D3（第一性）在文档层的落法。

### V4 · 模型弹层接线偏离拍板

- **当时为什么**：任务书说「模型清单吃 catalog 派生（#535 的 `keepRunnableVendorOptions`）」。
- **现在为什么不成立**：接线时 #535 还是 OPEN，仓库 grep 不到那个符号（接线计划 §0.2 记下了）。于是接了现役 `filterUsableAssistantTextModels`，与拍板的排序/去重语义不同。
- **怎么改**：这条已经在计划里挂了「#535 合后换一行」。**风险是这种「先接现役、以后换」的欠条没有到期提醒**——应当在代码里留一条会红的断言（引用 #535 的符号，缺失就 skip 但打 warning），而不是留在文档里。

### V5 · 空态没设计

- **当时为什么**：12 板样张覆盖的是「有内容之后」的形态。冷启动空面板不在任何一板里。
- **现在为什么不成立**：冷启动是**每个新用户的第一屏**。设计覆盖了第 2 分钟到第 20 分钟，漏了第 0 秒。
- **怎么改**：已补（`c3a90eb71` 空态已合 main）。**教训要提升**：任何面板类设计，样张清单必须包含「零内容 / 加载中 / 出错 / 无权限」四态，否则不算完整。

### V6 · 收起态没沿用 logo 血统

- **当时为什么**：收起坞按「32px 图标条 + 运行中状态点」设计，图标从 Tabler 里挑。
- **现在为什么不成立**：收起态是 Agent 在画面上**最长时间的形态**，它同时是品牌露出面。用一个通用 Tabler 图标等于在自家产品最显眼的常驻位放一个没有身份的方块。
- **怎么改**：`feat/agent-panel-v4-logo-dock-20260906` 分支在做。**这条属于「设计覆盖了主态、漏了常驻态」，与 V5 同源。**

### V7 · 十条裁决里，现在看不对的三条

| # | 裁决原文 | 现在的问题 |
|---|---|---|
| **4** | 「工具调用**内联在对话流**，不置顶」 | 宿主写入顺序让它**结构上做不到**（V2）。裁决是对的，可行性没验。 |
| **7** | 「过程反馈 7 时刻：发出 → **思考(shimmer+秒数)** → 调工具 …」 | 「思考」在系统里不存在（`thinkingLevel:'off'`）。那一行秒数量的是**等首个 token 的时长**。词是个断言，而它是假的——按 D4（诚实交付），要么把 thinking 真的打开，要么把这一行改名叫「等待模型」。 |
| **5** | 「composer：**模型钮只显示模型名（无 icon）**」 | 底栏五个控件全 `shrink-0`，模型名一长（「DeepSeek V3.2」）就把面板永久裁掉 17px（`d065efbd0` 真机撞到）。已止血成 truncate，但**默认宽度下真实模型名装不下**——这是设计层没解决的取舍，止血不等于设计对了。 |

另两条要标注但**不是错**：
- **裁决 2**（权限三档合并 workMode）与契约里「两轴刻意独立」的注释冲突——这是**真的产品岔路**，接线计划的 D1 已挂待拍板，正确处理是继续等，不要自己挑。
- **裁决 1**（只有 8 个积木）让 `missing_param` 介入没有家——D4 已挂待拍板。

### V8 · 单测把「什么都没校验」当成通过了

- 现象：`canvasDescriptors.test.ts` 396 行全绿，测的是一个**没人 import 的文件**；同时活的那份 schema（`z.record(z.unknown())`）**没有任何测试问过「模型看得见字段名吗」**。
- 根因：我们的测试问的是「schema 会不会拒绝坏输入」，从来没问过「schema 告诉了模型什么」。前者是**执行边界**，后者是**广播边界**——两件事，只测了一件。
- 怎么改：§4.2 的第 1 条门岗。同时把 `canvasDescriptors.test.ts` 的资产（那些 `.describe()` 和边界用例）迁到活的 schema 上，然后同 commit 删掉死文件（P1）。

### V9 · 三条防线做同一件事，第三条会说谎

`run.mts` 里步数上限有三处：`shouldStopAfterTurn`（正确、pi 原生）、硬抛（冗余保险）、以及 `:260-262` 把「刚好在上限上以 `toolUse` 正常结束」翻译成 `step-limit` **错误**。第三条会把一次合法的收尾报成失败给用户看。防线可以有三层，但**只有一层有权改变用户看到的结论**。

### V10 · 渲染层铸造宿主的规范记录

`projectAgentTurnCommands.ts:88-167` 在渲染层生成 thread / turn / user item / queue item / `executionToken` / `contextRef`，作为 `payload: unknown` 送过桥。主进程会校验，但**宿主自有记录的身份生成在桥的不可信一侧**。这不是今天的 bug，是一条会长出 bug 的形状——尤其当以后有第二个客户端（MCP 宿主、跨设备）时。

---

## 附：证据索引（可当场证伪的锚点）

| 结论 | 锚点 |
|---|---|
| pi 的 assistant 内容是有序段 | `node_modules/@earendil-works/pi-ai/dist/types.d.ts:307-327` |
| pi 的事件带 `contentIndex` | 同上 `:400-453` |
| `AgentHarness` 在 0.84.3 是空壳 | `node_modules/@earendil-works/pi-agent-core/dist/harness/agent-harness.js`（`HarnessNotImplemented` ×5） |
| pi 自带 39 家 provider 价格/窗口目录 | `node_modules/@earendil-works/pi-ai/dist/providers/data/*.json`（39 个文件） |
| 接缝把顺序压扁 | `electron/harness/runtime/runtimePort.ts:122-133`、`electron/harness/runtime/pi/run.mts:73/201/267` |
| 宿主只认一种事件 | `electron/projectAgentHost/projectAgentTurnExecution.ts:168-170` |
| assistant item 的时间戳是回合开始 | 同上 `:83/:95`；工具条目是回合结束 `:616-618` |
| 投影按 createdAt 排序 | `src/workbench/ai/v4/agentPanelV4Projection.ts:247-254` |
| 重试全关 | `electron/harness/runtime/pi/session.mts:32`、`run.mts:165` |
| 思考全关 | `session.mts:37`、`model.mts:71` |
| 价格清零 | `model.mts:72` + `run.mts:24-26` |
| 每回合一个新 session | `run.mts:67`、`session.mts:27` |
| 分镜 schema 对模型是空的 | `electron/shared/agentCapabilities/canvasWrite.ts:139-146` |
| 真正的 25 字段校验在渲染层 | `src/workbench/generationCanvas/agent/storyboardPlanSchema.ts:37-104` |
| 带说明的那份 schema 已死 | `electron/harness/tools/canvasDescriptors.ts:37`，唯一 importer 是 `canvasDescriptors.test.ts` |
| `author_skill` 死分支 | `electron/harness/agentChatPolicy.ts:85-86` |
| 模型雷达不看 LLM | `scripts/model-radar.ts:30-33` |
| DeepSeek 五个 id 与其分层 | `electron/catalog/apimartTexts.ts:54-62`、`electron/catalog/seedBuiltins.ts:578-580` |
| MCP 广播的 schema 刻意弱于执行的 | `electron/capabilityCore/mcpCapabilityProjection.ts:151-153` |
| 内部 agent 禁止自开付费闸 | `electron/harness/tools/modelToolSurfaceManifest.ts:236-240/253-254` |
