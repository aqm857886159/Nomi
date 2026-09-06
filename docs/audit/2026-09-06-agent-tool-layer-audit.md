# Agent 工具层 · 第一性原理评审（2026-09-06）

状态：📎 已结案（只审不改）——本文只给证据与判断；根修方案在 `docs/plan/2026-09-06-agent-tool-layer-root-fix.md`。

> **缘起**：2026-09-06 晚，用户在打包版真实使用后说：「工具显示排序不对，文字竟然在工具上面；工具本身有问题；
> 这可能是通用的根因问题，要从第一性原理、根节点上解决。」现场：让 DeepSeek 在分镜表里「从原稿重拆 10 镜」，
> 同一工具连续失败 6 次（模型把 `anchors`/`shots` 传成 JSON 字符串），中间 6 段自言自语；
> 面板把文字全堆在上面、工具收据全堆在下面。
>
> **本文档只改文档，不动一行产品代码。** 每条结论带 `file:line`；每个数字带出处。

---

## 0. 先说结论

用户看到的四个症状——**顺序错、工具连错 6 次、错了还不知道怎么改、面板一堆自言自语**——不是四个 bug，
是**三个根因**：

| # | 根因 | 一句话 | 它解释了哪些症状 |
|---|---|---|---|
| **R-A** | **回合不是一条有序的事件流，是「一个助手条目 + 一袋工具条目」，只有两个时间戳** | 运行时明明按真实顺序发了 `text_delta` / `tool_execution_start` / `tool_execution_end`，宿主把顺序**丢掉**了：助手文本全部并进**一条**记录（时间戳＝回合开始），工具记录**全部**在回合结束时用**同一个** `receivedAt` 一次性生成 | 文字在工具上面 · 工具之间顺序随机 · 6 段自言自语挤成一坨 |
| **R-B** | **工具报错是给日志看的，不是给模型用的**——两层校验都把「哪个字段、期望什么」丢掉了 | 外层 pi 的 JSON-Schema 校验把 **9 个 union 分支的报错平铺成 8 行、不标是哪个分支**；内层我们自己的 Zod 把错误压成 `message: canonicalCode`（消息**就是**错误码） | 同一工具连错 6-7 次 · 模型在两个同名工具间来回试 |
| **R-C** | **工具契约是写给人看的**：两个工具 schema 完全相同、9 分支塞进一个工具、35 个工具零示例、必填字段没有一句说明 | `nomi_canvas_plan` 与 `nomi_canvas_edit` 是**字节级相同**的 8238B schema；`canvas.write` 一个契约挂 9 个 operation；全目录 35 个工具**没有一个**带示例 | 模型选不对工具 · 参数写不对 · 上下文被 schema 吃掉 ~6.8k token |

**一个根因解决几个症状**：R-A 解 3 个，R-B 解 2 个，R-C 解 3 个（R-B 与 R-C 有交集：错误看不懂 × 工具分不清 = 抖动）。

---

## 1. 回合内事件有没有一条统一有序的时间线？

### 1.1 答案：**没有。运行时有，宿主把它丢了。**

**运行时这一层是对的。** pi 运行时按真实因果顺序逐个发事件：

- `electron/harness/runtime/pi/run.mts:199-202` —— `message_update` / `text_delta` → `hooks.emit({ type: 'content-delta', delta })`
- `electron/harness/runtime/pi/run.mts:205-208` —— `tool_execution_start` → 写进 `records` Map
- `electron/harness/runtime/pi/run.mts:209-223` —— `tool_execution_end` → `tool-result` / `tool-error`

这些事件**天然有序**，而且互相交错。问题出在下一层。

**宿主这一层把顺序压成了两个时间戳。**

① **一个回合只有一条助手记录**，所有文本增量拼进它的 `text`：

- 创建：`electron/projectAgentHost/projectAgentTurnExecution.ts:85-97` —— `assistantItem` 的 `createdAt: startAt`（**回合开始那一刻**）
- 追加：`electron/projectAgentHost/projectAgentAssistantAppendReduction.ts:76-81` —— `text: assistant.text + delta`，只 bump `textRevision`，**不新建条目**
- 契约本身就只允许一条：`electron/shared/projectAgentContracts.ts:246-247` ——
  `ProjectAgentAssistantItem = { kind: "assistant"; text: string; textRevision: number }`

所以「6 段模型自言自语」在数据层根本就**不是 6 段**，是 1 段被拼起来的长文本。它们之间原本夹着的 7 次工具调用，位置信息**在拼接的那一刻就没了**。

② **所有工具记录在回合结束时一次性生成，共用同一个时间戳**：

- `electron/projectAgentHost/projectAgentTurnExecution.ts:616` —— `const receivedAt = now();`
- `electron/projectAgentHost/projectAgentTurnExecution.ts:618` —— `response.toolCalls.map((item) => toolItem(..., receivedAt, ...))`
- `electron/projectAgentHost/projectAgentExecutionHelpers.ts:135-136` —— `createdAt: now, updatedAt: now`（`now` 就是那一个 `receivedAt`）

**真机实测证明**（本次探针，见 §3）：`two_shot_cards#1` 这一轮 8 条工具记录的 `createdAt` **去重后只有 1 个值**
（`2026-09-06T10:20:32.228Z`），而该回合的助手记录 `createdAt` 是 `10:18:45.349Z`——
**107 秒的真实交错活动，被压成了两个时间点。**

### 1.2 投影层只能按它拿到的东西排，所以必然是「文字在上、工具在下」

`src/workbench/ai/v4/agentPanelV4Projection.ts:247-255`：

```ts
function sortedItems(items) {
  return [...items].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.itemId.localeCompare(right.itemId)      // 第二键 = itemId
      : left.createdAt.localeCompare(right.createdAt))
}
```

两个后果，都在真机上发生了：

1. **助手文本永远排在所有工具收据前面**——因为 `assistant.createdAt`（回合开始）恒 < `tool.createdAt`（回合结束）。
   这就是用户说的「文字竟然在工具上面」。**这条无法靠改排序修好**：一个回合只有一条助手记录，
   它没有「第二段文本」可以排到工具后面去。
2. **同回合工具之间的顺序是 `itemId` 的字典序**，而 `itemId = tool-${digest([binding, executionToken, toolCallId])}`
   （`projectAgentExecutionHelpers.ts:113`）——是**哈希**。所以工具收据的先后＝哈希字典序＝与调用顺序无关。

> **进行中的分支已经修掉了第 2 条的一半**：`fix/design-lab-wired-states-20260906`
> 把第二键从 `itemId` 换成**宿主数组下标**（提交 `f2b5a5c4a`，diff 见该分支 `agentPanelV4Projection.ts`）。
> 这让同毫秒的工具按写入顺序排——写入顺序就是 `response.toolCalls` 的顺序，也就是调用顺序。**这是对的，本方案不与之冲突。**
> 但它**修不了第 1 条**：只要一个回合仍然只有一条助手记录、且它的时间戳在回合开始，文字就永远在工具上面。

### 1.3 wiring plan 的 G6 仍然成立，而且比计划里写的更严重

`docs/plan/2026-09-06-agent-panel-v4-wiring.md:114-121` 已经实查记下：
「`ProjectAgentToolItem` **只在回合结束时**一次性从 `response.toolCalls` 生成……跑的过程中，状态里**一条 tool 记录都没有**。」
今天核对：**仍然成立**（`projectAgentTurnExecution.ts:616-618` 未变）。

计划把它当成「七态拿不到」的问题，让渲染层 join 三路补。**但这只是 G6 的一半。**
另一半是：即使补齐了七态，**顺序仍然是错的**——因为丢失的不是状态，是**位置**。
补状态解决「这个工具现在跑到哪一步」，解决不了「这个工具发生在哪两段文本之间」。

### 1.4 与行业现役结构对照：四家都是**一条有序流**，我们是唯一的例外

| 生态 | 一个回合的载体 | 顺序由什么保证 | 出处 |
|---|---|---|---|
| **Anthropic Messages API** | assistant 消息的**一个 `content` 数组**，`text` 与 `tool_use` **交错其中** | 数组下标 | platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools：官方示例即 `content: [{type:'text',…},{type:'tool_use',…}]`；并明确「Unlike APIs that separate tool use or use special roles like `tool` or `function`, the Claude API integrates tools directly into the `user` and `assistant` message structure」 |
| **Vercel AI SDK 6** | `UIMessage.parts: Array<UIMessagePart>` | 数组下标；流处理器对每个 `*-start` **push** 一个新 part，`*-delta` **就地改**已在数组里的那个 part | `packages/ai/src/ui/ui-messages.ts` @ `ai@6.0.0`；`process-ui-message-stream.ts`（`reasoning-start` → `parts.push(...)`，`reasoning-delta` → `part.text += delta`） |
| **MCP** | `tools/call` 结果的 `content` 数组 | 数组下标 | modelcontextprotocol.io/specification/2026-07-28/server/tools |
| **Claude Agent SDK** | 追加式的 `SDKMessage` 帧流（异步迭代器），每帧带 `uuid` / `parent_tool_use_id` | 帧到达顺序 + `parentUuid` 链 | `@anthropic-ai/claude-agent-sdk@0.3.263` 的 `sdk.d.ts`：`SDKMessage` 是 37 个变体的 union；`SDKAssistantMessage.message` 是 `BetaMessage`，「When streamed, content typically holds the single block this message delivers」 |
| **Nomi 现状** | `ProjectAgentHostState.items: readonly ProjectAgentItem[]`——**按 kind 分类的一袋记录**，只有 `createdAt` | 无（两个时间戳 + 哈希字典序） | `electron/shared/projectAgentContracts.ts:391-402`、`:319-326` |

**四家没有一家把一个回合拆成「按类型分开的几个列表」。** 我们是。

### 1.5 最小契约提案：给回合加一条有序 parts 流（不引 AI SDK 依赖，只借结构）

**不新建第九种积木，不改 8 积木词表。** 只做一件事：**让每个 item 知道自己在回合里的第几位。**

```ts
// electron/shared/projectAgentContracts.ts —— 加在 ProjectAgentItemBase 上
type ProjectAgentItemBase = ProjectAgentRecordBase & Readonly<{
  itemId: string; threadId: string; turnId: string;
  /**
   * 本条在**它所属回合**内的位置。由宿主在写入时单调分配，永不复用、永不回填。
   * 这是唯一的顺序真相源；`createdAt` 只用于显示用时，不再参与排序。
   */
  turnSeq: number;          // ← 唯一的新字段
  parentItemId?: string; correlationId?: string;
}>;
```

配套三条（都不新增第二份词表）：

1. **助手文本按「步」切段**，不再拼成一条。运行时已经有天然的切点：
   `run.mts:224-226` 的 `turn_end` / `step-finish` 事件。每一步的文本是一条 `assistant` item，
   拿到它自己的 `turnSeq`。—— 这条直接对应 AI SDK 的 `StepStartUIPart` 与 Anthropic 的「一个 assistant 消息一个 content 数组」。
2. **工具 item 在 `tool_execution_start` 时就落宿主**（`input-available`），
   `tool_execution_end` 时 `item.transition` 改终态。这同时把 G6 的七态从「渲染层 join 三路」降级成「读一个字段」。
3. **投影层排序改成单键 `turnSeq`**（同一 turn 内），跨 turn 仍按 turn 的先后。
   `sortedItems()` 从 8 行变 1 行，`itemId` 与宿主数组下标两个 tie-break 都可以删掉（P1：加新必删旧）。

**为什么是 `turnSeq` 而不是「一个 parts 数组」**：现有宿主是**扁平 items + 增量 patch**（`ProjectAgentChange` 的 12 个变体，
`projectAgentContracts.ts:359-371`），把 items 改成嵌套数组会重写整个 reducer 与命令账本。
加一个单调整数拿到**同样的排序保证**，而 patch/reducer/持久化全部不动。这是「最小」的含义。

---

## 2. 工具契约是不是写给人看不是写给模型用的？

### 2.1 模型面工具全清单（35 个）

真相源：`electron/harness/tools/agentToolCatalog.ts:36-43`（唯一 model-facing 入口）。
数值由脚本对**生产同款** `zodToJsonSchema` 配置（`electron/harness/runtime/pi/tools.mts:43-50`）实测得出。

| 组 | 工具名 | 描述字长 | 有示例 | union 分支 | 嵌套深度 | 字段数 | 必填 | 带说明的字段 | 不透明 `z.record` | 发给模型的 JSON Schema |
|---|---|---:|:--:|---:|---:|---:|---:|---:|---:|---:|
| canvas | **`nomi_canvas_plan`** | 102 | ❌ | **9** | 4 | 76 | 34 | 8 | **9** | **8238 B（~2574 tok）** |
| canvas | **`nomi_canvas_edit`** | 71 | ❌ | **9** | 4 | 76 | 34 | 8 | **9** | **8238 B（~2574 tok）** |
| canvas | `nomi_canvas_read` | 78 | ❌ | 1 | 0 | 0 | 0 | 0 | 0 | 114 B |
| canvas | `nomi_canvas_maintenance` | 83 | ❌ | 1 | 2 | 3 | 2 | 0 | 0 | 361 B |
| generation | `nomi_generation_plan` | 82 | ❌ | 4 | 5 | 57 | 16 | **0** | 5 | 3622 B |
| generation | `nomi_generation_status` | 108 | ❌ | 3 | 1 | 7 | 7 | 0 | 0 | 713 B |
| document | `nomi_document_read` | 70 | ❌ | 1 | 1 | 1 | 1 | 0 | 0 | 188 B |
| document | `nomi_document_edit` | 77 | ❌ | 1 | 1 | 2 | 2 | 0 | 0 | 257 B |
| timeline | `propose_edit_plan` | 177 | ❌ | 1 | 4 | 51 | 31 | **0** | 0 | 3882 B |
| timeline | `apply_edit_plan` | 172 | ❌ | 1 | 4 | 51 | 31 | **0** | 0 | 3882 B |
| timeline | `read_timeline` | 69 | ❌ | 1 | 0 | 0 | 0 | 0 | 0 | 114 B |
| timeline | `inspect_timeline_range` | 72 | ❌ | 1 | 1 | 2 | 2 | 0 | 0 | 290 B |
| timeline | `undo_timeline_edit` | 67 | ❌ | 1 | 1 | 3 | 2 | 0 | 0 | 326 B |
| timeline | `layout_read` / `layout_write` | 43 / 47 | ❌ | 1 | 0 / 3 | 0 / 10 | 0 / 10 | 0 | 0 | 114 / 853 B |
| timeline | `get_media` / `inspect_media` / `search_media` / `inspect_source_range` / `read_waveform` | 65–91 | ❌ | 1 | 1–2 | 1–4 | 0–3 | 0 | 0 | 194–395 B |
| timeline | `export_timeline` / `inspect_export_job` / `verify_render` / `cancel_export_job` | 61–78 | ❌ | 1 | 1 | 1–5 | 1 | 0 | 0 | 190–476 B |
| production | `start_production_run` | **268** | ❌ | 1 | 2 | 8 | 1 | 2 | 0 | 821 B |
| production | 其余 8 个（`get_` / `subscribe_` / `read_…artifact(_content)` / `control_` / `decide_gate` / `revise_` / `review_` / `materialize_`） | 93–123 | ❌ | 1 | 1 | 1–5 | 1–5 | 1–3 | 0 | 251–589 B |
| skills | `load_skill` | 104 | ❌ | 1 | 1 | 2 | 1 | 0 | 0 | 239 B |

**汇总（35 个工具）**：
- 描述长度：最短 43 字符、最长 268 字符、**中位数 87 字符（约 20 token）**
- **带示例的工具：0 / 35**
- **一个字段说明都没有的工具：23 / 35**
- 全目录 JSON Schema 合计 **38 651 B（~12 079 token）**

**一次请求真正发给模型的量**（按 `agentChatPolicy.agentToolsForRequest` 实算）：

| 场景 | 工具数 | 工具名+描述+schema |
|---|---:|---:|
| `canvas-agent` + 分镜类 prompt（profile=storyboard） | 6 | **21 809 B ≈ 6 815 token** |
| `canvas-agent` + 生成类 prompt（profile=generation） | 6 | 同上 |
| `canvas-agent` + 成片类 prompt（profile=production） | **30** | **40 452 B ≈ 12 641 token** |
| `creation-editor` + 分镜类 prompt | 8 | — |
| `creation-chat` | 2 | — |

> 分镜场景那 6 个工具里，**`nomi_canvas_plan` + `nomi_canvas_edit` 两个人占了 16 476 B——整个工具面的 76%**，
> 而它们**是同一份 schema**。

### 2.2 「让模型六次写不对」的类根因：四条，全都成立

#### ① 两个工具**字节级相同**，模型分不清 —— 而且真机上它就在两者之间来回抖

`electron/harness/tools/modelToolSurfaceManifest.ts:195-208` 逐字摘录（**应用内 Agent 工具面**，不是 MCP `tools/list` 目录——
`nomi_canvas_plan` 已于 2026-09-05 从 MCP 目录退役，但在应用内工具面仍然并列存在，这正是本节要说的问题）：

```text
{ name: "nomi_canvas_plan", intent: "Propose storyboard, staging, camera, or timeline landing intent for review before changing the canvas.",
  capabilityRefs: ["canvas.write"], inputSchema: canvasWriteSemanticInputSchema, outputSchema: canvasWriteResultSchema, ... },
{ name: "nomi_canvas_edit", intent: "Propose a validated reversible edit to canvas nodes or reference edges.",
  capabilityRefs: ["canvas.write"], inputSchema: canvasWriteSemanticInputSchema, outputSchema: canvasWriteResultSchema, ... },
```

**同一个 `inputSchema`、同一个 `outputSchema`、同一个 capability、同一个 `sideEffect`/`risk`。**
两者唯一的差别是 `availability.phases`（`plan` 多一个 `storyboard`）——**这是宿主的路由维度，模型看不见**。
模型看到的是两个名字不同、schema 一模一样的工具，只能靠两句一行英文猜。

它猜不出来。真机实测（§3，`two_shot_cards#1`）的 7 次连续失败序列是：
`plan → edit → edit → edit → plan → edit → plan`——**这就是在两个同名工具之间抛硬币。**

这两个名字的来源是 `CANVAS_WRITE_CAPABILITY.aliases`（`electron/shared/agentCapabilities/canvasWrite.ts:485-489`）：
`pi: "set_node_prompt"` / `mcp: "nomi_canvas_edit"` / `ui: "nomi_canvas_plan"`。
**三个投影面的别名，被 `modelToolSurfaceManifest` 当成两个独立工具发给了同一个模型。**

#### ② 一个工具里塞 9 个 operation，JSON Schema 变成 9 分支 `anyOf`

`canvasWriteSemanticInputSchema` 是 9 个分支的 `discriminatedUnion`（`canvasWrite.ts:225-246`）：
`set_node_prompt` / `create_canvas_nodes` / `connect_canvas_edges` / `tidy_canvas` /
`propose_storyboard_plan` / `patch_shots` / `arrange_storyboard_to_timeline` /
`create_staging_reference` / `create_camera_move`。

转成 JSON Schema 后是 **`anyOf` 9 项、8238 B**。这直接导致了 ③。

#### ③ **错误信息把 9 个分支的报错平铺，不标是哪个分支** —— 这是「六次写不对」的**直接**原因

真机实测抓到的、**模型真正收到的那段文本**（原文见 `docs/audit/attachments/2026-09-06-tool-probe.jsonl`）：

```
Validation failed for tool "nomi_canvas_plan":
  - nodeId: must have required properties nodeId, prompt
  - root: must not have additional properties
  - operation: must be equal to constant
  - nodes: must be array
  - edges: must have required properties edges
  - root: must not have additional properties
  - operation: must be equal to constant
  - root: must not have additional properties

Received arguments:
{
  "operation": "create_canvas_nodes",
  "summary": "在画布上建两个镜头：清晨空街空镜 + 主角推门走出中景",
  "nodes": "[{\"clientId\": \"shot1\", \"kind\": \"video\", ...}]"     ← 数组被序列化成了字符串
}
```

八行报错里，**只有第 4 行（`nodes: must be array`）是真的**；其余 7 行来自模型压根没打算用的另外 8 个分支。
而这唯一有用的一行，和 7 行噪音**长得一模一样**，没有任何标记说「这条属于你选的 `create_canvas_nodes` 分支」。

它也**没说出那句唯一有用的话**：「你把数组序列化成 JSON 字符串了，请直接给数组本体」。

> 这就是用户现场那 6 次失败的机制。**同一个失败模式，不同的字段**：用户那次是 `anchors`/`shots`
> （`propose_storyboard_plan` 分支），本次探针是 `nodes`（`create_canvas_nodes` 分支）。
> 两者都在同一个 9 分支 union 里，共用同一条报错通道。

出错点在 `electron/harness/runtime/pi/tools.mts:74`：

```ts
const args = await awaitHost(() => tool.schema.parseAsync(toolCall.arguments), signal);
```

——但那行之前，pi 自己已经用 `parameters`（`tools.mts:43-50` 生成的 JSON Schema）校验过一遍并抛出了上面那段文本。

#### ④ 我们自己那层的错误更糟：**message 就是 error code**

`electron/capabilityCore/canvasWriteTransportAdapters.ts:69-75`：

```ts
function safeFailure(error: unknown): Extract<RuntimeToolDecision, { ok: false }> {
  const candidate = ...;
  const code = candidate && PUBLIC_FAILURE_CODES.has(candidate) ? candidate : "capability_execution_failed";
  return { ok: false, code, message: code };     // ← message 就是 code
}
```

`electron/projectAgentHost/projectAgentExecutionCoordinatorTypes.ts:222-235`：

```ts
execution.capabilityOutcome ??= Object.freeze({
  toolCallId, code: canonicalCode,
  message: canonicalCode,                       // ← 同样
  nextAction: definition.nextAction, status: ..., retryable: ...,
});
return { ok: false, code: canonicalCode, message: canonicalCode, ...(denied ? { denied: true } : {}) };
                                                // ↑ 返回给模型的 decision 里**没有 nextAction**
```

所以：
- 模型收到的是字符串 `"capability_input_invalid"`，**没有字段、没有期望、没有收到值**；
- `CANVAS_WRITE_OUTCOMES` 里那条泛泛的 `nextAction`（`"correct the proposal parameters and submit it again"`，
  `projectAgentExecutionCoordinatorTypes.ts:159-163`）**只进宿主的 failure item 给 UI 用，从不回给模型**。

上游的 Zod `error.issues`（带 `path` / `expected` / `received`）在
`electron/capabilityCore/capabilityExecutorRegistry.ts:341-343` 被整个丢掉：

```ts
if (!schema.safeParse(invocation.input).success) {
  throw new CapabilityExecutionError("capability_input_invalid");   // issues 没了
}
```

`electron/capabilityCore/generationTransportAdapters.ts:86` 同样：
`throw Object.assign(new Error("generation_input_invalid"), { code: "generation_input_invalid" })`。

#### ⑤ 补充证据：**MCP 外部路径已经做对了，内部 Agent 路径没有**

`electron/capabilityCore/dispatcher.ts:557-565`（对外 MCP）：

```ts
// 未知 operation 必须当场说清「合法的有哪些」：Zod 的 discriminator 错误只会说
// "Invalid discriminator value"，模型据此没法自纠（MCP spec 要求输入错误可恢复）。
if (!CANVAS_WRITE_OPERATIONS.includes(raw.operation as CanvasWriteOperation)) {
  throw new RpcError(`未知的画布操作：${JSON.stringify(raw.operation ?? null)}`, 400, {
    code: 'capability_input_invalid',
    nextAction: `Use one of: ${CANVAS_WRITE_OPERATIONS.join(', ')}`, ... })
}
```

**同一个问题，同一个仓库，外部 MCP 客户端拿到可行动错误，我们自己的 Agent 拿到一个错误码。**
而且这条补救只覆盖「operation 认不出来」，**字段级错误（正是本次的失败）走的仍是下一行的裸 `.parse()`**（`dispatcher.ts:566`）。

#### ⑥ 补充证据：**容忍已经写好了，但建在最后一层，模型永远走不到**

`src/workbench/generationCanvas/agent/storyboardPlanSchema.ts:72-87`：

```ts
function parseJsonArrayString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return value
  try { const parsed = JSON.parse(trimmed); return Array.isArray(parsed) ? parsed : value } catch { return value }
}
export const storyboardPlanSchema = z.object({
  title: z.string(),
  anchors: z.array(planAnchorSchema),                              // ← 没有容忍
  shots: z.preprocess(parseJsonArrayString, z.array(planShotSchema)),  // ← 有容忍
  ...
})
```

有人已经踩过这个坑并写了容忍——但**只给了 `shots`，没给 `anchors`**，
而且它在**渲染层的第二道校验**里。模型的调用在**主进程边界**（`canvasWrite.ts:139-146`，
`anchors: z.array(...)`、`shots: z.array(...)`，两者都无容忍）就被拒了，
**渲染层那段 preprocess 从模型的角度看是死代码**。

**同类的症状级补丁还有两处**——在**提示词**里恳求模型别犯这个错：
- `src/workbench/generationCanvas/agent/storyboardLauncher.ts:40`
  「`propose_storyboard_plan` 的 shots 字段必须是**数组本体**……绝对不要写成字符串，禁止 `shots: "[{...}]"`」
- 同文件 `:80`「结构化工具调用硬约束：参数必须是对象本体，anchors/shots 必须是数组本体」

**两条提示词 + 一条只给一半的 preprocess，都没挡住。** 这三处是同一个根因的三个症状级补丁（P2 违规），
根修后应当三处一起删（P1）。

#### ⑦ 顺带发现：schema 里没有可用模型枚举，模型只能编

同一条真机记录里，模型给 `modelKey` 填了 `"seedance"`——一个**它自己编的**键。
`plannedNodeSchema.modelKey` 是 `z.string().trim().min(1).optional()`（`canvasWrite.ts:43`），
没有枚举、没有说明、没有示例；真正的可用清单只在**提示词**里（`generationCanvasAgentClient.ts` 一带）。

### 2.3 近义重复工具盘点

| 组 | 疑似重复 | 判定 |
|---|---|---|
| `nomi_canvas_plan` vs `nomi_canvas_edit` | **同 schema、同 capability、同输出** | ✅ **真重复**，只有 phases 不同（模型看不见） |
| `propose_edit_plan` vs `apply_edit_plan` | 同 schema（3882 B ×2），差别是 preview / apply | ⚠️ **应合成一个工具 + `operation` 参数**（Anthropic「consolidate related operations」） |
| `layout_read` / `layout_write` 与 `nomi_canvas_read` / `tidy_canvas` | 都在动画布布局 | ⚠️ 概念重叠，需要一条边界说明 |
| `read_production_artifact` vs `read_production_artifact_content` | 同 382 B schema | ⚠️ 应合成一个 + `include: "meta" | "content"` |
| `nomi_document_edit` vs `nomi_canvas_plan(propose_storyboard_plan)` vs `patch_shots` | 三个都能「写分镜相关的东西」 | ⚠️ 需要一句「什么时候用哪个」，现在三个描述互不提及对方 |

---

## 3. 真实成功率（量化底座）

### 3.1 怎么测的

- **模型**：`DeepSeek V4 Flash`（apimart，`modelKey=deepseek-v4-flash`）——用户 catalog 里已有的最便宜文本档。
- **栈**：真实 Electron + 真实 v4 面板 + 真实宿主 + 真实工具边界。隔离 profile（`evals/lib/isoApp.mjs`
  的 `prepareIsolation`：只把**加密的** `model-catalog.json` 复制进隔离目录复用已配 key，
  **不碰用户真实项目库**，key 全程不出 app）。
- **只读**：介入槽出现即拒绝，**不落画布、不生成、不花生成额度**；只花文本 token。
- **数据**：每回合从宿主落盘快照读 `items`，记录每条 tool item 的 `capability` / `status` / `error` / `createdAt`。
- **脚本**：`scratch/realModelToolProbe.mjs`（未提交，方法写在本节）；原始数据
  `docs/audit/attachments/2026-09-06-tool-probe.jsonl`（已脱敏：不含 key，不含用户真实项目内容，故事正文是本次自造）。

### 3.2 结果（5 任务 × 3 次 = 15 回合）

按 `turnId` 归组去重（同一回合的工具记录共用一个 `receivedAt`，见 §1.1）：

| 任务 | 主要工具 | 回合全绿 | 工具调用 | 成功 | 校验失败 | 中位耗时 |
|---|---|---:|---:|---:|---:|---:|
| 读文稿 | `document.read` | **3/3** | 3 | 3 | 0 | 9.5 s |
| 改文稿 | `document.read` + `document.write` | **3/3** | 6 | 6 | 0 | 23.0 s |
| 从原稿拆 8 镜 | `skill.read` ×N + `canvas.read` + `generation.plan` | 3/3 | 18 | 18 | 0 | 50.9 s |
| **建 2 个镜头卡** | `canvas.write`（`create_canvas_nodes`） | **0/3** | 16 | 3 | **13** | 107 / 125 / **210 s 超时** |
| 读时间轴 | `timeline.read` | 3/3 | 3 | 3 | 0 | 11.3 s |

**跨全部 15 回合，按工具汇总：**

| 工具（capability） | 调用次数 | 成功 | 失败 | 成功率 |
|---|---:|---:|---:|---:|
| `document.read` | 6 | 6 | 0 | 100% |
| `document.write` | 3 | 3 | 0 | 100% |
| `skill.read` | 13 | 13 | 0 | 100% |
| `canvas.read` | 8 | 8 | 0 | 100% |
| `generation.plan` | 4 | 4 | 0 | 100% |
| `timeline.read` | 3 | 3 | 0 | 100% |
| **`canvas.write`** | **18** | **0** | **18** | **0%** |

> `canvas.write` 是本次唯一有写入语义、也是唯一带 9 分支 union 与重复工具的能力。
> **它 18 次调用 0 次通过。** 其余全部工具（都是单分支、扁平 schema）100% 通过。
> 这不是「模型不行」——同一个模型在同一轮对话里把 `document.write` 写对了 3/3。

**四个数字值得单独说：**

1. **`canvas.write` 成功率 0%（0/18）。** 失败原因 100% 相同：把数组字段序列化成了 JSON 字符串。
   三轮的失败序列是 7 连败、6 连败（中间穿插一次成功的 `generation.plan`）、以及第三轮跑到 210 秒探针超时仍未成功。
2. **模型在 `nomi_canvas_plan` / `nomi_canvas_edit` 之间抖动**：`plan→edit→edit→edit→plan→edit→plan`。
   这不是随机，是「同一个错误重复出现，模型合理地假设自己选错了工具」——
   而两个工具**根本是同一份 schema**，换过去还是同一个错。
3. **「拆 8 镜」三轮全部没调到 `propose_storyboard_plan`**：模型改去调 `skill.read`（一轮调了 5 次）
   和 `generation.plan`。三者的描述里没有任何一句说明彼此分工——
   `load_skill` 104 字符、`nomi_canvas_plan` 102 字符、`nomi_generation_plan` 82 字符，**都没提对方**。
   所以「拆镜头」这条**用户最常用的任务**，一次都没走到为它设计的那条路上。
4. **顺序错乱当场可见**：`two_shot_cards` 那两轮里，模型显然**先** `canvas.read` 再去写，
   但按宿主记录排出来是 `write:fail ×6 → read:done → write:fail`——
   `canvas.read` 被排到了第 7 位。原因就是 §1.2：同回合工具共用一个 `createdAt`，
   第二键是 `itemId` 哈希的字典序。同一轮里助手记录的 `createdAt` 比全部工具早 **107 秒**。

### 3.3 花费

本轮全部为文本 token（无生成、无图像/视频）。按 apimart DeepSeek V4 Flash 档位与本轮 token 量估算，
**远低于 ¥1**，未触及 ¥5 上限。精确账单以供应商后台为准；本文不编造具体金额。

---

## 4. 与行业现役做法对照：我们违反了哪几条

| # | 行业规范 | 出处 | Nomi 现状 | 违反 |
|---|---|---|---|---|
| V1 | 「**Provide extremely detailed descriptions.** This is by far the most important factor in tool performance.」「Aim for at least 3–4 sentences」 | Anthropic · Define tools | 中位描述 **87 字符（约一句话的一半）** | ❌ 全部 35 个 |
| V2 | 「Prioritize descriptions, but consider using `input_examples` for complex tools.」 | Anthropic · Define tools | **0/35 带示例**，含 8238 B / 9 分支的 `nomi_canvas_plan` | ❌ |
| V3 | 「Consolidate related operations into fewer tools.」「Fewer, more capable tools reduce selection ambiguity.」 | Anthropic · Define tools | 反着来：**同一个 capability 被拆成两个同 schema 的工具**（`plan`/`edit`）；同时 `propose_edit_plan`/`apply_edit_plan`、`read_production_artifact(_content)` 该合的没合 | ❌ 双向都违反 |
| V4 | 「Aim for fewer than 20 functions available at the start of a turn」 | OpenAI · Function calling | production profile **30 个** | ❌ |
| V5 | 「Explicitly describe the purpose of the function **and each parameter (and its format)**」 | OpenAI · Function calling | **23/35 工具零字段说明**；`nomi_generation_plan` 57 字段 / 0 说明；`propose_edit_plan` 51 字段 / 0 说明 | ❌ |
| V6 | 「Write **instructive** error messages… include what went wrong and **what Claude should try next**」 | Anthropic · Handle tool calls | `message: canonicalCode`；`nextAction` 存在但**不回给模型** | ❌ |
| V7 | 「errors… **SHOULD** be reported inside the result object, with `isError` set to true… Otherwise, **the LLM would not be able to see that an error occurred and self-correct**」；「Clients **SHOULD** provide tool execution errors to language models to enable self-correction」 | MCP 2026-07-28 · Tools | 错误确实回给了模型（✅），但内容不可自纠（❌）。**校验失败属于「tool execution error」而非「protocol error」，规范要求它必须可自纠** | ⚠️ 形式合规、实质违反 |
| V8 | Anthropic：assistant 消息的 `content` 数组里 text 与 tool_use **交错**；AI SDK：`parts` 数组保序；MCP：`content` 数组；Agent SDK：有序帧流 | 四家（见 §1.4） | 宿主按 kind 分列表 + 两个时间戳 | ❌ **四家都违反** |
| V9 | 「Servers **SHOULD** return tools in a deterministic order… improves LLM prompt cache hit rates」 | MCP 2026-07-28 | ✅ 已做：`agentToolCatalog.ts:31-35` 注释明写「Keep array order stable: it is part of the prompt/KV-cache contract」 | ✅ **合规** |
| V10 | 「Use meaningful namespacing in tool names」 | Anthropic · Define tools | 混着来：`nomi_canvas_read`（有前缀）与 `read_timeline` / `load_skill` / `get_media` / `export_timeline`（无前缀）**在同一个工具集里同时出现**（见 `agentChatPolicy.ts:112-131`） | ❌ |
| V11 | strict 模式：`additionalProperties:false` + 所有字段 required + 可选用 `["T","null"]` | OpenAI · Structured outputs | 我们用 `.strict()`（→ `additionalProperties:false` ✅），但大量 `.optional()`（✗ strict 不允许），且 `anyOf` 9 分支超出多数供应商 strict 子集 | ⚠️ 无法开 strict —— 这本可以在**供应商侧**挡住本次全部失败 |

**顺带一条 CI 卫生问题**：`tests/ux/_agentProbe.mjs` 依赖的 `window.nomiDesktop.agents` 桥
**在当前代码里已经不存在**（全仓 grep `cancelChatV2` 只剩测试文件自己），
所以 `apimart-text-brain.e2e.mjs` / `staging-reference.e2e.mjs` 这些付费 e2e **已经是死的**。
这正是 `docs/lessons/dead-selector-lies-both-ways.md` 那一族。根修方案 §3 的评测要接**现役** `projectAgent` 通道，别复活它。

---

## 5. 六角色评审

**CTO**：三个根因里 R-A 是**契约级**的（少一个字段），R-B 是**边界级**的（错误没带上下文），R-C 是**目录级**的（工具重复+无示例）——
代价从小到大依次是加一个 `turnSeq`、把 issues 带出来、合并两个工具。三件都不需要重写宿主，
所以「从根节点解决」这次是真的可行、不是口号。
我最担心的不是改不动，是**改一半**：只修排序不修错误，用户下次仍然会看到工具连错 6 次，只是排得整齐了。
所以三件必须捆在一个方案里排期，不能拆散当成三个「顺手做」。

**设计**：用户那句「文字竟然在工具上面」不是审美投诉，是**因果关系被打断了**——
他读到「我来建两个镜头卡」，往下翻却先看见 7 条红色收据，再往下才是「我遇到了问题」。
这让人无法判断 Nomi 到底在干什么。有序流修好之后，v4 那 8 个积木**一个都不用改长相**，
只是终于按发生顺序出现——这才是设计定稿本来的样子。另外请把「同一个工具连错 7 次」在 UI 上折叠成
「尝试 7 次未成功」一行，7 条一模一样的红收据本身就是噪音。

**PM**：数字说话——**「建两个镜头卡」这条最基础的画布任务，真实成功率 0%（0/3）**，
「从原稿拆 8 镜」三次一次都没走到正确的工具。这不是打磨项，这是**画布 Agent 目前不可用**。
优先级应当高于任何新功能。可交付的验收线很清楚：这两条任务的一次写对率从 0% 到 ≥80%，
且不靠在提示词里加更多恳求（那三处恳求已经证明无效）。

**前端**：投影层这边我要提醒一句边界——`fix/design-lab-wired-states-20260906` 正在改
`sortedItems()` 的第二键（itemId → 宿主数组下标），那个改动是对的、也必须先合。
`turnSeq` 落地后 `sortedItems()` 会退化成单键排序，那两个 tie-break **一起删**（P1）。
两边不要同时改同一个函数：先合它，再动 `turnSeq`。

**后端**：`turnSeq` 要在 reducer 里单调分配，不能让运行时自己报——运行时报的序号在
`async.result` 批量落账时会和已有 items 冲突。做法：`assistant.append` / `item.put` 两条 mutation
在宿主侧读当前 turn 的 max seq + 1。另外把 Zod issues 带出来时要**过 allowlist**：
`path` + `expected` + `received` 的**类型名**可以出，`received` 的**值**不能原样回给模型
（可能含用户文稿正文，那是 provenance 边界）。

**真实用户**：我不知道什么叫 `capability_input_invalid`，也不想知道。我要的是：
它试了一次、告诉我「刚才那步没成，我换个方式再来」，而不是刷出 7 条一样的红字然后停在那儿。
还有——它一直在说话，说的却不是它正在做的事，这最劝退。

---

## 6. 附件

- `docs/audit/attachments/2026-09-06-tool-probe.jsonl` —— 真实模型探针原始记录
  （每行一轮：任务 / 次数 / 每条 tool item 的 capability·status·完整错误文本·时间戳 / 助手条目长度与时间戳）。
  已脱敏：不含 API key、不含用户真实项目内容；故事正文为本次审计自造。
