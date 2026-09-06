# Agent 运行时重做方案（2026-09-07）

> 状态：📋 方案待拍板 —— **只写方案，一行产品代码未改**。含必须先拍板的 **3 条岔路**（§7）。
> 基线：`origin/main@1365441db`。全文 `file:line` 均在此 checkout 上实核。
> 起因：2026-09-06 深夜用户拍板——**「不能为了好做而去修补现在的，既然整体错了，就重做吧。」**
> 上游输入（三份，全部吸收）：
> - [#546 架构总评审](../audit/2026-09-06-agent-architecture-review.md) + [渐进方案](2026-09-06-agent-architecture-master-plan.md)（**它主张渐进修，用户已否决**；四列表 / 漏洞清单 / 三条岔路 / 合流顺序全部吸收）
> - [#547 工具层审计](../audit/2026-09-06-agent-tool-layer-audit.md) + [根修方案](2026-09-06-agent-tool-layer-root-fix.md)（`canvas.write` 真实模型 **0/18**、读类 37/37、违反行业 10 条）
> - [#549 成熟 Agent 产品调研](../research/2026-09-06-mature-agent-products.md)（**已并入 · 2026-09-07 随 PR #549 合入 main**，路径 `docs/research/2026-09-06-mature-agent-products.md`）——它的 §1.9 与本文 §0.2 是**两次相互独立的实核**：它实拉 `0.84.3` / `0.85.1` 两个 tarball，比 `dist/harness/agent-harness.js` 的字节数与 `HarnessNotImplemented` 计数，并读 `agent-harness.d.ts` 确认 `LaneSnapshot` 已带 `streamingMessage` 与 `runningTools`；结论与本文一致——**`AgentHarness` 在 0.85.1 是真实现，#546 §1.5「它是空壳」的判断只对 0.84.3 成立**。两条独立证据同向，是岔路 1 推荐 A 的依据。

---

## 先查别人

> 本节 2026-09-07 随 `check:prior-art` 门岗补入（R27 §16）。**内容不是新查的**——这份方案本来就
> 做足了检索，只是散在正文里没有一个固定的标题；这里把它按四问归拢，每格给出可复核的出处。

| 问 | 答 | 出处 |
|---|---|---|
| 依赖里已有？ | 有，而且比我们写的全。pi 已提供会话持久化（`SessionManager`）、有序转录（`AgentSessionEvent`）、重试（`RetryPolicy`）、steer/followUp、资源加载（`DefaultResourceLoader`）——我们各写了一份更差的，共 14 处已登记成债 | `@earendil-works/pi-coding-agent@0.84.3` dist/core/session-manager.d.ts:184、dist/core/agent-session.d.ts:377/385、dist/core/resource-loader.d.ts:120、dist/core/agent-session.d.ts:40；登记表 [`docs/engineering/framework-boundaries.json`](../engineering/framework-boundaries.json)、债基线 `scripts/framework-boundary-baseline.json` |
| 依赖的**新版**里已有？ | 有。0.85.1 的 `AgentHarness` 是真实现，不是 0.84.3 那个空壳——这条直接推翻了 #546 §1.5 的前提，决定了整份方案的形状 | 本文 §0.2 的双版本 tarball 逐字比对（`dist/harness/agent-harness.js` 7883B/5 次 `HarnessNotImplemented` → 558B/0 次）；独立第二次实核见 [`docs/research/2026-09-06-mature-agent-products.md`](../research/2026-09-06-mature-agent-products.md) §1.9 |
| 仓库里已有？ | 有，且正是问题所在：`electron/harness/runtime/pi/`（session/snapshot/contextCodec/run/resources/nomiSkillResources）与 `electron/projectAgentHost/`（executionCoordinator/executionHelpers/turnExecution）就是那 14 处自研版本的所在地 | [`docs/audit/2026-09-06-agent-architecture-review.md`](../audit/2026-09-06-agent-architecture-review.md)、[`docs/audit/2026-09-06-agent-tool-layer-audit.md`](../audit/2026-09-06-agent-tool-layer-audit.md)（`canvas.write` 真实模型 0/18） |
| 生态里已有？ | 有。成熟 Agent 产品的运行时分层、工具契约与容忍策略已成行业惯例，本方案的 §3 工具契约规范直接对着它们写 | [`docs/research/2026-09-06-mature-agent-products.md`](../research/2026-09-06-mature-agent-products.md)（PR #549 已合入 main） |
| TikHub 自媒体里怎么说？ | 本轮未查。这一层是运行时架构，不是面向用户的产品能力，自媒体侧没有可比的一手经验——**明着标出来，不冒充覆盖** | 无 |

**结论**：用已有（换用 pi 0.85.1 的 `AgentHarness` 与它已提供的五项能力），自研只保留 Nomi 独有的那部分（工具契约、画布语义、投影层）。理由：14 处自研版本每一处都比上游的差，且升级 pi 时要我们自己跟——这笔成本是结构性的，不是一次性的。

---

## 0. 先说清楚：这份方案在解决哪个真实摩擦，以及为什么是「重做」而不是「修」

### 0.1 摩擦（用户自己撞到的，不是我们推测的）

用户在打包版里做了一件最普通的事——**「从原稿重拆 10 镜」**。屏幕上发生的是：

1. Nomi 连续 6 次调同一个工具、6 次被自己拒收；
2. 每次拒收之间它写一段话解释自己在干嘛，于是多了 6 段自言自语；
3. 面板把 6 段文字**全堆在上面**、7 条红收据**全堆在下面**——他读到「我来拆镜头」，往下翻先看见 7 条失败，再往下才看到「我遇到了问题」；
4. 一次网络抖动 = 整轮白等重发；
5. 「花费」「推理」两行永远是空的。

**要权衡的那一个东西**：这五件事看起来是五个 bug，但它们共用一个形状——**我们把 pi（一个完整的 agent 运行时）当成一个「发请求、收字符串」的 HTTP 客户端在用**，然后在旁边手写了一整套 pi 已经有的东西。所以真正的取舍不是「修哪几个 bug」，而是——

> **是继续在一条形状错了的管道上打补丁（每个补丁都便宜，但补丁只能贴在管道外面，管道里没有的东西补丁变不出来），还是把管道换成上游本来就给我们的那根（贵，一次性，但从此每个新功能都有地方落）。**

用户已经选了后者。本文回答的是「换成什么、怎么换、换完怎么证明它对了」。

### 0.2 一条推翻上游前提的实核（必须先说，它决定整份方案的形状）

#546 §1.5 写了一条明确警告：「**不要**建议直接换用 pi 的 `AgentHarness`——在锁定的 0.84.3 里它是个空壳」。

**这条对 0.84.3 完全正确，对今天不正确。** 我拉两个版本的 tarball 逐字比对：

| | `pi-agent-core@0.84.3`（仓库锁定的） | `pi-agent-core@0.85.1`（2026-09-05 发布，npm latest） |
|---|---|---|
| `dist/harness/agent-harness.js` | **7 883 字节**，`HarnessNotImplemented` 出现 **5** 次 = 全部方法抛异常 | **558 字节**，是一个 barrel（`AgentHarness = { create: createAgentHarness }`），`HarnessNotImplemented` **0** 次 |
| `dist/harness/` 子目录 | 无 | 新增 `compaction` `env` `execution` `runtime` `session` `tools` `utils` **七个** |
| `agent-harness.d.ts` | 715 行（类型面完整、实现是空的） | 715 行，**实现补齐** |

**复跑方法**：`npm pack @earendil-works/pi-agent-core@0.84.3` 与 `@0.85.1`，解包后比 `dist/harness/agent-harness.js` 的字节数与 `HarnessNotImplemented` 计数。已由本方案作者独立执行，非转引。

**为什么这条决定整份方案**：0.85.1 的 `LaneSnapshot`（`dist/harness/agent-harness.d.ts:174-201`）**逐项对应 Nomi 手写的那 52 个文件**：

```ts
interface LaneSnapshot {
  transcript: Entry[]              // ← 有序转录（Nomi 今天没有「顺序」这个概念）
  stats: SessionStats              // ← 跨压缩边界的 token/费用（Nomi 三层各算一遍，都算不出钱）
  operation: null | {
    retry?: { attempt, maxAttempts, nextAttemptAt }   // ← 重试进度（Nomi 把重试整个关了）
    streamingMessage?: AssistantMessage               // ← 正在流的那条【有序段】消息
    runningTools: LaneSnapshotTool[]                  // ← 正在跑的工具（Nomi 渲染层为此手写了第二真相）
  }
  queues: LaneQueuedItem[]         // ← 队列（Nomi 有一套 ProjectAgentQueueItem）
  faulted: boolean
}
```

以及 `accept(request) → OperationAdmissionResult` / `getResult(operationId)` / `drive()`（`:644-646`）——**这就是 Nomi 的 `commands-v1.jsonl` 幂等命令账本**。

**所以「重做」在 R20（造轮子前先过 build-vs-buy 闸）下不是一个偏好，是一个判决**：我们手写了 9 688 行去做上游已经做好的事，而做出来的那份**比上游少了顺序、少了重试、少了钱**。

> ⚠️ **这不等于「明天就换过去」**。0.85.1 发布只有一天、没有生产验证，pi 六个包被 `pnpm.overrides` 硬锁必须一起动。所以它是 **§7 岔路 1**，并且**阶段 0 是一次只产出决策、不产出产品代码的探针**（§6）。

### 0.3 术语先解释（D6：出现陌生概念先说「这是干嘛的、为什么要它」）

- **段 / parts**：模型一轮回复不是一整块文本，而是一串**有顺序**的小块——「说一段话」「想一下」「调一个工具」。pi 原样保留这个顺序；我们在接缝处压平了，压平之后「先说什么后做什么」在系统里**不再存在**（不是没画，是数据里没有）。
- **接缝 / runtimePort**：主进程里把 pi 藏起来的那道门。门外只认识我们自己定义的一组结构。今天这组结构里没有「段」。
- **lane（车道）**：pi 0.85.1 里「一条独立的对话轨」。一个项目可以有几条 lane 并行（比如「主对话」和「后台跑的分镜」），互不干扰。今天 Nomi 用 `threadId` 表达同一件事。
- **transcript（转录）**：这条对话到底发生了什么的**权威流水**。今天 Nomi 有**三份**（pi 快照、宿主 snapshot、浏览器 localStorage），三份的生命周期、信任级别、清除时机全不一样。
- **压缩 / compaction**：对话太长时把前面总结成一段摘要腾出空间。pi 自带，我们在用。
- **steering**：模型跑到一半插一句改方向（「不对，横屏」），不用等它跑完。pi 有，我们**结构性用不了**（每回合开一个全新 session，队列跨不过回合边界）。
- **一次写对率**：模型第一次调工具就把参数写对的比例。它直接决定用户等多久、烧多少钱。今天 `canvas.write` 是 **0%**。
- **棘轮（ratchet）门岗**：一条 CI 规则，允许存量违规存在但**只减不增**。仓库已有两种：计数式（`check:heavy-path`）和**身份式**（`check:boundaries`，记住每一条违规长什么样，防止「修掉一条、偷加一条」）。

---

## 1. 重做边界（D2：约束就是战略）

> 纪律：**每一项给理由与 `file:line`**。「重做」= 删掉重写；「保留并重声明契约」= 代码基本不动，但要把它的契约明确写下来，因为它以后要挂在新地基上。
> 判据只有一条：**这东西是 pi 已经做好的（→ 重做，别再造），还是 pi 明确不做、属于 Nomi 领域的（→ 保留，它是护城河）。**

### 1.1 重做（七项）

| # | 重做什么 | 现在在哪（实核） | 为什么必须重做，而不是修 |
|---|---|---|---|
| **B1** | **运行时接缝** | `electron/harness/runtime/runtimePort.ts`（156 行）：`RuntimeActivityEvent` `:74-80`、`RuntimeTurnResult` `:122-133`（`text: string` + `toolCalls[]`）；`electron/harness/runtime/pi/*.mts` 13 个文件 | **形状本身就是 bug**。pi 给的是 `AssistantMessage.content: (Text\|Thinking\|ToolCall)[]`（`pi-ai/dist/types.d.ts:307-327`）+ 每个事件带 `contentIndex`；我们在这里压成两堆。**改形状 = 重写，不是改字段**。`run.mts:73` 一行 `let text = ''` 就把八步里所有文字连成一根字符串 |
| **B2** | **宿主状态机** | `electron/projectAgentHost/`：**52 个生产文件、9 688 行**（#546 记的是 41，实核为 52）。`projectAgentTurnExecution.ts` 793 行 | **R20 判决**：pi 0.85.1 的 `AgentLane` 逐项覆盖——`accept/getResult/drive`（`agent-harness.d.ts:644-646`）= 命令账本与幂等；`queues`（`:196`）= 队列；`watch()`（`:674`）= 快照订阅；`transcript`（`:176`）= 转录；`stats`（`:180`）= 用量。我们手写的这份**比上游少了顺序、少了重试、少了钱** |
| **B3** | **转录持久化（三份 → 一份）** | ① pi 快照信封 `snapshot.mts:64`（sha256；#546 记的是 `:56`，实核为 `:64`）+ `contextPaths.ts:17-21`；② 宿主 `snapshot-v1.json` + `commands-v1.jsonl`（`projectAgentRepository.ts:351-357`）；③ 渲染层 localStorage 工具正文（`residentToolProjection.ts:88`） | 同一段对话三份落盘、三种信任级别、三个清除时机。**清浏览器存储 = 历史收据正文静默清空**。三份里没有一份完整，所以「顺序」这件事三份都答不上来 |
| **B4** | **v4 数据通路（不是外观）** | `agentPanelV4Projection.ts`（459 行，`sortedItems()` `:247-263`）、`agentPanelV4PendingTools.ts`（自陈存在理由 = 宿主没有运行中工具记录）、`residentToolProjection.ts`、`projectAgentProjectionStore.ts`（手写 external store） | 这四个里有三个**只因为宿主缺数据才存在**。`LaneSnapshot.runningTools` / `streamingMessage` 一到，它们就是净负担。排序键、三路 join、易失登记表全部消失 |
| **B5** | **内部工具契约的编码与分解** | `electron/harness/tools/`：`agentToolCatalog.ts`（模型面唯一入口）、`modelToolSurfaceManifest.ts:195-208`（两个**字节级相同** 8238 B 的工具）、`canvasDescriptors.ts`（471 行，**零生产 importer**）、`documentDescriptors.ts`（86 行，同）；`electron/shared/agentCapabilities/canvasWrite.ts:143-144` | **真实模型 0/18**（#547 §3.2）。带 `.describe()` 的那份 schema 是死的，活的那份对模型说「shots 是一个由任意对象组成的数组」——25 个字段名一个都没告诉它。`canvasWrite.ts:143-144` 经 `git blame` 确认**自 2026-09-01 未变**，没有任何在途修复动过它 |
| **B6** | **Agent IPC 通道** | `projectAgentIpc.ts:39-48`（7 个通道）；渲染层在 `projectAgentTurnCommands.ts:88-167` **铸造宿主的规范记录**（thread / turn / item / `executionToken` / `contextRef`）送过桥 | #546 V10：宿主自有记录的**身份生成在桥的不可信一侧**。新通路只发 `OperationRequest`（pi 官方形状，`agent-harness.d.ts:48-77`），身份由主进程铸造 |
| **B7** | **三处结构性关闭 + 三层步数上限 + 价格清零** | 重试 `session.mts:32`（`retry:{enabled:false, provider:{maxRetries:0}}`）+ `run.mts:165`（`maxRetries:0`）；思考 `session.mts:37`（`thinkingLevel:'off'`）+ `model.mts:71`（`reasoning:false`）；价格 `model.mts:72`（`cost:{0,0,0,0}`）；步数三防线 `run.mts:138` / `:151` / `:260` | 每条关掉的理由单看都成立，**但没有一条后面跟着「那这件事现在谁负责」**。第三条步数防线会把「刚好到上限的正常收尾」报成失败给用户看（#546 V9：防线可以三层，**只有一层有权改变用户看到的结论**） |

**同批清掉的死码**（P1 欠账，实核确认四个都零生产 importer）：`canvasDescriptors.ts` 471 行（3 个测试 importer；`src/workbench/generationCanvas/agent/gate.ts:54` 注释自陈「已不认它」）、`documentDescriptors.ts` 86 行、`agentChatV2Ipc.ts` 277 行（`projectAgentCutoverStructure.test.ts:40` 已断言 main.ts **不**含它）、`nomiSkillResources.mts` 167 行。
**前提**：`canvasDescriptors.ts` 里那份带 `.describe()` 的 shot/anchor schema **是资产不是垃圾**，必须先迁到活契约（§3）再删——否则是删资产。

**`skill.write`（用户已定：删，记远期）**：`author_skill` 在死文件 `documentDescriptors.ts` 里，`agentChatPolicy.ts:85-86` 那条找它的分支恒 `undefined`。净效果是这条能力**从任何入口都够不着**，且 `creation-chat` 实际只有一个只读工具。随死码一起删，远期项登记进 §6 附表。理由：**一条够不着的能力不是能力，是一条会让下一个读代码的人误判现状的假线索**；要恢复它需要先设计「Agent 写的技能怎么被用户看到、审批、撤销」，那是一件独立的活。

### 1.2 保留并重声明契约（七项）

| # | 保留什么 | 现在在哪（实核） | 为什么保留 |
|---|---|---|---|
| **K1** | **能力注册表的领域语义** | `electron/shared/agentCapabilities/registry.ts`（127 行，**22 个能力契约** `:37-59`；`aliasEntriesFor()` `:65-73` 按 surface 派生 `{contract, surface, alias}`） | **pi 完全不知道「画布」「分镜」「时间轴」是什么。** 这是 Nomi 的护城河（D2）。内外双别名的**声明式**做法是对的，保留。只换两样：schema 的编码（§7 岔路 3）与工具的分解方式（§3） |
| **K2** | **审批 / 提案 / 权限三档 / 队列的产品语义** | 三档 `projectAgentContracts.ts:47`（`["step","safe-auto","project"]`）+ 花费轴 `:51`（`["confirm","within-budget"]`）+ 默认 `:60-63`（`safe-auto`/`confirm`）；判定在 `projectAgentExecutionPolicy.ts:27`（风险）与 `:78`（安全复用）；协调在 `projectAgentExecutionCoordinator.ts:433` | **pi 官方明说它不做审批**（`pi.dev/docs/latest/security`：无内置工具审批、无内置沙箱，只有管「加不加载项目本地配置」的 project trust）。所以这不是「我们重造了 pi 的轮子」，**是 pi 明确留给宿主的活**。改的只是**挂载点**：从宿主自己的状态机搬到 pi 的 `before_tool` 钩子（`agent-harness.d.ts:550-562`，返回 `{block:{reason}}`，`reason` 直接成为模型看到的正文）。⚠️ 注意 `agentChatPolicy.ts:64-70` **不是**执行点，它只是把渲染层可能夹带的 `approvalPolicy` 剥掉——纵深防御，保留 |
| **K3** | **MCP 对外 dispatcher** | `capabilityCore/dispatcher.ts`（800 行；可行动错误块 `:557-565`：未知 operation 抛 `RpcError` 带 `nextAction: Use one of: …`） | **#547 §2.2⑤ 说它已经做对了**：同一个仓库，外部 MCP 客户端拿到可行动错误，我们自己的 Agent 拿到一个错误码。保留它，并让**内部路径从同一个源派生**（§3）。⚠️ `mcpCapabilityProjection.ts:151-153`（511 行）的「刻意有损广播」注释要作为**债**登记：外部宿主看到的契约比实际执行的松 |
| **K4** | **生产运行子系统** | `electron/productionRun/`（**58 个生产文件**）；owner 是工厂 `productionRunService.ts:81` `createProductionRunService()`（无 `class ProductionService`） | 与 Agent 运行时**正交**。它有自己的生命周期（跑几十分钟、跨重启、花真钱）。新转录**按 id 引用它，永不复制它的状态** |
| **K5** | **时间轴操作** | 5 个生产文件散在 3 个目录：`capabilityCore/{mcpTimelineConfirmation,timelineTransportAdapters}.ts`、`shared/agentCapabilities/{timelineRead,timelineWrite}.ts`、`video/shotTimeline.ts` | 同 K4：领域实现，与运行时正交。**唯一要动的是它的工具分解**（16 个内部工具 vs MCP 1 个，§3） |
| **K6** | **v4 面板组件 + 57 张视觉基线** | `src/workbench/ai/v4/*`；基线 `tests/ux/design-lab/__baselines__/agent-panel-v4/` **实核正好 57 个 PNG**；门岗 `check:design-lab` → `scripts/check-design-lab.mjs`（package.json:179） | 设计已拍板（`docs/design/2026-09-06-agent-panel-v4.md`，用户原话「画布的设计没有问题」）。**8 个积木一个都不改长相**——它们只是终于按发生顺序出现。57 张基线在重做期间**升格为回归网**（§4.3） |
| **K7** | **模型目录领域** | `electron/catalog/`（254 文件）；Agent 文本模型清单 `apimartTexts.ts:54-62`（注释自陈来自 2026-08-21 一次手动探测） | 领域数据保留，但按用户已定的第①条**加两件**：带鉴权的 `/v1/models` 探测（不是抓 docs 页——文档页在 API 退役后还挂着，读起来就是「还活着」）、退役 id **直接下架**（不是只降 `legacy` 分层；今天 `seedBuiltins.ts:578-580` 已把三个 DeepSeek id 标 legacy，而 legacy **只改显示分层，不下架不禁用**） |

### 1.3 一条不对等，明确保留

内部 agent **永远不能**自己开付费闸和启动付费生成（`modelToolSurfaceManifest.ts:236-240`，另有断言防止泄漏进模型面）。这是**有意的信任边界，不是缺口**。

重做后写法升级一档，学 Claude Code 的做法（调研 §2.3「Actions no mode auto-approves」）：从「让它够不着」改成「**让它够得着但永远批不动**」——即这两个工具仍不投影给内部模型，但审批层多一条**独立于权限档位**的硬清单，任何档位（包括未来的「全自动」）都批不动它。理由：以后真要给 Agent 开这个能力时，不用重做安全模型。

---

## 2. 目标架构

### 2.1 分层图（每层：唯一真相源 · 唯一 owner 文件）

```
┌─ ① 面板组件 ────────────────────────────────────────────────────────┐
│  src/workbench/ai/v4/*                                【不动·K6】    │
│  真相源：无（纯渲染，吃 view model）                                  │
│  owner：现有组件文件；57 张基线是它的合同                             │
└──────────────────────────────────────────────────────────────────────┘
                              ▲ view model
┌─ ② 视图投影（新建） ─────────────────────────────────────────────────┐
│  src/workbench/ai/lane/laneViewModel.ts               【唯一 owner】  │
│  真相源：③ 推来的一份 LaneSnapshot                                    │
│  硬规则：不排序（顺序已在 transcript 里）· 不 join 第二真相 ·          │
│          不缓存正文 · 纯函数                                          │
│  → 删掉：agentPanelV4Projection.sortedItems()、PendingTools、         │
│          residentToolProjection（B4）                                 │
└──────────────────────────────────────────────────────────────────────┘
                              ▲ LaneSnapshot / LaneWatchEvent
┌─ ③ 渲染层订阅（新建） ───────────────────────────────────────────────┐
│  src/workbench/ai/lane/laneClient.ts                  【唯一 owner】  │
│  真相源：主进程推来的快照；本层零状态机                                │
│  草稿/附件/选中 chip 仍住 workbenchStore —— 那是**用户输入**，         │
│  不是转录，两者永不混                                                  │
└──────────────────────────────────────────────────────────────────────┘
                              ▲ IPC
┌─ ④ IPC（重建 B6） ───────────────────────────────────────────────────┐
│  electron/agentLane/laneIpc.ts                        【唯一 owner】  │
│  两个通道：snapshot(push) · command(req/res)                          │
│  渲染层**不再铸造宿主记录**：只发 pi 的 OperationRequest              │
│  （agent-harness.d.ts:48-77）；身份在主进程铸造                        │
└──────────────────────────────────────────────────────────────────────┘
┌─ ⑤ Lane 宿主（新建·薄） ─────────────────────────────────────────────┐
│  electron/agentLane/laneHost.ts                       【唯一 owner】  │
│  真相源：⑥ 的 AgentLane（它自己不存任何转录）                          │
│  职责三件，仅此三件：                                                  │
│   a. lane 生命周期（项目 ↔ lane 映射、打开/关闭）                      │
│   b. 把 Nomi 的审批/花费闸挂到 pi 的 before_tool 钩子（K2）            │
│   c. 把 Nomi 领域记录以 appendCustomEntry 放进**同一条** transcript    │
│      （审批卡/任务卡/失败卡各一个 customType + entryProjectors）       │
│  它**不存转录 · 不排序 · 不重试 · 不算钱**——四条都是 ⑥ 的活           │
└──────────────────────────────────────────────────────────────────────┘
┌─ ⑥ pi 运行时（上游） ────────────────────────────────────────────────┐
│  @earendil-works/pi-agent-core · AgentHarness / AgentLane            │
│  真相源：lane transcript（Entry[]）+ LaneSnapshot                     │
│  它负责：顺序 · 流式 · 队列/steering · 压缩 · 重试退避 ·               │
│          会话持久化与分支 · usage/cost 汇总                            │
└──────────────────────────────────────────────────────────────────────┘
┌─ ⑦ 工具投影（新建） ─────────────────────────────────────────────────┐
│  electron/agentLane/toolProjection.ts                 【唯一 owner】  │
│  真相源：⑧ 的能力契约。本层只做「契约 → 模型可见工具」的派生           │
│  **内部 pi 工具面与 MCP tools/list 是同一个函数的两个 profile**        │
│  差异只允许来自声明：MCP 必带 leaseHandle；内部永不投影付费闸           │
└──────────────────────────────────────────────────────────────────────┘
┌─ ⑧ 能力契约（保留 K1） ──────────────────────────────────────────────┐
│  electron/shared/agentCapabilities/*                  【唯一 owner】  │
│  真相源：22 个能力的领域语义 + 别名 + 风险/权限元数据                  │
└──────────────────────────────────────────────────────────────────────┘
┌─ ⑨ 领域实现（保留 K3/K4/K5） ────────────────────────────────────────┐
│  capabilityCore/* · productionRun/*(58) · timeline(5) · canvas       │
│  真相源：各自的领域存储                                                │
│  与转录**按 id join，永不复制**                                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 2.2 三条纵向不变量（每条配一条机器判据）

> 今天的病根是「每一层都在自己那层做了合理的事，没有人负责纵向不变量」。所以不变量必须**有 owner、有门岗**，不能只写进文档。

| # | 不变量 | 一句话 | 门岗 |
|---|---|---|---|
| **I1** | **顺序只有一个来源** | 一个回合里「谁先谁后」= lane transcript 的条目顺序。**任何层不得再排序** | `check:pi-boundary` 规则 O1 |
| **I2** | **转录只有一份落盘** | agent 转录的持久化只有一个写入点 | 规则 O2 |
| **I3** | **账只有一个算点** | token → 钱只在 pi 的 `calculateCost` 算一次 | 规则 O3 |

### 2.3 四条实核事实，落地时会咬人

1. **价格单位是「每百万 token 美元」，不是每 token。** `calculateCost` 实现是 `(rates.input / 1000000) * usage.input`（`node_modules/@earendil-works/pi-ai/dist/models.js:539-543`）。#546 后端评审那条提醒是对的：Nomi catalog 的 `pricing` 单位必须对齐，**差一次就是三个数量级**。（本方案作者读实现确认；一份并行调研把它记成「每 token」，以实现为准。）
2. **`reasoning:false` 让思考在类型层不可能发生。** `getSupportedThinkingLevels(model)` 在 `model.reasoning === false` 时**只返回 `["off"]`**（`models.js:547-549`）。所以面板上的档位选择器必须由 `getSupportedThinkingLevels` **derive**（P4 通用第一 + 随输入 derive 不 hardcode），不是硬编码三档；`thinkingLevelMap` 里值为 `null` 的档位是「这个模型不支持」，要在 UI 上不可选而不是报错。
3. **pi 的工具 schema 是 TypeBox（`TSchema`），不是 zod。** `Tool<TParameters extends TSchema>`（`pi-ai/dist/types.d.ts:381-386`）、`AgentTool`（`pi-agent-core/dist/types.d.ts:340-359`）。Nomi 的契约真相源是 zod（62 个文件）。这不是小事——它是 §7 **岔路 3**。
4. **容忍有官方钩子**：`AgentTool.prepareArguments?: (args: unknown) => Static<TParameters>`（`pi-agent-core/dist/types.d.ts:347`，注释自陈「校验前的兼容性捏合」）。今天我们用 `z.preprocess` + `zodToJsonSchema` override，而那个 override 会把该字段的 schema **抹成 `{}`**（`tools.mts:47-49`）——它现在零活跃用户，但陷阱还在，随 B1 一起删。

---

## 3. 模型优先的工具契约规范

> **这一段解决的真实摩擦**：模型第一次就把参数写对的概率，直接决定用户等多久、烧多少钱。今天最贵的那个工具（分镜 24 行）拿到的 schema 是「一个由任意对象组成的数组」，真实成功率 **0%（0/18）**。
> **要权衡的那一个东西**：工具越少，每个工具的参数就越复杂（一个 `operation` 枚举带十几个分支，模型要在参数里做二次选择）；工具越多，模型每次请求要读的 schema 越长（占上下文、占钱、增加选错概率）。#547 的真实数据给出了裁决方向：**出问题的从来不是「工具多」，是「一个工具里塞 9 个分支 + 两个工具字节级相同」**——所有单分支扁平 schema 的工具都是 100%。

### 3.1 命名

- 模型面统一 `nomi_<domain>_<verb>`。今天是混着来的：`nomi_canvas_read`（有前缀）与 `read_timeline` / `load_skill` / `get_media` / `export_timeline`（无前缀）**在同一个工具集里同时出现**（`agentChatPolicy.ts:112-131`）。
- 正则取 pi 运行时正则（`tools.mts:39`）与 Anthropic `^[a-zA-Z0-9_-]{1,64}$` 的**交集**，在**注册表处**校验（不是 session 构造时）。这条直接来自真机教训：`layout.read` 这个带点的别名不合正则 → `createHostTools` 直接抛 → **整个 timeline/production 工具档一次请求都发不出去**，用户只看到「发送失败」。
- **别名不再直接当工具名。** `canvasWrite.ts:485-489` 的三个别名（`pi: set_node_prompt` / `mcp: nomi_canvas_edit` / `ui: nomi_canvas_plan`）被 `modelToolSurfaceManifest` 当成**两个独立工具**发给了同一个模型——这是 0/18 的直接成因之一（真机序列 `plan→edit→edit→edit→plan→edit→plan` = 在两个字节级相同的工具间抛硬币）。

### 3.2 Schema（硬规则，全部可机器判定）

| # | 规则 | 今天违反的实例（已实核） |
|---|---|---|
| S1 | 模型可见 JSON Schema 里不许出现 `{}`、`z.any()`、`z.record(z.unknown())`、无 `items` 的数组 | `canvasWrite.ts:143`（`anchors`）`:144`（`shots`）`:71` `:200` `:202` `:204` `:206` `:221` 共 8 处；`mcpGenerationToolCatalog.ts:33` `references: { type: "array" }` 无 items |
| S2 | 单个工具 `anyOf` ≤ 4 | `nomi_canvas_plan` / `nomi_canvas_edit` 各 **9** 分支 |
| S3 | 无两个模型可见工具的 `inputSchema` 结构相同 | `plan`/`edit`（**字节级**相同 8238 B）、`propose_edit_plan`/`apply_edit_plan`（3882 B ×2）、`read_production_artifact(_content)` |
| S4 | 每个工具描述 ≥ 3 句（说清：干什么 / 什么时候用它而不是隔壁那个 / 不要用它做什么） | 35/35 违反（中位 **87 字符**）。Anthropic 原文：这是「by far the most important factor in tool performance」 |
| S5 | ≥2 分支或 ≥10 字段的工具必须带 ≥1 个 schema-valid 示例（**写进 description**，不用 Anthropic 专有的 `input_examples`——我们要跨供应商） | **0/35** 带示例 |
| S6 | 全部必填字段 + 全部枚举字段带说明；「值必须来自目录」的字段（`modelKey`/`vendor`）给枚举或明写「必须来自 `nomi_*_read` 的返回，不要自己编」 | 23/35 零字段说明；真机实测模型给 `modelKey` 编了一个 `"seedance"`（`canvasWrite.ts:43` 是裸 `z.string()`，无枚举无说明） |
| S7 | 任一 profile ≤ **12** 工具、schema 总量 ≤ **4 000 token** | production profile **30 个 / 12 641 token**；storyboard 6 个但两个重复工具独占 76% |

### 3.3 错误契约（模型必须能自纠）

**今天的机制**（真机抓到的、模型真正收到的那段文本）：8 行来自 9 个不同分支、互不标记的校验报错，其中**只有 1 行是真的**，而它和 7 行噪音长得一模一样；再往下一层，模型收到的干脆就是错误码字符串本身（`canvasWriteTransportAdapters.ts:69-75`：`message: code`）。

```ts
// 住在 electron/shared/agentCapabilities/，唯一 owner
type ToolFailure = Readonly<{
  code: string            // 闭合词表，供 UI 分档（保留现有词表）
  message: string         // 一句人话：哪里错、期望什么。**门岗断言 message !== code**
  issues?: readonly { path: string; expected: string; receivedType: string }[]
  branch?: string         // union 命中的分支（= 模型给的 operation），只报这一支的错
  allowed?: readonly string[]   // 枚举/operation 的全部合法值
  nextAction: string      // 「把 nodes 直接给数组本体，不要 JSON.stringify」
}>
```

- **回给模型的官方出口**：pi 的 `before_tool` 钩子返回 `{ block: { reason } }`，`reason` 就是模型看到的正文（`agent-harness.d.ts:550-562`）。**不需要自己造通道**。
- **安全边界（硬性）**：`receivedType` 只带**类型名**，绝不回传收到的**值**——用户文稿正文、素材路径都可能在参数里，那是 provenance/隐私边界。今天 pi 那层会把整个 `Received arguments` 原样回给模型，这条随重做一起收口。
- **今天已经做对的那一半**：`dispatcher.ts:557-565`（对外 MCP）已经是这个形状。**内部路径从同一个源派生**，不再各写一份。

### 3.4 容忍（一族，不是一个字段）

**规则**：模型把结构化值序列化成 JSON 字符串，是**跨模型的通用行为**，不是某个模型的毛病（真机 18 次失败 100% 是这一条）。所有模型面入参在**模型能到达的第一层**统一过一次归一化，用 pi 的官方钩子 `prepareArguments`；解开后**在结果里回一句「已按 JSON 字符串解析」**（不静默——静默容忍会让模型学不会）。

**同 commit 删掉现有三处症状级补丁**（P1 + R28：防线建在最早能拦住的那层）：
- `storyboardPlanSchema.ts:72-87` 的半套 preprocess（**只给了 `shots`、没给 `anchors`**，且在渲染层第二道校验里——从模型角度看是死代码）；
- `storyboardLauncher.ts:40` 与 `:80` 两条在提示词里恳求模型别犯这个错的话。**三次恳求都没挡住**，这就是它们该被删的证据。

### 3.5 数量收敛（用 #547 的重复度数据）

| 动作 | 对象 | 依据 |
|---|---|---|
| 合并 | `nomi_canvas_plan` + `nomi_canvas_edit` → 一个 `nomi_canvas_write` | 字节级相同；模型在两者间抖动 |
| 拆分 | `canvas.write` 的 9 个 operation → **3 个语义工具**：`nomi_canvas_write`（节点/边）· `nomi_storyboard_write`（分镜三个）· `nomi_shot_reference_write`（站位/运镜） | 9 分支 `anyOf` 是错误不可归因的直接成因；拆完每个 ≤4 分支（满足 S2） |
| 合并 | `propose_edit_plan` + `apply_edit_plan` → 一个 + `operation: "preview" \| "apply"`；`read_production_artifact(_content)` → 一个 + `include: "meta" \| "content"` | S3 |
| 派生 | 时间轴读：MCP 1 个 / 内部 3 个；媒体查询 1 / 5；导出检查 1 / 2 —— **分解方式从契约派生，不再两边手写** | 收掉 `mcpCapabilityProjection.ts:210/227/261` 三处手写映射 |

**目标**：任一 profile ≤12 工具 / ≤4 000 token（今天 production 30 / 12 641）。

### 3.6 内外同源

```
toolProjection(registry, profile: "internal" | "mcp") → ModelFacingTool[]
```

一个函数、两个 profile。**允许的差异只能来自契约里的声明**：
- MCP 侧每工具必带 `leaseHandle`（显式租约 —— 安全设计，不是历史包袱，保留）；
- 内部侧永不投影 `nomi_operation_gate` / `nomi_operation_execute`（信任边界，§1.3）。

**不允许的差异（今天存在，要消掉）**：广播 schema 弱于执行 schema。今天 `references` 在 MCP 侧无 `items`、在内部侧严格 typed——**外部宿主比内部 agent 拥有更宽松的输入面**，信任方向反了。门岗断言：MCP 广播 schema 必须能拒绝所有 zod 会拒绝的输入。

---

## 4. 迁移与切换

### 4.1 开发期并存的边界（P1 的正确读法）

新模块住 `electron/agentLane/` + `src/workbench/ai/lane/`，**对用户不可达**：不注册 IPC、无任何入口。

> **为什么这不算「并行版」**：P1 禁的是「同一件事有两条用户走得到的路」。开发期新通路用户走不到，所以用户只有一条路。**判据必须是机器判据，不是承诺**：切换 PR 之前，新目录的任何符号不得出现在 `main.ts` 的 IPC 注册表里——这条做成 `check:pi-boundary` 的规则 O6，和 `projectAgentCutoverStructure.test.ts:40` 已有的「main.ts 不含 `registerAgentChatV2Ipc`」是同一手法（那条断言证明这个手法在本仓行得通）。

### 4.2 切换 PR 同 commit 删旧（不留 feature flag、不留 fallback、不留逃生口）

一个**原子 PR**，删除清单：
- `electron/projectAgentHost/` 52 个生产文件 / 9 688 行
- `electron/harness/runtime/` 旧 seam（`runtimePort.ts` + `pi/*.mts` 13 文件）
- `agentPanelV4Projection.ts`(459) + `agentPanelV4PendingTools.ts` + `residentToolProjection.ts` + `projectAgentProjectionStore.ts`
- `projectAgentIpc.ts`
- 四个死文件（`canvasDescriptors` 471 + `documentDescriptors` 86 + `agentChatV2Ipc` 277 + `nomiSkillResources` 167）

**不许拆成半截合入**——半截就是并行版。

### 4.3 旧数据迁移（诚实分档：能读的迁，不能读的明说）

| 旧数据 | 能不能迁 | 怎么办 |
|---|---|---|
| pi 快照信封 `<project>/.nomi/agent-thread-context-v1.json`（`snapshot.mts:64`） | ✅ **能，且优先** | 它本来就是 pi session 的导出，schema **已完整保留有序的 text/thinking/toolCall 段**（`snapshotSchema.mts:18-26`）。**这是唯一一份含真实顺序的旧数据**。与宿主 items 冲突时以它为准——它是模型真正看过的 |
| 宿主 `snapshot-v1.json` 的 items | ⚠️ **能迁内容，迁不回顺序** | 按 items 数组顺序（= 历史写入顺序）线性回填。**绝不按 `createdAt` 重排**：实核数据里同回合 8 条工具的 `createdAt` 去重后**只有 1 个值**，助手条目比它们早 107 秒——按它重排会**造出一个假顺序** |
| 宿主 `commands-v1.jsonl` 命令账本 | ❌ **不迁** | 它是旧状态机的重放输入；新运行时有自己的 `operationId` 受理（`accept`/`getResult`）。归档保留一个版本周期后删 |
| 渲染层 localStorage 工具正文 | ❌ **不迁** | 它本来就是易失的（清浏览器存储就没了）。新通路里工具正文在 transcript 里 |
| 审批卡 / 任务卡 / 失败卡条目 | ✅ **能** | 各一个 `customType`，用 `appendCustomEntry` 写进新 transcript，配 `entryProjectors`（`AgentHarnessOptions.entryProjectors`，`agent-harness.d.ts:634`）。这正是 pi 官方给宿主放自己数据的姿势 |

**明着标（D4 诚实交付）**：迁移来的历史对话，顺序是**「写入顺序」而不是「真实发生顺序」**——旧数据里真实顺序已经不存在了，任何声称能恢复的做法都是编。面板上给迁移来的历史打一个「旧格式」标记。

### 4.4 实验室：57 张基线一张不动，作为回归网

- v4 面板改由**新投影**驱动；夹具从「手写宿主 items」改成「手写 `LaneSnapshot`」。
- **每个夹具必须投出与今天逐像素相同的 view model。** 基线红 = 新通路投错了，**不是「基线该更新」**。
- ⚠️ 排错顺序（踩过的坑）：报「基线不符」先确认不是 5197 端口撞了——docs-only 分支上曾出现 30 张全红，全是 `ERR_CONNECTION_REFUSED`，而门岗文案会诱导人去更新基线，那是把连接失败钉成新基线。
- ⚠️ `check:design-lab` 是**静态检查**，它不执行走查；旧截图不自动清。判断证据新鲜度要比 mtime。

---

## 5. 验收门（不可省，每条给判据 + 怎么证）

| # | 门 | 判据 | 怎么证 |
|---|---|---|---|
| **G1** | **真实环境闭环** | MiniMax H3 一条 **1–2 分钟短片**，真项目 / 真素材 / 真额度，跑通 创作 → 分镜 → 画布 → 生成 → 时间轴 → 导出 | R13 走查法：截图**人眼判断** + 情绪摩擦日志。判据不是「没报错」，是「一屏之内能读出『它说了什么 → 它做了什么 → 结果如何』这条线」。R16：过程中冒出的体验/UI/产品感问题**全修掉**才算完成 |
| **G2** | **工具一次写对率** | `canvas.write` 从 **0/18** 到 **≥90%**；「建 2 个镜头卡」**3/3** 回合全绿；「从原稿拆 8 镜」**3/3** 调到分镜工具（现状 0/3） | 用 #547 §3.2 **同一套**任务复测：5 任务 × 3 次、同模型（DeepSeek V4 Flash）、同隔离 profile（`prepareIsolation`）、介入槽一律拒绝、只花文本 token。改前基线就是那张表 |
| **G3** | **冷重启顺序** | 关 app → 重开 → 打开同一条历史对话，面板顺序与 lane transcript 的 `Entry[]` **下标顺序逐项一致** | **机器断言**，不是人眼。⚠️ 今天这条**结构上做不到**（易失登记表冷重启就空）——**它是重做存在的理由**，也是唯一一条「修不出来、只能重做」的门 |
| **G4** | **一次 429 不死** | loopback 夹具在第 N 次请求注入 429，断言：① 自动重试（pi `RetryPolicy`）② 面板出现「正在重试 2/3」③ 最终成功 ④ 转录里留有重试记录 | 事件源 `retry_scheduled` / `retry_start` / `retry_end`；快照字段 `LaneSnapshot.operation.retry{attempt,maxAttempts,nextAttemptAt}`。⚠️ 后端提醒：先确认 `observeNativeStream` 看门狗（90s 首响应 / 120s 空闲）与 pi 重试**不会互相打架**——两套超时叠在一起是典型的「单跑绿、真实网络下翻红」 |
| **G5** | **花费/上下文/推理三行有真数字** | 三个数都 > 0，且花费与供应商账单**同量级** | 花费走 pi `calculateCost`（**单位对齐 per-million**，§2.3-1）；上下文走 `LaneSnapshot.stats` + `contextWindow`；推理走 `Usage.reasoning`。**用户已定第②条**：思考打开、面板上让用户选档位、默认按能力分档（`storyboard`/`production` 开，`creation-chat`/`canvas-refine` 保持 off）、**旁注推理计费**。档位由 `getSupportedThinkingLevels` derive。**任一档位下思考确实关闭时，那一行不渲染**（D4：不给用户看永远空的行） |
| **G6** | **真机教训做成零额度判据（R28）** | 五条，各带阳性对照（把修复前的代码喂进去**必须红**，R17） | ① 模型可见字符串（工具名/operation 枚举/别名）在**注册表处**过运行时正则 ← `layout.read` 整档发不出去 ② `useSyncExternalStore` 快照 getter 引用稳定 ← 有待决工具时整页「工作台加载失败」（仓库有 6 个手写 store） ③ 带传输标记的字符串，编码/剥离函数同文件成对且互为单测 ← base64 原样印给用户 ④ 审批七态 join 里 `denied` 与 `approved` 不得折进同一态 ← 点「不要」显示「已确认」 ⑤ 滚动容器不出现在没有滚动条的地方 ← 面板被永久裁 17px |
| **G7** | **两条新门岗自身归零** | `check:pi-boundary` 与 `check:model-schema` 的棘轮基线，**到切换 PR 时必须归零** | §8。基线不归零 = 重做没做完 |
| **G8** | **五门 + 视觉基线** | contracts 全绿 + 按 R22 选定的验证档；**57 张基线一张不动** | `check:design-lab`。⚠️ 多步回合的走查截图**会变**（顺序变了），这要在 PR 里明说，别让人以为「基线没动 = 没影响」 |

---

## 6. 分阶段与体量

> **总纪律**：每阶段一个分支一个 PR。不做「一个 PR 收口全部」——接线计划已经算过账，那样做当天就会红掉每日闸。
> **体量**是数量级估计，不是承诺。

### 阶段 0 · 探针（**不产出产品代码，只产出决策**）

- **范围**：在一个独立 worktree 里验四件事——① pi 0.85.1 在 Nomi 的 **CJS 主进程**里能不能起（六个包一起动，`pnpm.overrides` 硬锁）；② `AgentHarnessOptions.session` 能否注入自定义存储位置（Nomi 要写 `<project>/.nomi/`，pi 默认写 `~/.pi/agent/sessions/`）；③ `before_tool` 的 `{block:{reason}}` 是否真的把 `reason` 送到模型；④ `LaneSnapshot` 的 `streamingMessage` / `runningTools` 实测形状。
- **不动项**：一切产品代码。
- **回滚**：删分支。
- **验收门**：一份带实跑证据的探针报告 + **§7 岔路 1 的拍板**。四件里任一不通过 → 走岔路 1 的方案 B（留 0.84.3 + `createAgentSession`），方案主体不变、⑤⑥ 两层的分工变。
- **体量**：0 产品文件。

### 阶段 1 · 垂直切片（walking skeleton）

- **范围**：一条能力端到端跑通新通路——选 `document.read` + `document.write`（#547 实测这两个今天就是 **100%**，所以任何失败都归因于新通路而不是模型）。链路：pi lane → laneHost → laneIpc → laneClient → laneViewModel → **现有 v4 组件**。
- **不动项**：旧通路照常服务用户；v4 组件一行不改；57 张基线不动。
- **回滚**：新目录整体删除（用户走不到，零影响）。
- **验收门**：G3（冷重启顺序，用这条能力证）+ G8。
- **体量**：新增 ~10 文件 / ~1 200 行；删 0；1 PR。

### 阶段 2 · 工具契约（§3）

- **范围**：`toolProjection` + 错误契约 + `prepareArguments` 容忍 + 工具合并/拆分/描述/示例/枚举 + 迁移 `canvasDescriptors.ts` 的 `.describe()` 资产。
- **不动项**：能力的 id / 别名 / 权限链；transport adapter；MCP 执行边界；`tools/list` 的确定性顺序（`agentToolCatalog.ts:31-35` 已合规，是 prompt/KV-cache 合同）。
- **回滚**：`toolProjection` 是新文件，可整体 revert；工具改名会同时动**对外 MCP 面**，PR 描述必须列改名前后对照。
- **验收门**：G2（一次写对率）+ `check:model-schema` 从红到绿。
- **体量**：改 `agentCapabilities` ~8 文件；新增 2 文件；删 4 个死文件（1 001 行）+ 3 处症状级补丁；2 PR。

### 阶段 3 · 闸与三行

- **范围**：审批/花费闸挂到 `before_tool`；队列/steering 接 pi 的 `steer`/`followUp`/`cancelQueued`（面板上第一次有入口）；花费/上下文/推理三行接真数字；重试打开 + 面板显示重试进度；三层步数上限收成一层（删掉会说谎的第三条）。
- **不动项**：三档权限的**产品语义**与默认值（`safe-auto`/`confirm`）；付费闸的信任边界（§1.3）。
- **回滚**：各条独立 revert。
- **验收门**：G4（429 不死）+ G5（三行真数字）+ G6（五条零额度判据）。
- **体量**：新增 ~6 文件；1–2 PR。

### 阶段 4 · 切换（**删旧**）

- **范围**：v4 面板改吃新投影；**同 PR 删旧**（§4.2 清单，~11 000 行）；旧数据迁移（§4.3）。
- **不动项**：v4 组件外观；57 张基线。
- **回滚**：revert merge commit（迁移必须连着 revert；新字段可选读、写时必填）。
- **验收门**：**G1（真实闭环）+ G3 + G7（两条门岗基线归零）+ G8**，全部。
- **体量**：删 ~58 文件 / ~11 000 行；改 v4 组件的数据入口；**1 个原子 PR，不许拆半截**。

### 阶段 5 · 内外同源 + 目录新鲜度

- **范围**：MCP 广播 schema 不弱于执行 schema；收掉三处手写映射；**用户已定第①条**——`radar:models` 的 `WATCHED` 加 LLM（今天 `scripts/model-radar.ts:30-33` 明写不含）、改抓**带鉴权的 `/v1/models`** 而不是 docs 页、退役 id **直接下架**（不是只降 legacy 分层）。
- **回滚**：各条独立。
- **验收门**：一条断言「每个能力的 MCP 广播 schema 必须能拒绝所有 zod 会拒绝的输入」；探测需真实 key（额度极小）。
- **体量**：2 PR。

### 6.1 在途分支处置

| 分支 | 实核状态 | 处置 |
|---|---|---|
| `fix/real-env-acceptance-20260906` | **ahead=10, behind=0** | **先合**（用户现在就在撞）。五条修复里 `d065efbd0`（overflow-clip）/ `7e56111c7`（剥传输标记）/ `fb4b156d1`（composer 跑出视口）**在重做后仍然有效**；`799564f91`（宿主丢 error）/ `567a29cb7`（denied 折进 approved）**随 B2/B4 一起死** —— 但**它们的教训升格成 G6 的判据②④**，这才是它们的长期价值 |
| `fix/agent-v4-real-use-20260906` | **ahead=6, behind=8**（6 个 commit，非任务书说的 A–H 八个） | **拆开处理**。可先合（重做后仍有效）：`9fed90d4f` 边界层解 JSON 字符串（**正是 §3.4 的正确落点**，重做时升级成 `prepareArguments`）· `b4c918b72` 同名连调折一行 · `425a29953` 模型弹层每类一行 · `e894d0d19` 分镜主语修正 · `a59cf7daa` 实验室加格。**不再叠**：`4bf23ecac`「上下文环补一手文档的窗口表」——它是 pi 免费给的东西（`Model.contextWindow` + `getContextUsage`）的手写替代品，重做后会**直接撞 `check:pi-boundary` 规则 O3**。但它里面「查不到就不画环、改说『已用 12.3k』」那条**产品规则是对的**（D4），单独保留 |
| `feat/agent-panel-v4-logo-dock-20260906` | 本地分支存在，**未推 origin** | **可合**（纯外观，收起坞 logo 血统）。趁 Dock 文件还没被阶段 4 动 |
| `fix/design-lab-wired-states-20260906` | **ahead=0, behind=4** —— 已合（PR #544） | 已在 main。它把 `sortedItems()` 第二键从 `itemId` 哈希改成宿主数组下标（`agentPanelV4Projection.ts:247-263`，方向正确）；**阶段 4 会把整个函数删掉**（顺序来自 transcript，不再排序）——PR 里要明写这是**净删**，免得下一个人以为排序键还在用 |
| `docs/mature-agent-products-research-20260906`(#549) | **已合入 main（2026-09-07）** | **已并入**，路径 `docs/research/2026-09-06-mature-agent-products.md`。它的 §1.9（0.85.1 harness 实现）与本文 §0.2 是两次独立实核，结论一致 |
| `docs/agent-architecture-review-20260906`(#546) / `docs/agent-tool-layer-audit-20260906`(#547) | docs-only | 随时可合，不阻塞任何人。**它们的渐进方案（`master-plan` / `root-fix`）已于 2026-09-07 标 ⛔ 被本文取代**（含 `docs/plan/INDEX.md` 与 doc-status 标记），两份方案不再并存 |

---

## 7. 只留真岔路的 R3 表（三条）

> 其余全部按 P0 自主推进。这三条各自是「多个分歧巨大的合理解 / 不可逆」，必须用户拍。

### 岔路 1 · pi 版本与接入层

**背后的逻辑（大白话）**：我们要在别人的地基上盖房子。上游前天刚把地基浇好（0.85.1），但混凝土只干了一天；我们锁的还是上一版（0.84.3），那一版的地基**图纸完整、实体是空的**。要么等一等自己先搭个临时架子，要么现在就站上去。

| 方案 | 用户看到 | 代价 |
|---|---|---|
| **A. 升到 0.85.1，用 `AgentHarness` / `AgentLane`** ⭐ | 顺序、重试、队列、花费、崩溃恢复**一次全到位**；面板上第一次能看到「正在重试 2/3」和真实花费 | 六个 pi 包必须一起动（`pnpm.overrides` 硬锁）；0.85.1 只发布一天、**零生产验证**；CJS 主进程兼容性未验（阶段 0 探针要答的第一题） |
| **B. 留 0.84.3，用 `createAgentSession` + `SessionManager`** | 同样能拿到有序段（`message_update` 带 `contentIndex`）与重试；但 lane/命令受理/多轨要**自己写一层薄的** | `AgentHarness` 在 0.84.3 **确认是空壳**（全部方法抛 `HarnessNotImplemented`，本方案实核）；我们要手写 `LaneSnapshot` 里那几个字段——**这正是 R20 要拦的事**，半年后 0.85.x 稳定了还得再拆一次 |
| **C. 把 pi 当子进程，走 RPC/JSON 协议** | 与版本解耦，pi 崩了不带崩主进程 | 多一道序列化边界与一个进程生命周期要管；Nomi 今天不需要这个隔离；审批要的 `ctx.ui` 一问一答变成跨进程往返 |

**推荐 A，但拍板挂在阶段 0 探针之后**：探针四题全过 → A；任一不过 → B（方案主体不变，只是⑤⑥两层的分工变，⑤ 变厚）。**C 明确不选**，除非探针发现 CJS 兼容是死结。
**这条为什么必须用户拍**：它是不可逆取舍（升级后回不去），且赌的是一个发布一天的版本。

> ✅ **2026-09-07 用户拍板：按推荐** —— 取 **A**，但拍板挂在阶段 0 探针之后：探针四题全过才推 `0.85.1`，任一不过退 B。

### 岔路 2 · 转录的真相源放哪

**背后的逻辑**：「这段对话到底发生了什么」现在有三份落盘记录，谁说了算今天没定。重做要往里加「顺序」，就必须先回答加到哪一份。
**⚠️ #546 §3.1 在「渐进修」前提下选了 A（宿主 record）。用户改判重做后，我在这里重新判了一次，结论翻转——理由见下。**

| 方案 | 用户看到 | 代价 |
|---|---|---|
| **A. 宿主 record 唯一（#546 原推荐）** | 冷重启后历史正确；审批/任务卡与文字段在同一条时间线 | **在重做前提下这条的理由消失了**：#546 选 A 的核心论据是「用户可见历史里有一半东西 pi 根本不知道（审批卡/任务卡/失败条）」。但 pi 0.85.1 有 `appendCustomEntry` + `entryProjectors`（`agent-harness.d.ts:634/642`）——**那正是官方给宿主放自己数据的口子**。继续选 A = 明知有官方口子还自己维护一份转录 = 撞 R20 |
| **B. pi lane transcript 唯一 + 宿主领域记录以 custom entry 骑在同一条流上** ⭐ | **顺序天生正确**（不需要任何排序）；与模型看到的历史逐字一致，永不漂移；压缩/分支/`branch_summary`/统计直接白拿 | pi 快照今天不过 IPC，要新建投影通道（本来就要建，B4）；生产运行等长生命周期领域状态**不能**塞进转录（它们跨线程、跨重启活得更久）——**按 id join，不复制**（这是设计约束不是代价） |
| **C. 双真相源 + 同步（今天的事实状态）** | — | **已经在付代价**：同一段助手文字有两处独立推导且互相覆盖（宿主增量 append vs 运行时 `response.text` 整覆盖），reducer 只在两者不一致时 bump 修订号——**分歧被容忍且不可见** |

**推荐 B**。一句话理由：**重做的全部意义就是「不再维护上游已经维护好的东西」；选 A 等于重做完还留着最大的那一件。**
边界写清楚：**agent 转录 = pi lane；领域状态 = 各自领域存储；两者按 id join，永不互相复制。**

> ✅ **2026-09-07 用户拍板：按推荐** —— 取 **B**，转录真相源 = pi lane transcript，宿主领域记录以 custom entry 骑在同一条流上。

### 岔路 3 · 模型可见 schema 的语言

**背后的逻辑**：pi 的工具参数类型是 **TypeBox**（`Tool<TParameters extends TSchema>`，`pi-ai/dist/types.d.ts:381`），Nomi 的契约真相源是 **zod**（62 个文件）。今天的做法是 zod → `zodToJsonSchema` → pi 用 ajv 校验一遍 → 我们再用 zod 校验一遍。**两个校验器 = 那 8 行互不标记的报错**（#547 §2.2③：8 行里只有 1 行是真的）。

| 方案 | 用户看到 | 代价 |
|---|---|---|
| **A. zod 仍是作者写法，模型可见 schema 只有一个生成点，校验只发生一次** ⭐ | 错误可归因（只报命中分支那一支）；契约作者不用学新东西 | 要写一个 zod→TypeBox（或 zod→JSON Schema→TypeBox）的**受控转换器**，且必须门岗保证「转换器没吃掉信息」（`.describe()`、枚举、`min/max` 都要过桥）；`z.preprocess` 那类会抹平 schema 的写法要禁 |
| **B. 模型可见契约原生改写成 TypeBox** | 与 pi 零阻抗，错误直接来自 pi 一层 | 22 个能力契约要重写；zod 仍要留给非模型面校验 → **两套 schema 语言长期并存**，正是我们要消灭的那种重复 |
| **C. 维持两套校验（今天）** | — | 已被真机否定：**0/18** |

**推荐 A**。理由：真正要消灭的不是「zod 还是 TypeBox」，是**「校验发生两次、错误来自两个不认识对方的验证器」**。A 用一个转换器把校验收成一次，且保住 62 个文件的既有投资；B 的收益（零阻抗）买不回重写 22 个契约的代价。
**转换器必须自带门岗**（信息不丢），否则它会变成下一个 `tools.mts:47-49`——一个静默抹平 schema 的 override。

> ✅ **2026-09-07 用户拍板：按推荐** —— 取 **A**，zod 保持作者写法，模型可见 schema 只有**单一生成点**，校验只发生一次。

---

## 8. 重做期间的两条门岗（规则草案 · R17：加规则必须先验它会红）

> 仓库有两种棘轮，选型有讲究（实核）：`check:heavy-path` 是**计数式**（`RULES[]` + `scripts/heavy-path-baseline.json` 的 `{ruleId: count}`）；`check:boundaries` 是**身份式**（`scripts/boundaries-baseline.json` 存每条违规的身份串，`added` 失败、`removed` 也失败）。
> **两条新门岗都取身份式**——因为它们要拦的东西可以「修掉一条、偷加一条」，纯计数拦不住。

### 8.1 `check:pi-boundary` —— pi 已提供的能力，仓库里再出自研版本就红

**它在解决哪个真实摩擦**：我们手写了 9 688 行去做上游已经做好的事，而**没有任何机制在写下去的那一刻拦住**。R20 的 build-vs-buy 闸今天只活在人的记忆里。

规则表（每条：pi 的 owner 符号 + 检测签名 + 今天会不会红）：

| # | pi 已提供 | pi owner（证据） | 检测签名 | **今天会红吗** |
|---|---|---|---|---|
| **O1** | 回合内顺序 | `LaneSnapshot.transcript` / `AssistantMessage.content` | `agentLane` 之外，对 agent item 集合做排序（`.sort(` 且比较键含 `createdAt`/`itemId`/`turnSeq`） | 🔴 **会**：`agentPanelV4Projection.ts:247-263` |
| **O2** | 转录持久化 | `Session` / `SessionManager` | `agentLane` 之外写 agent 转录到盘（`snapshot-v1.json` / `commands-v1.jsonl` / sha256 信封 / localStorage 工具正文） | 🔴 **会**：`projectAgentRepository.ts:351-357`、`snapshot.mts:64`、`residentToolProjection.ts:88`（**3 条身份**） |
| **O3** | 用量→花费换算与上下文窗口 | `calculateCost`（`models.js:527`）、`Model.contextWindow` | 第二处把 token 乘价、或手写 contextWindow 表 | 🔴 **会**：`run.mts:12-32` `nomiUsage()`、`agentUsageStore`、`agentPanelV4Projection.ts:421` 各汇总一遍（**3 条身份**）；`4bf23ecac` 若合入再加一条 |
| **O4** | 队列 / steering | `steer` `followUp` `nextRun` `cancelQueued` `queues` | `agentLane` 之外的 agent 队列状态机 | 🔴 **会**：`projectAgentHost` 的 `ProjectAgentQueueItem` reducer |
| **O5** | 重试与退避 | `RetryPolicy` + `retry_*` 事件 | agent 供应商调用外面手写重试/退避循环 | 🟢 今天不红（我们把重试**整个关了**，没有替代品）。**这条是防复发**：阶段 3 打开 pi 重试后，任何人再手写一个就红 |
| **O6** | 开发期不可达 | — | 新目录符号出现在 `main.ts` 的 IPC 注册表（手法同 `projectAgentCutoverStructure.test.ts:40`） | 🟢 今天不红（新目录还不存在）。**切换 PR 时这条规则删除** |

- **基线**：`scripts/pi-boundary-baseline.json`，身份式（`{ruleId: [identity…]}`）。
- **纪律**：基线**只减不增**；**到阶段 4 切换 PR 时必须归零**（G7）。基线不归零 = 重做没做完。
- **R17 预验**：规则落地 PR 必须先在 `origin/main` 上跑一次并把上表 🔴 那四条的实际命中数写进 PR 描述——**先绿后红的门岗是装饰品**。

### 8.2 `check:model-schema` —— 模型可见 schema 不许空

**它在解决哪个真实摩擦**：模型给分镜表写 24 行，而它看到的 schema 只说「shots 是一个由任意对象组成的数组」。**真实成功率 0%。**

规则表：

| # | 规则 | **今天会红吗**（已实核） |
|---|---|---|
| **S1** | 模型可见 JSON Schema 不许有 `{}` / `z.any()` / `z.record(z.unknown())` / 无 `items` 的数组 | 🔴 `canvasWrite.ts:71,143,144,200,202,204,206,221`（8 条）+ `mcpGenerationToolCatalog.ts:33`（1 条） |
| **S2** | 单工具 `anyOf` ≤ 4 | 🔴 `nomi_canvas_plan` / `nomi_canvas_edit` 各 9 |
| **S3** | 无两个模型可见工具 `inputSchema` 结构相同 | 🔴 3 组 |
| **S4** | 描述 ≥ 3 句 / ≥120 字符 | 🔴 35/35 |
| **S5** | ≥2 分支或 ≥10 字段的工具带 ≥1 示例 | 🔴 35/35 |
| **S6** | 必填 + 枚举字段有说明；「必须来自目录」的字段给枚举或明写 | 🔴 23/35 |
| **S7** | 任一 profile ≤12 工具 / ≤4 000 token | 🔴 production 30 / 12 641 |
| **S8** | 任一 `ToolFailure` 构造点带 `nextAction` 且 `message !== code` | 🔴 `canvasWriteTransportAdapters.ts:69-75`、`projectAgentExecutionCoordinatorTypes.ts:222-235` |
| **S9** | MCP 广播 schema 不得弱于执行 schema | 🔴 `references` 无 items（外部比内部还松） |

- **基线**：`scripts/model-schema-baseline.json`，身份式（`{ruleId: ["toolName#fieldPath", …]}`）。
- **附一条离线回归**（零额度）：把真机抓到的**真实错误参数**（`docs/audit/attachments/2026-09-06-tool-probe.jsonl` 里那些 `"nodes": "[...]"`）钉成 fixture，断言「归一化后应当通过」+「若仍不通过，错误必须带 `path`/`expected`/`nextAction`」。**这是把本次 bug 变成永久回归测试。**
- **归零时点**：阶段 2 结束（G7）。

### 8.3 一条附带的评测卫生

**不要复活 `tests/ux/_agentProbe.mjs`**：它依赖的 `window.nomiDesktop.agents` 桥**在当前代码里已不存在**（全仓 `cancelChatV2` 只剩测试文件自己），`apimart-text-brain.e2e.mjs` / `staging-reference.e2e.mjs` 已经是**死的付费 e2e**。新评测接现役 `window.nomiDesktop.projectAgent` 通道（`electron/preload.ts:673-712`），并**同 commit 删掉**那两个死 e2e 与死 probe（P1）。这属于「死选择器同时造假红和假绿」那一族。

---

## 9. 六角色评审（R7）

**CTO**
1. 这份方案与 #546 最大的分歧只有一处，但那一处决定一切：#546 在「渐进」前提下推荐**宿主 record 当真相源**，本文在「重做」前提下翻成 **pi lane**。翻转的依据不是偏好，是 0.85.1 的 `appendCustomEntry`/`entryProjectors` 把 #546 选 A 的核心论据（「审批卡 pi 不知道」）消掉了。**这个翻转必须在拍板时被明确看见，不能悄悄发生。**
2. 我最担心的不是改不动，是**阶段 4 那个原子 PR**——~11 000 行删除 + 一次切换。它必须有一条演练：在切换前用 `--dry-run` 跑一次「删了旧的、新的顶不顶得住」的结构测，别等 PR 里才发现某个领域模块偷偷依赖着宿主的某个导出。
3. `check:pi-boundary` 是本方案最有长期价值的一件，它比任何一条修复都值钱：**它把 R20 从人的记忆搬进了 CI**。但它必须先在 main 上验红——先绿后红的门岗是装饰品。

**设计**
1. 有序流修好之后，v4 那 8 个积木**一个都不用改长相**，只是终于按发生顺序出现——这才是设计定稿本来的样子。57 张基线一张不动这条要守住，它是我们唯一能证明「重做没顺手改设计」的东西。
2. G1 不要用断言证，要用**截图人眼看**，判据我给具体的：一屏之内能不能读出「它说了什么 → 它做了什么 → 结果如何」这条线。另外「同一工具连错 7 次」要折成一行「尝试 7 次未成功 ›」——7 条一模一样的红收据本身就是噪音，这不新增积木，是一行收据的一个状态。
3. 裁决 7 的「思考(shimmer+秒数)」今天量的是**等首个 token 的时长**，词是个断言而它是假的。用户已定要打开思考——那这行就名副其实了；但**按能力分档意味着有些档位下它确实不该出现**，那时必须**不渲染**，不能显示一个 0。用一个断言性的词描述一件没发生的事，比不显示更糟。

**PM**
1. 数字说话：**「建两个镜头卡」这条最基础的画布任务，真实成功率 0%（0/3）**，「从原稿拆 8 镜」三次一次都没走到正确的工具。这不是打磨项，是**画布 Agent 目前不可用**。所以阶段 2（工具契约）的用户价值密度**高于**阶段 1，但它依赖阶段 1 的地基——我接受这个顺序，但要求**阶段 2 一结束就复跑 G2 并公布数字**，别等阶段 4 才量。
2. 用户 09-05 点名的三件事，本方案覆盖全部：「Agent 状态 UI 体验」= B1/B4 + 岔路 2；「用户自己接模型太难」= K7 + 阶段 5；「MCP 外部宿主出片」= §3.6 内外同源。
3. 阶段 0 是**唯一一个不产出用户价值的阶段**，所以它必须短、必须有明确的四道题和明确的失败出口（转 B 方案）。不允许它变成一个开放式调研。

**前端**
1. `sortedItems()` 在这条路上**会被改两次**：#544 刚把第二键从哈希改成数组下标（已合），阶段 4 把整个函数**删掉**。请在阶段 4 的 PR 里明确写出这次是**净删**，免得下一个人以为三个排序键都还在用。
2. 六个手写 external store 的引用稳定性判据（G6-②）我最想要——那个「有待决工具时整页崩」的 bug 是我最不想再遇到的一类。而且重做后这六个里至少三个会消失，剩下的更值得上门岗。
3. 实验室夹具从「手写宿主 items」改成「手写 LaneSnapshot」这件事量不大，但**每个夹具必须投出与今天逐像素相同的 view model**。基线红就是新通路投错了。别在那个时候去更新基线。

**后端**
1. 打开 pi 重试之前必须确认：`observeNativeStream` 的看门狗（90s 首响应 / 120s 空闲）和 pi 的重试**会不会互相打架**。两套超时叠在一起是典型的「单跑绿、真实网络下翻红」。这条我要求进阶段 3 的验收门。
2. 价格单位我复核过了：`calculateCost` 是 `rates.input / 1_000_000 * usage.input`（`models.js:539`），**每百万 token**。Nomi catalog 的 `pricing` 单位必须对齐，差一次就是三个数量级——这条写进阶段 3 的单测，不要靠人记得。
3. `ToolFailure.receivedType` **只带类型名、绝不带值**这条我坚持：现状 pi 把整个 `Received arguments` 原样回给模型，里面可能有用户文稿正文，那是 provenance 边界。重做时一起收口，不要留到以后。

**真实用户**
1. 我要的就是「我知道它在干嘛」。现在是发完一句话、转圈、然后哗啦一堆东西，而且文字说的和下面那堆红字对不上。
2. 它试一次不成，**换个法子再试**，而不是把同一句话说七遍。如果它真的做不到，直接告诉我做不到，我去手动建，别让我看七条红字猜。
3. 一次网络抖动就要我重发一遍 30 秒的等待，这个我最烦。花费那一行我不着急——但**别给我看一个永远是空的行**，要么给数，要么别画。

---

## 10. 本轮交付边界

- 本轮**只产出本文档**（docs-only PR，不合并）。一行产品代码未改。
- 拍板 §7 三条后，按 §6 阶段推进；**阶段 0 的探针结果回写进 §7 岔路 1**。
- 本方案拍板后，`docs/plan/2026-09-06-agent-architecture-master-plan.md` 与 `docs/plan/2026-09-06-agent-tool-layer-root-fix.md` 应标 **⛔ 被本文取代**——两份渐进方案与一份重做方案并存，下一个读的人一定会走错。
- 远期项登记：**`skill.write`**（让 Agent 把学到的方法写成技能）。恢复它需要的不是把工具接回去，是先设计「Agent 写的技能怎么被用户看到、审批、撤销」——那是一件独立的活。
