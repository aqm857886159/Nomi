# 成熟 Agent 产品怎么搞的 —— 行业对照（2026-09-06）

> 状态：📎 调研记录 · **只读调研，零产品代码改动** · 基线 `origin/main@9bac3b373`
> 起因：2026-09-06 深夜用户原话——「调研一些成熟的 Agent 产品，看怎么搞」。
> 服务对象：平行进行的两份评审 —— `docs/agent-architecture-review-20260906`（Agent 架构总评审）与 `docs/agent-tool-layer-audit-20260906`（工具层审计）。本文给它们**行业外部视角**，不重复它们已经查清的 Nomi 内部事实。
> 纪律：**每条结论都带一手出处**（官方文档 URL / 开源仓库 `file:line` + commit / Context7 查到的确切 API 名）。凭记忆的一律不写；查不到的地方明写「未查到」——写「未查到」比编一条像样的话有用。

---

## TL;DR（先看这 8 行）

1. **⚡ pi `0.85.1`（2026-09-05 发布）把 `AgentHarness` 真正实现了**，它的 `LaneSnapshot` 里直接带 `streamingMessage`（正在流的**有序段**消息）和 `runningTools`——**正好是 Nomi 最疼的两处**。架构总评审 §1.5 的「别用它，是空壳」对锁定的 `0.84.3` 正确，对 `0.85.1` 已翻转。**这条必须进决策**（§1.9）。
2. **pi 明确不做审批、不做沙箱**（官方 security 页原话），但把 `tool_call` 阻断钩子和 `ctx.ui.confirm` 两根线都拉好了。**审批必须是 Nomi 自己的**——而我们已经建了，而且三轴（姿态 × 档位 × 花费）比 Claude Code 还细（§7.1③）。
3. **Nomi 的 v4 面板已经和行业标准对齐**：`toolStatusOf` 的七态与 AI SDK 6 的 `ToolPart["state"]` **逐字相同**，且注释明写 `input-streaming` 刻意不用（「渲染一个永远不出现的状态等于在词表里留一个谎」）。**这是我们领先的一处。**
4. **顺序信息不是没有，是在接缝处被压掉了**：`runtimePort.ts:122-133` 把 pi 的有序段压成 `text: string` + `toolCalls[]`，`contentIndex` 整个不过接缝（§7.1①）。
5. **花费结构性恒空**：`model.mts:72` 零价目表 + `run.mts:25` 的 `total > 0` 守卫。而**创作类产品普遍在「花钱」和「停止」上做得很差**（MiniMax 全程不显金额、停止不真停；Figma 公开承认给不出预估），只有 Adobe 做完整了四段式——**这是能一次拉开差距的位置**（§6.3）。
6. **Cline 和 Nomi 是同一个形状**（全量快照 + 增量流两条不同步通道 + 长时异步任务），它已经踩过并修好的两个坑最该抄：`ts+seq+epoch` 收敛 reducer、独立的回合相位机（**别从消息尾巴推 UI 状态**）（§4.1）。
7. **审批答案要做成「带修正意图 + 作用半径写在标签里」的枚举**（Codex `Denied{rejection}`，`Default` 就是拒绝），并配一张**谁都批不动的清单**（Claude Code）+ **审批那一刻顺手立规则**的交互（Roo）（§2.3、§3.3、§4.3）。
8. **三条不该抄**：通用产品的沙箱 + bypass 逃生口（Nomi 工具面是封闭可枚举的）、AI SDK 的 Redis 流重放（Nomi 本地单进程）、pi 的 cwd 技能自动发现（Nomi 的 cwd 是用户素材，不是可信代码）（§7.4）。

---

## 0. 先说清楚：为什么只看这几家

Nomi 是一个很具体的形状：**本地优先的 Electron 桌面应用，内嵌一个常驻 Agent，工具调用打到项目文稿/画布/时间轴上，会花真钱（生图生视频），需要审批、需要会话恢复。**

所以下面只收同一类需求的做法，按「离 Nomi 有多近」排：

| # | 对象 | 为什么它是对照 | 能拿到什么级别的一手材料 |
|---|---|---|---|
| 1 | **pi**（我们真正在用的 agent 运行时） | 最近邻：我们的 Agent 就跑在它上面。它自己怎么渲染转录、怎么做审批、会话 JSONL 长什么样，是「我们本来就能白拿」的那部分 | 官方文档全站 |
| 2 | **Claude Code / Claude Agent SDK** | 终端里的常驻 Agent，权限模式与 hooks 是这一类里做得最细的 | 官方文档 |
| 3 | **OpenAI Codex CLI / Agents SDK** | 另一条技术路线（Rust TUI + 沙箱进程），审批与沙箱是正交两轴 | 开源仓库源码 |
| 4 | **Cline / Roo Code / Cursor / Windsurf** | **桌面/IDE 内嵌 Agent 面板**——和 Nomi 面板同形态。Cline 开源，能读到面板消息模型的源码 | 开源仓库源码 + 官方文档 |
| 5 | **Vercel AI SDK 6 `UIMessage.parts` / MCP 规范** | 不是产品，是两份「参照结构」：前者是「有序 parts 流」的工业标准形状，后者是「工具契约」的规范 | 官方文档 + 源码 |
| 6 | **创作类内嵌 Agent**（MiniMax Design 等） | 唯一和 Nomi 共享「产出物是图/视频、生成要等、要花钱」这组约束的一类 | 本机既有真实使用调研 + 官方文档 |

**不看的**：纯云端 Chat 产品（没有本地文件与工具面）、纯 workflow 编排器（没有常驻对话）、agent 框架的营销页（拿不到一手实现）。

---

## 1. pi —— 最近邻，也是我们已经买了却没拆封的那箱

> 读的是 `https://pi.dev/docs/latest/*` 全站现役文档，读取日 2026-09-06。npm 包 `@earendil-works/pi-coding-agent`（[sdk](https://pi.dev/docs/latest/sdk)）。

### 1.1 转录/事件模型：pi 的转录本来就是「有序的段」

**先解释术语**：pi 把「模型这一轮吐出来的东西」表达成一条 `AssistantMessage`，它的 `content` 不是一根字符串，而是**一串有顺序的块（content block）**——「说一段话」是一块、「想一下」是一块、「调一个工具」也是一块，按模型实际吐出来的先后排。

四种块，字段是（[session-format](https://pi.dev/docs/latest/session-format)）：

```
TextContent      { type: "text",     text }
ImageContent     { type: "image",    data, mimeType }
ThinkingContent  { type: "thinking", thinking }
ToolCall         { type: "toolCall", id, name, arguments }
```

消息一共七种 `role`（同上）：`user` / `assistant` / `toolResult` / `bashExecution` / `custom` / `branchSummary` / `compactionSummary`。注意 **`toolResult` 是一个独立的消息角色**，不是塞进 user 消息里的一个块——这和 Claude 的做法不同（见 §2），也意味着「一次工具往返」在 pi 的数据里天然是两条可分别渲染的记录。

流式事件（[json](https://pi.dev/docs/latest/json)、[rpc](https://pi.dev/docs/latest/rpc)）分三层嵌套，每层都有明确的 start/end：

| 层 | 事件 |
|---|---|
| 一次运行 | `agent_start` / `agent_end` / `agent_settled` |
| 一个回合（一次模型回复 + 它的工具） | `turn_start` / `turn_end`（带 `message` 与 `toolResults`） |
| 一条消息 | `message_start` / `message_update` / `message_end` |
| 一次工具执行 | `tool_execution_start` / `tool_execution_update`（带 `partialResult`）/ `tool_execution_end`（带 `result`、`isError`） |

**关键细节**：`message_update` 是**只带增量**的，字段是 `contentIndex` + `delta`——`contentIndex` 就是「这个 delta 属于第几块」。也就是说**顺序信息是逐 token 携带的，不需要事后重建**。里面嵌的 `assistantMessageEvent` 有 `text_start/delta/end`、`thinking_*`、`toolcall_start/delta/end` 三族。`message_end` 给出「最终权威版本」的整条消息。

其余 agent 级事件：`queue_update`（排队消息变了）、`compaction_start/end`、`auto_retry_start/end`（瞬时错误自动重试）、`summarization_retry_*`、`bash_execution_update`、`extension_error`。

> **对 Nomi 直接相关**：架构评审已经查明我们在 `runtimePort.ts:122-133` 把这一切压成了 `text: string` + `toolCalls[]`，`contentIndex` 整个不过接缝（见 `docs/agent-architecture-review-20260906` §1.2）。本节的价值是佐证**上游本来就把顺序做对了**，我们要建的不是新能力，是把已经在流里的东西接出来。

### 1.2 工具契约与校验：schema 用 TypeBox，渲染由工具自己带

`pi.registerTool({...})` 的字段（[extensions](https://pi.dev/docs/latest/extensions)）：

```ts
pi.registerTool({
  name, label, description,
  promptSnippet,        // 塞进系统提示词的一行
  promptGuidelines: [], // 必须点名这个工具
  parameters: Type.Object({ ... }),   // TypeBox schema
  prepareArguments(args) { ... },     // 校验前的兼容性捏合钩子
  async execute(toolCallId, params, signal, onUpdate, ctx) { ... },
  renderCall(args, theme, context),    // ← 工具自带「调用怎么画」
  renderResult(result, options, theme, context), // ← 自带「结果怎么画」
})
```

三个值得抄的设计：

1. **`renderCall` / `renderResult` 跟工具住在一起**。「这个工具的调用与结果长什么样」是工具定义的一部分，不是 UI 层的一张 switch 表。新增工具时 UI 不用改。
2. **`promptSnippet` + `promptGuidelines` 与 `description` 分开**。前两者是「怎么在系统提示词里介绍你自己」，后者是「参数面的说明」。今天 Nomi 是把两件事混在一处 description 里的。
3. **`prepareArguments` 是官方的「模型写歪了先捏一下再校验」钩子**——不是 hack。（Nomi 现在用 `z.preprocess` + zodToJsonSchema override 达到类似目的，副作用是把该字段的 schema 抹成 `{}`，见架构评审 §1.2。）

工具默认**并行**执行；改文件要用 `withFileMutationQueue()` 参与 pi 的按文件串行队列。

### 1.3 审批与权限：**pi 明确表示它不做这件事**

这是本次调研对 Nomi 最重要的一条事实。[security](https://pi.dev/docs/latest/security) 页原文立场：

- **没有内置的工具审批系统**。pi 以「pi 进程自己的权限」执行工具，没有审批闸。
- **没有内置沙箱**。原文措辞是真正的隔离必须来自操作系统或虚拟化/容器边界。
- 有的只是**项目信任（project trust）**：设置项 `defaultProjectTrust`，取值 `"ask"` / `"always"` / `"never"`，决定结果存在 `~/.pi/agent/trust.json`。它管的是「要不要加载项目本地的 `.pi/` 设置、扩展、技能」，**不管工具调用**。文档明说它「不能让不受信的代码、提示词或模型输出变安全」。
- 文档直说：来自仓库文件、注释、文档、构建输出的提示词注入是「本地 agent 预期内的风险」，pi 无法可靠防止。

**那审批该建在哪？** pi 给了两个正好接得上的缝：

- **`tool_call` 事件可以阻断**：处理器返回 `{ block: true, reason }` 就阻止执行，`reason` 会成为模型看到的错误正文；改 `event.input` 会真的影响执行。这就是「审批闸」的挂载点。
- **`ctx.ui.*` 是模式无关的用户交互通道**：`confirm(title, message)` / `select` / `input` / `editor` / `custom(component)`。在 RPC 模式下它自动变成 stdout 的 `extension_ui_request` → stdin 的 `extension_ui_response` 一问一答（[rpc](https://pi.dev/docs/latest/rpc)），`ctx.mode` 是 `"tui" | "rpc" | "json" | "print"`，`ctx.hasUI` 在 TUI/RPC 下为 true、print/JSON 下为 false。

> **一句人话**：pi 没有做审批，但它把「在工具执行前拦一下」和「向宿主问一句」这两根线都拉好了，接上就是审批。Nomi 今天的审批不走这条线，是自己在宿主层实现的——这本身可能是合理的（Nomi 的审批要画卡片、要记账本、要能重启后还在），但**要清楚我们是在自建而不是在缺**。

### 1.4 会话与恢复：一棵可分支的 JSONL 树

落盘路径 `~/.pi/agent/sessions/--<把 cwd 的 / 换成 - 的路径>--/<timestamp>_<uuid>.jsonl`；每行一个带 `type` 的 JSON 对象；第一行是头，后面每条 entry 带 `id`（8 位 hex）/ `parentId` / `timestamp`——**靠 `parentId` 构成一棵树，「当前位置」是活动叶子**（[session-format](https://pi.dev/docs/latest/session-format)、[sessions](https://pi.dev/docs/latest/sessions)）。

```json
{"type":"session","version":3,"id":"uuid","timestamp":"2024-12-03T14:00:00.000Z","cwd":"/path/to/project"}
```
fork 出来的会话头多一个 `parentSession`（指向原文件路径）。

entry 类型：`message` / `model_change` / `thinking_level_change` / `compaction` / `branch_summary` / `custom` / `custom_message` / `label` / `session_info`。

三种「回到过去」的动作，语义**不一样**，值得逐个看：

| 动作 | 做了什么 | 落在哪 |
|---|---|---|
| `/resume` | 交互式挑一个历史会话打开（可搜索、可改名 Ctrl+R、可删 Ctrl+D） | 打开另一个文件 |
| `/tree` | 把活动叶子移到更早的某条 entry，**在同一个文件里**长出另一条分支 | 同文件，树内 |
| `/fork` | 从某条用户消息起**新开一个会话文件** | 新文件，头里带 `parentSession` |

**`/tree` 切走时 pi 会给被放弃的那条分支生成一段摘要（`branch_summary`），挂在新位置上**——这样「我试过那条路、结论是 X」不会因为切分支而丢掉，又不用把整条路重放进上下文。这一条设计非常值得抄。

SDK 侧对应：`SessionManager.inMemory()` / `.create(cwd)` / `.continueRecent(cwd)` / `.open(path)`，运行时替换 API `AgentSessionRuntime` 提供 `newSession()` / `switchSession()` / `fork()`（[sdk](https://pi.dev/docs/latest/sdk)）。

### 1.5 上下文与花费：压缩有明确的两个旋钮，花费在 footer 上是一等公民

压缩触发条件（[compaction](https://pi.dev/docs/latest/compaction)）：

```
contextTokens > contextWindow - reserveTokens        # reserveTokens 默认 16384
```
切点：从最新往回走，攒够 `keepRecentTokens`（默认 **20000**）为止；之前的摘要掉，之后的原样保留。配置在 `~/.pi/agent/settings.json` 或项目 `.pi/settings.json`：

```json
{ "compaction": { "enabled": true, "reserveTokens": 16384, "keepRecentTokens": 20000 } }
```

摘要不是自由散文，是**结构化模板**：Goal / Constraints & Preferences / Progress（Done、In Progress、Blocked）/ Key Decisions / Next Steps / Critical Context，外加 `<read-files>` 与 `<modified-files>` 两个 XML 标签列出跟踪到的路径。默认实现把 `readFiles`/`modifiedFiles` 存进 `details`。

落进会话的记录：

```ts
interface CompactionEntry<T> {
  type: "compaction"; id; parentId; timestamp;
  summary; firstKeptEntryId; tokensBefore;
  usage?; fromHook?; details?: T;
}
```
`firstKeptEntryId` 这个字段是关键——**压缩不是删除，是标记「从这条起才是原文」**，历史仍在文件里，UI 仍可回看。

三个扩展钩子：`session_before_compact`（可取消，也可自己返回一份 compaction 顶替默认实现）、`session_compact_failed`（带 `reason` / `errorMessage` / `aborted` / `willRetry`）、`session_before_tree`。

**花费**：TUI footer 常驻显示「工作目录 · 会话名 · token/cache 用量 · 花费 · 上下文用量 · 当前模型」，并且文档明说合计里**包含工具报告的用量和摘要生成的用量**（[usage](https://pi.dev/docs/latest/usage)）。也就是说 pi 认为「压缩本身烧的钱」也要算给用户看。`ctx.getContextUsage()` 给扩展用。

### 1.6 UI 呈现：TUI 分四区，但 pi 不替你决定工具怎么折叠

TUI 四个区（[usage](https://pi.dev/docs/latest/usage)）：启动头（快捷键、加载的上下文文件、提示词模板、技能、扩展）· 消息区（用户消息、助手回复、工具调用、工具结果、通知、错误、扩展 UI）· 编辑器 · footer。思考等级用**边框颜色**表示。

`/docs/latest/tui` 那一页**不是**讲转录渲染的，它讲的是「怎么写自定义 TUI 组件」（`Component` 接口的 `render()` / `handleInput()` / `handleMouse()` / `invalidate()`，内建 `Text` / `Box` / `Container` / `Markdown` / `Image` 等）。**转录里工具调用的具体折叠规则、长输出截断策略，官方文档未查到**——因为它被下放给了每个工具自己的 `renderCall` / `renderResult`。

**排队机制值得单独说**（这是 Nomi 面板上完全没有入口的一件事）：agent 干活时用户可以继续打字，**Enter = steering 消息**（在当前助手回合把工具跑完之后送进去），**Alt+Enter = follow-up 消息**（等 agent 全部干完再送）。对应 RPC 命令 `steer` / `follow_up` / `clear_queue`，事件 `queue_update`。这解决的是一个非常真实的摩擦：**用户看到 agent 走偏了，不想打断它，也不想等它跑完 24 步再说。**

### 1.7 可观测性/评测

扩展系统本身就是可观测性挂载点：`before_provider_headers` / `before_provider_request` / `after_provider_response` 三个钩子能看到每一次 HTTP 往返的头、体、状态码。`pi.appendEntry(customType, data?)` 把扩展自己的数据持久化进会话文件但**不进 LLM 上下文**，配合 `pi.registerEntryRenderer(type, renderer)` 自定义渲染——这正好是「把 Nomi 自己的审批记录/花费记录挂进转录」的官方姿势。内建 OTEL / 独立日志文件：**未查到**。

### 1.9 ⚡ 本次调研最重要的一条：**pi 0.85.1 把 `AgentHarness` 真正实现了**

并行的架构总评审 §1.5 写了一条明确的警告：「**不要**建议直接换用 pi 的 `AgentHarness`——在锁定的 0.84.3 里它是个空壳」。**这条对 0.84.3 完全正确，但 2026-09-05（本文写作前一天）发布的 0.85.1 把答案翻了过来。** 我实拉两个版本的 tarball 逐字比对：

| | `pi-agent-core@0.84.3`（Nomi 锁定的） | `pi-agent-core@0.85.1`（2026-09-05 发布） |
|---|---|---|
| `dist/harness/agent-harness.js` | **7,883 字节**，`HarnessNotImplemented` 出现 **5** 次、`unavailable` **23** 次 = 全部方法抛异常 | **558 字节**，是一个 barrel：`export const AgentHarness = { create: createAgentHarness }`，**0 次** `HarnessNotImplemented` |
| `dist/harness/` 总体积 | 1.9 MB | **3.9 MB**，新增 `runtime/` `session/` `execution/` `compaction/` `tools/` `env/` 六个子目录 |

**它现在提供的东西，和 Nomi 手写的那 41 个文件几乎逐项对应**（`dist/harness/agent-harness.d.ts`，715 行）：

- **队列**：`steer()` / `followUp()` / `nextRun()` / `cancelQueued(entryId)` —— Nomi 的 `ProjectAgentQueueItem`（插队/删/暂停）。
- **幂等命令受理**：`accept(request: OperationRequest) → OperationAdmissionResult`、`getResult(operationId)`、`drive({operationId, waitForRetry, pollDeferred})`、`requestAbort(operationId)` —— Nomi 的 `commands-v1.jsonl` 命令账本 + `commandId` 去重。
- **快照订阅**：`watch() → WatchHandle<LaneSnapshot>` —— Nomi 的 `PROJECT_AGENT_SNAPSHOT_CHANNEL`。
- **`LaneSnapshot` 的形状（`:174-201`）几乎就是 Nomi 宿主快照想成为的样子**：

```ts
interface LaneSnapshot {
  lane: string
  transcript: Entry[]                 // 有序转录
  tipId: string | null
  lastResult?: OperationResultRecord
  configuration: LaneConfiguration
  stats: SessionStats                 // { messageCount, usage } 跨压缩边界
  operation: null | {
    id; kind: "run" | "compaction" | "navigation"; startedAt; fromTipId; status
    retry?:   { attempt, maxAttempts, nextAttemptAt }   // ← 重试进度可见
    deferred?: { handle, poll }
    streamingMessage?: AssistantMessage                  // ← ⚡ 正在流的那条【有序段】消息
    runningTools: LaneSnapshotTool[]                     // ← 正在跑的工具（args + 中间 result）
  }
  queues: LaneQueuedItem[]
  faulted: boolean
}
```

**看 `streamingMessage` 和 `runningTools` 这两行**。它们正好是 Nomi 今天最疼的两处：

- `streamingMessage: AssistantMessage` 就是**正在流的那条消息的完整有序 content 段**（Text / Thinking / ToolCall）。Nomi 的 P0「面板上文字一堆、工具一堆」，在这个形状下**不需要修**——快照里本来就是有序的。
- `runningTools: LaneSnapshotTool[]`（`status: "running" | "settled"`，带 `args` 与中间 `result`）正好消掉 Nomi 渲染层那个「活的工具调用」第二真相（`src/workbench/ai/v4/agentPanelV4PendingTools.ts:1-14` 自陈：之所以要它，就是因为「宿主状态里没有运行中的工具记录」）。

还有 `recordUsage(usage, ...)` / `setRetryPolicy(policy)` / `navigateTree(targetId)` / `resume()` / `lane(name)` / `lanes()` —— 分别对应 Nomi 缺的**花费记账、自动重试、回到某一步、多轨并行**。

> **这不等于「明天就换过去」。** 它是一次**升级评估**，代价至少三项：① pi 六个包必须一起动（`pnpm.overrides` 硬锁）；② `AgentHarness` 自己管持久化，意味着「转录的真相源放 pi 还是放宿主」这个岔路必须先拍板（架构评审 §4.1 已把它列为 R3 决策点）；③ 0.85.1 发布只有一天，没有生产验证。
> **但它必须进决策**：如果不看这条，我们可能会去手写一遍 `LaneSnapshot`——而那正是 R20「造轮子前先过 build-vs-buy 闸」要拦的事。

**核实方法（可复跑）**：`npm pack @earendil-works/pi-agent-core@0.84.3` 与 `@0.85.1`，解包后比 `dist/harness/agent-harness.js` 的字节数与 `HarnessNotImplemented` 计数，再读 `dist/harness/agent-harness.d.ts`。`npm view @earendil-works/pi-coding-agent version` → `0.85.1`（`time.0.85.1 = 2026-09-05T12:17:19Z`）。

### 1.8 对 Nomi 的启发（一句话）

**pi 已经把「有序段 + 树状会话 + 结构化压缩 + 工具自带渲染 + 阻断钩子」都做好了，我们缺的不是能力而是接缝；但审批和沙箱 pi 明确不做，那两件必须是 Nomi 自己的。**

### 出处

- https://pi.dev/docs/latest （文档导航）
- https://pi.dev/docs/latest/session-format （会话 JSONL 格式、content block、AgentMessage 七种 role）
- https://pi.dev/docs/latest/sessions （树/分支/resume/fork/branch summary）
- https://pi.dev/docs/latest/rpc （JSONL 协议、命令表、事件表、`extension_ui_request`/`extension_ui_response`）
- https://pi.dev/docs/latest/json （`pi --mode json`、`message_update` 只带 delta + `contentIndex`）
- https://pi.dev/docs/latest/compaction （`reserveTokens` 16384 / `keepRecentTokens` 20000、`CompactionEntry`、摘要模板、三个钩子）
- https://pi.dev/docs/latest/extensions （全部钩子、`registerTool`、`tool_call` 阻断、`ctx.ui.*`、`ExtensionAPI` 方法表）
- https://pi.dev/docs/latest/security （**无内置工具审批、无内置沙箱**、`defaultProjectTrust`、`~/.pi/agent/trust.json`）
- https://pi.dev/docs/latest/usage （TUI 四区、footer 内容、steering/follow-up、`/tree` `/fork` `/resume` `/compact`）
- https://pi.dev/docs/latest/tui （TUI 组件接口——**不含转录渲染规则**）
- https://pi.dev/docs/latest/sdk （`@earendil-works/pi-coding-agent`、`createAgentSession()`、`SessionManager` 四种构造、`defineTool`、内建工具 8 个）

---

## 2. Claude Code / Claude Agent SDK —— 权限模型是这一类里做得最细的

> 读的是 `https://code.claude.com/docs/en/*` 与 `https://platform.claude.com/docs/en/*` 现役文档，读取日 2026-09-06。

### 2.1 转录/事件模型：块顺序有**硬规则**

**content block（一条消息内部的有序片段）** 三种：`text` / `thinking` / `tool_use`。规则（[working-with-messages](https://platform.claude.com/docs/en/build-with-claude/working-with-messages.md)、[handle-tool-calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md)）：

- `thinking` 若存在**必须在最前**；
- `text` 与 `tool_use` 可以交错——**「说一句、做一件、再说一句」在协议层就是合法且常见的**；
- `tool_result` **不是**助手消息的一部分，它必须放在**下一条 user 消息的开头**，且要排在该消息的任何 `text` 之前。

这和 pi 的 `role: "toolResult"` 独立消息是两种解法，共同点是：**「工具结果」在数据里有明确的、不可含糊的位置**。Nomi 现在两种都不是——工具收据是回合结束时另生成的一批条目，靠 `createdAt` 排序（架构评审 §1.4）。

SDK 侧的消息类型（[agent-loop](https://code.claude.com/docs/en/agent-sdk/agent-loop.md)）：`SystemMessage`（subtype `init` / `compact_boundary` / …）、`AssistantMessage`、`UserMessage`、`StreamEvent`（要开 `includePartialMessages` 才有）、`ResultMessage`（subtype `success` / `error_max_turns` / `error_max_budget_usd` / `error_during_execution`）。CLI 侧 `--output-format stream-json` 每行一条同形状的 JSON。

> **注意 `error_max_budget_usd` 这个 subtype**：它意味着「这次运行的美元预算」是一等的终止原因。Nomi 今天**没有任何线程级花费上限**（架构评审 §4.4），一个失控的 24 步 production 回合可以烧到底。

### 2.2 工具契约与校验

工具定义三件套（[define-tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools.md)）：`name`（正则 `^[a-zA-Z0-9_-]{1,64}$`）、`description`（说明何时用、怎么用、有什么限制）、`input_schema`（JSON Schema object），可选 `input_examples`（**给几个示例调用帮模型理解**——这一条 Nomi 的能力契约里完全没有，而分镜这种 25 字段的工具最需要它）。

`tool_result` 的 content 可以是纯字符串，也可以是内容块数组，块类型包括 `text` / `image`（base64 或 URL）/ `document`（含 PDF）/ `search_result`。**工具能返回图片给模型看** —— 对 Nomi 是直接相关的：生成出来的图，模型应该能看见自己生成了什么。

错误回给模型：在 `tool_result` 上打 `is_error: true`，正文是给模型读的说明；模型据此调整下一步。

### 2.3 审批与权限：六种模式 + 一张「谁都不能自动批」的清单

**六种 permission mode**（[permission-modes](https://code.claude.com/docs/en/permission-modes.md)，逐字）：

| 配置值 | 不问就能跑的 | 适合 |
|---|---|---|
| `default`（CLI 里显示为 **Manual**，接受别名 `manual`） | 只有读 | 每一步都自己看 |
| `acceptEdits` | 读、改文件、常见文件系统命令（`mkdir` `touch` `mv` `cp` 等） | 边写边审的迭代 |
| `plan` | 读；auto 模式可用时再加分类器批准的命令 | 动手前先摸清楚 |
| `auto` | 全部，但有后台安全检查（**由第二个模型「分类器」代替人审**） | 长任务、减少提示词疲劳 |
| `dontAsk` | 只有预先批准过的工具 | 锁死的 CI 与脚本 |
| `bypassPermissions` | 全部 | 只在隔离容器/VM 里 |

**模式只定基线，规则叠在上面**：`permissions` 里的 allow / ask / deny 三级，工具名可带参数模式（如 `Bash(git push *)`）。**deny 规则在每种模式下都生效，包括 `bypassPermissions`；allow 规则在 `bypassPermissions` 下无效。**

**最值得抄的是这一条**——文档专门有一节叫「Actions no mode auto-approves」（任何模式都不自动批准的动作），包括：

- 被显式 ask 规则命中的工具；
- **需要用户交互的工具**：内建 `AskUserQuestion`，以及 MCP 里标了 `requiresUserInteraction` 的工具；
- 针对关键路径的 `rm` / `rmdir`——**连 allow 规则和 `PreToolUse` hook 返回 `"allow"` 都批不动**。

> **一句人话**：他们承认「用户会把闸门开到最大」，所以把「无论如何都要问」做成**独立于模式的一层**，而不是靠用户别开 bypass。**Nomi 有一模一样的需求**：`nomi_operation_gate` / `nomi_operation_execute`（开付费闸、启动付费生成）今天靠「不投影给内部模型」来保证安全（架构评审 §4.5）——那是「让它够不着」，Claude Code 的做法是「让它够得着但永远批不动」。后者在「以后要给 Agent 开这个能力」时不用重做。

**模式与沙箱是正交两轴**，文档明说：「权限模式决定要不要问，Bash 沙箱与外层隔离边界决定跑起来之后够得到什么」。

### 2.4 Hooks：33 个事件，`PreToolUse` 就是审批闸

全部 hook 事件名（[hooks](https://code.claude.com/docs/en/hooks.md)）：`SessionStart` `Setup` `UserPromptSubmit` `UserPromptExpansion` `PreToolUse` `PermissionRequest` `PermissionDenied` `PostToolUse` `PostToolUseFailure` `PostToolBatch` `Notification` `MessageDisplay` `SubagentStart` `SubagentStop` `TaskCreated` `TaskCompleted` `Stop` `StopFailure` `TeammateIdle` `InstructionsLoaded` `ConfigChange` `CwdChanged` `DirectoryAdded` `FileChanged` `WorktreeCreate` `WorktreeRemove` `PreCompact` `PostCompact` `PreModelSwitch` `PostModelSwitch` `Elicitation` `ElicitationResult` `SessionEnd`。

`PreToolUse` 的输入（逐字）：

```json
{ "session_id", "prompt_id", "transcript_path", "cwd",
  "permission_mode": "default|plan|acceptEdits|auto|dontAsk|bypassPermissions",
  "effort": { "level": "low|medium|high|xhigh|max" },
  "hook_event_name": "PreToolUse",
  "agent_id", "agent_type", "tool_name", "tool_input", "tool_use_id" }
```

输出（逐字）：

```json
{ "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow" | "deny" | "defer",
    "permissionDecisionReason": "...",
    "updatedInput": { }
  },
  "additionalContext": "...", "systemMessage": "...", "terminalSequence": "..." }
```

三个细节值得抄：

1. **第三个值是 `defer`（交还给正常权限流程），不是 `ask`**。「我不表态」和「我要求问用户」是两件事，分开表达。
2. **`updatedInput` 可以替换工具入参**——审批不只是「过 / 不过」，还可以是「改一下再过」。这正是「用户在审批卡上把参数改了再放行」的协议基础。
3. **退出码 2 是硬阻断，压过 JSON**：即使 JSON 里写了 `"allow"` 也拦住。而**超时的 hook 不阻断**——文档明说「别指望一个卡住的 hook 当闸门」。这是 fail-open 与 fail-closed 的取舍被写进了文档；Nomi 的 R25 选的是 fail-closed，方向相反但都是**明写出来的**。

### 2.5 会话与恢复

磁盘上是 JSONL 转录，路径 `~/.claude/projects/<规范化的工作目录名>/<session-id>.jsonl`（[sessions](https://code.claude.com/docs/en/sessions.md)、[claude-directory](https://code.claude.com/docs/en/claude-directory.md)）。三个动作：

- `--continue`：接着当前目录最近那次（同 session ID）；
- `--resume`：打开选择器，或直接给名字/ID；
- `--fork-session` / `/branch <name>`：把当前历史复制到**新 session ID**，原会话保留。

与 pi 的对照很有意思：**pi 的 `/tree` 是「同一个文件里长分支」，Claude Code 没有对应物**——它的 fork 一律是新文件。pi 那套树 + `branch_summary`（切走时给放弃的分支留一段摘要）是更强的模型。

### 2.6 上下文与压缩

自动压缩在接近上下文上限时触发，压缩点在转录里留一条 `SystemMessage` subtype `compact_boundary`——**「这里压缩过」是转录里的一等公民，不是一个静默事件**。手动 `/compact [focus instructions]`（可以带一句「这次摘要重点保留什么」）。

`/compact` 与 `/clear` 的区别：前者用摘要替换旧对话、**session ID 不变**；后者开新 conversation、新 session ID，旧的还能 `/resume` 回去。

`PreCompact` hook 带 `trigger: "auto" | "manual"`；另有 `PostCompact`。`/context` 命令列出上下文各成分各占多少 token（系统提示、CLAUDE.md、MCP 工具、对话历史、最近文件）。status line 可配 `context_remaining` 实时显示百分比。

> **对 Nomi**：`/context` 那种「上下文由谁占掉了」的分解，比一个笼统的百分比环有用得多——用户能看到「你的 35 个工具定义吃掉了 X token」。

### 2.7 花费显示

`ResultMessage` 里带 `total_cost_usd` 与 `usage`（`input_tokens` / `output_tokens` / `cache_creation_input_tokens` / `cache_read_input_tokens`），以及 `modelUsage`（**含子 agent 的全树分解**）。缓存读与缓存写**分开计**，不并进 input（[cost-tracking](https://code.claude.com/docs/en/agent-sdk/cost-tracking.md)）。

> **对 Nomi**：`agentUsageStore` 在入口就把 `cachedPromptTokens` 丢了（架构评审 §1.3）。缓存读通常是最大的一块也是最便宜的一块，丢掉它等于既算不出钱也说不清为什么便宜。

### 2.8 UI 呈现

终端里工具调用的具体折行/折叠规则、长输出截断阈值：**官方文档未查到逐字规格**（分散在 interactive-mode / keybindings 等页，未逐页核实到可引用的措辞）。已核实的是 **`Shift+Tab` 切换权限模式**（[permission-modes](https://code.claude.com/docs/en/permission-modes.md) 开头逐字：「Switch permission modes with Shift+Tab in the CLI, the mode indicator in VS Code, or the mode selector in Desktop」）。

**「模式指示器」这个设计本身值得抄**：当前处在哪种审批档位，在三个宿主（CLI / VS Code / 桌面）上都有一个常驻可见的位置，并且**切换是一个键**。Nomi 今天的 `approvalPolicy` 在渲染层和主进程各剥离一次（架构评审 §2.2），但面板上**没有一个常驻的「现在是什么档」指示器**。

### 2.9 子 agent

子 agent 跑在隔离上下文里，完成后**只把最终文本摘要交回主会话**，中间步骤/工具调用不进主转录（[sub-agents](https://code.claude.com/docs/en/sub-agents.md)）。这是「上下文预算」和「用户认知负荷」的同一个答案：**长任务的中间过程要能被折叠成一句话**。

### 2.10 对 Nomi 的启发（一句话）

**把「审批」从一个布尔开关升级成「模式（基线）× 规则（allow/ask/deny）× 一张谁都批不动的清单」三层，并且让 `PreToolUse` 的第三态是 `defer`（不表态）而不是 `ask`——这样「谁负责决定」才不会含糊。**

### 出处

- https://code.claude.com/docs/en/permission-modes.md （六种模式逐字表、Actions no mode auto-approves、模式与沙箱正交、Shift+Tab）
- https://code.claude.com/docs/en/hooks.md （33 个 hook 事件名、`PreToolUse` 输入/输出逐字、`permissionDecision: allow|deny|defer`、`updatedInput`、退出码 2 硬阻断、超时不阻断）
- https://code.claude.com/docs/en/permissions.md （allow/ask/deny 规则写法、带参数的工具名匹配）
- https://code.claude.com/docs/en/sessions.md （`--continue` / `--resume` / `--fork-session` 语义、JSONL 路径）
- https://code.claude.com/docs/en/claude-directory.md （`~/.claude/projects/<项目名>/<session-id>.jsonl`）
- https://code.claude.com/docs/en/context-window.md （自动压缩、`/compact` vs `/clear`、`/context` 成分分解）
- https://code.claude.com/docs/en/agent-sdk/agent-loop.md （SDK 消息类型与 `ResultMessage` subtype 含 `error_max_budget_usd`）
- https://code.claude.com/docs/en/agent-sdk/cost-tracking.md （`total_cost_usd`、cache 读写分列、`modelUsage` 全树分解）
- https://code.claude.com/docs/en/sub-agents.md （子 agent 只交回摘要）
- https://platform.claude.com/docs/en/build-with-claude/working-with-messages.md （content block 顺序规则）
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools.md （`name` 正则、`input_schema`、`input_examples`）
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls.md （`tool_result` 位置规则、content 块类型含 image/document、`is_error`）
- ⚠️ **未查到逐字规格**：终端里工具调用的折叠/截断阈值；`Ctrl+O`/`Ctrl+R` 的确切语义（未逐页核实，不写）。

---

## 3. OpenAI Codex CLI / Agents SDK —— 另一条技术路线，审批做得最细

> **Codex CLI** 基线：`git clone --depth 1 openai/codex` @ `ac192cd7937b0d73edc6dffe009940ae53782dd4`（`main`，2026-09-06），最新 release tag `rust-v0.153.4`（2026-09-04）。以下 `file:line` 相对仓库根。
> **Agents SDK** 基线：`openai-agents-python` @ `1d471a47`（`pyproject.toml:3` → `0.22.0`）、`openai-agents-js` @ `32612641`（`0.17.0`，tag `v0.17.0` 2026-08-19）。

**先解释四个词**：**rollout** = Codex 对「一次会话的完整落盘记录」的叫法，写成一个 JSONL 文件；**thread** = 一次对话线程，一个 thread 对应一个 rollout 文件；**turn** = 用户一次输入触发的一整轮（可能含多次模型调用与多个工具）；**app-server** = Codex 内置的 JSON-RPC 服务端，IDE 插件和 GUI 宿主通过它驱动 agent——**这一层是 Nomi 最该看的**。

### 3.1 转录/事件模型：**内部富事件 + 对外窄投影**，两层结构

这是 Codex 最值得学的架构选择。内部有约 **80 个** `EventMsg` variant（`codex-rs/protocol/src/protocol.rs:1356`），对外只投影出 **9 种 item、8 个 wire 名**。

**内部**：双向队列 —— `Op`（宿主 → agent，`protocol.rs:592`）+ `Event { id, msg: EventMsg }`（agent → 宿主，`:1337`）。事件分五类：生命周期（`TurnStarted` / `TurnComplete` / `TurnAborted` / `SessionConfigured`）、**双阶段 item**（`ItemStarted` `:1928` / `ItemCompleted` `:1936`，**两者都携带完整 `TurnItem` 而非 diff**，前者带 `started_at_ms`、后者带 `completed_at_ms`）、增量 delta（`AgentMessageContentDelta` / `ReasoningContentDelta` / `PlanDelta`）、旧式成对事件（`ExecCommandBegin/OutputDelta/End` 等）、需要宿主回应的（`ExecApprovalRequest` / `RequestUserInput` / `ElicitationRequest` / `GuardianAssessment`）。

`TurnItem`（`codex-rs/protocol/src/items.rs:45`）19 种，每种自带状态机。注意 `CommandExecutionStatus`（`items.rs:200`）= `in_progress / completed / failed / **declined**` —— **「被用户拒绝」是 item 的一个终态，不是错误**。（Nomi 的 `toolStatusOf` 为 `stopped` 落在哪一态纠结过，同源问题。）

**对外投影 (a)**：`codex exec --json`（flag 在 `codex-rs/exec/src/cli.rs:59-65`，`alias = "experimental-json"`）。wire 名**用点号分隔，与内部 snake_case 完全不同**：`thread.started` / `turn.started` / `turn.completed` / `turn.failed` / `item.started` / `item.updated` / `item.completed` / `error`（`exec/src/exec_events.rs:11`）。对外只暴露 9 种 item details（`:107`）。这层是**转换出来的**：`exec/src/event_processor_with_jsonl_output.rs:470-580` 逐条映射。

**对外投影 (b)**：app-server JSON-RPC（`app-server-protocol/src/protocol/common.rs:1853-1930`）——`thread/started` · `thread/compacted` · `thread/tokenUsage/updated` · `turn/started` · `turn/completed` · `turn/diff/updated` · `item/started` · `item/completed` · `item/agentMessage/delta` · `item/commandExecution/outputDelta` · `item/mcpToolCall/progress` …；Client→Server 请求约 130 个，含 `thread/start` `thread/resume` `thread/fork` `thread/rollback` `thread/compact/start`。

> **⚡ 对 Nomi 最直接的一条**：`Op::ThreadRollback` 的注释（`protocol.rs:735-738`）明写**只回滚模型上下文，不回滚磁盘改动**——「Clients are responsible for undoing any edits on disk」。Nomi 若做「回到某一步」，必须同样把「上下文回滚」和「画布/时间轴实体回滚」当两件事讲清楚，否则就是 §6.1 MiniMax 那个「对话里旧版本和真实实体状态脱节」的坑。

### 3.2 工具契约与校验：**工具输出也定 schema**，校验失败一律回给模型

- `ToolSpec`（`codex-rs/tools/src/tool_spec.rs:22`）：`Function` / **`Namespace`**（工具分组，避免顶层几十个扁平函数）/ **`ToolSearch`**（工具多到塞不进 prompt 时按需检索）/ `WebSearch` / `Freeform`（自由文本而非 JSON）。
- `ResponsesApiTool`（`tools/src/responses_api.rs:32`）：`{ name, description, strict, defer_loading, parameters, **output_schema** }`。**输入输出都定 schema。**
- shell 工具的真实形状（`core/src/tools/handlers/shell_spec.rs:24`）：工具名是 **`exec_command`**（不是 `shell`），带 `output_schema`（`:197`：`{chunk_id, wall_time_seconds, exit_code, session_id, ...}`）。配套 `write_stdin`（`:112`）——**长命令返回 `session_id`，后续用 `write_stdin` 交互，长跑进程不阻塞 turn**。
- **⚡ 审批参数被折进工具 schema 本身**（`shell_spec.rs:229`）：`sandbox_permissions` 枚举 `use_default` / `with_additional_permissions` / `require_escalated`，外加 `justification`（注释：给用户看的审批问题）。**模型自己声明这次需要升权，并自带给用户看的理由**——比在外面猜要不要弹窗准得多。
- **校验失败怎么办**：`FunctionCallError`（`tools/src/function_call_error.rs`）**只有两个 variant**——`RespondToModel(String)`（错误文本当工具输出回给模型，**turn 继续**）和 `Fatal(String)`。统一入口（`core/src/tools/handlers/mod.rs:85-92`）把 serde 的原始错误直接给模型，例如 `"failed to parse function arguments: unknown field \`interrupt\`, expected \`target\` or \`message\`"`。语义级校验同样走这条路，且**错误消息直接教模型怎么改**：``"`justification` requires an explicit `sandbox_permissions`; use ... or omit `justification`."``

> **对 Nomi**：Nomi 现在是 `tools.mts:74` 直接把 zod 原始错误抛出去。zod 的 `path`/`code` 对模型不友好——Codex 证明了「把错误写成一句教模型改法的话」是可行且必要的。这一条和工具层审计的「一次写对率」直接相关。

### 3.3 审批与权限：**⚠️ 我原以为的四档已经过时**

现役 `AskForApproval`（`protocol.rs:984`）**不是** `untrusted/on-failure/on-request/never`：

| variant | wire 值 | 语义 |
|---|---|---|
| `UnlessTrusted` | `"untrusted"` | 除非 execpolicy 显式放行，否则都问 |
| `OnRequest` | `"on-request"`，**`alias = "on-failure"`** | **默认档**，模型自己决定何时问 |
| `Granular(GranularApprovalConfig)` | `"granular"` | **新增的细粒度档** |
| `Never` | `"never"` | 从不问，失败直接回模型 |

**`on-failure` 已降级成 `on-request` 的反序列化别名**（`:991`）。`GranularApprovalConfig`（`:1009`）是 5 个独立布尔闸：`sandbox_approval` / `rules` / `skill_approval` / `request_permissions` / `mcp_elicitations`，且注释（`:998-1000`）说明 **`false` 不是「放行」而是「自动拒绝且不展示给用户」**——这个语义选择很重要，关掉一类审批不等于把它变成自动同意。

**沙箱是正交的另一轴** `SandboxPolicy`（`:1070`）：`danger-full-access` / `read-only{network_access}` / **`external-sandbox{network_access}`**（新增：进程已在外部沙箱里）/ `workspace-write{writable_roots, network_access, ...}`。`WritableRoot`（`:1129`）可在可写根之下再挖 `read_only_subpaths`，注释点名 **`.codex`、`.git`（尤其 `.git/hooks`）不许写**——防止 agent 写 hook 提权。

**⚡ 审批请求事件的字段远比一个 y/n 丰富**（`codex-rs/protocol/src/approvals.rs`，`ExecApprovalRequestEvent` 约 `:258`）：`command` · `cwd` · `reason` · `network_approval_context{host, protocol}` · `proposed_execpolicy_amendment`（可加进白名单的命令前缀）· `additional_permissions` · **`available_decisions: Option<Vec<ReviewDecision>>`**（**服务端告诉 UI 这次该给哪几个选项**）· `parsed_cmd: Vec<ParsedCommand>`（结构化解析过的命令，供 UI 高亮）。

**⚡ 用户答案是「带修正意图的枚举」**（`ReviewDecision`，`protocol.rs:4056`）：
`Approved` / `ApprovedExecpolicyAmendment{...}` / `ApprovedForSession` / `ApprovedMcpPolicyAmendment` / `NetworkPolicyAmendment{...}` / **`Denied{rejection: String}`** / `TimedOut` / `Abort`。
- **`impl Default` = `Denied{rejection: "denied"}`——fail-closed 写进了类型系统。**
- **`Denied` 带 `rejection` 字符串**：拒绝时用户可以一次说清「不行，改成 X」，**turn 继续**；`Abort` 才是整轮停。
- 三种不同**持久化半径**（`Approved` 只此一次 / `ApprovedForSession` 本会话 / `ApprovedExecpolicyAmendment` 写进规则）在类型上分开，不混成一个「记住我的选择」。

**MCP 工具的逐工具审批档**（`codex-rs/config/src/mcp_types.rs:26`）：`Auto`(默认) / `Prompt` / `Writes` / `Approve`。语义（`core/src/mcp_tool_call.rs:2345`）：
```rust
Auto    => requires_mcp_tool_approval(annotations),        // 看 MCP 的 hint
Prompt  => true,                                           // 永远问
Writes  => !read_only_hint.unwrap_or(false),               // 只有声明只读的才免批
Approve => false,                                          // 永远放行
```
`Auto` 的判据（`:2326`）：`destructiveHint==true` → 必批；`readOnlyHint==true` → 免批；否则 `destructiveHint.unwrap_or(true) || openWorldHint.unwrap_or(true)` —— **hint 缺失时按最坏情况算**。这与 §5B 的 MCP 规范默认值方向完全一致，是规范落地的一个现成参考实现。

**`request_user_input`（agent 主动问用户）**（`codex-rs/protocol/src/request_user_input.rs`）：`{ id, header, question, isOther, **isSecret**, options }` + `RequestUserInputArgs { questions, **isBlocking** }`。工具 prompt 里写死了约束（`core/src/tools/handlers/request_user_input_spec.rs:16`）：*"Provide 2-3 mutually exclusive choices. Put the recommended option first and suffix its label with \"(Recommended)\". Do not include an \"Other\" option; the client will add a free-form \"Other\" automatically."*
- `isSecret` = 别回显（API key 场景）；**`isBlocking: false` = 问了但不阻塞，agent 继续干活**。

### 3.4 会话与恢复：**真相在 JSONL，索引在 SQLite**

- `RolloutLine`（`codex-rs/history/src/lib.rs:254`）= `{ timestamp, ordinal, #[serde(flatten)] item }`。注释明说它**故意不实现 `Deserialize`**：必须走规范解析器，否则嵌套十进制数会在扁平化 envelope 里失真。
- `RolloutItem` wire 形状（`history/src/rollout_payload.rs:22`）：`session_meta` / `response_item` / `compacted` / `turn_context` / `token_usage_record` / `event_msg` / `realtime_item` …。**`EventMsg` 本身也是一种 rollout item** —— UI 事件和模型上下文混在同一条时间轴上，靠 type 区分「模型看得见的」和「只给 UI 重放的」。**这是「resume 后 UI 能完整重放」的关键。**
- 路径 `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<ts>-<thread_id>.jsonl`（`rollout/src/recorder.rs:1640-1647`、`rollout_file_name.rs:38-72`）。**被 revert 过的线程文件名变成 `...-<thread_id>_<rollout_id>.jsonl`——thread id 稳定、rollout id 换新**，用文件名表达「同一线程被回滚重写过」。
- `InitialHistory`（`history/src/lib.rs:264`）四态：`New` / `Cleared` / `Resumed{...}` / `Forked(Vec<RolloutItem>)`。
- **fork 按 turn 边界裁，不按 item**：`ThreadForkParams { thread_id, last_turn_id?, before_turn_id?, path? }`（`v2/thread.rs:518`），两者互斥，且引用的 turn 不能在进行中。（理由很实在：item 中断处的历史是不自洽的。）
- **⚡ 会话索引是独立 SQLite，不是扫目录**：`state_5.sqlite`（`codex-rs/state/src/sqlite.rs:33`），表 `threads`（`state/migrations/0001_threads.sql`）带 `rollout_path` / `title` / `sandbox_policy` / `approval_mode` / `tokens_used` / `archived` / `git_sha` / `git_branch`。共 54 个 migration。**列出会话列表不该去 parse 几百个 JSONL。**

### 3.5 上下文与花费

**压缩三种实现并存、走同一套生命周期**：本地摘要（`core/src/compact.rs:119`）、服务端压缩（`compact_remote_v2.rs:82`）、**不摘要直接开新窗口**（`compact_token_budget.rs:52`——注释明说仍建模成 compaction，好让 hook 和 `ContextCompaction` item 看到一样的生命周期）。

**⚡ 自动触发的两个细节值得抄**（`core/src/session/context_window.rs`）：
- `AutoCompactTokenLimitScope` 两档：`Total` / **`BodyAfterPrefix`**（**只算固定前缀之后新增的部分**，因为前缀是被缓存的初始上下文，不该反复触发压缩）。**Nomi 的项目上下文正是长固定前缀，按 Total 算会疯狂误触发。**
- `token_limit_reached = auto_compact_scope_tokens >= (limit + fallback_buffer) || full_context_window_limit_reached`（`:105-109`），且 fallback buffer **只在配置了 fallback prompt 时才预留**（`:96-101`）。

**压缩提示词**（`codex-rs/prompts/templates/compact/prompt.md`，全文 9 行）写成**给下一个 LLM 的交接单**而不是「总结一下」：
> "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task." + 四条要点（进展与决策 / 上下文约束与用户偏好 / 剩下要做什么 / 关键数据引用）。

`CompactedItem`（`history/src/lib.rs:181`）带窗口链（`window_number` / `window_id` / `previous_window_id`）和 **`latest_token_usage_record`**——注释明说（`:193-195`）`thread/resume` 靠这个字段直接恢复 token 总数，**不用回扫压缩点之前的任意长历史**。

**Token 用量**：`TokenUsage`（`protocol.rs:2216`）= `input_tokens` / `cached_input_tokens` / `cache_write_input_tokens` / `output_tokens` / `reasoning_output_tokens` / `total_tokens`。`RateLimitSnapshot`（`:2324`）带两个滚动窗口 + `credits` + `individual_limit` + `spend_control_reached` + `plan_type`。

**⚡ 一个反直觉但很人性的常量**：`BASELINE_TOKENS: i64 = 12000`（`tui/src/token_usage.rs:9`），`percent_of_context_window_remaining()`（`:44-53`）从窗口和已用两边**各扣掉这 12000** 再算百分比——即**系统提示词那部分不算进用户看到的剩余百分比**，否则新会话一开局就显示只剩 90%。

**没有 $ 金额换算**（已确证）：protocol 与 tui 侧 grep `price_per` / `cost_usd` 零命中。Codex 只报 token 数 + rate limit 窗口 + credits，**不做单价表**。

### 3.6 UI 呈现（TUI，ratatui）—— 这一节几乎每条都能直接用

**工具调用折叠**（`codex-rs/tui/src/exec_cell/render.rs`）：
- `TOOL_CALL_MAX_LINES = 5`（`:33`）、**`USER_SHELL_TOOL_CALL_MAX_LINES = 50`（`:34`，用户自己敲的命令给 50 行）**、`MAX_INTERACTION_PREVIEW_CHARS = 80`（`:35`）——**折叠上限按来源分档**。
- 表头（`:358-372`）：bullet `•` 的**颜色由退出码决定**（成功绿 / 失败红 / 运行中动画），标题 `"Running"` / `"Ran"` / `"You ran"` 三态。
- **截断策略 `truncate_lines_middle`（`:528`）：头尾都留、中间省略、省略行写明省了多少行；且先按屏宽 wrap 再截**（注释 `:461-463`：「这样少数超长行不会淹掉视口」）。

**reasoning 的双层可见性**（`tui/src/history_cell/messages.rs`）：整段 `dim().italic()`（`:326`）；**`transcript_only` 分流**（`:347-356`）——`display_lines()` 在 `transcript_only=true` 时返回空，`transcript_lines()` 永远返回全文。判据（`:629-644`）：抽得出 `**标题**` 的上主流，纯正文的只进 `Ctrl+T` 全文视图。**比一刀切「折叠/展开」体验好。**

**审批卡**（`tui/src/bottom_pane/approval_overlay.rs`）。文件头 doc（`:1-12`）自己写了两条契约：① 选中必须显式发出 decision 事件；② **MCP elicitation 的 `Esc` 永远映射到 `Cancel`，即使用户改了键位**——「dismissal never silently becomes "continue without info"」。并明说「This module does not evaluate whether an action is safe to run; it only presents choices and routes user decisions.」（**渲染层不做安全判断**）。

**⚡ 选项文案全是完整句子，且作用半径写在标签里**（`:840-909`、`:1015-1095`）：
```
"Yes, just this once"
"Yes, and don't ask again for commands that start with `{prefix}`"
"Yes, and allow this host for this conversation"
"Yes, and allow this host in the future"
"Yes, and allow these permissions for this session"
"No, continue without running it"
"No, and tell Codex what to do differently"      ← 对应 ReviewDecision::Denied{rejection}
"Yes, provide the requested info" / "No, but continue without it"   ← elicitation
```
**用户不需要猜「这次同意管多久」。**

**失败重试**（`core/src/responses_retry.rs`）：发 `EventMsg::StreamError`，文案 `"Reconnecting... {retry_count}/{max_retries}"`（`:118`）。注释（`:107-108`）解释为什么要发：「让用户明白发生了什么，而不是盯着一个看起来卡死的屏幕」。**但第一次重试在 release 构建里被隐藏**（`:109-111`）以减少瞬态噪音。**且 `StreamError` 不生成 history cell**（测试断言 `tui/src/chatwidget/tests/status_and_layout.rs:2782`）——**重试信息进状态条，不污染永久转录**。

### 3.7 可观测性：三条独立通道，权限分得很开

- **OTEL（对外遥测）**：`OtelExporter`（`codex-rs/otel/src/config.rs:88`）= `None` / `Statsig` / `OtlpGrpc` / `OtlpHttp`。**debug 构建里 `Statsig` 强制降为 `None`**（`:13-22`）——本地开发不发遥测。
- **⚡ 同一事件按「日志 / trace」分级出字段**（`otel/src/tool_result.rs:54-80`）：`common`（都发）= `tool_name`/`call_id`/`duration_ms`/`success`；`log`（只进本地日志）= `arguments`/`output`/`mcp_server`；`trace`（只进可上报 trace）= `arguments_length`/`output_length`/`output_line_count`/`tool_origin`。**trace 里只有形状和体量，没有内容。**
- **结构化日志落 SQLite**（`state/src/log_db.rs`）：一个 tracing Layer，有界队列（2048 / 批 512 / 10s flush）批量写 `logs_2.sqlite`；**sqlx 自己的日志被硬排除**（否则写库产生日志、日志再写库）。
- **rollout-trace（本地取证包，opt-in）**：README 第一段就是隐私声明——「Rollout tracing is **not** telemetry. Codex does **not** upload these traces」，只在设了 `CODEX_ROLLOUT_TRACE_ROOT` 时写本地 bundle。设计口号 **"observe first, interpret later"**：运行时**不**建语义图，只按序写原始事件 + payload 引用，离线 reducer 再做归因。

> **⚡ 对 Nomi**：「先记原始事件、离线再解释」正好解决 Nomi「生成失败了但当时没记够上下文」的老问题——热路径只 append 原始证据，语义归因留给离线。

### 3.8 Agents SDK：只补三条 Codex 没有的

SDK 是库不是产品，UI 那一维几乎没东西（只有 `repl.py:15` 的 `input(" > ")` 循环）。三条独有价值：

1. **「审批是中断，不是流事件」**。流事件只有三种（`src/agents/stream_events.py`）：`raw_response_event` / `run_item_stream_event` / `agent_updated_stream_event`；而 `ToolApprovalItem` 和 `CompactionItem` **被显式吞掉不发事件**（`run_internal/streaming.py:56-59`，注释：「approvals represent interruptions, not streamed items」）。审批 surface 在 `RunResult.interruptions`（`result.py:516`）。
2. **⚡ `RunState` 可序列化，审批能跨进程恢复**。回路是 `result.interruptions` → `result.to_state()` → `state.approve(item, always_approve=False)` / `state.reject(item, *, rejection_message=...)` → `Runner.run(agent, state)`。**sticky 决策（`always_approve`）能跨 `to_string()`/`from_string()` 存活**；**部分批准合法**（只解决一部分，剩下的下轮继续 pause）。这正是「用户离开电脑、明天回来继续批」该有的形状。
3. **⚡ fail-closed 的具体清单**（`docs/human_in_the_loop.md:15`）：参数是坏 JSON、是合法 JSON 但非 object（`null`/list）、或含 `NaN`/`Infinity`/`-Infinity` 时，**`needs_approval` 回调根本不被调用，直接要求人工审批**。

另外两条记账纪律值得记：`Usage.request_usage_entries`（`src/agents/usage.py:218`）的 docstring 明说**聚合数没用、逐次明细才有用**（3 次调用 100K/150K/80K，聚合成 330K 毫无意义）；`ModelResponse.raw_usage` 用来**区分「provider 没报」和「provider 报了 0」**。**SDK 同样没有 $ 换算**（grep `cost|price|usd` 只命中 docstring）。

⚠️ 两个「wire 名一旦发出就锁死」的警示：Python 的 `handoff_occured` 是**故意保留的拼写错误**（改了就是 breaking change），JS 那边拼对了（`handoff_occurred`）——两边不一致；`MCPListToolsSpanData` 的 `.type` 是 `"mcp_tools"` 而非 `"mcp_list_tools"`。

### 3.9 对 Nomi 的启发（一句话）

**「内部富事件 + 对外窄投影」让内部随便演进而对外 schema 稳定；审批答案要做成「带修正意图 + 作用半径写在标签里」的枚举，且 `Default` 就是拒绝。**

### 出处

- **Codex CLI**，clone `openai/codex` @ `ac192cd7937b0d73edc6dffe009940ae53782dd4`（tag `rust-v0.153.4`）：
  `codex-rs/protocol/src/protocol.rs`（`:592` Op · `:735-738` ThreadRollback 注释 · `:984` AskForApproval · `:991` on-failure 别名 · `:998-1009` GranularApprovalConfig · `:1070` SandboxPolicy · `:1129` WritableRoot · `:1337` Event · `:1356` EventMsg · `:1928/:1936` Item{Started,Completed} · `:2216` TokenUsage · `:2324` RateLimitSnapshot · `:3040` SessionMeta · `:4056` ReviewDecision）
  · `protocol/src/items.rs:45,200` · `protocol/src/approvals.rs`（`:258` 起）· `protocol/src/request_user_input.rs`
  · `exec/src/cli.rs:59-65,215` · `exec/src/exec_events.rs:11,61,98,107` · `exec/src/event_processor_with_jsonl_output.rs:470-580`
  · `app-server-protocol/src/protocol/common.rs:506,1624,1735,1853-1930` · `v2/item.rs:64,1609` · `v2/thread.rs:335,518,1119`
  · `tools/src/tool_spec.rs:22` · `responses_api.rs:32,34-36` · `json_schema/types.rs:17,30,36` · `function_call_error.rs`
  · `core/src/tools/handlers/mod.rs:85-92` · `shell_spec.rs:24,112,197,229` · `request_user_input_spec.rs:16`
  · `core/src/compact.rs:119` · `compact_remote_v2.rs:82` · `compact_token_budget.rs:48-89` · `session/context_window.rs:8-110` · `mcp_tool_call.rs:2326,2345` · `responses_retry.rs:74,92,107-118`
  · `config/src/mcp_types.rs:26,39`
  · `history/src/lib.rs:118,181,193-195,254,264` · `history/src/rollout_payload.rs:22`
  · `rollout/src/lib.rs:82-83` · `recorder.rs:1640-1647` · `rollout_file_name.rs:38-72`
  · `state/src/sqlite.rs:29-34` · `state/src/log_db.rs:51-54` · `state/migrations/0001_threads.sql`
  · `tui/src/exec_cell/render.rs:33-35,349,358-372,461-463,528,695-700` · `history_cell/messages.rs:296,326,347-356,629-644` · `bottom_pane/approval_overlay.rs:1-12,74,840-909,1015-1095` · `ui_consts.rs:12` · `token_usage.rs:9,44-53` · `chatwidget/tests/status_and_layout.rs:2782`
  · `otel/src/config.rs:9-22,50,88` · `otel/src/targets.rs` · `otel/src/tool_result.rs:54-80` · `rollout-trace/README.md`
  · `prompts/templates/compact/prompt.md` · `summary_prefix.md`
  · 官方文档：https://learn.chatgpt.com/docs/non-interactive-mode （JSONL 事件名）· https://learn.chatgpt.com/docs/config-file/config-basic （`approval_policy` / `sandbox_mode` 文档值）
- **Agents SDK**：`openai-agents-python` @ `1d471a47`（v0.22.0）：`src/agents/stream_events.py:11,24,29-42,52` · `items.py:533,556,686-701` · `result.py:516,542` · `run_internal/streaming.py:56-59` · `tool.py:441,485,1863,2512` · `strict_schema.py:115,235,250` · `run_state.py:193,1287,1302,2124` · `usage.py:196,218-229` · `memory/sqlite_session.py:42,230-262` · `extensions/memory/advanced_sqlite_session.py:53,300` · `run_internal/session_persistence.py:325-420` · `repl.py:15` · `docs/{streaming.md,human_in_the_loop.md,usage.md,tracing.md}`；`openai-agents-js` @ `32612641`（0.17.0）：`src/events.ts:38` · `runState.ts:180`
  · https://openai.github.io/openai-agents-python/human_in_the_loop/ · /streaming/ · /usage/ · /tracing/
- ⚠️ **本次调研修正了任务书里的一个过时假设**：Codex 的 approval policy 现役**不是** `untrusted/on-failure/on-request/never` 四档——`on-failure` 已降级为 `on-request` 的别名，并新增了 `granular` 档。

---

## 4. 桌面/IDE 内嵌 Agent 面板 —— 和 Nomi 面板同形态的一类

> **这一节权重最高**：Cline 和 Nomi 是同一个形状——**两条不同步的通道（增量事件流 + 全量状态快照）+ 长时异步任务 + 一个要排时间线的面板**。它踩过的坑我们一定会踩。

| 仓库 | commit | 版本 | 状态 |
|---|---|---|---|
| `cline/cline` | `dac3b35ba485dbab3b5a73aca239b0d07ce071cf`（2026-09-04） | `apps/vscode/package.json:5` = **4.1.17** | 活跃 |
| `RooCodeInc/Roo-Code` | `b867ec9145750d0ae1ff7f02d35406e9bf2a0b16`（2026-05-15） | `src/package.json:6` = **3.53.0** | ⚠️ **仓库已 archived**（`gh api ... --jq .archived` → `true`） |

**先解释三个词**：**ask / say** = Cline 把消息分两类，`ask` 是「停下来等你点」，`say` 是「单向播报」；**partial** = 这条还在流式写、没写完；**shadow git** = 在你的仓库之外另开一个隐形 git 仓来存快照。

### 4.1 Cline 的转录模型：**不是有序 parts 流，是按 `ts` 排序的分类型消息数组**

- 唯一消息类型 `ClineMessage`（`apps/vscode/src/shared/ExtensionMessage.ts:177-207`）：`ts`（**既是时间戳也是合并主键**）· `type: "ask" | "say"` · `ask?` · `say?` · `text?` · `reasoning?` · `partial?` · `seq?` · `epoch?` · `lastCheckpointHash?` · `conversationHistoryDeletedRange?`。
- `ClineAsk` 18 个成员（`:209-227`）、`ClineSay` **37 个**（`:229-266`）。工具调用是 `say: "tool"`（已完成）/ `ask: "tool"`（待批），`text` 里塞的是 `JSON.stringify` 过的 `ClineSayTool`（`:268-293`）。
- proto 镜像在 `apps/vscode/proto/cline/ui.proto:18-79`。里面 `reserved 9 // was API_REQ_RETRIED` 和 `reserved 28 // was ERROR_RETRY` 记录了**「自动重试的可视化被主动移除」**这段历史。

**⚡ 这一节最值钱的两条设计**：

**① 收敛副本（convergent replica）三元组 `ts + seq + epoch`。** 纯函数 reducer 在 `apps/vscode/webview-ui/src/components/chat/chat-view/messageReducer.ts:1-60`，注释直说动机：webview 同时从两条**无序、fire-and-forget** 的通道收同一段对话（增量 partial 流 + 全量 state 快照），reducer 保证**任意到达顺序 / 重复 / 丢失下都收敛到同一结果**。`ts` 是身份、`seq` 是同一 ts 的新鲜度（越大越新）、`epoch` 是会话围栏（旧 epoch 直接丢）。

**② 一条独立于消息数组的回合相位机 `TurnState`**（`ExtensionMessage.ts:153-168`）：`TurnPhase = idle | streaming | awaiting_approval | awaiting_followup | completed | error | resumable`，带 `anchorTs`（这个相位是「关于哪条消息」的）和单调 `seq`。注释明说：有了它，底部按钮和「Thinking」指示器**不再靠 tail-walking（从消息尾巴往回猜）**，因而免疫「尾部记账消息把状态带偏」的 bug。

> **⚡ 对 Nomi 的直接启发**：Nomi 有一模一样的双通道结构（`PROJECT_AGENT_SNAPSHOT_CHANNEL` 全量快照 + `RuntimeActivityEvent` 增量流），而且渲染层已经因为「宿主状态里没有运行中的工具记录」被迫维护了一个第二真相（`src/workbench/ai/v4/agentPanelV4PendingTools.ts:1-14`）。**别把 UI 状态从消息数组尾巴上推导**——那正是 Cline 注释里点名修掉的 bug。两样可直接抄：`ts + seq + epoch` 的纯函数 reducer（可做 property-based 测试，与 React/IPC/定时器解耦）；一条独立相位机，让底部按钮、「正在想」、输入框禁用**共用同一个真相源**。

### 4.2 工具契约：现役是 native tool calling，XML 那套已成遗留

- 24 个工具 id 在 `apps/vscode/src/shared/tools.ts:8-35`；同文件 `:1-5` 直接 import 三家 SDK 的 Tool 类型（Anthropic `Tool`、Google `FunctionDeclaration`、OpenAI `ChatCompletionTool`）。
- SDK 契约：`sdk/packages/shared/src/agent.ts:171-181` `AgentToolDefinition { name, description, inputSchema, lifecycle?: { completesRun? } }`；可执行版加 `timeoutMs` / `retryable` / `maxRetries`。
- **XML 提示词那套还在文件里但没人 import 了**：`apps/vscode/src/core/prompts/responses.ts:371-384` 的 `toolUseInstructionsReminder`，全仓 grep 除了它自己的两个测试外**无生产 import**。

**⚡ 最值得抄的是错误文案的「递进强度」设计**（`responses.ts`）：
- 通用：`missingToolParameterError(paramName)` → ``"Missing value for required parameter '${paramName}'. Please retry with complete response."``（`:50-51`）
- **专门的递进错误** `writeToFileMissingContentError(relPath, consecutiveFailures, contextUsagePercent)`（`:58-96+`）：连续失败 ≥2 次换措辞、**≥3 次直接禁止再用 `write_to_file`**，改列三条替代策略（先建空文件再 `replace_in_file` / 拆多文件 / 先写骨架再逐段填），并规定每次 replace 不超过 50-100 行。上下文占用 >50% 时再加一句预算警告。

native 路径的非法调用分三类（`sdk/packages/agents/src/agent-runtime.ts:189-194`）：`InvalidToolCall.reason = "missing_name" | "missing_arguments" | "invalid_arguments"`。JSON 解析失败挂到 `metadata.invalidToolCalls`，执行阶段读 `metadata.inputParseError` 作为 `skipReason` **跳过执行**（`:1687-1689`）；未注册工具 → `{ output: { error: 'Unknown tool: X' }, isError: true }`（`:1832-1834`）。

> **对 Nomi**：① 不要只给一句「参数缺失」——「同一个错连犯 N 次就换策略、并明令禁止再走这条路」能把模型从死循环里捞出来。Nomi 的分镜工具（24 行、25 字段）正是会反复写不完的那种。② 参数非法要**分成 `missing_name` / `missing_arguments` / `invalid_arguments` 三类**：第一类是**我们注册表的问题**，后两类才是模型的问题，UI 和给模型的回执都该不同。

### 4.3 审批：Cline 砍掉了总开关，Roo 反而做加法

**Cline 现役只有 5 个维度**（`apps/vscode/src/shared/AutoApprovalSettings.ts:1-26`）：`readFiles` / `editFiles` / `executeSafeCommands` / `useBrowser` / `useMcp`。默认（`:28-44`）读、写、浏览器、MCP **为 true**，`executeSafeCommands: false`。

**⚡ `enabled`（auto-approve 总开关）、`maxRequests`、`executeAllCommands` 等全部被注释成 legacy**（`:4-12`, `:16-20`）——**Cline 主动砍掉了「总开关 + 分项」的两级结构**，改成「一直开着、逐维度勾」。常驻条 `AutoApproveBar.tsx:93-121` 在 footer 顶部显示 `Auto-approve: Read, Edit, MCP ▸`，**已开维度用 shortName 逗号拼在标题行上，不展开也一眼可见**。

**⚠️ 一个 Nomi 引 SDK 会撞的坑**（`apps/vscode/src/sdk/sdk-tool-policies.ts:13-40`）：SDK 默认**「未列出的工具即自动批准」**，所以 Cline 反过来把所有受管工具显式设成 `{ autoApprove: false }`，强制走 `requestToolApproval` 回调，回调里再读**最新**设置——这样用户任务进行中改开关也立刻生效。MCP 工具按 `${server.name}__${tool.name}` 注册，但**一个全局开关管所有 MCP 工具，没有 per-tool 粒度**（`:62-65` 注释自陈）。

审批 IPC（桌面版）走**文件系统**：写 `${sessionId}.request.${id}.json`、200ms 轮询 decision 文件、**默认 5 分钟超时后 fail-closed 为拒绝**（`sdk/packages/core/src/runtime/tools/tool-approval.ts:74,101`）。另有 hooks 层可在批准前拦：`PreToolUse` / `PostToolUse` / `UserPromptSubmit`（`sdk/packages/shared/src/hooks/events.ts:75-92`）。

**YOLO 不在扩展里，在 CLI**：`apps/cli/src/main.ts:980`，且 yolo 会**关掉 spawn agent 和 agent teams**（`:1087-1088`）。

**Roo Code 反向操作**：7 个 always-allow 维度（`webview-ui/src/components/settings/AutoApproveToggle.tsx:28-78`），外加 `autoApprovalEnabled` 总开关、`allowedCommands`/`deniedCommands` 真白黑名单、`alwaysAllowWriteProtected`、`followupAutoApproveTimeoutMs`（倒计时自动批准）、**`allowedMaxRequests` / `allowedMaxCost`（次数与金额双上限）**（`packages/types/src/global-settings.ts:97-118`）。

> **⚡⚡ Roo 有一个全场最强的交互，Nomi 该直接抄**：`webview-ui/src/components/chat/CommandPatternSelector.tsx:14-52` —— **命令审批卡上直接列出这条命令能抽出的若干层模式**（完整命令 + 逐级前缀），每个模式旁一对 ✓/✗，点一下就写进白/黑名单。**用户在要做决定的那一刻顺手建立长期规则，而不是事后去设置页翻。** 对应到 Nomi：模型要覆盖一个已生成节点、或要调一次付费模型时，审批卡上直接给「以后这类都放行 / 都拦」。

> **另外两条判断**：① **Cline 砍总开关的取舍更对**（两级开关让用户每次想两遍），Roo 保留它是历史包袱；② **`allowedMaxCost` 金额上限 Cline 没有，而 Nomi 碰真实花费，这个必须有**。

### 4.4 会话与恢复：Cline 已从 shadow git 换成「用户仓库里的私有 ref」

- **两套存储并存**（4.x 迁移期）：传统 VS Code 路径 `globalStorage/tasks/<taskId>/{api_conversation_history,ui_messages,context_history,task_metadata}.json`（`apps/vscode/src/core/storage/disk.ts:17-53`）；SDK 路径是 **SQLite** `~/.cline/data/db/sessions.db`（`sdk/packages/core/src/services/storage/sqlite-session-store.ts:45`，`shared/src/storage/paths.ts:179-185`）。子 agent 作为 `parent_session_id` 的子会话记在同一张表（`:264-270`）。
- 历史列表项 `HistoryItem`（`apps/vscode/src/shared/HistoryItem.ts:1-26`）带 `tokensIn` / `tokensOut` / `cacheWrites` / `cacheReads` / **`totalCost`** / `modelId` / `apiProvider` —— **每个 task 的累计花费是历史条目的一等字段**。
- **⚡ Checkpoint 的实现变了**：不再是 shadow git，改成 `git stash create` + `git update-ref refs/cline/checkpoints/${sessionId}/${runCount}`（`sdk/packages/core/src/hooks/checkpoint-hooks.ts:110-160,285-286`）。
- **⚡ 恢复是带事务的**（`sdk/packages/core/src/session/checkpoint-restore.ts:50-80+`）：因为 restore 要跑 `git clean -fd`，先用 `git stash push --include-untracked` 把当前工作区抓下来、挪到私有 ref `refs/cline/restore-transactions/<uuid>`，并**立刻从用户可见的 stash list 里移除**，commit/rollback 时才删。
- **⚡ checkpoint 锚在「用户轮次」而不是「每条消息」**（`apps/vscode/src/sdk/sdk-checkpoints.ts:3-45`）：只有 `say: "task"` 或 `say: "user_feedback"` 且不是对 followup/mistake_limit 的回答，才算一个 run。

> **对 Nomi**：① **回滚粒度选「用户轮次」**——用户想回到的是「我上一句话之前」，不是「第 37 条工具调用之前」。② Nomi 的项目库不是 git，但「**用私有命名空间存快照 + 恢复前先把当前状态抓进事务性备份**」这个模式可以照搬。③ **别做不可逆的 revert**（Windsurf 就是，见 §4.7）。

### 4.5 上下文与花费

**上下文常量**（`sdk/packages/core/src/extensions/context/compaction-shared.ts:13-23`）：`DEFAULT_MAX_INPUT_TOKENS = 128_000` · `CONTEXT_WINDOW_INPUT_RATIO = 0.9` · **`COMPACTION_TRIGGER_RATIO = 0.9`** · **`DEFAULT_TARGET_RATIO = 0.7`** · `DEFAULT_PRESERVE_RECENT_TOKENS = 20_000` · `TOOL_RESULT_CHAR_LIMIT = 2_000`。两套策略：`basic-compaction.ts`（确定性截断）与 `agentic-compaction.ts`（模型写摘要）。

**⚡ 溢出恢复的纪律**（`compaction.ts:44-51` 注释）：当 provider 回「超上下文窗口」时，`overflowRecovery` 强制压缩且**必须用确定性的 basic 策略**，理由写死在注释里——**「recovery must not depend on another successful LLM request」**。（这条等价于 Nomi 的「fallback 路径不能再依赖那个会失败的东西」。）

**花费显示的粒度是「每个 task」，不是每条消息**：总价在 TaskHeader 折叠态右上角的 pill，**四位小数**（`webview-ui/src/components/chat/task-header/TaskHeader.tsx:178`）。展开后 `ContextWindowSummary.tsx:62-72` 是四行手风琴——`Prompt Tokens` ↑ / `Completion Tokens` ↓ / **`Cache Writes` ← / `Cache Reads` →**，**为 0 的行直接过滤掉**。

**⚡ 什么时候不显示价格**（`TaskHeader.tsx:92-106`，这段注释是产品判断的教科书）：本地 provider（`vscode-lm`/`ollama`/`lmstudio`）没花费；`openai-compatible` 只有用户填了单价才算；**包月/订阅制 provider 显式标 `"subscription"` 从而不显示**，理由写死：**「算出来的数字是按 API 费率估的，不是真实扣费」**。

而**消息级的 `api_req_started` 行默认不渲染**（`chat-view/utils/messageUtils.ts` 的 `filterVisibleMessages`，只有带 `cancelReason` 或 `streamingFailedMessage` 才保留）。

> **对 Nomi**：① 「触发线 0.9 / 压到 0.7 / 保留最近 2 万 token」这组数可以直接当起点（对照 pi 的 `reserveTokens 16384` / `keepRecentTokens 20000`，两家非常接近）。② **花费显示要按「计费模型」而不是按 provider 硬编码**——Nomi 接 APIMart/kie 这类中转，有的按次、有的按 token，该由能力档案声明「显不显示 / 显示什么」（正好对上 P4 通用第一）。③ Cline 把 per-request 成本行**从时间线里拿掉了**，只留 task 级——这是明确的 D4 取舍：**逐条报价噪音大于价值**。Nomi 要做「每条都标价」前，先用 D4 的尺子量一遍。

### 4.6 UI 呈现（本节最该抄的一节）

**时间线与虚拟列表**（`MessagesArea.tsx`）：用 **react-virtuoso**。三个带注释的 hack（`:247-256`）——`atBottomThreshold={10}`；`increaseViewportBy={{ top: 3_000, bottom: Number.MAX_SAFE_INTEGER }}`（top 加 3000px 防折叠时跳动，**bottom 给 MAX_SAFE_INTEGER 保证最后一条永远渲染**）；`key={task.ts}` 换 task 强制重建；`overflowAnchor: "none"` 防浏览器自动锚定造成跳动。

数据管线三层：`filterVisibleMessages` → `groupMessages` → **`groupLowStakesTools`**（`messageUtils.ts:533`）。

**⚡ 按风险分层编组**：`LOW_STAKES_TOOLS = { readFile, listFilesTopLevel, listFilesRecursive, listCodeDefinitionNames, searchFiles }`（`messageUtils.ts:17-23`）——**只读探查折成一组一行**，写/执行/浏览器/MCP 单独成卡。**这是按风险分层，不是按工具名分层。**

进行中的探查显示成**动词进行时**（`ToolGroupRenderer.tsx:28-64`）：`Reading src/foo.ts (lines 10-40)...` / `Exploring src/...` / `Searching "a | b" in src/ (*.ts)...`，搜索正则会被清洗成人话（去 `\b`、`\s?`）。

**长输出截断**：命令输出三档高度（折叠 `max-h-[75px]` / 展开 `max-h-[200px]` / 自动显示 `overflow-y-visible`），**只有超过 5 行才显示展开把手**（`CommandOutputRow.tsx:95-108`）。`ExpandHandle` 不是文字按钮，是**贴在卡片底边中央、半嵌出来的小三角凹槽**。Task 标题超长用 **mask-image 渐隐**而不是省略号。

**⚡ 失败与按钮：按钮不在卡上，在 footer 的统一动作条上。** footer 顺序 `AutoApproveBar → ActionButtons → QueuedPrompts → InputSection`（`ChatView.tsx:415-433`）。按钮配置是**单一真相源表** `chat-view/shared/buttonConfig.ts:33-221`，注意文案是具体动作而非泛泛的 Approve：`command` → **「Run Command」**/「Reject」；`command_output` → 「Proceed While Running」；`api_req_failed` → 「Retry」/「Start New Task」；`mistake_limit_reached` → 「Proceed Anyways」。按钮由 `TurnState` 驱动，并有**防重复点击的 latch**：`askIdentity = anchorTs:primaryText:secondaryText`（`ActionButtons.tsx:53`，注释解释为什么不能只比对象引用——配置对象是共享单例）。

**⚡ 可自愈的错误不给按钮**：`diff_error` 的文案是「模型用的搜索片段在文件里匹配不到。正在重试…」（`ErrorRow.tsx:176`）——**只解释 + 自动重试，不把心智负担丢给用户**。

**⚡「模型正在想」的占位是本次调研里最讲究的一段**（`chat-view/hooks/useThinkingLoaderRow.ts`）：
- 占位行**在消息流里**（不是 footer），用哨兵消息 `WAITING_ROW = { ts: Number.MIN_SAFE_INTEGER, ..., partial: true, text: "" }`（`MessagesArea.tsx:16-25`）。
- **列表为空时走快路径** `showEmptyListLoader`（`:113,223-239`）：冷启动的虚拟列表要几帧才能测量并画出第一项，**那正好是「刚点发送」的时刻**，所以先用普通 DOM 画一个同 markup 的 loader，Virtuoso 在底下预热，第一条真消息来了再切回去，**视觉上不跳**。
- **反闪烁 grace period** `THINKING_LOADER_GRACE_MS = 500`（`useThinkingLoaderRow.ts:14`）。注释解释信号是二义的：「尾条 partial → false」在回合中间意味着「等下一块内容」（该显示），在回合末尾却是「done 事件即将把相位翻成 completed」前几毫秒到的（不该显示）。**真等待会活过 500ms，回合结束会取消它。**
- **权威路径**：有 TurnState 时只有 `phase === "streaming"` 才可能是 thinking（`:62-65`，注释点名这修的是「Thinking 卡死」的 bug）。
- **乐观显示**：从 webview 发出去那一刻就先显示，不等后端回环（`MessagesArea.tsx:94`）。
- 活动文字动效（`TypewriterText.tsx:4-35`）：逐字打出（30ms/字），**打完不留光标，改成 shimmer 渐变扫过**。

**⚡ 滚动行为（Nomi 会撞同样的问题）**（`useScrollBehavior.ts`）：用户向上滚滚轮（`deltaY < 0`）→ 关掉自动跟随；滚回底部 → 重新打开。**展开一行 = 关掉自动跟随；折叠一行才滚**（`:216-260`，注释：「Only scroll on collapse, never on expand - expanding should stay in place」）。每次 pin 到底都是「smooth 一次 + 50ms 后 auto 再补一次」，防止晚到的布局位移让你差一点到底。

### 4.7 模型选择：Plan/Act 双档 vs 模式↔档案 N:1 绑定

**Cline**：两段式选择器，**都用 Fuse.js 模糊搜索、都是扁平列表，没有按 provider 分组的 optgroup**。provider 列表从**运行时 SDK provider catalog** 取而不是硬编码静态表（`settings/ApiOptions.tsx:124-146`，注释说明这样用户自配的 provider 也会出现）。模型选择器里**收藏的固定置顶**（`ClineModelPicker.tsx:337-346`）。模型信息卡用紧凑价格格式 `$5/M`、`$0.0004/M`，**cache reads / writes 单价单列**（`ModelInfoView.tsx:96-113,273-282`）。

**「每类任务默认模型」= Plan / Act 各配一套**：设置项 `planActSeparateModelsSetting`，**默认 false**（`state-keys.ts:272`）；打开后 UI 变成两个 tab；字段成对存在（`planModeApiProvider` / `actModeApiProvider`）；**关掉开关时会先把当前 tab 的配置同步到另一边**（`ApiConfigurationSection.tsx:69-71`），避免关掉后另一模式停在旧模型上。

**Roo 的做法更泛化**：不是「Plan 一个 / Act 一个」，而是 **`modeApiConfigs: Record<modeSlug, profileId>`**（`packages/types/src/global-settings.ts:193`）——**任意多个命名配置档案（provider + model + 参数），任意模式各绑一个**。5 个内置模式 `architect` / `code` / `ask` / `debug` / `orchestrator`（`packages/types/src/mode.ts:169-227`），且 **architect 的 edit 权限被正则限死只能改 markdown**：`["edit", { fileRegex: "\\.md$" }]`（`:177`）。

> **⚡ 对 Nomi**：Plan/Act 双模型的底层逻辑是「规划要贵要聪明、执行要快要便宜」。Nomi 的「文本创作 / 生图 / 生视频 / 音频 / 编排」是**更强的同类需求**，而 2026-09-06 已拍板「模型钮显示模型名 + 三类生成模型默认预设」——**这正是 Cline `planActSeparateModels` 的泛化版，而 Roo 的 `modeApiConfigs`（命名档案 + 绑定表）才是对的形状**，二元开关不够用。抄两个细节：**默认关**（不给新用户加认知负荷）、**关掉时自动同步**（别留半配置状态）。另外 provider 列表从运行时能力档案取而非硬编码，正好是 Nomi 的 P4「档案声明槽、通用系统负责填」。

### 4.8 Cursor / Windsurf（仅官方文档）—— 两个结构性前提必须先说

- **Cursor 文档搬家**：`docs.cursor.com/*` 现 308 跳到 `cursor.com/docs` + `cursor.com/help`，旧路径已不存在。
- **⚠️ Windsurf 已更名为 Devin Desktop**（Cognition）：`docs.windsurf.com/*` 307 跳到 `docs.devin.ai/desktop/*`。**任何基于记忆的 Windsurf 结论都要重新验。**

**模式**：Cursor 有 Agent（默认）/ Ask（只读）/ Plan（先出可编辑计划）/ Debug（先假设、插日志、用运行时信息定位），**Shift+Tab 循环**。关键设计一句话：**「Each mode uses its own context, so switching modes starts a fresh context window」——换模式 = 换上下文窗口。** Windsurf/Devin 的 Cascade 三模式 Code / Plan / Ask，**区别是工具权限不是模型**，⌘+. 切换；Plan 模式常用**多选题**问澄清，产出一个外部 Markdown 计划文件（存 `~/.windsurf/plans`），**可以重新 @ 它并点 Implement 在新会话里重试**。

**审批**：Cursor 现行文档里 **「YOLO mode」这个词已经查不到了**，现在叫 **Run Modes**（`Settings > Agents > Approvals & Execution`）：`Auto-review`（白名单直跑；其他 shell 尽可能进沙箱；剩下交给分类器 allow/block/要求换做法）/ `Allowlist` / `Run Everything`。**允许/拒绝不再是命令字符串列表，而是自然语言指令**——`~/.cursor/permissions.json` 里的 `allow_instructions` / `block_instructions`。

**⚡ Cursor 有三条不管什么模式都要批的红线**：**Browser Protection**、**File-Deletion Protection**、**External-File Protection**。

Windsurf 四档自动执行：`Disabled` / `Allowlist Only` / `Auto`（模型自评风险）/ `Turbo`（全自动除黑名单）。设置键 `windsurf.cascadeCommandsAllowList` / `...DenyList`，团队版**「The denylist takes precedence」**。另有 Auto-Continue：每个 prompt 最多 20 次工具调用，撞上限自动续，**每次续算一个新的 prompt credit**。

**Checkpoint**：Cursor 自动在重大改动前建快照，并**明确写出限制**——只管文件；恢复**不会**删掉对话消息；**不捕获终端或应用状态**；「Checkpoints are stored locally and separate from Git. Only use them for undoing Agent changes; use Git for permanent version control.」**Windsurf 的回退 ⚠️「Reverts are currently irreversible, so be careful!」——不可逆。**

**花费**：**三家都不在聊天流里显示逐条花费**——Cursor 在 dashboard 的 Spending tab（编辑器内只有接近上限时的通知），Windsurf 在设置面板的 Plan Info，Cline 只在 task header。聊天内逐条 token/$ 读数：**未查到**。

**规则激活模型**（Windsurf，`docs.devin.ai/desktop/cascade/memories`）：分层且各有字数上限——全局 `~/.codeium/windsurf/memories/global_rules.md`（**6,000 字符**）、工作区 `.windsurf/rules/*.md`（**每个 12,000 字符**）、目录级 `AGENTS.md`。工作区规则用 **`trigger`** 字段声明生效方式：`always_on` / `model_decision` / `glob` / `manual`。文档**明确推荐 Rules/AGENTS.md 优于自动 memories**：「Rules are version-controlled, shareable with your team, and give you explicit control over activation.」

**未查到**（写明而非编）：Cursor 每模式的默认模型、模型选择器的分组方式、会话磁盘位置、聊天内的逐条花费读数；Windsurf 的 @-mentions 权威汇总页（`docs.devin.ai/desktop/cascade/mention` **404**）、回退是否覆盖终端状态、每模式默认模型；`.cursorrules` 与 Cursor「memories」；Cursor 的 `@Docs`/`@Web`/`@Definitions` 等——**在现行页面上都不存在**。

> **对 Nomi**：① Cursor 从「命令字符串白名单」转向「自然语言意图规则 + 分类器」，承认了一件事：**用户没法穷举命令模式**。Nomi 没有那个分类器，**该走 Roo 那条低成本解（审批那一刻顺手立规则）**。② **三条永不免批的红线**对应到 Nomi 应该是：**花钱的生成调用、覆盖已有成片/节点、删素材**——就算用户开了全自动也照样问（呼应 §2.3 Claude Code 的「Actions no mode auto-approves」）。③ **「换模式 = 换上下文窗口」**是个干脆的心智：Nomi 的「创作 / 画布 / 时间轴」若各有 Agent 入口，**上下文该不该共享是必须先想清楚的岔路，别默认共享**。④ **Windsurf 的不可逆回退是反面教材**——文档里都要写「be careful!」，说明它在真实使用里咬过人。

### 4.9 一句话总结这三家的分野

- **Cline** 把复杂度吃在**状态正确性**上（收敛副本 reducer + 相位机 + 反闪烁 grace），UI 上做减法（砍总开关、砍逐条报价、砍自动重试可视化）。**Nomi 最该抄它，因为形状一模一样。**
- **Roo Code** 把复杂度吃在**用户可配置性**上（7 维审批 + 真白黑名单 + 就地加规则 + 模式↔档案绑定 + 次数/金额双上限）。**该抄「审批那一刻顺手立规则」和「模式↔命名档案 N:1 绑定」，但要知道它已归档。**
- **Cursor / Windsurf** 把复杂度藏进**托管服务**（分类器决定放行、路由器决定模型、花费在 dashboard）。**Nomi 本地优先，抄不了这条路**——但它们的**红线清单**和**规则激活模型**可迁移。

### 出处

- **Cline** @ `dac3b35ba485dbab3b5a73aca239b0d07ce071cf`（v4.1.17，2026-09-04）：`apps/vscode/src/shared/ExtensionMessage.ts:153-293` · `tools.ts:1-35` · `AutoApprovalSettings.ts:1-44` · `HistoryItem.ts:1-26` · `content-limits.ts:7,38` · `apps/vscode/proto/cline/ui.proto:18-79,178-183,204-236` · `src/core/prompts/responses.ts:11-123,371-384` · `src/core/storage/disk.ts:17-97` · `src/sdk/sdk-tool-policies.ts:13-65` · `src/sdk/sdk-checkpoints.ts:3-45` · `src/core/hooks/templates.ts:255` · `apps/cli/src/main.ts:820,980,1087-1088` · `sdk/packages/shared/src/agent.ts:171-211` · `llms/tools.ts:7-18` · `hooks/events.ts:75-92` · `storage/paths.ts:179-265` · `sdk/packages/agents/src/agent-runtime.ts:189-194,1357-1359,1687-1689,1832-1834,2109` · `sdk/packages/core/src/runtime/tools/tool-approval.ts:74,101` · `hooks/checkpoint-hooks.ts:10-26,110-160,250-269,285-286,403-405` · `session/checkpoint-restore.ts:50-80` · `services/storage/sqlite-session-store.ts:45,264-270` · `extensions/context/{compaction-shared.ts:13-23, compaction.ts:44-51, basic-compaction.ts, agentic-compaction.ts}` · `types/config.ts:59,62` · `types/sessions.ts:33-44` · webview-ui：`chat-view/messageReducer.ts:1-60` · `chat-view/utils/messageUtils.ts:17-23,116,202,533` · `chat-view/shared/buttonConfig.ts:7-221` · `chat-view/hooks/useThinkingLoaderRow.ts:14,62-75` · `chat-view/hooks/useScrollBehavior.ts:32,202-260,323-324` · `chat-view/components/layout/ChatLayout.tsx:21-33` · `chat/MessagesArea.tsx:16-25,94,113,128-151,204-256` · `chat/MessageRenderer.tsx:73-91` · `chat/ChatView.tsx:415-433` · `chat/ChatRow.tsx:402-473,718-727` · `chat/ToolGroupRenderer.tsx:25-64` · `chat/CommandOutputRow.tsx:78-108,149-151` · `chat/ExpandHandle.tsx:15-25` · `chat/DiffEditRow.tsx:16-30,68-196` · `chat/ErrorRow.tsx:19,135,176` · `chat/TypewriterText.tsx:4-35` · `chat/QueuedPrompts.tsx:6-9` · `chat/auto-approve-menu/{constants.ts:3-34, AutoApproveBar.tsx:18-121}` · `chat/task-header/{TaskHeader.tsx:92-221, ContextWindowSummary.tsx:62-72}` · `chat/ActionButtons.tsx:39-59` · `common/CodeAccordian.tsx:55,95` · `settings/{ApiOptions.tsx:124-182, ClineModelPicker.tsx:9,323-346, sections/ApiConfigurationSection.tsx:27-71, common/ModelInfoView.tsx:96-282}` · `src/shared/storage/state-keys.ts:245-272`
- **Roo Code** @ `b867ec9145750d0ae1ff7f02d35406e9bf2a0b16`（v3.53.0，2026-05-15，**仓库已归档**）：`packages/types/src/message.ts:27-274` · `mode.ts:169-227` · `global-settings.ts:97-118,193` · `src/core/prompts/tools/native-tools/{index.ts:25,42, read_file.ts:5-60}` · `filter-tools-for-mode.ts:216-312` · `src/core/task/build-tools.ts:112-151` · `src/core/condense/index.ts:109-110` · `src/core/context-management/index.ts:24,171-177` · `src/core/config/ProviderSettingsManager.ts:30,108-115` · `src/services/checkpoints/ShadowCheckpointService.ts:122-178` · `src/shared/globalFileNames.ts:1-9` · webview-ui：`settings/AutoApproveToggle.tsx:28-78` · `chat/CommandPatternSelector.tsx:14-52` · `chat/TaskHeader.tsx:248-337` · `chat/ContextWindowProgress.tsx:24` · `chat/ApiConfigSelector.tsx:73-76`
- **Cursor**（2026-09-06 抓）：cursor.com/docs/agent/overview · /agent/plan-mode · /agent/debug-mode · /agent/design-mode · /agent/security/run-modes · /agent/tools/terminal · /agent/chat/checkpoints · /docs/rules · /docs/skills · cursor.com/help/ai-features/agent · /ask-mode · /customization/context
- **Windsurf / Devin Desktop**（2026-09-06 抓）：docs.devin.ai/desktop/cascade/modes · /cascade/cascade · /cascade/memories · /terminal
- ⚠️ 本节修正了两条常见过时前提：**Roo-Code 仓库已归档**（不是活跃对照物）；**Windsurf 已更名 Devin Desktop**，且 Cursor 的「YOLO mode」在现行文档中已被 Run Modes 取代。

---

## 5. 两份参照结构：Vercel AI SDK 6 的 `UIMessage.parts` 与 MCP 规范

> 这两个不是产品，是**形状的工业标准**。前者回答「有序 parts 流长什么样」，后者回答「工具契约与审批该怎么表达」。
> 组件层的对照另有一份同日调研：[`docs/research/2026-09-06-ai-elements-anatomy.md`](2026-09-06-ai-elements-anatomy.md)（读的是 `vercel/ai-elements@6a9d5b18`）。本节只讲**协议与类型**。

### 5A. AI SDK 6 —— parts 数组本身就是持久化格式

**版本事实**：`npm view ai dist-tags` → `latest: 7.0.93`、`ai-v6: 6.0.277`（2026-09-06 查）。ai-sdk.dev 官网现在渲染的是 **v7**，所以下面的类型取自 **v6 tarball 的 `dist/index.d.ts`**，文档引用取自 git tag `ai@6.0.277`（commit `0ef8ccec`）。

**先解释术语**：`UIMessage` 是「一条消息在界面层的表示」。它不是一根字符串，而是一个**有序的 `parts` 数组**——文本、思考、工具调用、文件各占一个 part，按发生顺序排。渲染 = `map(parts)`；持久化 = 存这个数组。**这两件事是同一个数组**，这是整个设计的支点。

`UIMessage` 只有 4 个字段（`ai@6.0.277` → `dist/index.d.ts:1590-1614`）：`id` / `role` / `metadata?` / `parts`。`UIMessagePart` 是 9 成员联合（`:1615`）：`text` · `reasoning` · `tool-${name}` · `dynamic-tool` · `source-url` · `source-document` · `file` · `data-${name}`（自定义结构化 part）· `step-start`（**无字段的纯步骤分隔符**）。

**tool part 的七态判别联合**（`:1725-1816`）：

```
input-streaming → input-available
      ↓（工具声明了 needsApproval 才走这两步）
   approval-requested { approval: { id, descriptor?, signature? } }   // approved?: never
      ↓
   approval-responded { approval: { id, approved: boolean, reason? } }
      ↓
├─ output-available { output, preliminary? }   // approval?.approved: true
├─ output-error     { errorText, rawInput? }   // approval?.approved: true
└─ output-denied    { approval: { approved: false, reason? } }  // output / errorText 都 never
```

三条设计值得逐条看：

1. **`approved` 的类型就是判别位**。`approval-requested` 里 `approved?: never`、`output-denied` 里 `approved: false`、有输出的两态里 `approved?: true`。**「被拒的调用带着 output」这种状态在编译期就不可表达**——这正是 R28「防线建在最早能拦住的那层」。
2. **审批是「两次模型调用」，不是「暂停协程」**。v6 core 文档原话：`generateText` / `streamText` **不会暂停执行**，它们直接返回、在结果里带 `tool-approval-request`；你收集用户决定，把 `tool-approval-response` 塞进 messages，**再调一次模型**（`15-tools-and-tool-calling.mdx:130`）。客户端 API 是 `useChat().addToolApprovalResponse({ id, approved, reason? })`（`:3720-3736`）。
3. **审批带 HMAC 签名防伪造**：`experimental_toolApprovalSecret`（`:1470/2833/3373`）让服务端对每个 approval request 做 HMAC-SHA256 签名（`ToolApprovalRequestOutput.signature`，`:737-752`），重放时验签；配套 `InvalidToolApprovalSignatureError`。**这一条对 Nomi 直接适用**：Nomi 的审批记录是从**本地文件**读回来重建的，文件能改就等于审批能伪造，而 Nomi 的工具真的会花钱。

**流协议**：SSE，每行 `data: {json}`，权威 chunk 清单在 `UIMessageChunk`（`:1999-2118`，**比文档页全**——文档页漏了 `tool-input-error` / `tool-output-error` / `tool-output-denied` / `message-metadata`）。

**delta 归并的两套 key（最容易搞错的地方）**：文本/思考按 **`id`** 归并（`text-start{id}` → 多个 `text-delta{id}` → `text-end{id}`，可并发交错）；工具按 **`toolCallId`** 归并，与 `id` 无关。

**usage 形状 v6 改了**（`:266-324`）：

```ts
inputTokens | undefined
inputTokenDetails:  { noCacheTokens, cacheReadTokens, cacheWriteTokens }
outputTokens | undefined
outputTokenDetails: { textTokens, reasoningTokens }
totalTokens | undefined
raw?: JSONObject   // 供应商原始报文，不归一
```
**每个字段都是 `| undefined`——供应商没报就是没有，不许当 0 记账。**（Nomi 的 `run.mts:12-15` 注释是同一条纪律。）`cacheWriteTokens` 单列，因为 Anthropic 那种「写缓存比读贵、也比未缓存贵」的计价只有分开才算得对。拿得到的层：**每 step** `StepResult.usage`（多步循环下只有这层能分摊到「哪一轮烧的钱」）、每次调用 `result.totalUsage`。协议里**没有专门的 usage chunk**——花费搭 `messageMetadata` 的车走。

**持久化**：`toUIMessageStreamResponse({ originalMessages, onFinish })`，`originalMessages` 一传就进入持久化模式（SDK 分配稳定 message ID，并判断是「续写最后一条 assistant」还是「新开一条」）。**读回来必须 `validateUIMessages({ messages, tools, ... })`**——旧存档里的 tool part 会跟今天的 tool schema 对不上，文档专门给了 `TypeValidationError` 的兜底段。

**多步循环**：`stopWhen`，条件有 `stepCountIs(n)` / `isLoopFinished()` / `hasToolCall(name)`（`:1047-1052`）。默认值不同：`generateText`/`streamText` 默认 `stepCountIs(1)`（**默认不循环**），`ToolLoopAgent` 默认 `stepCountIs(20)`。

⚠️ **v7 已把 `needsApproval` 挪到调用侧**（`streamText({ toolApproval: { getWeather: 'user-approval' } })`）。**抄状态机形状可以，抄 API 名会踩空**。

### 5B. MCP 规范 `2026-07-28` —— 这一版拆掉了会话

**版本事实**：modelcontextprotocol.io 当前 latest 是 **`2026-07-28`**，schema 取自 `schema/2026-07-28/schema.ts`（该路径最新 commit `271ecc9a`）。**这一版是破坏性改动最大的一版**，三件事大概率和印象不同：**协议级 session 没了**、**sampling 被弃用了**、**服务器不再能主动发请求**。

**① `ToolAnnotations` 四个 hint 与它们的默认值**（`schema.ts:1912-1953`）——这是「要不要弹审批」的核心：

| hint | 语义 | **默认值** |
|---|---|---|
| `readOnlyHint` | true = 不修改环境 | **`false`** |
| `destructiveHint` | true = 可能破坏性更新（仅在 `readOnlyHint == false` 时有意义） | **`true`** |
| `idempotentHint` | true = 同参重复调用无额外影响（同上） | **`false`** |
| `openWorldHint` | true = 与开放世界外部实体交互 | **`true`** |

**默认值方向是刻意的**：什么 annotation 都不写的工具，语义上等于「会改环境、可能破坏性、不幂等、会碰外部世界」。**默认不安全**。

**但规范同时两处明说 hint 不可信**（`schema.ts:1903-1910` 与 tools 页 Warning）：客户端 **MUST** 把 tool annotations 视为不可信，除非来自可信服务器。**所以 hint 只能单向收紧、不能放松**：`destructiveHint: true` → 一定弹审批；`readOnlyHint: true` → **不足以**免审批。

**② `isError` 的分界线是「模型能不能自我纠正」**（`schema.ts:1823-1836` + tools 页 Error Handling）：

| | 协议错误（JSON-RPC `error`） | 工具执行错误（`isError: true`） |
|---|---|---|
| 什么情况 | 工具不存在、请求不合法、服务器故障 | API 失败、输入校验失败、业务逻辑错误 |
| 判据 | **模型不太可能靠自己修好** | **模型能据此自我纠正并重试** |
| 客户端 | MAY 提供给模型 | **SHOULD** 提供给模型 |

schema 注释原文说：错误若源自工具本身，SHOULD 报在 result 里 `isError: true` 而**不是**协议级错误，「否则 LLM 看不到出错了、也无法自我纠正」。

`CallToolResult` = `content: ContentBlock[]` + `structuredContent?` + `isError?`。content 块类型 `text` / `image` / `audio` / `resource_link` / `resource`，都可带 `annotations`（`audience: ["user"] | ["assistant"]` —— **现成的「这块给人看 / 这块给模型看」分流位**）。

**③ elicitation（服务器向用户要结构化输入）—— 形状变了**：不再是服务器发起的独立请求，而是在 `tools/call` 响应里返回 `InputRequiredResult`（`resultType: "input_required"`），客户端收集完输入后**用一个新的 JSON-RPC id 重发原请求**（这套叫 MRTR / SEP-2322）。两种 mode：

- **`form`**（默认）：`requestedSchema` 被**刻意限死在扁平对象 + 原始类型**（string 支持 email/uri/date/date-time 四种 format、number/integer、boolean、enum），**不支持嵌套、对象数组**——为的是客户端能可靠地自动生成表单。
- **`url`**：把用户导向外部页面，**数据不经过 MCP 客户端**。

**「不许要密码」的逐字措辞**：
> 服务器 **MUST NOT** 使用 form mode elicitation 请求敏感信息，例如密码、API key、access token 或支付凭据；服务器 **MUST** 对涉及此类敏感信息的交互使用 **URL mode**。

规范还澄清了边界：「敏感信息」指**授予访问权或授权交易的秘密与凭据**；姓名、邮箱、用户名等一般档案信息不属于绝对禁止。

**三种响应动作**：`accept`（明确批准并提交；**url 模式下 accept 只表示同意去交互，不代表交互完成**）/ `decline`（明确拒绝）/ `cancel`（没做选择就关掉了）。服务器 **MUST** 处理拒绝与取消，不许假设 elicitation 总会成功。URL 模式的客户端硬要求包括：**MUST NOT** 自动预取该 URL、**MUST** 展示完整 URL 供检查、**MUST** 用客户端和 LLM 都无法窥探的方式打开。

> **这条直接落到 2026-09-05 的拍板「MCP 密钥走 elicitation URL」上**：那不只是个偏好，是规范 **MUST** 级别的要求——用 form mode 要 API key 是违规的。

**④ sampling 已弃用**（SEP-2577）。规范页顶逐字：自 `2026-07-28` 起弃用，**新实现 SHOULD NOT 采用**，现有实现 SHOULD 迁移到直接对接 LLM provider API。人类审批的措辞仍在：SHOULD 始终有 human in the loop；**允许用户在发送前查看和编辑 prompt**；**在交付前呈现生成的响应供审阅**。序列图把审批点画得很密——**每一次跨越信任边界都是一个审批点，不是整轮一个**。

**⑤ 传输与会话恢复 —— 本版直接删掉了**。逐字：

> **「Resumable SSE streams via `Last-Event-ID` are not supported.」**

`Mcp-Session-Id` 头、GET 常驻 SSE 流、服务器在 SSE 上发 JSON-RPC 请求、`Last-Event-ID` 恢复——**「本修订中这些机制一个都没有」**。替代思路写在 tools 页的 **Stateful Tools**（非规范性指导）：MCP 没有协议级 session，**要跨调用保持状态就从创建工具返回一个显式 handle，后续调用把它当普通参数传回来**。设计 handle 的纪律：每次调用都验授权（handle 是名字不是凭证）；用**不透明** id；在 description 里写明保留期；**过期 handle 返回工具执行错误而非协议错误**，让模型自己重建。

stdio（Nomi 的场景）要点：newline 分隔，消息内 **MUST NOT** 含嵌入换行；服务器 **MUST NOT** 往 stdout 写任何非 MCP 消息；客户端 **SHOULD NOT** 把 stderr 当错误信号；服务器 SHOULD 在 stdin EOF 时立刻退出（**唯一可移植的优雅关闭信号**）。

### 5D. ⚠️ 一条「别误判成 bug」的核实（D3）

读到这里很容易得出「Nomi 的 MCP 落后了一个 spec 版本」的结论。**核实过，不成立——那是明写的选择。**

- `electron/capabilityCore/mcpProtocol.ts:84` `PROTOCOL_VERSION = '2025-11-25'`；`:87` 支持列表 `['2025-11-25','2025-06-18','2025-03-26','2024-11-05']`。
- `electron/capabilityCore/mcpElicitation.ts:14-16` 的注释**已经写明了 2026-07-28 的差异**：「2026-07-28 把同样两种 mode 挪到多轮往返的 `InputRequiredResult` 信封上并去掉了 `elicitationId`。Nomi 把 2025-11-25 当作自己支持的最高版本……所以本文件说的是 2025-11-25 的形状。」
- 而 URL-mode 的**理由**也写在 `electron/integrationCertification/credentialElicitation.ts:6-8`，直接引了规范原文：「Servers MUST NOT use form mode elicitation to request sensitive information such as passwords, API keys」。

**所以真正的行动项不是「快去升版本」，而是**：`2026-07-28` 删掉了协议级 session（`Mcp-Session-Id`、`Last-Event-ID` 恢复全没了），改用「创建工具返回不透明 handle」。Nomi 的 MCP 侧有 session/lease 语义（`nomi_*` 的 run id / shot id 就是 handle），**升版本时这条是形状变更而不只是版本号变更**——要提前知道，而不是升到一半才发现。

### 5C. 对 Nomi 的启发（一句话）

**AI SDK 教的是「渲染用的数组就是持久化用的数组，且非法状态在编译期不可表达」；MCP 教的是「工具的行为提示只能用来收紧审批、绝不能用来免除审批，且 handle 过期要报成工具错误好让模型自己重建」。**

### 出处

- `ai@6.0.277` npm tarball → `package/dist/index.d.ts`（`UIMessage` :1590-1614、`UIMessagePart` :1615、tool 七态 :1725-1816、`UIMessageChunk` :1999-2118、usage :266-324、`stopWhen` :1047-1052、approval secret :1470/2833/3373、签名 :737-752、`addToolApprovalResponse` :3720-3736）
- `@ai-sdk/provider-utils@4.0.50` → `dist/index.d.ts:1176`（`needsApproval`）
- `npm view ai dist-tags` → `latest 7.0.93` / `ai-v6 6.0.277`（2026-09-06）
- AI SDK v6 文档（git tag `ai@6.0.277`, commit `0ef8ccec`）：`content/docs/03-ai-sdk-core/15-tools-and-tool-calling.mdx:108-245`、`04-ai-sdk-ui/03-chatbot-tool-usage.mdx:380-530`、`03-chatbot-message-persistence.mdx:95-320`、`03-chatbot-resume-streams.mdx`、`50-stream-protocol.mdx:113,414-421`、`25-message-metadata.mdx:40-80`
- https://modelcontextprotocol.io/specification/ （当前 latest = `2026-07-28`）
- `schema/2026-07-28/schema.ts`（commit `271ecc9a`）：`ToolAnnotations` :1903-1953、`Tool` :1912+、`CallToolResult` :1809-1838、`Resource` :1441-1471、`Prompt` :1659-1671
- https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation
- https://modelcontextprotocol.io/specification/2026-07-28/client/sampling
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- ⚠️ **文档页不完整之处（以 schema/.d.ts 为准）**：MCP tools 页正文没有逐条列 hint 语义与默认值（取自 `schema.ts` 类型注释）；AI SDK v6 `stream-protocol` 页只记了 12 个 chunk，漏了 4 个。

---

## 6. 创作类内嵌 Agent —— 唯一和 Nomi 共享「产出要等、产出要花钱」的一类

> 这一类和前面几家的根本差别：**编码 agent 的工具调用是免费且瞬时的，创作 agent 的工具调用要等 30 秒并且真扣钱。** 所以「等待怎么表现」「花费怎么说清」「停止到底停没停」这三件事，只有在这一类里才有参照。

### 6.1 MiniMax Design（本机真实操作实测）

> **引用自既有调研**，不重做：`docs/research/2026-09-06-minimax-design-agent-usage/README.md`（70 行，60 张截图在同目录 `shots/`）。这是三家里唯一有一手操作证据的——**不是文档转述，是 Computer Use 真机走完流程**。

- **转录**：单条时间线「用户消息 → Agent 文字 → **任务卡** → 结果附件」。任务卡上钉着模型、参数、状态（`:13`「任务卡显示『生成 1 张图片』、GPT Image 2、16:9、2k」）。产出物**双落点**：既落画布，又以文件名回到对话。工具调用有前置状态文本（`:37`「先显示『读取了 1 个文件』『在画布上定位』，再生成」）。
- **⚠️ 分镜只是对话里的 Markdown 文本，不是结构化实体**（`:9`「结果都在对话流，非结构化分镜实体」），卡点是「不能直接编辑分镜」。**这正好印证 Nomi 那条「分镜表 = 画布节点的表格表示版」的判断是对的方向。**
- **模型选择**：点「模型」打开的是**按媒体类型的多选允许列表**（不是单一默认下拉）——视频 / 图片 / 音频各一组（`:49`）。技能库 = 搜索框 + 12 个分类标签 + 列表卡，每项带**斜杠命令**（`:51`）。
- **审批**：**没有花钱审批卡**。参数缺失时用**对话追问**代替确认卡（生成图前问画幅、生成视频前确认时长、删镜头前问「改脚本、剪视频还是两者」）。但**换模型重生成完全无确认、无价格卡**（`:17`）。
- **⚠️「停止」是假的**（`:33`）：视频生成中点停止，「任务后来仍完成并留下 MP4，只证明停止没有阻止已提交任务完成，不能证明后端取消」。文本停止会留痕但**无恢复入口**（`:45`）。**无撤销**（`:29`）。
- **⚠️ 花费全程不可见**：4 次生成任务一次都没显示费用；调研作者的纪律值得点名——`:5`「对话没有返回实际计费金额，故费用写『未知』，**绝不写成 0**」。模型列表里「规格/促销标签可见，价格数字不可见」（`:49`）。
- **失败很弱**：`:25` 返回「运行时连接异常 / 会话运行状态异常，请重试」+ 重试按钮，「错误可理解但缺原因/恢复信息」。视频产出物**无法就地预览**（`:21`）。

**对 Nomi 的启发**：任务卡把「模型 + 参数 + 状态 + 结果」四件事钉在同一张卡上，直接抄；但它的三个洞（**花费不可见、停止不真停、无撤销**）恰好全落在 Nomi 已经有真实花费、有 `productionRun` 预算账本与审批回执的地方——**这是结构上能一次拉开差距的位置**。

### 6.2 Figma Make + Figma Design Agent（官方 help / blog）

Figma 有**两条形态相反**的内嵌 Agent，对 Nomi 都有参照：

- **Figma Make = 聊天 + 预览两栏**；干活时**聊天里长出实时待办清单**（原文：as it works, a to-do list may appear in the chat, tracking the steps in real time）。
- **Design Agent 反过来——进度指示器长在画布上**：每个运行中的 prompt 在画布上显示一个动画指示器，**点开才是聊天窗**（显示正在做什么、已完成的步骤、结果）。并发任务用蓝色状态气泡展示。**即：画布是主视图，聊天是可展开的详情抽屉。**
- **可扩展三层**：**Custom Tools**（让 agent 自己造可复用插件）、**Skills**（把常用 prompt 变成可复用的**斜杠命令**）、**MCP connectors**（把 GitHub / Atlassian / Slack 的上下文接进来，**并能回写**）。
- **审批**：**没有生成前确认关卡**。但**中断和撤销都是一等公民**：Stop 结束当前任务；**Undo 把 Agent 的改动接进了原生 undo 栈**（聊天里的 Undo 和 Cmd/Ctrl+Z 等价）。
- **⚡ 改主意走队列，不走停止**：Agent 干活时可以继续输入 prompt 排队，**排队的消息可重排、可编辑、可删**。这比「停止」更符合真实创作节奏。
- **会话**：走 Figma 通用版本历史，可 Restore，且**恢复是加一个版本而不是毁掉后面的**（all versions remain available）。另有一个很实用的开关：**主动清空聊天上下文**（resets the AI's memory for the current file）。
- **花费**：统一 AI credits（Starter 500/月、Professional 3000、Organization 3500、Enterprise 4250）。**官方明确承认给不出事前预估**：「Because the AI determines what actions it needs to perform, we can't predict exactly how many credits it will use.」改用**量级示例**代替精确报价（加交互 ~75+ credits、从零生成 app ~100+ credits）。耗尽是**硬阻断**。
- **失败三段式**：错误 → 原因 → 修复动作。例：「Rate limit exceeded.」→ 「**This error isn't related to usage limits.** Wait for a short time and then try again.」——**特意撇清和额度无关**，避免用户误判成没钱了。

**对 Nomi 的启发**：两点直接可抄——**① 把 Agent 改动接进原生 undo 栈**（Nomi 画布已有 Cmd+Z，Agent 建节点应当整批一个 Cmd+Z）；**② 用「可重排/可编辑/可删的 prompt 队列」代替「停止」**——创作者真正想要的不是中断，是插队和改主意。（这和 §1.6 pi 的 steering / follow-up 是同一件事的两种表达。）

### 6.3 Adobe Firefly —— **唯一把「花钱」做完整的一家**

> 注：不存在名为 "Project Moonlight" / "Photoshop AI Assistant" 的官方 help 页面——**未查到**；现役官方 agentic 产品名是 **Firefly AI Assistant (beta)**。

- **转录**：两套并存。**Boards**（自由画布）——生成结果先进**胶片条缩略图候选带**，「allowing you to select and add them to the canvas」，**用户挑了才拖上画布，产出物不自动污染画布**。**AI Assistant**（聊天面板）——左栏留会话历史，且**显式展示计划步骤**（interpret your request, break it into steps, and select the appropriate tools）。
- **工具契约三家里最明确**：跨 App 取能力并点名工具（Blur background、Auto tone、Vectorize、Generate image、Transcode video、Generative expand…）。有技能层且**显隐双调用**（可以显式打 `/batch-edit-photos`，也可以隐式触发）。但**用户不能自建技能**（Creating custom skills is not currently supported）。
- **⚡ 花费四段式，这是本节最值钱的一条**：
  1. **事前报价**：固定成本节点「Graph knows what that costs and shows you the cost before you run it」；
  2. **报不准就显式标注**：变动成本节点在运行控件上显示 **"Credits vary"** 标签，而不是留空；点「运行」本身即是授权；
  3. **失败自动退款**：「Credits are deducted up front... On an unsuccessful generation, credits are typically refunded... within minutes」；
  4. **耗尽后降级排队而非硬阻断**：Premium 用户额度用尽后视频生成「are queued and processed in the background with an unspecified completion time」，最多排 20 条。
- **明码标价的量级差**值得记住：Firefly Image 4 Ultra 20 credits/次、Image 5 10 credits/次、多数标准功能 1 credit；**视频 1080p@24fps = 100 credits/秒**（720p 50/秒、540p 20/秒）。**一条 5 秒 1080p 视频 ≈ 500 credits ≈ 50 张 Image 5。** 这个量级差正是「为什么视频必须有审批卡而图片可以放行」的定量依据。
- **回到某一步**：生成历史自动保存且与项目解耦；**Load 能把原始 prompt 与参数带回输入框**（prompt、画幅、模型），改一项再生成——**这就是「分支」的轻量实现**。另有 Vary（More like this / Keep style / Keep subject / Custom vary）做受控变体。
- **进行中的具体视觉（骨架屏/进度条）在 help 页面里没有描述 —— 未查到。** 失败是通用文案 + 自助重试，无自动重试。

**对 Nomi 的启发**：抄它的**花费四段式**；另一条更便宜的改进：**产出物先进「候选带」、用户挑了才落画布**，避免 Agent 一次生成把画布搞乱。

### 6.4 附：ComfyUI（开源，唯一能读到源码级事件契约的近邻）

不是 Agent 产品，但它是**节点画布 + 生成队列**，和 Nomi 结构最像，而且能读源码。抓自 `github.com/comfyanonymous/ComfyUI` master（2026-09-06）：

- **事件是有名字的枚举，不是自由文本**：`execution_start` / `execution_cached` / `executing` / `executed` / `execution_error` / `execution_interrupted` / `execution_success`（`execution.py:436,496,536,578,699,742,770,824`）。
- **失败事件带完整现场**，不是一句「出错了」：`exception_message` / `exception_type` / `traceback` / `current_inputs` / `current_outputs` / `node_id` / `node_type` / `executed`（已完成节点列表）（`execution.py:701-712`）。
- **⚡ 中断和失败是两种事件**：`InterruptProcessingException` 走 `execution_interrupted`，其余走 `execution_error`（`execution.py:692-712`）——**用户主动停 ≠ 系统炸了，UI 该分开显示。**（Nomi 的 `agentPanelV4Projection.ts:121-135` 注释里为 `stopped` 落在哪个态纠结过，理由完全同源：「硬塞进 `output-denied` 会让行尾写『已拒绝』——那是在替用户承认一个他没做过的决定」。）
- **进度是「整张图的状态快照」而非增量**：`progress_state` 一次带上 `{prompt_id, nodes: {node_id: {state, value, max}}}`，`state` 枚举 `pending|running|finished|error`（`comfy_execution/progress.py:16-29,183-184`）——**断线重连后不用重放历史即可复原全图状态。**
- **中间预览图带 node_id 回传**，落到正确的节点上（`comfy_execution/progress.py:208-229`）。
- **⚡「取消」分两件事**：`POST /queue {delete:[id]}` 只删**未开始**的（`server.py:1146-1157`），`POST /interrupt` 才打断**运行中**的（`server.py:1160+`）。官方文档同样点破：「This endpoint only affects pending jobs. To cancel running jobs, use /api/interrupt.」

**对 Nomi 的启发**：这条正好补上 MiniMax 那个「停止没真停」的坑——**队列取消和运行中断必须是两个动作、两种事件**，UI 上也该说清用户按的那一下取消了哪一类。

### 6.5 一页横向对照

| 维度 | MiniMax Design（实测） | Figma（官方文档） | Adobe Firefly（官方文档） |
|---|---|---|---|
| 主视图 | 对话流，产出物双落点（画布+对话） | Make：聊天+预览两栏；Agent：**画布为主**，聊天是抽屉 | Boards：画布+**候选胶片条**；Assistant：聊天 |
| 步骤可见 | 任务卡（模型/参数/状态） | **实时待办清单** + 画布状态气泡 | 显式「拆步骤→选工具」叙述 |
| 工具清单 | 未公开（只有模型允许列表 + 斜杠技能库） | Custom Tools + Skills(斜杠) + **MCP 连接器** | 点名工具列表 + Skills(斜杠，**不可自建**) |
| **事前报价** | **无** | **明确做不到**，给量级示例 | **有**；报不准就标 "Credits vary" |
| **失败退款** | 未见 | 未说明 | **有，分钟级自动退** |
| 额度耗尽 | 未触发 | **硬阻断** | **降级后台排队（上限 20 条）** |
| **停止** | 有按钮但**后端仍跑完** | Stop 有效 + **原生 Undo** | 未文档化 |
| **改主意** | 只能停 | **prompt 队列可重排/编辑/删** | 未文档化 |
| 回到某一步 | 无（对话与实体脱节） | **版本历史 Restore（不毁后续）** | **生成历史 Load 带回参数改一项重生成** |
| 失败信息 | 「连接异常，请重试」，缺原因 | **错误→原因→修复动作**三段式 | 通用文案 + 自助重试 |

### 6.6 对 Nomi 的启发（一句话）

**这一类产品普遍在「花钱」和「停止」这两件事上做得很差——而这两件恰好是 Nomi 已经有底子（预算账本、审批回执、effect class 词表）的地方，是能一次拉开差距的位置。**

### 出处

- **MiniMax Design**：`docs/research/2026-09-06-minimax-design-agent-usage/README.md`（行号如正文；截图 60 张在同目录 `shots/`）。该文件自述边界：`:5` 账户/额度区域已遮盖；`:51` 工作模式档位、hover 预览、语音输入均「未验证」。
- **Figma**：https://help.figma.com/hc/en-us/articles/31304412302231-Explore-Figma-Make · /31304485164695-Create-and-edit-a-Figma-Make-file · /37998629035799-Work-with-the-Figma-agent-in-design-files · /33459875669015-How-AI-credits-work · /31304610458647-Troubleshoot-in-Figma-Make · https://developers.figma.com/docs/code/intro-to-figma-make/ · https://www.figma.com/blog/the-figma-agent-is-here/ · https://www.figma.com/blog/agent-custom-tools-context-skills/
  - ⚠️ help.figma.com 页面**不显示发布日期**，时效性只能靠博客侧证。
- **Adobe Firefly**：https://helpx.adobe.com/creative-cloud/apps/generative-ai/generative-credits-faq.html · https://helpx.adobe.com/firefly/web/get-started/learn-the-basics/generative-credits-overview.html · /firefly-ai-assistant/firefly-ai-assistant-overview.html · /firefly-ai-assistant/ai-assistant-faq.html · /create-mood-boards/firefly-boards/create-mood-boards.html · /generate-image-variations.html · /work-with-audio-and-video/work-with-video/about-generate-video.html · /access-your-files/view-generation-history.html
  - ⚠️ **未查到**：名为 "Project Moonlight" / "Photoshop AI Assistant" 的官方 help 页面（现役名是 Firefly AI Assistant (beta)）；进行中状态的具体视觉描述。
- **ComfyUI**（master，2026-09-06）：https://raw.githubusercontent.com/comfyanonymous/ComfyUI/master/execution.py · /server.py · /comfy_execution/progress.py · https://docs.comfy.org/development/comfyui-server/comms_routes · https://docs.comfy.org/api-reference/cloud/job/manage-queue-operations
- 旧调研（**标注为旧**，本次未复核）：`docs/research/2026-06-27-lovart-element-decomposition-research.md`

---

## 7. 三方会师：Nomi 现状 × pi 提供 × 行业做法

> 本节的 Nomi 事实**全部现读现证**（基线 `origin/main@9bac3b373`，读取日 2026-09-06），路径为仓库相对路径。
> 与并行的 `docs/agent-architecture-review-20260906` 有**三处结论不同**，本节按现读代码为准，并逐处标注（见 §7.1 的 ⚑）。

### 7.1 Nomi 现状（带 file:line）

**① 接缝形状：中立契约层只有 6 种事件、结果里没有顺序**

- `electron/harness/runtime/runtimePort.ts:74-80` —— `RuntimeActivityEvent` 六种：`content-delta` / `tool-call` / `tool-result` / `tool-error` / `step-finish` / `warning`。**没有 reasoning 事件，没有 contentIndex（段序号），工具参数没有流式分片。**
- `electron/harness/runtime/runtimePort.ts:122-133` —— `RuntimeTurnResult` 是 `text: string` + `toolCalls: RuntimeToolCallRecord[]`。**pi 那条逐 token 携带 `contentIndex` 的有序段流（§1.1），在这里被压成两堆。**
- `src/workbench/ai/v4/agentPanelV4Projection.ts:261-265` —— 时间线排序键是 `createdAt` + 宿主数组插入序做同毫秒 tiebreak。注释自陈：宿主数组顺序「就是真实发生的顺序」。**所以顺序信息在宿主侧是有的**，问题在于同一回合里助手文本 item 与工具 item 的 `createdAt` 分别是回合开始与回合结束。

**② 工具契约：清单是一等的，校验用 Zod，但 JSON Schema 只是投影**

- `electron/harness/tools/agentToolCatalog.ts:35-43` —— 六组工具（document / canvas / timeline / production / skills / generation），注释明写**数组顺序是 prompt / KV-cache 合同的一部分**（这条纪律行业里少见，是好设计）。
- `electron/harness/runtime/pi/tools.mts:43-50` / `:74` / `:56-57` —— `zodToJsonSchema` 生成给模型看的 `parameters`；真正校验在 `beforeToolCall` 里对**原始 JSON** 跑 `schema.parseAsync`，执行时丢弃 pi 传来的 rawArgs（`void rawArgs`）。理由写在注释里：pi 自己的 validator 会 coerce 数字与 optional null。
- `electron/harness/tools/modelToolSurfaceManifest.ts:237-239` —— 三个 transition（`nomi_request_generation_gate` / `nomi_start_generation` / `nomi_decide_generation_gate`）**只允许宿主发起，模型不可调**。

**③ 审批：已实现，而且是三轴 —— ⚑ 这与架构总评审给人的印象不同**

- `electron/shared/projectAgentContracts.ts:31-35` —— 工作姿态 `PROJECT_AGENT_WORK_MODES = ["ask","editSelection","agent"]`。
- `electron/shared/projectAgentContracts.ts:48-52` —— 审批档 `["step","safe-auto","project"]` × 花费策略 `["confirm","within-budget"]`，默认 `{mode:'safe-auto', spend:'confirm'}`（`:59-63`）。注释明写两轴**故意独立**，且这只是「用户选择的快照，不是授权」，域/ProductionRun 闸仍是权威。
- `electron/shared/agentCapabilities/capabilityContract.ts:4` `CapabilityEffect = "read" | "reversible_write" | "destructive" | "paid"`；`:9` `CAPABILITY_EFFECT_CLASSES = ["reversible_local","spend","irreversible"]`（宿主审批边界用的闭合词表）。
- `electron/projectAgentHost/projectAgentExecutionPolicy.ts:40-63` —— `ask` 只放行 `effect === "read"`，**未知别名 fail-closed**；`:78-89` —— `step` 永不复用批准；只有 `reversible_local` 可复用；带 `requiresPlanReview` 的能力每次执行至少问一次。
- `electron/harness/runtime/runtimePort.ts:31` —— `approvalScope?: 'once' | 'session' | 'always'`。
- `src/workbench/ai/v4/agentPanelV4Types.ts:30-38` —— UI 介入槽 8 种：`approval-irreversible` / `approval-reversible` / `reject-reason` / `spend` / `question` / `plan` / `credential` / `deviation`。
- `electron/projectAgentHost/projectAgentApprovalHelpers.ts:10-24` —— `reprepareEffectiveCall`：**用户在审批卡上改了参数就重新 prepare**（对应 Claude Code 的 `updatedInput`，我们已经有了）。

**④ 会话与恢复：有续、没有分叉**

- `electron/projectAgentHost/projectAgentRepository.ts:350-358` —— 宿主转录落在 `<settingsRoot>/project-agent-host/<partitionKey>/`：`snapshot-v1.json` + `.backup.json` + `commands-v1.jsonl`（目录 0o700 / 文件 0o600）。命令账本 append-only，每条 checksum 链式挂前一条（`electron/projectAgentHost/projectAgentCommandLedger.ts:39-44, 79-80`）。
- `electron/harness/context/contextPaths.ts:20` —— pi 工作上下文另存 `<projectRoot>/.nomi/agent-thread-context-v1.json`。信封 `electron/harness/runtime/pi/snapshot.mts:10-24`（`{format:'nomi.pi-work-context', version:1, piVersion:'0.84.3', data:{header, entries, leafId}, sha256}`）；entry 九种类型 schema 在 `electron/harness/runtime/pi/snapshotSchema.mts:40-50`。
- `electron/harness/runtime/pi/run.mts:67` —— **每个回合起一个全新 pi session**（注释：「A turn owns one fresh SDK session」），靠 `:95-96` import 上一回合导出的快照续上。
- `electron/harness/context/contextService.ts:19-25` —— 服务面只有 `ensure / inspect / alive / clear / run`。**没有 resume / fork / rewind 对外 API**；`SessionManager.branch()` 只在 import 时用来还原 leaf 指针（`electron/harness/runtime/pi/snapshot.mts:84`）。
- 压缩交给 pi：`electron/ai/agentChatV2.ts:169` 恒 `{ enabled: true }`，**`reserveTokens` / `keepRecentTokens` 从不设值**（用 pi 默认 16384 / 20000，见 §1.5）。

**⑤ 上下文与花费：链路完整，但金额被一行零价目表堵死**

- `electron/harness/runtime/runtimePort.ts:41-60` —— `RuntimeUsage` 含 `promptTokens` / `completionTokens` / `cachedPromptTokens` / `totalTokens` / `reasoningTokens?` / `costUsd?`。累加在 `electron/harness/runtime/pi/run.mts:169-182`，注释明写不做 `?? 0`（「`?? 0` 会把『不知道』印成 0」）——**这条诚实纪律比行业里多数做法好。**
- ⚑ **但金额恒空**：`electron/harness/runtime/pi/model.mts:72` 把价目硬编码成 `cost: {input:0, output:0, cacheRead:0, cacheWrite:0}`，`electron/harness/runtime/pi/run.mts:25` 又只在 `total > 0` 时保留 `costUsd`。两条合起来 ⇒ 内嵌 Agent 的 `costUsd` **在生产里永远 undefined**。
- ⚑ **上下文环是有的**（架构评审说「面板画不出百分比」，现读代码不成立）：`src/workbench/ai/v4/agentPanelV4Projection.ts:432-459` 按本线程汇总，`used` 取**末次回合的 promptTokens 而非累加**（`:429-431` 注释解释累加会画出 300% 的环）；缺 `max` 时 `contextPercent` 返回 `undefined`（`:412-415`）。接线 `src/workbench/ai/v4/useAgentPanelV4Data.ts:338-343`。

**⑥ UI 呈现：v4 已在生产，词表已经和行业标准对齐**

- `src/workbench/ai/ProjectAgentResidentShell.tsx`（406 行）只做接线；v4 目录最大文件 `AgentPanelV4Composer.tsx`（471 行），**无巨壳**。
- ⚑ `src/workbench/ai/v4/agentPanelV4Projection.ts:121-135` —— `toolStatusOf` 的七态是 `output-available` / `output-denied` / `output-error` / `approval-requested` / `approval-responded` / `input-available`，**与 Vercel AI SDK 6 的 `ToolPart["state"]` 逐字相同**（见 §5 与 `docs/research/2026-09-06-ai-elements-anatomy.md`）。注释还明写 `input-streaming` **刻意不用**，理由是「渲染一个永远不出现的状态等于在词表里留一个谎」。**这是本次对照里 Nomi 领先的一处。**
- `src/workbench/ai/v4/AgentPanelV4Receipt.tsx:31` / `:58-64` —— 工具收据折叠用原生 `<details>`，**没有正文就不画展开箭头**。失败留在原行不弹窗（`:6-7`、`:14-18`）；整回合级失败走独立错误条。
- `src/workbench/ai/v4/agentPanelV4PendingTools.ts:1-14` —— 「活的工具调用」是渲染层第二真相（模块级 Map + `useSyncExternalStore`），因为宿主状态里没有运行中的工具记录。

**⑦ 可观测性：⚑ 旧结论「无统一落盘日志」已不成立，但 Agent 基本没接**

- `electron/logging/logger.ts:170-227` —— `logInfo` / `logWarn` / `logError` / `logVendorCall` / `installMainLogger`；`LogScope` 是闭合枚举（`:36-58`，含 `"agent"` 与 `"mcp"`），字段只收标量（`:64`）。落盘 `electron/logging/logFiles.ts`：按天 `nomi-YYYY-MM-DD.log`（`:50-52`）、4MB 滚一代（`:21`、`:58-60`）、保留 7 天（`:24`）。脱敏层 `electron/logging/redact.ts:42-123`。
- **但全仓只有 3 处 `scope="agent"` 的调用**，且全是 warn/error：`electron/projectAgentHost/projectAgentExecutionCoordinator.ts:112`、`electron/experience/projectAgentExperience.ts:95` 与 `:98`（另有 `electron/harness/context/agentContextHost.ts:39`）。**正常路径（回合开始/工具调用/审批决定）一条 INFO 轨迹都没有。**

**⑧ pi 运行时边界：同进程嵌 SDK，而且把 pi 的工具面整个关掉了**

- `electron/harness/runtime/pi/nativeLoader.cts:4-10` —— 唯一加载点，CJS 里保留动态 `import('./run.mjs')`，「只有真正用 Agent 才加载 pi」。版本锁死 `0.84.3`（`package.json:193-195`）。
- `electron/harness/runtime/pi/session.mts:31-38` —— 明确关掉的 pi 能力：**`noTools: 'all'`（pi 自带的 bash/read/write/edit 全禁）**、`enableSkillCommands:false`、`thinkingLevel:'off'`、`retry.enabled:false` + `maxRetries:0`、`images.autoResize:false`、遥测两项；`:45` `toolExecution = 'sequential'`（pi 默认是并行）。
- `electron/harness/runtime/pi/resources.mts:13-27` —— ResourceLoader 整体掏空，注释（`:3-12`）写明理由：不让 cwd/agentDir 变成指令或可执行资源来源。**这是正当分歧，不是欠账**（对照 §1.3 pi 的 project trust 只管加载、不管工具）。
- `electron/harness/runtime/pi/model.mts:65-66` —— ModelRuntime 断网（`allowModelNetwork:false, modelsPath:null`）。
- Nomi 自建、pi 没有的护栏：流超时（`electron/harness/runtime/pi/observeStream.mts:31-121`，首包 90s / 空闲 120s）、步数硬闸三档 1/8/24（`electron/harness/runtime/runtimePort.ts:95`）、错误事实提取器（`electron/harness/runtime/pi/errorFacts.mts`）。

### 7.2 一眼看懂的三方对照表

「⚫ 有且好」「🟡 有但残」「⭕ 没有」。

| 能力 | Nomi 现在 | pi 直接提供 | 行业（Claude Code / Codex / Cline / AI SDK） |
|---|---|---|---|
| **有序段流（先说什么后做什么）** | ⭕ 接缝压成 `text` + `toolCalls[]`（`runtimePort.ts:122-133`） | ⚫ `contentIndex` 逐 token 携带（§1.1） | ⚫ 全员标配：Claude 的 block 顺序规则、AI SDK 的 `UIMessage.parts` |
| **工具七态词表** | ⚫ 与 AI SDK 6 逐字相同（`agentPanelV4Projection.ts:121-135`） | 🟡 只有 start/update/end | ⚫ AI SDK 6 定义了这套 |
| **审批三轴（姿态 × 档位 × 花费）** | ⚫ 三轴独立，effect class 闭合词表 fail-closed | ⭕ **pi 明确不做审批**（§1.3） | 🟡 Claude Code 六模式 + 三级规则，但**花费不是独立轴** |
| **「谁都批不动」的清单** | 🟡 用「不投影给模型」实现（`modelToolSurfaceManifest.ts:237-239`） | ⭕ | ⚫ Claude Code 有独立一节 |
| **审批时改参数再放行** | ⚫ `reprepareEffectiveCall` | ⭕ | ⚫ Claude Code `updatedInput` |
| **会话落盘 + 可回看** | ⚫ 两套（宿主账本 + pi 快照），带 sha256 与命令链 | ⚫ JSONL 树 | ⚫ 全员 JSONL |
| **分支 / fork / 回到某一步** | ⭕ 无对外 API（`contextService.ts:19-25`） | ⚫ `/tree` 同文件分支 + `branch_summary`；`/fork` 新文件 | 🟡 Claude Code 只有 fork；pi 的树更强 |
| **压缩** | ⚫ 用 pi 的，但两个旋钮从不设值（`agentChatV2.ts:169`） | ⚫ 两旋钮 + 结构化摘要模板 + 三钩子 | ⚫ Claude Code 有 `compact_boundary` 与 `PreCompact` |
| **token 用量** | ⚫ 采集完整、拒绝把「不知道」印成 0（`run.mts:12-15`） | ⚫ footer 常驻 | ⚫ |
| **花费金额** | ⭕ 结构性恒空（`model.mts:72` + `run.mts:25`） | ⚫ 价目表 + `calculateCost()` | ⚫ Claude Code cache 读写分列 |
| **线程级花费上限** | ⭕ 无任何上限 | ⭕ | ⚫ Claude SDK `error_max_budget_usd` |
| **模型推理（thinking）** | ⭕ 双处硬关（`session.mts:37`、`model.mts:71`） | ⚫ 有等级、边框色示意 | ⚫ |
| **失败自动重试** | ⭕ 关掉且无替代（`session.mts:32`） | ⚫ `auto_retry_*` 事件 | ⚫ |
| **打断/插话（steering）** | ⭕ 结构性做不到：每回合新 session | ⚫ Enter=steer / Alt+Enter=follow-up | ⚫ Cline/Cursor 均有 |
| **工具自带渲染** | ⭕ UI 层按 kind 派发 | ⚫ `renderCall` / `renderResult` | 🟡 |
| **Agent 运行日志** | 🟡 设施齐备、只有 3 处 warn/error | 🟡 靠 provider 三钩子自建 | ⚫ Claude Code `transcript_path` 进每个 hook |
| **给模型的参数示例** | ⭕ | ⭕ | ⚫ Claude `input_examples` |

### 7.3 该抄的 5 条

> 排序依据 D1（从用户真实摩擦出发）+ D2（从结构约束出发）：先解决「用户看不出 Agent 在干嘛」和「会花钱却看不见钱」，再谈锦上添花。

**抄 1 ｜有序段流：别自己造，先评估 pi 0.85.1 的 `LaneSnapshot`（R20 build-vs-buy 闸）**

- **真实摩擦**：面板上先一大段文字、再一排工具收据，读起来像「它先想好了全部，再一口气做完了全部」。真实过程是「说一句、做一件、再说一句」。做一条短片会跑到 8 甚至 24 步，这个差别就是「我知道它在干嘛」和「我不知道它卡在哪」。
- **行业一致做法**：Claude 的 content block 顺序规则、AI SDK 的 `UIMessage.parts`、pi 的 `contentIndex` —— 三家都把顺序做成**逐 token 携带的一等信息**，没有一家是事后重建的。
- **怎么抄**：`RuntimeTurnResult` 增加 `parts: (TextPart | ThinkingPart | ToolCallPart)[]`，排序键从 `createdAt` 换成显式序号。**但在动手前必须先看 §1.9**：pi 0.85.1 的 `LaneSnapshot.operation.streamingMessage` 已经就是这个东西，`runningTools` 还顺带消掉了渲染层的第二真相。**先做升级评估再决定自建**，否则就是 R20 要拦的造轮子。
- **顺带必抄的两件（§4.1，Cline 同形状踩过的坑）**：① `ts + seq + epoch` 的**纯函数收敛 reducer**——Nomi 和 Cline 一样有「全量快照 + 增量事件」两条不同步通道，这个 reducer 保证任意到达顺序都收敛，且能做 property-based 测试；② 一条**独立于消息数组的回合相位机**（`TurnPhase`），让底部按钮、「正在想」、输入框禁用共用同一真相源——**别再从消息数组尾巴上推导 UI 状态**。

**抄 2 ｜「谁都批不动」清单：把安全从「够不着」升级成「够得着但批不动」**

- **真实摩擦**：今天 `nomi_operation_gate` / `nomi_operation_execute` 的安全性靠**不投影给模型**实现（`electron/harness/tools/modelToolSurfaceManifest.ts:237-239`）。这在「以后要给 Agent 开这个能力」时得整个重做——一旦投影出去，就没有第二道防线了。
- **行业做法**：Claude Code 有独立一节「Actions no mode auto-approves」，里面的动作**连 allow 规则和 `PreToolUse` hook 返回 `"allow"` 都批不动**；deny 规则在 `bypassPermissions` 下依然生效。MCP 规范同向：`annotations` 只能用来**收紧**审批，绝不能用来**免除**（客户端 MUST 视其为不可信）。
- **怎么抄**：在 `projectAgentExecutionPolicy.ts` 加一层**先于所有模式**的 never-auto-approve 判据，输入是 `CapabilityEffect`（`paid` / `destructive`）而不是工具名。Nomi 已经有闭合词表（`capabilityContract.ts:4`、`:9`），只差把它变成一道独立的、模式无关的闸。
- **Nomi 的三条红线应该是**（对照 Cursor 的 Browser / File-Deletion / External-File 三条，§4.8）：**花钱的生成调用 · 覆盖已有成片或节点 · 删素材**——就算用户开了全自动也照样问。
- **⚡ 配一个低成本的高价值交互（Roo，§4.3）**：审批卡上直接给出这次调用可以抽象成的几层规则，每层旁一对 ✓/✗，**让用户在要做决定的那一刻顺手立长期规则**，而不是事后去设置页翻。这比 Cursor 那套「自然语言意图 + 分类器」便宜得多，而 Nomi 没有那个分类器。
- **审批答案的形状抄 Codex（§3.3）**：`Denied{rejection: String}` 让用户一次说清「不行，改成 X」且回合继续；三种持久化半径（只此一次 / 本会话 / 写进规则）**在类型上分开**；`Default` 就是拒绝。Nomi 已有 `approvalScope: once|session|always` 和 `reprepareEffectiveCall`，差的是「拒绝时带修正意图」这一条。

**抄 3 ｜花费：先让金额算得出来，再给线程级上限**

- **真实摩擦**：Nomi 是会真花钱的产品，而内嵌 Agent 的「花费」**结构性永远是空的**（`model.mts:72` 零价目表 + `run.mts:25` 的 `total > 0` 守卫）。同时**没有任何线程级上限**——一个失控的 24 步 production 回合可以烧到底。
- **行业做法**：pi 的 footer 把「花费」和「token/cache 用量」并列常驻，且**把压缩本身烧的钱也算进去**；Claude SDK 把 `error_max_budget_usd` 做成一等的终止原因；AI SDK 6 把 `cacheWriteTokens` 单列（Anthropic 那种「写缓存比读还贵」的计价只有分开才算得对）。
- **怎么抄**：① 把 Nomi catalog 里已有的 `Model.pricing` 填进 pi 的 `Model.cost`，让 `calculateCost()` 真的算；② `cachedPromptTokens` 别在 `agentUsageStore` 入口就丢；③ 加线程级预算上限与超限行为。**Nomi 已有的那条纪律要保住**：`run.mts:12-15` 拒绝把「不知道」写成 0——这和 AI SDK 6 的「每个 usage 字段都是 `| undefined`」、Agents SDK 的 `raw_usage`（区分「provider 没报」与「报了 0」）是同一条，行业里多数实现反而更差。
- **⚡ 花费四段式抄 Adobe（§6.3，全场唯一做完整的一家）**：**事前报价 → 报不准就显式标「费用浮动」而不是留空 → 失败自动退款 → 耗尽后降级排队而非硬阻断**。Figma 公开承认给不出预估、MiniMax 全程不显示金额——**这是结构上能一次拉开差距的位置**。
- **两条记账粒度纪律**：① 存 **per-request 明细**而非只存聚合数（Agents SDK `usage.py:218` 的 docstring 说得最直白：3 次调用 100K/150K/80K，聚合成 330K 毫无意义）；② **花费显不显示要按「计费模型」而不是按 provider 硬编码**（Cline `TaskHeader.tsx:92-106`：订阅制 provider 显式标 `"subscription"` 从而不显示，理由是「算出来的是按 API 费率估的，不是真实扣费」）——正好对上 P4。
- **⚠️ 但先用 D4 量一遍「每条都标价」**：Cline / Cursor / Windsurf **三家都不在聊天流里显示逐条花费**（§4.5、§4.8），Cline 更是主动把 per-request 成本行从时间线里拿掉了。Nomi 的单次生成花费量级远大于一次 LLM 调用（Adobe 的数：一条 5 秒 1080p 视频 ≈ 50 张图），所以**结论可能相反**——但这需要是个有意识的判断，不是默认。

**抄 4 ｜steering：让用户能在不打断的前提下插一句**

- **真实摩擦**：Agent 走偏了，用户不想打断它（打断就前功尽弃），也不想干等它跑完 24 步。今天 Nomi **结构性做不到**——`run.mts:67` 每回合开一个全新 session，队列跨不过回合边界。主进程 IPC 有 `turn.steer`、渲染层有封装，**面板上没有入口**。
- **行业做法**：pi 分得很细——**Enter = steering**（等当前回合把工具跑完就送进去）、**Alt+Enter = follow-up**（等全部干完再送），配 `queue_update` 事件；Cline / Cursor 也都有。pi 0.85.1 的 `AgentHarness` 直接给了 `steer()` / `followUp()` / `nextRun()` / `cancelQueued()`。
- **⚡ 更进一步（Figma，§6.2）**：真正该做的不是「停止」按钮，是**可重排、可编辑、可删的 prompt 队列**——创作者要的不是中断，是插队和改主意。
- **⚠️ 同时把「停止」拆成两件事（ComfyUI，§6.4）**：**取消排队**（`POST /queue {delete:[id]}`）和**打断运行中**（`POST /interrupt`）是两个动作、两种事件。MiniMax 的「停止」按下去后端仍跑完（§6.1），这正是没拆开的后果——而 Nomi 的生成是真花钱的，「关掉面板 = 停止扣费吗」必须有明确答案。
- **怎么抄**：这条**依赖抄 1 的决策**（跨回合的 session 生命周期）。先决定运行时形态，再接入口，别先画 UI。

**抄 5 ｜可观测性：把「模式指示器」和「Agent 回合轨迹」补上**

- **真实摩擦**：① 用户不知道自己现在处在哪个审批档；② 出问题时没有可回溯的轨迹——Nomi 的日志设施齐备（`electron/logging/logger.ts:36-58` 的 `LogScope` 闭合枚举里就有 `"agent"`），但**全仓只有 3 处 `scope="agent"` 调用且全是 warn/error**，正常路径一条 INFO 都没有。
- **行业做法**：Claude Code 把权限模式做成三个宿主上都常驻可见的指示器 + 一个键切换（`Shift+Tab`），并把 `transcript_path` 塞进**每一个** hook 的输入；pi 的 footer 常驻六项状态。
- **怎么抄**：① 面板加常驻档位指示（Nomi 已有 `V4PermissionPopover`，缺的是**不点开也看得见现在是什么档**）；② 回合开始 / 工具调用 / 审批决定各写一条 INFO，走已有的 `logInfo(scope: "agent")`，脱敏层已经在了。
- **⚡ 字段按「日志 / trace」分级出（Codex，§3.7）**：同一个 `tool_result` 事件，`arguments` / `output` **只进本地日志**，可上报的 trace 里**只有 `arguments_length` / `output_length` / `output_line_count`** ——形状和体量出得去，内容出不去。2026-09-06 已拍板遥测默认关，所以该抄的是**开关的分层粒度**（全局 / per-run / 敏感字段）而不是默认值。
- **⚡ 「先记原始事件、离线再解释」（Codex rollout-trace，§3.7）**：热路径只按序 append 原始证据 + payload 引用，语义归因交给离线 reducer。这正好解决 Nomi「生成失败了但当时没记够上下文」的老问题。

### 7.4 不该抄的 3 条（写清为什么不适合 Nomi）

**不抄 1 ｜Claude Code / Codex 那套「沙箱 + bypassPermissions」的安全模型**

- **他们的处境**：Agent 的工具面是**通用的**（任意 shell、任意文件），危险动作的集合**无法枚举**，所以只能靠外层的 OS/容器边界兜底，并给用户一个「我知道我在干嘛」的逃生口。
- **Nomi 不一样**：Nomi 的工具面是**封闭的 35 个语义工具**，而且 `session.mts:31` 已经 `noTools: 'all'` 把 pi 自带的 bash/read/write/edit 全关了——**模型根本够不到 shell**。危险动作的集合是**可枚举的**（`CAPABILITY_EFFECT_CLASSES` 三个值）。
- **为什么不能抄**：在可枚举的工具面上引入 `bypassPermissions` 式逃生口，是**用通用产品的代价换我们不需要的自由度**；而 Nomi 的危险不是「删了文件」而是「花了钱」——花钱是不可回滚的，没有沙箱能兜。**正确方向是相反的**：把封闭工具面这个优势用足（抄 2 的 never-auto-approve），而不是补一个 Nomi 并不需要的隔离层。

**不抄 2 ｜AI SDK 的 `resume` 那套（Redis + 服务端流重放）**

- **他们的处境**：AI SDK 面向的是**多客户端、无状态服务端**的 Web 部署，用户可能关标签页、换设备，所以要把「正在流的这一路」外化到 Redis，靠 `resumable-stream` 重放。
- **Nomi 不一样**：本地优先、单进程、主进程就是那个「服务端」，状态天然住在项目文件里。
- **为什么不能抄**：抄过来就是给一个不存在的问题装一套分布式基础设施。**但要抄它的那条警告**：在可恢复流的设定下，客户端 abort 被当成「断线」而不是「取消」——关窗口不会取消底层生成。Nomi 的生成是**真花钱**的，「关掉面板 = 停止扣费吗」必须有明确答案，这个问题和 Redis 无关。

**不抄 3 ｜pi 的技能/资源自动发现（`ResourceLoader` 从 cwd 扫盘）**

- **他们的处境**：pi 是**编码 agent**，cwd 就是用户自己的仓库，从 `.pi/` 加载项目本地的扩展与技能是特性；配 `defaultProjectTrust` 的三值（ask/always/never）做一道信任闸。
- **Nomi 不一样**：Nomi 的 cwd 是**用户的项目素材目录**，里面是从各处拖进来的图片、视频、文稿——**素材不是可信代码**。pi 自己也在 security 页明说：项目信任「不能让不受信的代码、提示词或模型输出变安全」，且仓库文件里的提示词注入是「预期内的、无法可靠防止的风险」。
- **为什么不能抄**：Nomi 已经做了正确的事——`electron/harness/runtime/pi/resources.mts:13-27` 把 ResourceLoader 整体掏空，注释写明「不让 cwd/agentDir 变成指令或可执行资源来源」，技能只走 `load_skill`。**这条要写进 `ARCHITECTURE-NOW.md` 当成不变量守住**，因为它看起来像「没接的功能」，下一个人很容易「顺手接上」。
