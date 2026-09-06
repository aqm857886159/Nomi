# Agent 工具层根修方案（2026-09-06）

状态：📋 方案待拍板 —— 上游证据是 `docs/audit/2026-09-06-agent-tool-layer-audit.md`（真机实测：`canvas.write` 18 次调用 0 次通过）。
本文只写方案，**不含实现**；拍板后按 §7 分段落地。

---

## 0. 先讲清楚：这是在解决哪个真实摩擦

用户 2026-09-06 晚在打包版里做了一件最普通的事——**「从原稿重拆 10 镜」**。发生的是：

- Nomi 连续 6 次调用同一个工具、6 次被自己拒收；
- 每次拒收之间它写一段话解释自己在干嘛，于是屏幕上多了 6 段自言自语；
- 最后面板把 6 段文字**全堆在上面**、7 条红色收据**全堆在下面**——
  用户读到「我来拆镜头」，往下翻先看见 7 条失败，再往下才看到「我遇到了问题」。

他说：「这可能是通用的根因问题，要从第一性原理、根节点上解决。」**他判断对了。**

**这三件事只有三个原因，而且都不在模型那边**（同一个模型在同一轮对话里把改文稿写对了 3/3）：

1. **回合的顺序在宿主里被丢掉了。** 运行时按真实顺序发事件，宿主把所有助手文本并成**一条**记录
   （时间戳＝回合开始），把所有工具记录在**回合结束**时用**同一个**时间戳一次性生成。
   107 秒的交错活动被压成两个时间点。文字在工具上面是这个压缩的必然结果，不是排序写反了。
2. **工具报错是写给日志的。** 模型收到的是 8 行来自 9 个不同分支、互不标记的校验报错，
   其中只有 1 行是真的；再往下一层，它收到的干脆就是错误码字符串本身（`message: "capability_input_invalid"`）。
   它没有任何线索知道「你把数组写成了字符串」，所以只能原样重试。
3. **工具目录是写给人看的。** `nomi_canvas_plan` 和 `nomi_canvas_edit` 是**字节级相同**的 8238 B schema，
   模型分不清所以来回抖；一个工具塞 9 个 operation；35 个工具**零示例**、23 个**零字段说明**。

**你要权衡的那个核心东西**：这三条都要动**契约**（宿主记录加一个字段、错误结构加字段、工具目录合并）。
契约一动，宿主 reducer、投影层、MCP 外部面、走查基线都要跟着对齐。
所以真正的取舍是——**是趁现在 v4 面板刚接线、外部 MCP 用户还少的时候一次改干净，
还是继续在提示词里加恳求。** 后者已经试过三次（见审计 §2.2⑥），三次都没挡住。

---

## 1. 范围

### 1.1 做（三刀，按「一个根因解决几个症状」排序）

| 刀 | 根因 | 改什么 | 解决的症状 |
|---|---|---|---|
| **刀 1 · 有序 parts 流** | R-A | `ProjectAgentItemBase` 加 `turnSeq`；助手文本按步切段；工具 item 在 `tool_execution_start` 时就落宿主 | 文字在工具上面 · 工具顺序随机 · 自言自语挤成一坨 · 顺带把 G6 七态从「渲染层 join 三路」降成「读一个字段」 |
| **刀 2 · 可行动的工具错误** | R-B | 校验失败必须带 `path` / `expected` / `received 类型` / `分支归属` / `nextAction`，并**回给模型**；边界层对「数组被写成 JSON 字符串」这一族**容忍并归一** | 同一工具连错 6-7 次 · 模型在同名工具间抖动 |
| **刀 3 · 工具契约规范** | R-C | 合并重复工具、拆分 9 分支巨兽、每个工具补 3-4 句描述 + 1 个示例、给关键字段补说明与枚举 | 选不对工具 · 参数写不对 · 上下文被 schema 吃掉 |
| **刀 4 · 一次写对率评测** | 全部 | 零额度结构门岗（进 CI）+ 手动付费真实模型评测（记账不进 CI） | 防复发；给「改好了没有」一个数 |

### 1.2 不动项（明确列出，避免范围蔓延）

- **不动 v4 的 8 个积木词表、不动面板长相。** 有序流落地后，8 个积木一个不改，只是按真实顺序出现。
- **不动审批/花费边界。** `ProjectAgentApprovalPolicy`、介入槽语义、ProductionRun 门全部不碰。
- **不动 pi 运行时**（`electron/harness/runtime/pi/*.mts`）除 §3.2 一处错误透传外的任何逻辑；不升 pi SDK。
- **不引入 Vercel AI SDK 依赖。** 只借 `UIMessage.parts` 的**结构**（一条有序流 + 位置即顺序），不装包。
- **不改 MCP 对外协议版本**；对外工具面随刀 3 一起收敛，但 `tools/list` 的确定性顺序保持不变
  （`agentToolCatalog.ts:31-35` 已合规，见审计 V9）。
- **不动 `docs/design/2026-09-06-agent-panel-v4.md` 的设计定稿。**
- **不在提示词里加任何新的「请不要把数组写成字符串」。** 相反，刀 2 落地后**删掉现有三处**
  （`storyboardLauncher.ts:40`、`:80`，以及渲染层那半个 `parseJsonArrayString`）——P1 加新必删旧。

---

## 2. 刀 1 · 有序 parts 流契约

### 2.1 契约（最小改动）

```ts
// electron/shared/projectAgentContracts.ts
type ProjectAgentItemBase = ProjectAgentRecordBase & Readonly<{
  itemId: string; threadId: string; turnId: string;
  /**
   * 本条在**它所属回合**内的位置。宿主在写入时单调分配（当前 turn 的 max+1），永不复用、永不回填。
   * 这是**唯一**的顺序真相源。`createdAt` 从此只用于算用时，不再参与排序。
   *
   * 为什么不是把 items 改成嵌套的 parts 数组：宿主是扁平 items + 增量 patch
   * （`ProjectAgentChange` 12 个变体），改成嵌套要重写 reducer、命令账本与持久化。
   * 一个单调整数给出**同样**的排序保证，而 patch/reducer/持久化全部不动。
   */
  turnSeq: number;
  parentItemId?: string; correlationId?: string;
}>;
```

**行业依据**（审计 §1.4，四家一致）：Anthropic 的 assistant `content` 数组、AI SDK 6 的 `UIMessage.parts`、
MCP 的结果 `content` 数组、Claude Agent SDK 的有序帧流——**没有一家把一个回合拆成按类型分开的列表**。
`turnSeq` 是把「数组下标」这件事在扁平存储里表达出来的最小方式。

### 2.2 助手文本按步切段

现状：一个回合一条 `assistant` item，所有 delta 拼进 `text`
（`projectAgentTurnExecution.ts:85-97` + `projectAgentAssistantAppendReduction.ts:76-81`）。

改：**每一步一条**。切点是现成的——`run.mts:224-226` 已经在 `turn_end` 时发 `step-finish`。
收到 `step-finish` 后，下一个 `content-delta` 开一条新的 assistant item（拿新的 `turnSeq`）。

- 一步内的 delta 仍然拼进同一条（`assistant.append` 语义不变，只是 itemId 换成「当前步的那条」）。
- `assistantFinal` 从「用 `response.text` 覆盖整条」改成「只封口最后一条」——
  否则最终文本会把前面几步的分段又合回去（现状 `projectAgentTurnExecution.ts:678-687` 正是这么做的）。

### 2.3 工具 item 提前落宿主

现状：`projectAgentTurnExecution.ts:616-618` 在回合结束时 `response.toolCalls.map(...)`，共用一个 `receivedAt`。

改：
- `tool_execution_start`（`run.mts:205-208`）→ 立即 `item.put` 一条 `status:'drafting'` 的 tool item，
  拿 `turnSeq`，`createdAt` = 该事件时刻；
- `tool_execution_end`（`run.mts:209-223`）→ `item.transition` 改终态，`updatedAt` = 结束时刻；
- 回合结束时的批量生成**删掉**（P1：不留并行版）。

**副作用（正向）**：wiring plan 的 G6 从「渲染层 join `tool-call` 事件 + 待决登记表 + 终态 item 三路」
降级成「读宿主的 status」。`input-available` / `output-available` / `output-error` 直接来自宿主，
只有 `approval-requested` / `approval-responded` 仍需 join 待决登记表。
`ProjectAgentResidentShell.tsx` 那个模块级 `residentPendingTools` Map 的职责随之缩小。

### 2.4 投影层

`src/workbench/ai/v4/agentPanelV4Projection.ts:247-255` 的 `sortedItems()` 改成：同一 turn 内按 `turnSeq`，
跨 turn 按 turn 的先后。**两个 tie-break（`itemId` 字典序 / 宿主数组下标）一起删**（P1）。

### 2.5 迁移

`turnSeq` 是新字段，旧快照没有。迁移在 `projectAgentMigration.ts` 里做：
按现有 `items` 数组顺序为每个 turn 回填 `0..n`（数组顺序就是历史写入顺序）。
**不猜、不按 createdAt 重排**——旧数据的 createdAt 本来就只有两个值，重排会造出一个假的顺序。

---

## 3. 刀 2 · 工具契约规范（错误可行动 + 边界容忍）

### 3.1 错误结构

新增一个跨两层共用的形状（住在 `electron/shared/agentCapabilities/`，**只有一个 owner**）：

```ts
export type CapabilityInputIssue = Readonly<{
  path: string;              // "nodes" / "shots[0].prompt"
  expected: string;          // "array" / "string" / "one of: image | video"
  receivedType: string;      // "string" —— **只有类型名，不带值**（见下）
}>;
export type CapabilityToolError = Readonly<{
  code: string;              // 仍是现有闭合词表，供 UI 分档
  message: string;           // 一句人话：说清哪里错、期望什么
  issues?: readonly CapabilityInputIssue[];
  branch?: string;           // union 时命中的分支（= 模型给的 operation）
  allowed?: readonly string[]; // 枚举/operation 时列出全部合法值
  nextAction: string;        // 「把 nodes 直接给数组本体，不要 JSON.stringify」
}>;
```

**安全边界**：`receivedType` 只带**类型名**，绝不回传收到的**值**——
用户文稿正文、素材路径都可能在参数里，那是 provenance/隐私边界（后端评审意见）。
现状 pi 那层会把整个 `Received arguments` 原样回给模型（审计 §2.2③ 的实录），
这条要随刀 2 一起收口。

### 3.2 三处落点

| 层 | 现状 | 改成 |
|---|---|---|
| **pi JSON-Schema 校验**（`runtime/pi/tools.mts:43-50` 生成的 schema，由 pi 自己校验） | 9 分支报错平铺、不标分支、附带完整原始参数 | 在 `beforeToolCall`（`tools.mts:68-77`）**先**用我们的 Zod 校验并抛结构化错误，让它先于 pi 的 ajv 报错抵达；或在 catch 里把 ajv 报错按 `operation` 过滤成命中分支那一份 |
| **主进程能力边界**（`capabilityExecutorRegistry.ts:341-343`、`generationTransportAdapters.ts:86`、`productionRunTransportAdapters.ts:42-44`） | 丢掉 `error.issues`，抛裸 code | 把 `safeParse` 的 `issues` 映射成 `CapabilityInputIssue[]` 带出来 |
| **传输层回执**（`canvasWriteTransportAdapters.ts:69-75`、`projectAgentExecutionCoordinatorTypes.ts:222-235`） | `message: code`；`nextAction` 只进 UI 不回模型 | `message` 是人话；`nextAction` **同时**回给模型和 UI |

**行业依据**：MCP 2026-07-28 明写——错误「SHOULD be reported inside the result object, with `isError` set to true…
Otherwise, **the LLM would not be able to see that an error occurred and self-correct**」；
Anthropic 要求「Write **instructive** error messages… include what went wrong and **what Claude should try next**」。
我们对外 MCP 路径**已经这么做了**（`dispatcher.ts:557-565`），内部 Agent 路径没有——**内外不对等本身就是要修的东西。**

### 3.3 边界容忍（一族，不是一个字段）

**规则**：模型把结构化值序列化成 JSON 字符串，是**跨模型的通用行为**，不是某个模型的毛病。
所有 `z.array(...)` / `z.object(...)` 的模型面入参，在**最外层边界**统一过一次归一化 preprocess：
若收到 string 且 `JSON.parse` 后类型正确，则接受并**在结果里回一句「已按 JSON 字符串解析」**（不静默）。

落点必须是**模型能到达的第一层**（`canvasWrite.ts` 的 `canvasWriteSemanticInputSchema` 及同族），
不是渲染层的第二道校验。**同 commit 删掉现有的三处症状级补丁**：
`storyboardPlanSchema.ts:72-87` 的半套 preprocess、`storyboardLauncher.ts:40` 与 `:80` 的两条提示词恳求（P1 + R28）。

### 3.4 工具目录收敛

| 动作 | 对象 | 依据 |
|---|---|---|
| **合并** | `nomi_canvas_plan` + `nomi_canvas_edit` → **一个** `nomi_canvas_write`。两者 schema 字节级相同（8238 B ×2），差别只是宿主看得见的 `phases` | Anthropic「Consolidate related operations into fewer tools」「Fewer, more capable tools reduce selection ambiguity」；真机实测模型在两者间抖动 |
| **拆分** | `canvas.write` 的 9 个 operation 拆成 **3 个语义工具**：`nomi_canvas_write`（节点/边：`set_node_prompt`+`create_canvas_nodes`+`connect_canvas_edges`+`tidy_canvas`）、`nomi_storyboard`（`propose_storyboard_plan`+`patch_shots`+`arrange_storyboard_to_timeline`）、`nomi_shot_reference`（`create_staging_reference`+`create_camera_move`） | 9 分支 `anyOf` 是错误不可归因的直接成因；拆完每个工具 ≤4 分支 |
| **合并** | `propose_edit_plan` + `apply_edit_plan` → 一个工具 + `operation: "preview" \| "apply"`（两者 schema 同为 3882 B）；`read_production_artifact(_content)` 同理 | 同上 |
| **命名统一** | 模型面全部 `nomi_<domain>_<verb>`。现状 `nomi_canvas_read` 与 `read_timeline` / `load_skill` / `get_media` / `export_timeline` **在同一个工具集里混用**（`agentChatPolicy.ts:112-131`） | Anthropic「Use meaningful namespacing in tool names」；MCP 2026-07-28 命名规则 |
| **描述** | 每个工具 **3-4 句**：干什么 / 什么时候用它而不是隔壁那个 / 不要用它做什么。现状中位 87 字符 | Anthropic「extremely detailed… at least 3–4 sentences」——「by far the most important factor in tool performance」 |
| **示例** | 每个 ≥2 分支或 ≥10 字段的工具带 **1 个** schema-valid 示例（写进 description，不依赖 `input_examples` 这个 Anthropic 专有字段——我们要跨供应商） | Anthropic「consider using `input_examples` for complex tools」；现状 **0/35** |
| **字段说明** | 全部**必填**字段 + 全部枚举字段带 `.describe()`。现状 23/35 工具零说明；`nomi_generation_plan` 57 字段 0 说明 | OpenAI「describe… **each parameter (and its format)**」 |
| **枚举** | `modelKey` / `vendor` 这类「值必须来自目录」的字段，schema 里给可用值或明写「必须来自 `nomi_*_read` 返回的清单，不要自己编」。真机实测模型编了一个 `"seedance"` | OpenAI「make invalid states unrepresentable」 |
| **数量目标** | 单次请求的工具数 **≤ 12**。现状 production profile **30 个** | OpenAI「Aim for fewer than 20 functions available at the start of a turn」 |
| **上下文目标** | 单次请求工具面 **≤ 4 000 token**。现状 storyboard 6 815 / production 12 641 | 前两条的自然结果 |

---

## 4. 刀 4 · 「工具一次写对率」评测

### 4.1 零额度部分（进 CI，跟着 contracts 跑）

一个新门岗 `check:tool-contracts`（**加规则先验它会红**，R17）：

| 断言 | 现状会不会红 |
|---|---|
| 模型面工具没有两个 `inputSchema` 结构相同 | 🔴 `nomi_canvas_plan` / `nomi_canvas_edit`、`propose_edit_plan` / `apply_edit_plan`、`read_production_artifact(_content)` |
| 每个工具描述 ≥ 3 句（或 ≥ 120 字符） | 🔴 35/35 |
| ≥2 分支或 ≥10 字段的工具必须带示例 | 🔴 全部 |
| 全部必填字段与枚举字段有 `.describe()` | 🔴 23/35 |
| 单个工具 JSON Schema `anyOf` ≤ 4 | 🔴 `nomi_canvas_plan`/`edit`（9） |
| 任一 capability profile 的工具数 ≤ 12、schema 总量 ≤ 4 000 token | 🔴 production（30 / 12 641） |
| 模型面工具名统一 `nomi_` 前缀 | 🔴 timeline/production/skills 组 |
| 任一 `CapabilityToolError` 构造点都带 `nextAction` 且 `message !== code` | 🔴 两处 |

**门岗做成棘轮**（基线只减不增），和 `check:heavy-path` / `check:boundaries` 同一套路。

另加一条**离线一次写对率回归**（零额度）：把真机抓到的**真实错误参数**
（`docs/audit/attachments/2026-09-06-tool-probe.jsonl` 里那些 `"nodes": "[...]"`）
钉成 fixture，断言「归一化后应当通过」+「若仍不通过，错误必须带 `path`/`expected`/`nextAction`」。
这是把本次 bug 变成永久回归测试。

### 4.2 手动付费部分（不进 CI）

复用本次审计的探针方法，固化成 `evals/tool-first-write/`：

- 5 条任务 × 3 次（读文稿 / 改文稿 / 从原稿拆 8 镜 / 建 2 个镜头卡 / 读时间轴），
  隔离 profile + 真实 catalog（`prepareIsolation`），介入槽一律拒绝，**只花文本 token**；
- 产出一张表：每个 capability 的调用数 / 成功数 / 一次写对率；
- **今天的基线数字就是本次审计 §3.2 那张表**（`canvas.write` 0/18）；
- 触发时机：改工具目录、改校验边界、换默认文本模型时手动跑。

> ⚠️ **不要复活 `tests/ux/_agentProbe.mjs`**：它依赖的 `window.nomiDesktop.agents` 桥在当前代码里已不存在
> （全仓 `cancelChatV2` 只剩测试文件自己），`apimart-text-brain.e2e.mjs` / `staging-reference.e2e.mjs`
> 已经是死的付费 e2e。新评测接**现役** `window.nomiDesktop.projectAgent` 通道
> （`electron/preload.ts:673-712`），并**同 commit 删掉**那两个死 e2e 与死 probe（P1）。

---

## 5. 与在途分支的边界（避免撞车）

| 分支 | 它在改什么 | 边界 |
|---|---|---|
| `fix/agent-v4-real-use-20260906` | **已全部合入 `origin/main`**（`git rev-list --count origin/main..` = 0）。本文所有 file:line 都是在 `origin/main`（`d974e6a55`）上核对的 | 无冲突 |
| `fix/design-lab-wired-states-20260906` | 正在改 `agentPanelV4Projection.ts` 的 `sortedItems()` 第二键：`itemId` 字典序 → **宿主数组下标**（提交 `f2b5a5c4a`），另改实验室/走查 | ⚠️ **同一个函数**。**先合它，再动刀 1**。它的改动方向与本方案一致（用写入顺序而不是哈希），是刀 1 的正确前置；刀 1 落地后 `sortedItems()` 退化成单键 `turnSeq`，那两个 tie-break 一起删（P1）。**本方案不重写它、不与它并行改同一个函数。** |
| `feat/design-lab-agent-panel-20260906` | 设计实验室状态格 | 刀 1 会改宿主快照形状 → 实验室夹具的 items 要补 `turnSeq`。作为刀 1 的验收项之一，不单独立轨。 |
| 分镜投影清零等在途修复 | 见 `docs/lessons/roadmap-20260905-four-cuts.md` 一族 | 刀 3 会改 `canvas.write` 的工具切分 → 与分镜写入路径相邻。**刀 3 排在分镜相关 PR 全部合入之后**。 |

---

## 6. 验收门

| 门 | 判据 | 怎么证 |
|---|---|---|
| **G-1 顺序** | 一个回合里，助手文本与工具收据按**真实发生顺序**交错出现 | 真机走查截图人眼判断（R13）：一段文本 → 一条收据 → 一段文本，而不是「全部文本 → 全部收据」 |
| **G-2 顺序（机器）** | `sortedItems()` 单键 `turnSeq`；同回合工具的相对顺序 == `response.toolCalls` 顺序 | 单测 + 实验室基线 |
| **G-3 一次写对率** | `canvas.write` 族一次写对率从 **0/18** 提到 **≥80%**；「建 2 个镜头卡」3/3 回合全绿 | §4.2 付费评测，与本次基线同法复跑 |
| **G-4 拆镜头走对路** | 「从原稿拆 8 镜」3/3 回合调到 `nomi_storyboard`（现状 0/3） | 同上 |
| **G-5 错误可行动** | 任一校验失败的工具结果都带 `path` + `expected` + `nextAction`，且 `message !== code` | `check:tool-contracts` 硬断言 |
| **G-6 不回传参数值** | 工具错误里不出现用户文稿正文/素材路径 | 单测：喂一段含哨兵串的参数，断言错误文本里没有它 |
| **G-7 工具面收敛** | 无重复 schema；任一 profile ≤12 工具、≤4 000 token | `check:tool-contracts` 棘轮 |
| **G-8 加新必删旧** | 三处症状级补丁（`storyboardPlanSchema.ts` 半套 preprocess、`storyboardLauncher.ts:40`/`:80` 两条恳求）已删；两个死付费 e2e + 死 probe 已删；回合末批量生成 tool item 的旧路径已删 | `git diff` 逐条对账 |
| **G-9 五门** | contracts 全绿 + 按 R22 选定的验证档 | — |

---

## 7. 分段与回滚

| 段 | 内容 | 可独立回滚 | 前置 |
|---|---|---|---|
| **S0** | 合入 `fix/design-lab-wired-states-20260906` | 已是独立 PR | — |
| **S1** | 刀 2 前半：错误结构 + 三层透传 + 边界容忍 + 删三处症状补丁 | ✅ 纯边界层，回滚＝revert 一个 commit | S0 |
| **S2** | 刀 4 零额度门岗 `check:tool-contracts`（**先验它在 S3 前会红**） | ✅ | S1 |
| **S3** | 刀 3：工具合并/拆分/描述/示例/枚举 | ⚠️ 改工具名 → 需同步 MCP 对外面与走查；回滚要连 catalog 测试一起 revert | S2；且分镜相关 PR 全部合入后 |
| **S4** | 刀 1：`turnSeq` + 助手分段 + 工具 item 提前落宿主 + 迁移 | ⚠️ 契约改动，回滚需连迁移一起 revert；旧快照读得回来（新字段可选读、写时必填） | S0 |
| **S5** | 刀 4 付费评测固化 + 删两个死 e2e | ✅ | S1–S4 |

**回滚原则**：S1/S2/S5 各自独立可 revert。S3 与 S4 各自是一个原子 PR，**不许拆成半截合入**
（半截 = 并行版，违反 P1）。S3 与 S4 之间没有依赖，可并行开发、串行合入。

**先做哪一段**：S1。理由——它单独就能把「连错 6 次」压下去（模型拿到 `nodes 期望数组、你给了字符串` 就能自纠），
风险最低、回滚最容易，而且它是 S2 门岗的前置。**S4（顺序）虽然是用户第一句抱怨，但它不解决「工具本身有问题」**，
而后者才是让任务做不成的那一半。

---

## 8. 六角色评审

**CTO**：分段是对的——S1 用最小改动吃掉最大痛点，S3/S4 各自原子。
我要加一条硬约束：**S3 改工具名会同时动对外 MCP 面**，那是外部宿主（Claude Code 等）的兼容边界，
必须在 S3 的 PR 描述里列出改名前后对照，并确认现有对外用户量。
另外 S2 那个门岗必须在 S3 之前落地并**验证它是红的**——先绿后红的门岗是装饰品（R17）。

**设计**：G-1 不要用断言证，要用**截图人眼看**。判据我给具体的：
一屏之内能不能读出「它说了什么 → 它做了什么 → 结果如何」这条线。
另外请在 S4 顺带处理「同一工具连续失败」的折叠——7 条一模一样的红收据是噪音，
应当折成一行「尝试 7 次未成功 ›」，展开才看全部。这不新增积木，是一行收据的一个状态。

**PM**：我认可先做 S1。但请在 S1 合入后**立刻复跑一次 §4.2 评测**，
把 `canvas.write` 的一次写对率填进 G-3 —— 如果 S1 之后就到了 80%，S3 的紧迫性下降、可以排到分镜之后；
如果还是低，说明重复工具那条（S3）才是主因，要提前。**别等三刀全做完才量。**

**前端**：投影层这边只有一句：`sortedItems()` 在 S0 和 S4 之间**会被改两次**。
第二次是删代码（两个 tie-break 全删），不是再加一个键。请在 S4 的 PR 里明确写出这次是**净删**，
免得下一个人以为三个排序键都还在用。实验室夹具补 `turnSeq` 那件事量不大，但基线会全量翻——
S4 的 PR 会带一批基线更新，别当成回归。

**后端**：`turnSeq` 分配必须在 reducer 里做，不能让运行时报——
`async.result` 批量落账时运行时报的序号会和已有 items 撞。
迁移用数组顺序回填是对的，**别按 `createdAt` 重排**：旧数据每回合只有两个时间戳，重排会造出假顺序。
还有 §3.1 那条「只回类型名不回值」我坚持——现状 pi 把整个 `Received arguments` 原样回给模型，
里面可能有用户文稿正文，这是 provenance 边界，S1 必须一起收口。

**真实用户**：我要的很简单——它试一次不成，**换个法子再试**，而不是把同一句话说七遍。
第二，别一边说「我来建镜头卡」一边什么都没建成；说和做要对得上。
第三，如果它真的做不到，直接告诉我做不到，我去手动建，别让我看七条红字猜。
