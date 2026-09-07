# Agent 面板 v4 · 打包版真实使用一批修复（2026-09-06）

> 状态：✅ 已交付 —— 实施与本文同批（PR #558）。本文是这批修复的方案侧记录：
> 范围、不动项、回滚、验收门，以及 R27 要求的「先查别人」。
> 基线：`origin/main`（PR #558 的 merge-base）。全文 `file:line` 均在此 checkout 上实核。
> 上游输入：[#549 成熟 Agent 产品调研](../research/2026-09-06-mature-agent-products.md)、
> 真机 QA 记录 [`docs/qa/2026-09-06-agent-panel-v4-real-use-fixes.md`](../qa/2026-09-06-agent-panel-v4-real-use-fixes.md)、
> 根因合同 [`docs/fixes/2026-09-06-tool-array-args-json-text-tolerance.root-cause.json`](../fixes/2026-09-06-tool-array-args-json-text-tolerance.root-cause.json)。
> 下一阶段：[Agent 运行时重做方案（2026-09-07）](2026-09-07-agent-runtime-rebuild.md) —— 本文里标了
> **「过渡补丁」**的两处，在那份方案的阶段 2「工具契约重做」里删掉。

---

## 0. 先说清楚：这批修复在解决哪个真实摩擦

2026-09-06 晚，用户在**打包版**里做了一件最普通的事——在分镜表 v6 里让 Agent（对话模型
DeepSeek）「从原稿重拆 10 镜」。屏幕上发生的是：

1. 「创建或修改镜头卡」连着失败 **6 次**，每条只有「⚠ <1s」，**一个字的原因都没有**；
2. 展开任意一条收据，「输入」和「输出」两栏写着**同一句工具描述**（「将内容写入当前文稿」）；
3. 六条失败之间夹着模型的自言自语（「我看到参数需要是数组而不是字符串…」「我把 JSON
   字符串化两次了…」），和最终回答一样宽、一样黑；
4. 面板头上的上下文环是一个恒定的灰圈 +「—」；
5. 模型弹层把整个文本模型目录摊成 17 行，每行都写「对话」，一个下拉都没有；
6. 分镜行上写着「此模型不吃参考」——而同一个模型的图生视频档摆在那里就能挂首帧。

**这六件事看起来是六个 bug，共用两个形状**：

> **① 面板在复述「这个工具是干嘛的」，而不是转述「这一次调用真的发生了什么」。**
> 描述是静态的、每次都一样，所以它在成功时看着像对的，在失败时就变成一句谎话。
>
> **② 工具契约既没告诉模型数组长什么样，也不肯收它写出来的那种，回执还读不懂。**
> 模型自己都猜对了病因，仍然改不回来——因为回执是 9 个联合分支的矛盾诉求 + 整包 payload 回显。

**要权衡的那一个东西**：这批修复是**过渡性的**。运行时形状错了这件事已经在
[2026-09-07 重做方案](2026-09-07-agent-runtime-rebuild.md)里拍板要整体换掉，所以这里的取舍是
——**哪些必须现在修（用户今天就在撞、且修在正确的层）、哪些必须忍到重做**。判据是「这一刀落在
不会被重做冲掉的层上吗」：参数契约、投影层、目录数据，会留下；渲染层的折叠策略与文案翻译，
重做时会被工具自带渲染取代，所以做成**独立纯函数层**、不长进组件里。

---

## 先查别人

> 四问按 R27 §16 的模板。**「他们怎么做 → 我们这批怎么做 → 判定」**三段写在同一格里，
> 判定只有三种：**一致** / **有意不同（附理由）** / **后续要改（附去处）**。

| 问 | 他们怎么做 → 我们这批怎么做 → 判定 | 出处 |
|---|---|---|
| 生态里已有？（错误可行动） | **他们**：Codex 的 `FunctionCallError` 只有两个 variant，`RespondToModel(String)` 把错误文本当工具输出回给模型、**回合继续**；错误消息直接**教模型怎么改**（「\`justification\` requires an explicit \`sandbox_permissions\`; use … or omit」）。**我们**：`readableSchemaFailure` 把 Zod 的 issue dump 换成「哪个字段 / 期望什么 / 收到了什么」，最多 6 行、**不回显入参**（模型手上就有）。**判定：一致**——这正是 #549 §3.2 结尾点名 Nomi 要补的那条 | [`docs/research/2026-09-06-mature-agent-products.md`](../research/2026-09-06-mature-agent-products.md) §3.2（引 `codex-rs/tools/src/function_call_error.rs`、`core/src/tools/handlers/mod.rs:85-92`）；我们的落点 `electron/harness/runtime/pi/tools.mts:45` |
| 生态里已有？（工具收据怎么折叠） | **他们**：Cline 的 `groupLowStakesTools` **按风险分层**——只读探查（`readFile`/`searchFiles`…）折成一组一行，写/执行/MCP 单独成卡；进行中显示动词进行时；**展开时绝不滚动**（注释：expanding should stay in place）；**可自愈的错误不给按钮**，只解释 + 自动重试。**我们**：按「**同名工具连着调 N≥2 次**」折成一行「创建或修改镜头卡 ×6 · 全部失败 · 原因」，只调一次的不动。**判定：有意不同**——用户撞到的现场恰恰是**写类**工具连着失败六次，按风险分层不会折它（写类单独成卡）；先按「重复」折才解决他看到的那一堆。**后续要改**：分层判据应当是 `CapabilityEffect`（`paid`/`destructive`）而不是工具名，与 #549「抄 2」的 never-auto-approve 闸共用同一份闭合词表——归阶段 2 | [`docs/research/2026-09-06-mature-agent-products.md`](../research/2026-09-06-mature-agent-products.md) §4.6（引 Cline `messageUtils.ts:17-23,533`、`ErrorRow.tsx:176`）、§7.3「抄 2」；我们的落点 `src/workbench/ai/v4/agentPanelV4Collapse.ts:86` |
| 生态里已有？（一次调用怎么呈现） | **他们**：pi 把 `renderCall` / `renderResult` **跟工具住在一起**——「这次调用长什么样」是工具定义的一部分，不是 UI 层的一张 switch 表，新增工具时 UI 不用改。**我们**：投影层新增 `input` / `output` 两段，落**真实入参**（按键名抹凭证 / 绝对路径缩成文件名 / 长串截断）与运行时回执里的**真实结果**。**判定：有意不同**——Nomi 的工具定义在主进程、渲染在渲染进程，render 函数跨不过 IPC；两段字符串跨得过去。**后续要改**：阶段 2 工具契约重做时把「这个工具怎么画」搬回工具定义旁边 | [`docs/research/2026-09-06-mature-agent-products.md`](../research/2026-09-06-mature-agent-products.md) §1.2；我们的落点 `src/workbench/ai/resident/residentToolProjection.ts`、`src/workbench/ai/v4/agentPanelV4Projection.ts:181` |
| 依赖里已有？（pi 0.85.1 的参数校验顺序） | **他们**：pi 的顺序写死在 agent loop 里——`prepareToolCallArguments`（`agent-loop.js:410`）→ `validateToolArguments`（`:411`，TypeBox `Value.Convert` + `Check`，失败抛 `Validation failed for tool "X": … Received arguments: <整包回显>`）→ **最后**才 `beforeToolCall`（`:412`，Nomi 的 Zod 住这里）。**这解释了根因**：模型写的字符串在 Nomi 的契约看到它之前就被挡掉了。**我们**：把「数组，或同一个数组的 JSON 文本」写进 Zod 契约本身，并让文本那支发布成 `{type:'string'}`，于是 TypeBox 放行、Zod 解开。**判定：一致**（修在最早的共享边界）——顺序本身是实核出来的，不是猜的 | `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:410`、`:411`、`:412`；`node_modules/@earendil-works/pi-ai/dist/utils/validation.js:280`、`:283`、`:306`；我们的落点 `electron/shared/agentCapabilities/jsonArgTolerance.ts:89`、`electron/harness/runtime/pi/tools.mts:71` |
| 依赖里已有？（pi 官方的「模型写歪了先捏一下」钩子） | **他们**：`ToolDefinition.prepareArguments?: (args: unknown) => Static<TParams>` —— **官方的兼容性钩子，跑在校验之前**，#549 §1.2 明确说「这不是 hack」。`AgentTool` 上同款。**我们**：**没有用它**，改在参数契约里加一条运输分支。**判定：有意不同（附理由）**——`prepareArguments` 只在 pi 那一路生效，而同一份 `canvas.write` 契约还要经 MCP `tools/list` 与传输超集两个发布口对外（外部宿主同样会把结构化参数二次序列化）。挂在 pi 的钩子上，MCP 那两路等于没写；挂在契约上，三路共用同一份容忍。**后续要改**：阶段 2 若运行时统一到 pi 的 `AgentHarness`、且 MCP 走同一份契约投影，`prepareArguments` 就该接管「捏合」这一层，届时评估把 `jsonTextBranch` 从契约里摘掉 | `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:344`、`:362`；`node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:347`；[`docs/research/2026-09-06-mature-agent-products.md`](../research/2026-09-06-mature-agent-products.md) §1.2 |
| 生态里已有？（Vercel AI SDK 的工具调用修复） | **他们**：`experimental_repairToolCall`（本仓锁的 `ai@4.3.19` 里就是这个名字；AI SDK 5 起去掉 `experimental_` 前缀叫 `repairToolCall`，AI SDK 7 迁移把回调入参 `system` 改名 `instructions`）。捕获 `NoSuchToolError` / `InvalidToolInputError`，把「模型写的入参 + 工具 schema」喂给**再跑一次的结构化输出模型**要一份改好的参数；工具名不存在就返回 `null` 不修；修复本身失败抛 `ToolCallRepairError`。**我们**：**不再跑一次模型**，纯字符串解析在边界层解开。**判定：有意不同（附理由）**——① 这一族错误（结构化参数被二次序列化）形状固定，`JSON.parse` 就能修，花第二次调用的钱和时间不划算，而 Nomi 的对话模型烧的是用户自己的额度；② 结构上也接不上：Agent 运行时走 pi，不走 `generateText`/`streamText`（`ai` 在本仓只用于 provider adapter 与 `electron/ai`），这个钩子在 Agent 那条路上根本没有挂点。**它的价值是佐证**：「模型会写歪参数、必须在边界修而不是等模型自己改对」是行业公认的一等问题 | Context7 / [AI SDK 官方文档 · Tools and Tool Calling](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling)、[`ToolCallRepairError`](https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-tool-call-repair-error)、[AI SDK 7 迁移指南](https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0)；本仓版本面 `node_modules/ai/dist/index.d.ts:2550`、`:3071` |
| 仓库里已有？ | **已有，而且正是问题所在**：`parseJsonArrayString` 有**两份逐字重复的私有拷贝**，都只包了 `shots` 一个字段（同一次调用里模型不会只把其中一个字段字符串化），且主进程那份挂在一套只有测试引用的 descriptor 上——**从没在真的模型面上跑过**。**我们**：收成唯一 owner `jsonArgTolerance.ts`，`canvas.write` 的九个数组参数整类覆盖，两份拷贝同 commit 删掉（P1）。**判定：一致**（这就是 R27 门岗要拦的那种「仓库里已有一份更差的」） | `git grep parseJsonArrayString origin/main` → `electron/harness/tools/canvasDescriptors.ts:139`、`src/workbench/generationCanvas/agent/storyboardPlanSchema.ts:72`；替代者 `electron/shared/agentCapabilities/jsonArgTolerance.ts:89` |
| TikHub 自媒体里怎么说？ | **本轮未查**。这批修的是工具参数契约与面板投影层，不是面向用户的产品能力，自媒体侧没有可比的一手经验——**明着标出来，不冒充覆盖** | 无 |

**结论**：

- **用已有**：错误文案形状抄 Codex（一致）；折叠/呈现的目标形状抄 Cline + pi，但**分层判据本轮不同**（见下）。
- **自研（有理由）**：JSON 文本容忍写在参数契约上，而不是 pi 的 `prepareArguments`，也不是 AI SDK 的
  `repairToolCall`——因为 Nomi 的同一份契约要同时喂 pi 和 MCP 两个发布口，只有契约层同时罩得住三路。

### 与《pi 参考实现一致性核对》（#566）工具层逐项对照

> 这份核对 2026-09-07 才进 main（`docs/research/2026-09-07-pi-reference-implementation-conformance.md`），
> 比本批修复晚。**回头拿它对了一遍**，不是补一句「读过了」——五条里两条一致、一条有意不同、
> 两条如实登记成「本轮没修」。判定仍是三种：一致 / 有意不同（附理由）/ 后续要改（附去处）。

| 核对项 | 他们怎么做 → 我们这批怎么做 → 判定 | 出处 |
|---|---|---|
| **G-08 / 1.6**「校验只发生一次，而且那一次必须是**会强转的**那一次」 | **他们**：pi 在 `Check` 之前有**四道**容忍，顺序写死——`structuredClone` → `normalizeOptionalNulls`（可选字段收到 `null` 就**删掉该键**）→ `Value.Convert`（`"5"`→`5`）→ 非 TypeBox 再走 `coerceWithJsonSchema`。核对结论：唯一校验点必须复用 `validateToolArguments`，**不要在后面再接一个严格的 `.parse()`**。**我们**：`tools.mts:100-105` 的 `beforeToolCall` 拿**原始的** `toolCall.arguments` 再跑一次 Zod —— 也就是核对里点名的那种「第二道、且更严的」校验。**判定：后续要改（本轮有意保留）**。本轮的理由：Zod 契约是 Nomi 唯一的能力真相源，pi 的 TypeBox 面是它的投影，删掉这一道等于把能力语义交给投影；而本轮修的 JSON 文本一族恰恰要在 Zod 这层解。**代价如实写**：pi 已经替我们兜掉的两族——可选字段填 `null`、数字写成 `"5"`——在 Nomi 的 Zod 面前会**重新开始失败**，因为 Zod 看的是强转**之前**的那份。这一族本轮没有复现报告，但结构上就在那儿。去处：阶段 2 收敛唯一校验点 | `docs/research/2026-09-07-pi-reference-implementation-conformance.md` §2 层 1 行 1.6 与 §G-08；实核 `node_modules/@earendil-works/pi-ai/dist/utils/validation.js:280`、`:222`；我们的落点 `electron/harness/runtime/pi/tools.mts:100` |
| **G-02 / 1.8**「失败必须 `throw`，`return` 一个错误对象会被记成成功」 | **他们**：文档原文 *"Returning a value never sets the error flag regardless of what properties you include in the return object."*；实现只有 `catch` 分支才置 `isError: true`。**我们**：`tools.mts:88` 宿主回执非 `ok` 一律 `throw new Error('[status] message')`，`beforeToolCall` 的校验失败也是 `throw`（带 `readableSchemaFailure`）。**判定：一致** —— 本轮收据能显红、能带出原因，正是因为走的是 throw 那条。**但登记一个缺口**：Host adapter 那一路把 `ZodError` 收成**返回**的 `capability_input_invalid`（§1.2 不动项已列），按这条核对它就是「会被记成成功」的形状，本轮只修了 pi 那一侧 | 同上 §2 层 1 行 1.8 与 §G-02（引 `pi-agent-core/dist/harness/execution/tools.js:61-73`）；我们的落点 `electron/harness/runtime/pi/tools.mts:88`、缺口在 `electron/capabilityCore/canvasWriteTransportAdapters.ts` |
| **G-01 + G-05**「根级 `anyOf` 会被适配器静默丢弃；枚举必须降成 `StringEnum`」 | **他们**：pi 8 个内建工具**没有一个**是根级 union，全是扁平 `Type.Object`；Google 的 legacy `parameters` 路径是 OpenAPI 3.03，不支持 `anyOf`/`const`；Anthropic 适配器已知会**静默丢掉**自定义工具 schema 的根级 `anyOf`（pi issue #9134）。**我们**：本轮只让九个数组参数吃得下「同一个值的 JSON 文本」，`canvasWrite.ts` 仍是根级 `z.discriminatedUnion('operation', …)`，全仓 `StringEnum` **0 次使用**（实核 `git grep StringEnum electron/ src/` 无命中）。**判定：后续要改（本轮没碰）** —— 直说要害：**D 的根因可能不止一条**。本轮证的是「模型把数组写成了 JSON 文本」这一支（有阳性对照）；「模型可能压根没看见那 9 个分支」那一支本轮既没证也没修，别把 D 当成已经关死 | 同上 §2 层 1 行 1.4 / 1.3 与 §G-01、§G-05；https://github.com/earendil-works/pi/issues/9134 ；实核 `electron/shared/agentCapabilities/canvasWrite.ts:225` |
| **G-04 / 1.9**「工具输出 **MUST** 自截断（50KB / 2000 行），截断时给可执行的下一步，全文落盘走 `details`」 | **他们**：文档级硬规则，`truncateHead`/`truncateTail` 随包导出，`read.js:128` 的正文直接写 `Use offset=2001 to continue.`，超长全文落临时文件经 `details.fullOutputPath` 给渲染器。**我们**：本轮确实加了截断，但**加在投影层**（`residentToolProjection.ts` 把长串截短、绝对路径缩成文件名——那是给**用户眼睛**看的两段）。**模型可见的工具输出本轮零截断**。**判定：后续要改（本轮没修，且不拿 UI 截断充数）** —— 两者连方向都不同：一个省用户的屏幕，一个省模型的上下文 | 同上 §2 层 1 行 1.9 与 §G-04（引 `pi-coding-agent/dist/core/tools/truncate.js:10-11`、`read.js:128`）；我们的落点只在 `src/workbench/ai/resident/residentToolProjection.ts` |
| **G-03 / 1.1**「描述三通道：`description` / `promptSnippet` / `promptGuidelines`，跨工具消歧只写一次」 | **他们**：「该用它还是用隔壁那个」住在系统提示词的 Guidelines 段、去重且按实际工具集条件化，**不在每个工具的 description 里复制**。**我们**：本轮把「怎么改」写进**运行时回执**（`readableSchemaFailure`），不是写进 description，也没有动 `promptSnippet`/`promptGuidelines`（全仓 0 次使用）。**判定：有意不同（本轮这一步）** —— 回执与描述管的是两件事：描述是「事前说明书」，回执是「你这次写错在哪一格」，Codex 的 `RespondToModel` 同样把可行动信息放回执。**后续要改**：跨工具消歧仍全塞在 description 里（S4 与 S7 数学上互斥那条），归阶段 2 | 同上 §2 层 1 行 1.1 与 §G-03（引 `pi-coding-agent/dist/core/system-prompt.js:42-76`）；我们的落点 `electron/harness/runtime/pi/tools.mts:45` |

**这一轮对照改变了什么**：没有改一行代码（本批已经在 CI 上、且核对本身晚于它）。它改的是**登记**——
D 从「已修」降级成「修掉了其中一支，另一支未证」，并给过渡补丁表补了第三条。

### 过渡补丁清单（阶段 2「工具契约重做」时删掉）

> 这两处是**框架已提供、我们这轮另写了一份**。如实写出来，不改代码去迎合门岗。
> 去处：[2026-09-07 Agent 运行时重做方案](2026-09-07-agent-runtime-rebuild.md) 阶段 2。

| # | 过渡补丁 | 上游本来提供什么 | 为什么本轮仍自己写 | 删除条件 |
|---|---|---|---|---|
| T1 | `electron/shared/agentCapabilities/jsonArgTolerance.ts` 的 `jsonTextBranch` —— 在 Zod 契约里加一条「同一个值的 JSON 文本」运输分支 | pi 的 `ToolDefinition.prepareArguments`（`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:362`），官方的「校验前先捏合」钩子 | 钩子只罩 pi 那一路；MCP `tools/list` 与传输超集两个发布口罩不到，而外部宿主同样会二次序列化 | 阶段 2 把 MCP 与 pi 收敛到同一份契约投影之后：容忍上移到 `prepareArguments`，契约回到干净的 `z.array(...)` |
| T2 | `src/workbench/ai/resident/residentToolDisplay.ts:553` 的 `humanizeToolFailure` + `src/workbench/ai/v4/agentPanelV4Collapse.ts` 的折叠层 —— 渲染层把两种机器写的校验回执翻成人话、并决定怎么折 | pi 的 `renderCall` / `renderResult`：**「这次调用怎么画」跟工具住在一起**（#549 §1.2） | 工具定义在主进程、渲染在渲染进程，render 函数跨不过 IPC；且本轮不该动运行时 | 阶段 2 工具契约重做把「渲染归工具」这条落地之后 |
| T3 | `electron/harness/runtime/pi/tools.mts:100` 的 `beforeToolCall` 再跑一次 Zod —— pi 校验之后的**第二道、且更严的**校验（本轮没有新增它，但本轮的 JSON 文本容忍写在它上面，一起登记） | pi 的 `validateToolArguments`（`node_modules/@earendil-works/pi-ai/dist/utils/validation.js:280`），自带 `normalizeOptionalNulls` + `Value.Convert` 两道容忍 | Zod 契约是 Nomi 能力的唯一真相源、且同时喂 MCP 两个发布口；本轮删不掉它，删了等于把能力语义交给 TypeBox 投影 | 阶段 2 唯一校验点收敛到 pi 的容忍梯之后（核对 §G-08）；收敛前 `null` / `"5"` 两族仍会在 Zod 面前重新失败 |

---

## 1. 范围

### 1.1 做（八条，按「一个根因解决几个症状」排序）

| # | 症状（用户屏幕上看到的） | 根因 | 落点 |
|---|---|---|---|
| A | 展开收据，「输入」「输出」两栏是同一句工具描述 | 两栏读的都是 `readableToolPreview`/`readableToolSummary` 的兜底描述；`response.toolCalls[].args/result/error` 在写侧被整包丢掉；更底下，收据正文缓存**从来没生效过**（scope 用发送前的快照，首次发送时线程还没建好 → 空串 → 直接 return） | `residentToolProjection.ts`（`input`/`output` + 脱敏）、`residentToolDisplay.ts`、`useAgentPanelV4Actions.ts`、`agentPanelV4Projection.ts`、`useAgentPanelV4Data.ts`（读侧订阅口） |
| B | 六条同名收据平铺、失败无原因 | 收据层没有「同一件事失败了 N 次」这个概念；失败行摘要仍印「打算做什么」；回合失败时落盘代码在 `throw` 之后，整批正文全丢 | 新增 `agentPanelV4Collapse.ts`（纯函数）、`AgentPanelV4Receipt.tsx`、`workbenchAgentRunner.ts`（回执挂 error 带出） |
| C | 过程自述与最终回答一样宽、一样黑 | 宿主把一个回合的全部助手正文合并成一条 item | `agentPanelV4Projection.ts` 按调用偏移切段 + `agentPanelV4Collapse.ts` 折过程行 —— **真机上这一档走不到，见 §4.2** |
| D | 建卡工具拒了模型 6 次 | `nodes`/`edges`/`anchors`/`shots` 是裸 `z.array(...)`；pi 的 TypeBox 跑在 Nomi 的 Zod 之前（`agent-loop.js:410-412`） | 新增 `jsonArgTolerance.ts`（唯一 owner）、`canvasWrite.ts` 九个数组参数、`canvasDescriptors.ts` / `storyboardPlanSchema.ts` 删私有拷贝、`mcpTransportSchemaFromZod.ts`（只广播结构化那一支）、`tools.mts`（`readableSchemaFailure`） |
| E | 模型弹层 17 行「对话」平铺、没有下拉 | 容器把整个文本模型目录摊成一行一个模型 | 新增 `agentPanelV4ModelRows.ts`、`ProjectAgentResidentShell.tsx`、`AgentPanelV4Composer.tsx`；三行各接**已有的** owner（`assistantModelPref` / `generationModelDefaults`），不新开偏好 |
| F | Skill 弹层行首 36×56 白块 | 「hover 换预览视频」预留的位，功能没做、`SkillListItemDto` 里也没有封面字段 | `AgentPanelV4Composer.tsx`：有图画图、没图画图标格；提示词库那段本来就带 `mediaUrl`（映射时被丢掉） |
| G | 上下文环恒为灰圈 +「—」 | 用户真实目录里 **21 个对话模型的 `meta.contextWindow` 一个都没有** | 新增 `modelContextWindowCatalog.ts`（一手文档 + 来源 URL + 查证日期，19 键 15 个拿到数）、`modelContextWindow.ts`、`AgentPanelV4Context.tsx`（没有分母就不画环，改说「已用 62.4K」） |
| H | 分镜行「此模型不吃参考」 | 主语错了：判据本来就是 `mode.slots.length === 0`——不吃参考的是**模式** | `shotReferenceCells.ts`、`ShotReferenceZone.tsx`、`StoryboardAnchorRow.tsx`、`storyboardEditor.ts` 词条 |

### 1.2 不动项（明确列出，避免范围蔓延）

- **不动 pi 运行时的转录形状**。有序 parts 流、`LaneSnapshot`、跨回合 session —— 全部归
  [重做方案](2026-09-07-agent-runtime-rebuild.md)。本轮只在**投影层**按调用偏移切段。
- **不动审批策略**。`projectAgentExecutionPolicy` 一行不改；#549「抄 2」的 never-auto-approve 闸不在本轮。
- **不动花费**。`Model.cost` 仍是零价目表，「花费」行仍然空着（#549「抄 3」，归重做方案）。
- **不动 Host adapter 那一路的 Zod issue**。`canvasWriteTransportAdapters.ts` 把 `ZodError` 收成
  `capability_input_invalid`、`projectAgentExecutionCoordinatorTypes.ts` 又把 `message` 设成 code 本身
  —— 那一路的回执模型仍读不懂。**本轮只修了 pi 那一侧**，如实登记在 QA 记录 §4。
- **不动行布局**。行内原因仍被 340px 列宽截成「nodes：期…」——那要样张拍板。
- **不录设计实验室基线**。新增/改动的五格等用户亲眼看过接触表（UI 交付定义）。
- **不加音频默认模型**。仓库里没有 audio 生成能力，2026-09-07 用户拍板**删掉**弹层第四行。

---

## 2. 回滚

三层独立，可分别回滚，互不依赖：

| 层 | 回滚方式 | 回滚后回到什么 |
|---|---|---|
| 参数容忍（D） | `canvasWrite.ts` 把 `jsonTolerantArray(x)` 换回 `x`，删 `jsonArgTolerance.ts` | 回到「模型二次序列化就被 TypeBox 挡掉」；**两份私有拷贝不恢复**（它们只包 `shots`，恢复等于恢复一个更差的版本） |
| 面板折叠与文案（A/B/C） | `AgentPanelV4Receipt.tsx` 不调 `collapseV4Flow`，投影层 `input`/`output` 两段不落 | 回到平铺 + 兜底描述。折叠是**独立纯函数层**，不删组件、不改积木词表 |
| 目录数据（G） | 删 `modelContextWindowCatalog.ts`，`modelContextWindow(meta, key)` 退回单参 | 回到「供应商没报就没有分母」；环退回不画（这条是本轮改的显示纪律，与目录表相互独立） |

E/F/H 是局部组件与文案改动，单文件 revert 即可。

---

## 3. 验收门

> 每一条都钉在 §0 里那六个**用户屏幕上的**症状上，不写「测试通过」这种与体验无关的门。

| 门 | 对应症状 | 判据 | 证据 |
|---|---|---|---|
| G1 | ② 两栏同一句描述 | 展开任意一条收据，「输入」是**这次真的发过去的入参**、「输出」是**这次真的收到的回执**，两栏内容不同 | 走查截图 03（读取画布：输入 `{}` / 输出「画布当前为空。」）、截图 04（失败条：输入含被二次序列化的 `nodes`，输出是真实校验回执）；`agentPanelV4Projection.test.ts` |
| G2 | ① 六条「⚠ <1s」无原因 | 同名工具连调 N≥2 折成一行，行内带**读得懂的中文原因**；行内**不出现**英文抬头、不出现只有标点的碎片 | 走查截图 01：「创建或修改镜头卡 ×3 · nodes：期… · ⚠ 全部失败」；`agentPanelV4Collapse.test.ts`（10 条）+ 变异测试（把 `failureReason` 换回 `find(Boolean)` 三条断言当场翻） |
| G3 | ③ 过程自述与回答同权重 | 最后一次调用**之前**的助手文本折成「尝试了 N 次 · 展开」，最终回答摊开；**切不开就整段原样渲染，绝不把唯一那条回答折没** | 走查截图 02；实验室格 `v4-process-folded`。⚠️ **真机上这一档走不到**（宿主不给锚），走查断言的是那条退让 —— 如实登记 |
| G4 | 建卡连失败六次 | 十镜 payload 的**结构化**与**二次序列化**两种写法解出同一个值；发布层用 pi 同一套选项 + TypeBox 验两种都过，**带阳性对照**（换成裸数组必须挡下来） | `jsonArgTolerance.test.ts`（170 行）、`tools.mts` 测试。⚠️ **没有跑一次真实 DeepSeek 调用**证明「模型一次写对」—— 如实登记 |
| G5 | ④ 上下文环恒为灰圈 | 查得到窗口 → 画环；查不到 → **不画环**，改说「已用 62.4K」；连用量都没有 → 「—」 | `modelContextWindowCatalog.test.ts`；实验室格 `v4-context-window-unknown` |
| G6 | ⑤ 模型弹层 17 行平铺 | 弹层是**三行**（对话 / 图片默认 / 视频默认），每行 = 当前模型 + 价格 + 一个真下拉；同名模型跨供应商按 #535 偏好序折成一行；该类无可用模型时给实话，不画按不动的空下拉 | `agentPanelV4ModelRows.test.ts`；实验室格（模型弹层） |
| G7 | ⑥「此模型不吃参考」 | 文案主语是**模式**；同档案里有吃参考的兄弟模式时把去处说清（「文生视频 不吃参考 · 切「首帧」模式可挂参考」），指不出去处就只说模式名、不编替代 | `shotReferenceSlots.test.ts`；两张 storyboard 实验室基线更新 |
| G8 | —（工程门） | `pnpm run gates:contracts` 全绿；`agent-v4-retry-storm.walk.mjs` 与 `agent-v4-short-film.walk.mjs` 真机复跑通过（loopback，`paidCalls: 0`） | CI Contracts / Unit / E2E Walkthroughs |

**未满足的门（如实登记，不算通过）**：G3 的真机档、G4 的真实模型档，两条都写在
[QA 记录 §3](../qa/2026-09-06-agent-panel-v4-real-use-fixes.md)；实验室五格**未录基线**，等用户看过接触表。

---

## 4. 与在途分支的边界

- **同一回合的收据顺序**：main 这一轮独立修了同一件事（第二排序键改成数组原序），合并时取了 main 那版。
- **[2026-09-07 重做方案](2026-09-07-agent-runtime-rebuild.md)**：本文的两处过渡补丁（T1/T2）在它的阶段 2 删除。
  两者不冲突——本轮一行运行时代码未改。
- **[pi 参考实现一致性核对（#566）](../research/2026-09-07-pi-reference-implementation-conformance.md)**：晚于本批进 main。
  已回头逐项对过（见「先查别人」的对照小节），结论是**本批不返工**——两条一致、一条有意不同，
  两条未修的（根级 `anyOf`、模型可见输出截断）都归阶段 2，且已把 D 的登记从「已修」降成「修掉一支」。
