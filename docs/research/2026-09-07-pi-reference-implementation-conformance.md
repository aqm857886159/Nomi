# pi 参考实现一致性核对（2026-09-07）

> 状态：📎 交接/日志 —— **只审不改，一行产品代码未动。**
> 日期：2026-09-07 · 基线：`origin/main@47323b12c` · 依赖：`@earendil-works/pi-{coding-agent,agent-core,ai}@0.85.1`（main 已锁）
> 性质：只调研不改码
> 服务对象：[`docs/plan/2026-09-07-agent-runtime-rebuild.md`](../plan/2026-09-07-agent-runtime-rebuild.md)（Agent 运行时重做方案）的拍板与阶段推进
> 起因：2026-09-07 用户原话 —— **「pi 他们 coding agent 的架构，我们这次优化完是不是一致了？是不是真的做了完整调研？他已经想好的那些东西，比如工具怎么搞的，是不是有些细节我们还没弄好？」**

---

## 0. 用户三问，先直接回答

**问 1「优化完是不是一致了？」** —— **架构骨架一致，工具层不一致。**
重做方案的分层（转录=lane、顺序=transcript、钱=`calculateCost`、队列=lane 级、审批=`before_tool`）与 pi 自己的 coding agent 逐项对得上，这一层没有走偏。但**工具层是另一回事**：pi 的工具不只是「一个 schema + 一个 execute」，它是**三条通道 + 一条容忍梯 + 一条截断契约 + 一条动态装载机制**，我们的方案只覆盖了其中的一条半。

**问 2「是不是真的做了完整调研？」** —— **做了，而且做得比大多数方案扎实（双版本 tarball 实核 + 四题真机探针 + $0.0005 真实模型验证），但调研面有一个系统性缺口：全部证据来自 `dist/*.d.ts` 与实跑，没有人读过 pi 随包发布的 `docs/`（33 篇）、`examples/extensions/`（60+ 个参考扩展）和 553KB 的 `CHANGELOG.md`。** 这三样都在 `node_modules` 里躺着，一次 `ls` 就能看见。本次审查的绝大多数新发现来自这三个从未被打开的目录。

**问 3「工具怎么搞的，有些细节我们还没弄好？」** —— **是。九条，其中五条会在阶段 2 之前咬人。** 最要命的一条：
> **我们的 22 个能力里有 11 个用 `z.discriminatedUnion` 写成根级 `anyOf`，而 pi 已知 Anthropic 适配器会把根级 `anyOf` 静默丢掉（[#9134](https://github.com/earendil-works/pi/issues/9134)），Google 的 legacy `parameters` 路径是 OpenAPI 3.03、压根不支持 `anyOf`/`const`（`pi-ai/dist/api/google-shared.js:278-281`）。**
> 也就是说 `canvas.write` 的 0/18 可能有**第三个成因**，而方案里没写：不是「9 个分支太多让模型选错」，是**那 9 个分支有的模型根本没看见**。方案的处方（拆成 3 个工具、每个 ≤4 分支）不解决它——拆完仍然是根级 `anyOf`。

---

## 1. 方法与证据边界（先说清楚这份东西能信到哪一步）

**读的是什么**：`node_modules/@earendil-works/{pi-coding-agent,pi-agent-core,pi-ai}@0.85.1` 的**编译产物 `.js`**（不是 `.d.ts`——类型面在 0.84.3 就已经完整而实现是空的，这个教训方案 §0.2 已经吃过一次），外加随包发布的 `docs/*.md`（33 篇）、`examples/extensions/`（60+）、`CHANGELOG.md`（553KB，回溯到 0.75）。文档与 `pi.dev/docs/latest` 逐页比对确认**内容一致**，所以下文的 `docs/xxx.md` 引用与线上 URL 等价。

**引用格式**：`file:line` 一律相对 `node_modules/@earendil-works/`；仓库侧一律相对仓库根；issue 给完整 URL。

**没查到的，明着标**：
- pi 的**单元测试源码不随包发布**（`dist/` 只有编译产物，无 `*.test.js`）。所以「pi 自己怎么测 harness」只能从它**发布出来的测试设施**（`harness/session/testing/conformance`、`InMemorySessionRepo`）反推，读不到断言正文。
- `chord` 包（0.85.1 传递依赖）未展开读——它不在方案的任何一层上。
- 本轮**未查自媒体**（见 §8）。

**一条要纠正的既有记录**：探针报告 §6.2 写「延迟 = `baseDelayMs * 2^(attempt-1)` + jitter」。实现里**没有 jitter**：`pi-ai/dist/utils/retry.js:140` 是 `policy.baseDelayMs * 2 ** (attempt - 1)`，纯指数、无抖动。这条会影响 G4 的断言写法（可以断言精确毫秒数，不必留抖动窗口），也意味着**多个 lane 同时 429 时会同步重试**——桌面端单用户不致命，但要知道。

---

## 2. 九层对照表

> 每层先一句人话说这层管什么（D6），再上四列表。
> 判定三档：**一致** / **有意不同（理由必须是 Nomi 领域约束）** / **没想到（= 方案里没有这件事，不是方案写错了）**。

---

### 层 1 · 工具层

> **这层管什么**：模型要动 Nomi 里的东西，只能通过「工具」这道窄门。这层决定的是——模型能看见哪些门、门上写着什么、它把参数递错了会发生什么、门后面吐出来的东西怎么回去。今天最贵的那扇门（分镜）模型第一次就推对的概率是 **0%**，所以这层不是打磨项。

pi 的内建工具共 8 个（`read` `bash` `powershell` `edit` `write` `grep` `find` `ls`，`core/tools/index.js:19-28`），全部用 TypeBox `Type.Object` 定义，全部走 `wrapToolDefinition`（`core/tools/tool-definition-wrapper.js:2-13`）。

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **1.1 描述通道** | **三条通道，各司其职**：① `description` 进工具 schema（每次请求都花 token）；② `promptSnippet` 一行，进系统提示词的 "Available tools" 菜单（`core/system-prompt.js:42-43`）；③ `promptGuidelines` 进系统提示词的 "Guidelines" 列表，**去重且按实际工具集条件化**（`system-prompt.js:45-76`：只有 bash 在而 grep/find/ls 都不在时才加「用 bash 做文件操作」那条）。「该用它还是用隔壁那个」住在 ③，**只写一次**，不在每个工具的 description 里复制 | §3.2 **S4**：「每个工具描述 ≥ 3 句（干什么 / 什么时候用它而不是隔壁那个 / 不要用它做什么）」——三件事**全塞进 description** | **没想到** | **阶段 2 前必补。** S4 与 S7（≤4 000 token）在数学上互斥：把「不要用隔壁那个」写进 N 个工具的 description = 把同一段话买 N 遍。改法：S4 拆成 S4a（description 只说「干什么 + 限制 + 截断」）+ S4b（跨工具消歧走 `promptSnippet`/`promptGuidelines`，`pi.registerTool` 原生收这两个字段，见 `docs/extensions.md:1955-1975` 的 `registerTool` 示例）。**仓库现状：`promptSnippet`/`promptGuidelines` 全仓 0 次使用**（实核 `grep -rn` over `electron/ src/`） |
| **1.2 参数 schema 风格** | 每个字段都带 `description`，**默认值写在描述里**（`"Maximum number of matches to return (default: 100)"`，`core/tools/grep.js:18`）。字段级说明覆盖率 **100%**。工具 `description` 里的数字是**从实现常量插值出来的**（`read.js:37`：`` `truncated to ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB` ``），所以描述与行为**结构上不可能漂移** | §3.2 **S6**：必填 + 枚举字段带说明（今天 23/35 违反） | **一致（方向）**，但漏了「常量插值」 | 建议阶段 2 顺手加一条 S6b：description 里出现的任何数字必须从同一个常量插值，禁止手写字面量。零成本，防的是「改了上限忘了改描述」 |
| **1.3 枚举的跨供应商写法** | **`StringEnum()` 而不是 `Type.Union`/`Type.Literal`**。`pi-ai/dist/utils/typebox-helpers.js:2-20` 注释原文：*"compatible with Google's API and other providers that don't support anyOf/const patterns"*。文档把它升成硬规则（`docs/extensions.md`：*"Use `StringEnum` from `@earendil-works/pi-ai` for string enums. `Type.Union`/`Type.Literal` doesn't work with Google's API."*） | 岔路 3 已定 A：写一个 zod→TypeBox 受控转换器，门岗保证「信息不丢」 | **没想到** | **阶段 2 前必补（这是转换器的验收条件之一）。** 「信息不丢」这条判据不够——`z.enum` 直译成 `anyOf:[{const:...}]` 是**信息没丢但供应商不认**。转换器必须把枚举一律降成 `{type:"string", enum:[...]}`，并加一条门岗断言「模型可见 schema 里不出现 `const`」。**仓库现状：`StringEnum` 0 次使用** |
| **1.4 根级 union（⚠️ 本次最要命的一条）** | pi **8 个内建工具没有一个是根级 union**——全是扁平 `Type.Object`。它自己在两处明说这条路不通：`pi-ai/dist/api/google-shared.js:278-281` —— Google 的 legacy `parameters` 路径是 **OpenAPI 3.03**，*"（including anyOf, oneOf, const, etc.）"* 只有新的 `parametersJsonSchema` 路径支持，而 Cloud Code Assist + Claude 走的是 legacy 那条；[#9134](https://github.com/earendil-works/pi/issues/9134)（2026-09-04 已关）：**Anthropic 适配器静默丢弃自定义工具 schema 的根级 `anyOf`** | §3.2 **S2**：单工具 `anyOf` ≤ 4；§3.5：把 `canvas.write` 的 9 个 operation 拆成 3 个工具 | **没想到** | **阶段 2 前必补，并且要改处方。** 仓库实核：`canvasWrite.ts:225` `z.discriminatedUnion("operation", [...])`，全仓 `discriminatedUnion` **11 处**，`canvasWrite.ts` 里 `z.literal(` **32 次**。拆成 3 个工具后每个仍是根级 `anyOf`（3–4 分支），**在丢 `anyOf` 的适配器上等价于「没有 schema」**。正确处方：**根必须是扁平 `Type.Object`，`operation` 降成 `StringEnum` 判别字段，分支专属字段做成 optional + 在 `execute`/`before_tool` 里做跨字段校验**。这条同时把 S2 从「≤4」升级成「根级 0」，比现在的规则更强也更好判。**它可能是 0/18 的第三个成因，而方案里没有这一条** |
| **1.5 `prepareArguments` 用法** | 全仓**只用了 1 次**：`core/tools/edit.js:92` → `prepareEditArguments`（`:44-74`）。它处理**三种**畸形：① `edits` 是 JSON 字符串 → `JSON.parse`（`:51-62`，注释点名 *"Some models (Opus 4.6, GLM-5.1) send edits as a JSON string instead of an array"*）；② `edits` 是单个对象而非一元数组 → 包成数组（`:63-65`）；③ 老会话里的扁平 `oldText`/`newText` → 折进 `edits[]`（`:66-73`）。**官方文档给的首要用途是 ③ 而不是 ①**：*"Use it to mimic an older accepted input shape when pi resumes an older session whose stored tool call arguments no longer match the current schema. … Keep the public schema strict."*（`docs/extensions.md`） | §3.4：用 `prepareArguments` 统一解 JSON 字符串（= pi 的 ①），并**在结果里回一句「已按 JSON 字符串解析」，不静默** | ①**一致**；②**没想到**；③**没想到** | **② 阶段 2 前补**（单对象→一元数组是同一族，pi 为它单开过一个 issue [#7835](https://github.com/earendil-works/pi/issues/7835)，且 [#9212](https://github.com/earendil-works/pi/issues/9212) 记录 sonnet-5 经网关有 13% 的 `edits` 退化成 `[{}]`）。**③ 阶段 4 前必补，且它是方案的一个真空**：§3.5 要改名/合并/拆分工具，§4.3 要迁移历史转录——**迁移来的旧会话里存着旧形状的 tool call**，新 schema 一律校验失败。pi 把 `prepareArguments` 当成这件事的官方答案，我们连问题都还没提。「回一句不静默」是**有意不同**，见 §11 |
| **1.6 容忍梯（校验前有几道）** | **四道，全在 pi 内部，顺序固定**（`pi-ai/dist/utils/validation.js:280-296`）：① `structuredClone`；② `normalizeOptionalNulls`（可选字段收到 `null` → **删掉该键**，`:222-235`）；③ `Value.Convert`（TypeBox 类型强转，`"5"`→`5`）；④ 非 TypeBox schema 再走一次 `coerceWithJsonSchema`；最后才 `validator.Check`。`prepareArguments` 在这四道**之前**跑（`pi-agent-core/dist/harness/execution/tools.js:25-29`） | §3.4 只描述了 `prepareArguments` 这一道；岔路 3 定「校验只发生一次」 | **一致（方向对）**，但少了「那一次校验必须是**会强转的**」 | 阶段 2 前把「唯一校验点」的定义写死：它必须复用 pi 的 `validateToolArguments`（即容忍梯全在），而**不是**我们自己在转换器后面再接一个严格 zod `.parse()`。否则「收成一次」收出来的是最严的那一次，`"5"` 和 `null` 会重新开始失败。⚠️ `normalizeOptionalNulls` 这道我们完全没有，而模型给可选字段填 `null` 是通用行为 |
| **1.7 执行结果形状** | `{ content: ContentBlock[], details?: unknown, usage?: Usage, terminate?: boolean, addedToolNames?: string[] }`。**`content` 给模型，`details` 给渲染器**（`core/tools/renderers/bash.js:37-38` 读 `result.details.truncation` / `.fullOutputPath`）。两者严格分工：模型看不到 `details`，渲染器不靠解析 `content` | §3.3 定义 `ToolFailure`（`code`/`message`/`issues`/`branch`/`allowed`/`nextAction`） | **一致（成功路径）** | — |
| **1.8 错误怎么回给模型（⚠️ 第二要命）** | **必须 `throw`，不能 `return`。** 文档原文：*"To mark a tool execution as failed (sets `isError: true` on the result and reports it to the LLM), throw an error from `execute`. **Returning a value never sets the error flag regardless of what properties you include in the return object.**"*（`docs/extensions.md`）。实现对得上：`harness/execution/tools.js:61-73`，只有 `catch` 分支才 `isError: true`。校验失败走另一条路：`prepareToolCall` 的 `immediateError`（`:19-34`）产出 `{kind:"immediate", isError:true}`，模型收到的正文是 `Validation failed for tool "X":\n  - path: msg\n\nReceived arguments:\n{...}`（`validation.js:294`） | §3.3 把 `ToolFailure` 定义成一个**返回**的结构 | **没想到** | **阶段 2 前必补，这条会直接复现今天的病。** 如果 `ToolFailure` 作为返回值出去，pi 记 `isError: false` → 面板画**绿**收据、`LaneSnapshot.runningTools[].isError` 为假、模型收到一条「成功」的工具结果里面装着错误。这正是「文字说的和下面那堆红字对不上」的机器成因之一。**规则要写死：能力层的失败一律 `throw`（或走 `before_tool` 的 `block`），`ToolFailure` 是 throw 出去的那个 Error 的序列化格式，不是 return 的形状。**门岗（`check:model-schema` 的 S8）要顺带断言「transport adapter 里不出现 `return ...ToolFailure`」 |
| **1.9 工具输出截断与分页** | **文档级硬规则**：*"**Tools MUST truncate their output**"*，上限 **50KB / 2000 行，先到先算**（`core/tools/truncate.js:10-11`），并导出 `truncateHead`/`truncateTail`/`truncateLine`/`formatSize` 供第三方工具复用。分页做在**结果正文里、写成可执行的下一步**：`read.js:128` → `[Showing lines 1-2000 of 8431. Use offset=2001 to continue.]`；首行就超限时直接给 bash 兜底命令（`read.js:119`）。超长时**全文落临时文件**，路径经 `details.fullOutputPath` 给渲染器（`output-accumulator.js:6-8`、`bash.js:171-174`）。文档还要求 *"Document the truncation limits in your tool's description"* | §3 **完全没有这一节** | **没想到** | **阶段 2 前必补（新增 S10）。** Nomi 的读类工具正是会喷大块的那种：24 行分镜表、整条时间轴、`read_production_artifact_content`。**仓库实核：`electron/` 下 agent 工具零截断**（唯一的 `DEFAULT_MAX_BYTES` 在 `hardenedFetch.ts:65`，是 50 **MB** 的网络下载上限，与工具无关）。不截断的直接后果 pi 在 [#6879](https://github.com/earendil-works/pi/issues/6879) 里写明了：大工具结果**在压缩之前**就被送去供应商 → 上下文溢出。⚠️ 另一条相关事实：压缩时工具结果会被**截到 2000 字符**（`docs/compaction.md`），所以「靠转录留全文」也不成立 |
| **1.10 `executionMode`** | 逐工具声明，默认并行；**任一工具声明 `sequential`，整批就串行**（`pi-agent-core/dist/agent-loop.js:287-291`） | 方案未提 | **有意不同，但今天是硬编码的** | 仓库实核：`electron/harness/runtime/pi/tools.mts:53` 对**所有** Nomi 工具写死 `executionMode: 'sequential'`。画布/分镜写操作要串行是对的（并行改同一张画布必冲突），但**读类工具没有理由串行**——串行让「读画布 + 读时间轴 + 读文档」这类扇出白等三倍。阶段 2 把它从硬编码改成**从能力契约声明派生**（读类 `parallel`、写类 `sequential`），这与 K1「档案声明槽、通用系统负责填」是同一条 P4 |
| **1.11 权限/审批钩子** | pi **自己不做审批**（`docs/security.md`：*"Project trust … is not a sandbox and it does not restrict what the model can ask tools to do"*），但把口子留得很完整：`tool_call` 事件返回 `{block:true, reason?, terminate?}`（扩展层）/ `{block:{reason, terminate}}`（harness 层，`harness/execution/tools.js:38-39`）。**参考实现就在包里**：`examples/extensions/permission-gate.ts`（危险 bash 命令弹 `ctx.ui.select`）、`protected-paths.ts`（保护路径直接 block）、`plan-mode/`、`sandbox/` | K2：审批/花费闸从宿主状态机搬到 `before_tool`，`reason` 直接成为模型看到的正文 | **一致（骨架）**，但漏三条机制细节 → 见 1.12/1.13/1.14 | — |
| **1.12 审批的失败方向** | **`tool_call` 是全事件表里唯一 fail-closed 的钩子。** `core/extensions/runner.js:745-763` 的 `emitToolCall` **没有 try/catch**；同文件的 `emitUserBash`（`:764-790`）、`emitContext`（`:791+`）都有。抛出去后被 `core/agent-session.js:237-242` 接住并**原样重抛**，注释写死 *"Extension failed, blocking execution"*。无 UI 时的默认更直白：`runner.js:90` `confirm: async () => false`，示例里也照抄（`permission-gate.ts:20-23`：`if (!ctx.hasUI) return { block: true, ... }`） | K2 未声明失败方向 | **没想到** | **阶段 3 前必补。** Nomi 的审批闸挂上去之后，「审批模块自己抛异常」必须 = 拒绝执行，不能 = 放行。这条要做成 G6 那种零额度判据（把审批函数改成必抛的版本喂进去，断言工具没跑）。R28：这是能让钩子结构本身拦住的事，别留给人记得 |
| **1.13 `block` 的批次语义** | `terminate` **只对被 block 的那一次有效**，且*"the agent stops early only when **every** finalized result in the batch is terminating"*（`docs/extensions.md`；实现 `agent-loop.js:385` `finalizedCalls.every(f => f.result.terminate === true)`）。并且并行模式下**同一条助手消息的多个工具是「先全部预检、再并发执行」**（`docs/extensions.md`：*"sibling tool calls … are preflighted sequentially, then executed concurrently"*），`tool_call` **看不到**同批兄弟的结果 | 方案 §3.3 只写了 `{block:{reason}}`，未提 `terminate`、未提批次 | **没想到** | **阶段 3 前必补。** 两个直接的产品后果：① 用户在一批 3 个工具里点「不要」，**agent 不会停**——另外两个照跑，然后模型拿着 2 成功 1 失败继续。这与「点不要 = 这件事到此为止」的用户预期相反；② 一批 3 个写操作会**先连弹 3 个审批**再执行，不是「批一个跑一个」。审批 UI 的形状（是不是要做成「这一批 3 项，全批/全拒/逐项」）要按这个真实时序设计，别做成逐项串行的弹窗 |
| **1.14 改写参数的两条路** | 两条，**校验行为相反**：harness 层 `before_tool` 返回 `{args}` → `applyBeforeToolDecision` **会重新校验**（`harness/execution/tools.js:44-53`）；扩展层直接改 `event.input` → 文档明写 *"**No re-validation is performed after your mutation**"* | 方案 §2.3④ 提到 `prepareArguments` 是官方容忍钩子，未区分这两条 | **没想到（低危）** | 阶段 3 顺手写进注释即可：Nomi 一律走 harness 的 `{args}`（有校验），永不走扩展的原地 mutate。相关未解决上游需求：[#7607](https://github.com/earendil-works/pi/issues/7607)「per-tool opt-out of argument validation」仍 open |
| **1.15 动态装载工具（`addedToolNames`）** | 工具结果可以**解锁更多工具**：`ToolResult.addedToolNames` → harness 追加进 `activeToolNames`（`harness/runtime/drive/tool-placement.js:136-150`），且 `splitDeferredTools`（`pi-ai/dist/utils/deferred-tools.js:3-34`）把「已解锁但还没用过」的工具**排在请求靠后的位置**，保住前缀的 prompt cache。三个供应商适配器各自实现了重放（`anthropic-messages.js:902`、`openai-completions.js:56`、`openai-responses-shared.js:228`）。0.80.7 起是官方特性（CHANGELOG：*"Cache-friendly dynamic tool loading"*），示例在 `examples/extensions/{dynamic-tools,kimi-deferred-tools}.ts` | §3.2 **S7**：任一 profile ≤12 工具 / ≤4 000 token（今天 production 是 30 / 12 641），靠**静态 profile** 收敛 | **没想到** | **阶段 2 前至少要做一次判断（补不补都行，但不能不知道）。** 我们正在用「静态分档 + 合并/拆分」硬解一个 pi 已经提供了动态解法的问题。production profile 30 个工具塞不进 12 个，很可能只能靠 `addedToolNames`：先给 5 个入口工具，`nomi_production_read` 返回时解锁那一档的其余工具。**仓库现状：`addedToolNames` 只在 `snapshotSchema.mts:29` 被动透传，从未产出过。**⚠️ 这条对 KV-cache 敏感，要和 `agentToolCatalog.ts:31-35` 的确定性顺序合同一起设计 |
| **1.16 技能怎么进模型** | **pi 没有 `load_skill` 工具。** 技能清单以 XML 块写进系统提示词（`core/skills.js:275-298`：`<available_skills><skill><name>/<description>/<location>`），模型用**普通 `read` 工具**按 `<location>` 自己去读。文档明说这是 progressive disclosure，且坦承 *"models don't always do this"* | 现状有 `load_skill` 工具（`agentChatPolicy.ts:112-131`，方案 §3.1 只把它当命名不规范的例子） | **没想到（中危）** | 阶段 2 顺手判一次：`load_skill` 占掉一个 S7 名额，而 pi 用 0 个工具做同一件事。若 Nomi 的技能正文不在磁盘上（在 skill hub / 数据库里），保留工具是**有意不同**且理由成立——但要把这条理由写下来，别让下一个人以为是抄漏了 |
| **1.17 流式进度** | `execute` 的第 4 个参数 `onUpdate(partial)` 可以持续推送**部分结果 + details**；bash 工具用它做节流推送（`bash.js:163-197`，`BASH_UPDATE_THROTTLE_MS`），并在开工瞬间先推一条空的 `onUpdate({content:[], details:undefined})`（`:199`）当「已开始」信号 | 方案未提 | **没想到（低危，但 Nomi 特别需要）** | 阶段 3 补。Nomi 的生成类工具一跑几十分钟，`onUpdate` 是把「它在干嘛」喂进 `LaneSnapshot.operation.runningTools[].result` 的官方通道——没有它，长工具在面板上就是一个不动的转圈 |
| **1.18 工具调用超时** | **pi 没有。**[#8857](https://github.com/earendil-works/pi/issues/8857)（2026-08-30 已关）标题即 *"Agent loop has no tool call execution timeout"*。`bash` 工具的 `timeout` 是**工具自己的参数**（`bash.js:26-29`），不是 loop 级 | 方案未提工具超时（只提了 `observeNativeStream` 的 90s/120s 看门狗，那是**模型请求**的超时） | **没想到** | **阶段 3 前必补。** 这是 Nomi 与 pi 的领域差：pi 的工具是本地 `rg`/`sed`，秒级；Nomi 的工具会调云端生成。工具级超时上游不给，**100% 是宿主的活**，且必须逐能力声明（读类 30s、生成类几十分钟）。别把它和模型请求看门狗混成一个数 |
| **1.19 步数上限 / 死循环** | **pi 一条都没有。**`agent-loop.js:85` 是 `while (true)`，全仓 `grep` `maxSteps\|maxIterations\|maxTurns\|stepLimit` **0 命中**；也没有任何重复调用检测（`consecutive`/`loopDetect`/`identicalCall` 全 0 命中）。循环只在三种情况停：`stopReason` 是 `error`/`aborted`、模型不再调工具、或整批 `terminate` | §1.1 **B7**：「三层步数上限收成一层（删掉会说谎的第三条）」 | **有意不同（正确），但方案的措辞会误导** | 方案把它写成「收敛」，读起来像是在削减一件上游也有的东西。事实是**上游给 0**，这三层全是我们自己的，而且**必须留至少一层**——pi 是 CLI（人盯着、Esc 随时能停），Nomi 是打包桌面应用、按 token 花钱。建议阶段 3 把 B7 的措辞改成「上游不提供任何回合上限，本层 100% 由宿主拥有；保留一层、且只有它有权改变用户看到的结论」。**「同一工具连错 7 次」也是这一族：pi 不管，我们必须管** |

---

### 层 2 · 转录与渲染

> **这层管什么**：模型一轮回复其实是一串**有顺序**的小块——说一句话、想一下、调个工具、再说一句。这层决定用户屏幕上这些块按什么顺序、什么形状出现。今天 Nomi 把它们压成「文字一堆、收据一堆」，用户读到「我来拆镜头」，往下翻先撞见 7 条失败。

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **2.1 时间线怎么排（⚠️ 一条会让人失望的事实）** | **pi 的 TUI 也没有把「文字→工具→文字」按序穿插显示。** 助手的 text/thinking 住在 `AssistantMessageComponent` 内部（`modes/interactive/components/assistant-message.js:69-132`，每帧 `clear()` 后按 `message.content` 顺序整个重建），而**工具卡片被提到 `chatContainer` 顶层**成为独立持久块（`interactive-mode.js:2630-2636`）。净效果：一条「说一句 → 调工具 → 再说一句」的消息，屏幕上仍是**「全部文字，然后全部工具卡片」**。`assistant-message.js:105-109` 甚至为这个布局专门做了空行抑制 | §2.1 ①②：顺序来自 transcript，投影层「不排序」，v4 的 8 个积木「一个都不改长相，只是终于按发生顺序出现」 | **没想到（预期管理，不是缺陷）** | **阶段 1 就要说清楚，否则阶段 4 会被判为「没修好」。** 把数据修成有序是**必要不充分**的：要真做到穿插显示，投影层必须把一条助手消息**拆成多个 view item**（text 段、thinking 段、toolCall 段各一个），而不是「一条消息 → 一个积木 + 若干工具积木」。pi 没做这件事（它的用户是开发者、能接受），**Nomi 要做就是超出参考实现的一步**，要写进 §2.1 的 `laneViewModel` 契约里，别默认「顺序对了画面就对了」 |
| **2.2 进行中 vs 完成怎么表达** | **没有 per-tool spinner。**三态**靠整块底色**：`toolPendingBg #282832`（冷灰）/ `toolSuccessBg #283228`（暗绿）/ `toolErrorBg #3c2828`（暗红），`components/tool-execution.js:216-221`。全局只有**一个** spinner，住在底部 dock 不在转录里（`components/status-indicator.js:15-26`，10 帧 / 80ms）。生命周期靠三个标志位 `isPartial` / `executionStarted` / `argsComplete` 传给渲染器（`tool-execution.js:71-89`）。只有 bash 有「跑了多久」计时（`renderers/bash.js:113-121`，`Elapsed 3.4s` → `Took 3.4s`） | K6：v4 面板 8 个积木不改长相 | **一致（且 Nomi 已更好）** | — |
| **2.3 折叠** | 默认折叠，`ctrl+o` 全局切换（`core/keybindings.js:52`），也可点单块切换（`tool-execution.js:107-114`）。**折叠行数逐工具自定义**：无渲染器兜底 10 行（`tool-execution.js:6`）、bash **尾** 5 行（`renderers/bash.js:14`）、grep 15 行（`renderers/grep.js:34`）、**read 折叠时一个字都不显示**（`renderers/read.js:86-88`），但 `isError` 时强制显示 | 方案未涉及（K6 不动外观） | **有意不同** | pi 让每个工具自己决定折叠形态；Nomi 是固定设计系统 + 57 张视觉基线，集中式折叠是对的。但 **「失败时强制展开」这一条值得抄**（`renderers/read.js:86`）——它是「用户要看的是出错的那个」的最小实现 |
| **2.4 重复调用怎么显示（⚠️）** | **完全不去重、不折叠、不分组。** 每个 `toolCallId` 无条件 new 一个组件 + 一个 `Spacer(1)`（`interactive-mode.js:2630-2636`/`2696-2702`/`3019-3025`）。全仓 `dedup\|collapse\|group\|fold\|coalesc` 在转录层零命中。唯一的反刷屏机制是**状态行**：连续 `showStatus()` 原地改上一行而不追加（`interactive-mode.js:2872-2892`，注释写 *"to avoid log spam"*）。pi 的处理办法是**把失败的视觉权重压到最低**（暗红 `#3c2828` 而不是刺眼红），不是折叠 | 设计角色提出：「同一工具连错 7 次折成一行『尝试 7 次未成功 ›』」 | **有意不同（我们更进一步，理由成立）** | 无需补，但要在方案里标注**这条没有上游参考实现**，是 Nomi 自己的产品决定：pi 的用户是开发者、7 张卡片能读；Nomi 的用户在做片子，7 张红卡片是纯噪音。**同时要接受它的代价**：折叠是投影层的语义判断（「同一工具 + 同一失败码」算一次），它天然违反 I1「任何层不得再排序」的字面意思——I1 要写成「不得**重排**」而不是「不得**分组**」，否则门岗 O1 会把这条设计拦掉 |
| **2.5 失败怎么显示** | 用户侧：整块变 `toolErrorBg`；渲染器拿到 `context.isError`；edit 的渲染器**只在错误文本 ≠ 已展示的 preview 错误时才多画一行**（`renderers/edit.js:59-68`），避免同一条错误说两遍。整条消息 abort/error 时，所有还挂着的 pending 工具被**批量塞进同一条错误结果**（`interactive-mode.js:2668-2674`）。模型侧：只有 `content` + `is_error` 过去（`pi-ai/dist/api/anthropic-messages.js:914-920`） | §3.3 错误契约 | **一致**，另加一条可抄的 | 「批量收尾 pending 工具」（`interactive-mode.js:2668-2674`）正是 Nomi「宿主丢 error、工具永远转圈」那类 bug 的上游解法，值得在 laneHost 抄一份 |
| **2.6 `details` / `content` 分工** | **`details` 永不进 LLM 载荷**，只给渲染器（diff、truncation 元信息、`fullOutputPath` 全在 details 里）。`content` 只给模型 | 方案未显式声明这条分工 | **没想到（低危但要写死）** | 阶段 2 写进工具契约：Nomi 的领域回执（新建的 nodeId 列表、镜头 id）该放 `details` 还是 `content`，是个每次都要答的问题。默认规则：**模型下一步要用的 id 进 `content`，纯展示的进 `details`** |
| **2.7 diff 呈现** | 两段式：`generateDiffString`（`core/tools/edit-diff.js:274-385`，带行号、前后各留 4 行上下文、跳过段用 ` ... ` 占位）→ `renderDiff`（`components/diff.js:70-132`，三色 + **仅当「1 删 1 增」时才做词级 `diffWords` 反显**）。**没有整体行数截断**。最漂亮的一手：`argsComplete` 一到就在**工具执行之前**异步算 diff 并 `invalidate()` 重画预览（`renderers/edit.js:124-133`），执行后只有真结果与预览不同才重画 | 方案未涉及 | **有意不同（领域不同）** | Nomi 没有文本 diff，但**「执行前预览」这个模式直接可移植**：`argsComplete` 时就能把「它准备建这 8 个镜头」画出来，用户在审批弹层里看到的是结果预览而不是一段 JSON。这条建议进阶段 3 的审批 UI 设计，不是必补项 |
| **2.8 流式增量 / `contentIndex`** | **pi 的 TUI 完全不用 `contentIndex`**：`agent-loop.js:207-225` 把所有细粒度事件折叠成一个 `message_update`，携带**整条消息的最新快照**，TUI 每帧 `clear()` 重建。`contentIndex` 真正的消费者只有两个：`AssistantMessageFrameEncoder`（持久化/回放增量，`pi-ai/dist/utils/assistant-message-frame.js:83-134`）和**对外 JSON 事件流**（`modes/json-event.js:1-28`）。⚠️ 0.84.0 起 JSON/RPC 的 `message_update` **变成 delta-only**，移除了累积 `message` 与 `assistantMessageEvent.partial`（[#7290](https://github.com/earendil-works/pi/issues/7290)） | §0.3 + B1：拿有序段；探针 §5.1 已实测 `harness.events.on('message_update')` 带 `contentIndex`，且 `lane.watch()` **故意剥掉** `event` 字段 | **一致（且我们选对了消费者）** | — 但要把这条写进 B4 的通道设计注释：**外部宿主才是 `contentIndex` 的目标用户**，这是上游的明确分工，不是我们在走偏门 |
| **2.9 渲染器契约** | 工具可自带 `renderCall(args, theme, ctx)` / `renderResult(result, options, theme, ctx)` / `renderShell: "default"\|"self"`。`RenderContext` 全集：`args, toolCallId, invalidate(), lastComponent, state, cwd, executionStarted, argsComplete, isPartial, expanded, showImages, isError`（`tool-execution.js:71-89`）。**抛异常一律 try/catch 降级到兜底**（`:242-246, 264-271`）。渲染器与工具实现**物理分离**（`renderers/index.js:1-7`，注释：只渲染的进程可省约 17 MB 模块图），同一对 `renderCall/renderResult` **既画 TUI 也画 HTML 导出**（`core/export-html/index.js:118-158`） | K6：8 个固定积木，集中投影，工具不自带渲染器 | **有意不同（理由成立）** | Nomi 有拍板过的设计系统 + 57 张视觉基线，「每个工具自带长相」会直接把基线打散。集中式是对的。**但要抄两条**：① 渲染失败必须 try/catch 降级到兜底积木，不能让一个工具的渲染 bug 白掉整个面板（对应 G6-② 那类「整页工作台加载失败」）；② 渲染层与执行层可分离——Nomi 的渲染层在渲染进程、执行层在主进程，这条天然满足，写进 §2.1 当既成事实 |

---

### 层 3 · 会话

> **这层管什么**：关掉 app 再打开，这段对话还在不在、顺序对不对、能不能从中间岔一条新路出来。

> ⚠️ **本层有一条统摄性事实，先说**：**0.85.1 里有两套并存的会话系统，而 pi 自己发货的 CLI 用的是旧那套。**
> - 在用：`pi-coding-agent/dist/core/session-manager.js`（v3 JSONL，扁平 append-only 树）。
> - **未接入**：`pi-agent-core/dist/harness/session/**`（v4 + 事务 / seq / branch tip / fork scope）——也就是**我们要用的那套**。
> - 判据：`grep -rn "harness\|JsonlSessionRepo\|entryProjectors" pi-coding-agent/dist` 只命中两处**无关的文案字符串**（`core/system-prompt.js:81`、`interactive-mode.js:117`），**零代码引用**。
> - 上游自己的记录同向：[#9000](https://github.com/earendil-works/pi/issues/9000)「AgentSession still hardcodes SessionManager (JSONL); cannot use SqliteSessionRepository **despite harness v2 Session/SessionRepo being stable**」、[#9042](https://github.com/earendil-works/pi/issues/9042)「Contribution proposal: make AgentHarness **the canonical** recoverable runtime」（是**提案**）、[#6451](https://github.com/earendil-works/pi/issues/6451)「Clean up new harness session projection and compaction」（**仍 open**）。
>
> **这对用户问题 1 的答案是一次修正**：方案说 0.85.1 的风险是「只发布一天、零生产验证」。更准确的说法是——**`AgentHarness` 不只是新，它在 pi 自己的 coding agent 里还没有被使用。** 我们不是在「跟上 pi 的架构」，是在**走到它前面**，跑一条上游自己还没 dogfood 的代码路径。这不推翻岔路 1 的 A（探针四题全过、151 条既有测试全绿，证据很硬），但它把风险的**形状**换了：不是「新版本可能有 bug」，是「这条路上我们可能是最早的重度用户，遇到的坑要自己上报自己等」。**这条必须写进拍板记录**，因为它改变的是心理预期与排期缓冲，不是技术选择。

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **3.1 落盘格式** | v4：一行 header + 每行一个**事务**。`serializeTransaction`（`pi-agent-core/dist/harness/session/jsonl/storage.js:56-58`）：单写就是裸对象、多写就是数组 —— **一次 commit 的多个写在盘上是原子的一行**。四种 write：`entry` / `usage` / `value`(set·delete) / `list`(append·delete)（`storage.js:20-45`）。`seq` 全局单调，`validateCommittedWrites`（`../commit.js:33-56`）强制严格递增 + id 不重复 + `parentId` 必须已存在或在同一事务内 | §4.3：pi 快照优先迁移；宿主 `snapshot-v1.json` 按数组顺序线性回填 | **一致** | — |
| **3.2 撕裂与并发（⚠️ 两条真事故）** | `splitCompleteLines`（`storage.js:62-69`）丢弃最后一行不完整内容；open 时检测到 `torn` 就用 `publishFileAtomically`（临时文件 + rename，`:70-80`）重写。**0.84.0 起要求 `FileSystem.renameFile()` 具备同文件系统替换语义**（CHANGELOG breaking）。上游踩过的两个坑：[#8852](https://github.com/earendil-works/pi/issues/8852)「**同一进程里把一个 JSONL 会话打开两次会写出重复 seq 并损坏文件**」、[#8939](https://github.com/earendil-works/pi/issues/8939)「会话文件跑到一半被删会被重建成**没有 header 行**，下次 resume 直接 'not a valid pi session'」；再加 0.84.4 修的「JSONL 缺尾换行导致下一条追加损坏」（[#8345](https://github.com/earendil-works/pi/issues/8345)） | §2.1 ⑤a：laneHost 负责「lane 生命周期（项目 ↔ lane 映射、打开/关闭）」 | **没想到** | **阶段 1 前必补，三条，全部是 Nomi 特有的放大器**：① **单打开者不变量**——Nomi 是 Electron 多窗口、一个项目可能被两个窗口打开，撞上 #8852 就是**转录损坏**，必须做成主进程里的一把锁 + 一条断言，不能靠约定；② **`renameFile` 的同文件系统语义**——Nomi 把会话写进 `<project>/.nomi/`，而用户项目住在 `~/Documents/Nomi Projects/`，那是**可能被 iCloud 同步的目录**；跨卷 / 同步目录下的 rename 不保证原子，注入的 `FileSystem` 必须显式满足并单测；③ **外部改动**——用户会拷贝、同步、备份、用 Finder 删 `.nomi/`，#8939 那个「重建成没有 header」正是这类。要有一条「会话文件损坏 → 明说损坏并另起一条，绝不静默吞掉历史」的路径 |
| **3.3 分支 / fork 的 scope** | 两种，语义差别很大（`harness/session/fork.js:63-101`）：**`tree`** 复制**全部条目**且**保留所有分支的 tip**；**`branch`** 只沿指定 tip 往 root 收集**这一条链**，`position:"before"` 时该条目本身不复制。逐 namespace 策略在 `fork-policy.js:2-21`：`pi.session.name` copy；`pi.branch.tip`/`pi.lane.config`/`pi.lane.state` **reconstruct**；`pi.op.*`/`pi.pending.*`/`pi.result` **exclude**；**用户自定义命名空间：`tree` → copy，`branch` → exclude**。fork 时 `laneState` 被重置为 `{currentOperationId:null, lastOperationId:null, inbox:[]}`（`fork.js:32`） | 方案未涉及 fork（探针 §3.2 实测过两种 scope 都落在 `<project>/.nomi/` 下） | **没想到（低危，但有一条会咬人）** | 阶段 4 前记一条：**Nomi 自己的 value 命名空间在 `branch` fork 时会被整个丢弃**。如果我们把审批状态、项目绑定、能力档位这类东西存进 lane value，用户做一次分支 fork 就静默丢失。规避很简单——**领域状态一律住领域存储、按 id join，永不放进 lane value**（这正是岔路 2 已经定下的边界，只是要知道 fork 是它的第二个理由） |
| **3.4 `continueRecent`** | `session-manager.js:1244-1252` → `findMostRecentSession`（`:397-415`）：读目录下所有 `*.jsonl`，逐个读 header（读不动就静默跳过），**按文件 `mtime` 降序取第一个**。⚠️ 排序键是 **mtime，不是 header 时间戳、也不是最后一条消息时间** | 方案未涉及（Nomi 按 threadId 直接定位） | **有意不同（我们更好）** | 无需补。但记一条：Nomi 若将来做「继续上次」，**不要抄 mtime 排序**——`.nomi/` 在同步/备份目录里，mtime 会被外部工具改写 |
| **3.5 跨压缩统计** | **条目永不删除，统计始终扫全量 `getEntries()`**（`agent-session.js:2656-2707`，注释原文：*"Aggregates over ALL session entries (including history that was compacted away), so token/cost totals reflect what was actually billed"*）。三个来源都记：assistant 的 `usage`、**toolResult 的 `usage`**（子 agent / 工具内部调模型）、**`compaction` 与 `branch_summary` 条目自身的 `usage`**（做摘要烧的 token 也算钱）。`cache-stats.js:59-64`：压缩会**重置** cache-miss 基线，**换模型不豁免** | G5：花费/上下文/推理三行接真数字 | **一致**，另有一条要注意 | `core/usage-totals.js:10-16` 的 `addUsageToTotals` **只累加 input/output/cacheRead/cacheWrite/cost，丢掉 `reasoning` 和 `cacheWrite1h`**。所以 G5 的「推理」那一行**不能从会话总计里取**，必须逐消息取 `usage.reasoning`。阶段 3 写进单测 |
| **3.6 `appendCustomEntry` / `entryProjectors` pi 自己怎么用（⚠️ 关键）** | **几乎不用。** `appendCustomEntry` 在 pi 内部**零调用**，唯一入口是暴露给扩展（`core/agent-session.js:2029-2030`）。全仓唯一的 customType 是 **`"pi.share"`**（`modes/interactive/session-share.js:14-32`），而且它是**导出期合成的**——装着系统提示词 + 完整工具目录，写进导出文件，**从不进入活会话**。`entryProjectors` 只存在于未接入的 harness，默认 `{}`（`harness/runtime/harness.js:50`），**pi 自己一个都没注册**。⚠️ 但 pi 在**旧那套**里给出了明确的语义分工：**`custom` 条目不进 LLM 上下文**（`session-manager.js:188`，注释 *"display/state entries and do not participate in context"*），**`custom_message` 条目进**（`:177-181`）——**物理分成两种条目类型，而不是靠一个 flag** | 岔路 2 已定 B：审批卡/任务卡/失败卡各一个 `customType`，用 `appendCustomEntry` + `entryProjectors` 骑在同一条 transcript 上 | **一致（机制选对了，探针已端到端验过）**，但**漏了一个必须做的决定** | **阶段 3 前必补：逐 customType 决定「模型该不该看见」。** 探针 §5.4 实测 `customEntryVisibleToModel: true` 且 **projector 每次组 context 都会被调一遍（探针里 4 次）**。所以：注册了 projector = 这条卡**每一轮都占 token**。审批结果（「用户拒绝了写 shot-1」）模型**应该**看见——那是它下一步的依据；纯展示的任务卡/进度卡**不该**看见。方案把三种卡一视同仁写成「各一个 customType + entryProjectors」，等于默认全部喂给模型。要补一条逐类型的表，并把 pi 的 `custom` / `custom_message` 二分**当成命名约定抄过来**（`nomi.ctx.*` = 进上下文、`nomi.ui.*` = 不进），这样「该不该看见」在类型名上就是自明的，不用去查注册表 |
| **3.7 cwd slug** | `` `--${cwd.replace(/^[/\\]/,"").replace(/[/\\:]/g,"-")}--` ``，两套系统各写一份、字符串一字不差（`core/session-manager.js:242-247`、`harness/session/jsonl/repo.js:27-29`）。**pi 自己承认这个编码有损**——`repo.js:187` 注释：*"Directory encoding is lossy: /a/b and /a-b both map to --a-b--."* 所以列目录后**必须再按 header 里的真实 `cwd` 精确过滤**（`repo.js:188`、`session-manager.js:393-395`）。**目录名只是分片，`header.cwd` 才是真相源** | 探针 §3.3 已发现 slug 层并给了处置（传稳定的项目相对 cwd + 用 Nomi 自己的 threadId 作 `create({id})`） | **一致（探针已覆盖）**，补一条 | 探针的处置对，再加一条断言：**任何按 cwd 查会话的地方都必须比 `header.cwd`，不能比目录名**。这是上游写在注释里的坑，抄结论比自己撞一次便宜 |
| **3.8 延迟落盘** | **第一条 assistant 消息出现之前，什么都不写盘**（`session-manager.js:739-768`）：先在内存累积，第一条 assistant 到达时用 `openSync(file,"wx")` 一次性刷出，之后才逐条 append。效果：用户敲一句就退出，不留垃圾会话文件 | 方案未涉及 | **没想到（低危，产品上很值）** | 阶段 4 顺手抄。Nomi 的项目目录是用户会用 Finder 打开看的地方，`.nomi/agent-sessions/` 里躺一堆空会话是可见的脏 |
| **3.9 导出** | 两种。JSONL 导出（`core/session-export.js:6-31`）**只导当前分支并把 `parentId` 重新串成一条直链**——分支语义在导出边界被有意丢弃，让外部只需理解线性序列；尾部留一个 `createTrailingEntries` 回调作唯一扩展点（`pi.share` 就走这里）。HTML 导出（`core/export-html/index.js:163-198`）是单文件自包含，**复用同一对 `renderCall`/`renderResult` 走 ANSI→HTML 管线**，折叠/展开两份都预渲染 | 方案未涉及 | **有意不同（暂不需要）** | 不补。记一条远期：**「导出一份对话」在 Nomi 是有真实用户价值的**（把一次创作过程发给别人看），而 pi 已经把「树压平成链 + 尾部元数据」这个格式设计好了。等 lane transcript 落地后，导出几乎是白拿的 |

---

### 层 4 · 上下文

> **这层管什么**：对话越聊越长，早晚塞不进模型的窗口。这层决定什么时候把前面的话压成一段摘要、压的时候留下什么、以及项目里那些「你得知道的规矩」（AGENTS.md、技能）怎么进到模型脑子里。

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **4.1 压缩触发** | `contextTokens > contextWindow - reserveTokens`，`reserveTokens` 默认 **16384**（`pi-agent-core/dist/harness/compaction/compaction.js:75-79, 144-148`）。`keepRecentTokens` 默认 **20000**。检查点有三处：工具批跑完之后·下一次助手响应之前（同一个 run 内就压，`pi-coding-agent/dist/core/agent-session.js:274-287`）、新 user prompt 之前、run 结束之后。`contextTokens` 取**最后一条有效助手消息的供应商实报用量**，之后的消息用 chars/4 估（`compaction.js:131-156`） | §0.3：「pi 自带，我们在用」 | **一致** | — |
| **4.2 摘要提示词（⚠️ 领域不匹配）** | 一段写死的六节结构（`core/compaction/compaction.js:356-387`）：`## Goal` / `## Constraints & Preferences` / `## Progress`(Done·In Progress·Blocked) / `## Key Decisions` / `## Next Steps` / `## Critical Context`，末尾一句 **"Preserve exact file paths, function names, and error messages."** 有增量版（已有摘要时用，`:388-426`）和切分回合版（`:587-600`）。摘要之后还会**机器追加**一段确定性清单 `<read-files>` / `<modified-files>`（`core/compaction/utils.js:59-70`），这段不经过模型。压缩输入里**工具结果被截到 2000 字符**（`utils.js:75, 130`） | 方案未涉及压缩提示词 | **没想到** | **阶段 3 前必补。** 那句 "Preserve exact **file paths, function names**, and error messages" 是为写代码调的。Nomi 一轮里必须活下来的是 **anchor id / shotId / nodeId / modelKey / 用户原话的提示词**——摘要里丢了 anchor id，下一次 `canvas.write` 就只能瞎编（真机已经见过模型编 `modelKey: "seedance"`）。上游给了两个官方口子：① `/compact <指令>` → `customInstructions`，拼成 `Additional focus: …`（`compaction.js:492-494`）；② `session_before_compact` 钩子返回 `{compaction:{summary, firstKeptEntryId, …}}` **完全接管**。**建议做法**：用①换掉那句领域错配的话，并抄②那套「机器追加确定性清单」的手法，压缩后自动补一段 `<touched-shots>` / `<touched-nodes>`——**id 不该交给模型去记，那是确定性数据** |
| **4.3 留什么 / 丢什么** | 从新到旧累计到 `keepRecentTokens` 找切点，然后**吸附到最近的合法切点**。合法切点：user / assistant / bashExecution / custom / branchSummary / compactionSummary —— **绝不在 toolResult 上切**（`compaction.js:227-240`，工具结果必须跟着它的调用走）。切点之后全部逐字保留，之前的进摘要。旧条目**留在会话文件里**，只是不进 LLM 上下文（`buildContextEntries`，`core/session-manager.js:198-226`）。**没有 pin 机制**（未查到） | §4.3 只讲了旧数据迁移，未讲压缩边界 | **一致（我们没有理由不同）** | — 但「绝不在 toolResult 上切」这条要在投影层复述一遍：Nomi 的审批卡是 custom entry，是合法切点；如果我们把审批卡插在 toolCall 与 toolResult **之间**，就制造了一个上游明确禁止的切点（见 4.7） |
| **4.4 `branch_summary`** | 会话树的构造，不是压缩：从一条分支导航到另一条时，把被抛弃那条路总结成一条 `branch_summary` 挂到新路上（`core/compaction/branch-summarization.js:26-55`）。提示词同骨架但**没有 `## Critical Context` 节**，且**完全跳过工具结果**（`:66-68`）。硬上限 `min(4096, model.maxTokens)`（`:219`） | 方案未涉及 | **有意不同（暂不需要）** | 不补。远期：Nomi 的「同一个分镜试两版」天然是分支，这套是现成的 |
| **4.5 AGENTS.md / 上下文文件** | 文件名按序 `["AGENTS.override.md","AGENTS.md","AGENTS.MD","CLAUDE.md","CLAUDE.MD"]`，**每个目录只取第一个命中**（`core/resource-loader.js:33-51`）。目录顺序：全局 `~/.pi/agent/AGENTS.md` 最先，然后从**最上层祖先 → cwd 最后**（`:82-109`）；git worktree 会做遮蔽去重（`:62-81`）。注入形状 `<project_context><project_instructions path="…">…</project_instructions></project_context>`（`core/system-prompt.js:103-110`）。**没有任何大小限制**——`readFileSync` 读全文，无截断、无字节上限、无数量上限 | Nomi 用的是 `createNomiResourceLoader`（一个**刻意全空**的 ResourceLoader，已在 `docs/engineering/framework-boundaries.json` 登记为有意的隔离决定） | **有意不同（理由成立，已登记）** | 不补。**这条要写进方案当成绩记一笔**：pi 的 `AGENTS.md` **不受 project trust 约束**（`resource-loader.js:33` 那条路径上没有任何 `isProjectTrusted()` 检查，`docs/security.md` 也明说 "loaded regardless of project trust"），也就是一个敌意仓库的 `AGENTS.md` 无提示地进模型。Nomi 用空 loader 把这个面整个关掉，是**已经比参考实现更安全**的一处，别在重做时手滑打开 |
| **4.6 技能的发现与注入** | 三处发现：`~/.pi/agent/skills/`、`<cwd>/.pi/skills/`（**需 project trust**）、显式 `--skill`。frontmatter：`description` **必填**（缺了整个技能不加载）≤1024 字符；`name` 可选、默认取父目录名、`^[a-z0-9-]+$` ≤64（违反只 warn 仍加载）；`disable-model-invocation` 排除出提示词。注入是 **progressive disclosure**：只有 name/description/location 三元组进系统提示词，正文由模型用 **`read` 工具**自己去取（`core/skills.js:275-298`）。**没有 `load_skill` 工具**。文档坦承 *"models don't always do this"*，所以另留 `/skill:<name>` 强制内联（`agent-session.js:983-1007`） | 现有 `load_skill` 工具 | **有意不同（但要写下理由）** | 见 1.16。补充一条**上游已知的坑**：0.85.0 才修「Bash 是唯一启用工具时技能不可用」（[#8552](https://github.com/earendil-works/pi/pull/8552)）——因为注入文案里硬写了「用 read 工具」。这印证了 progressive disclosure 的脆弱：**它依赖模型自觉，而且依赖某个具体工具存在**。Nomi 的 `load_skill` 是显式的，不脆——这就是保留它的正当理由，写进方案 |
| **4.7 `systemPromptOverride`（⚠️ 与层 1 复合）** | 两个同名的东西：① `ResourceLoader.systemPromptOverride`（`core/resource-loader.js:133,182,383`），一个 `(base) => string` 变换器，作用于 `SYSTEM.md`；② `AgentSession._systemPromptOverride`（`agent-session.js:137`），由 `before_agent_start` 钩子设置的**逐回合**覆盖，每次 prompt 跑完在 `finally` 里清掉（`:781`）。**两者都是整体替换**。**被覆盖时丢掉的东西**（`core/system-prompt.js:15-35`）：pi 的身份段、**`Available tools:` 菜单**（由各工具的 `promptSnippet` 组装）、**`Guidelines:` 块**（各工具的 `promptGuidelines` + 两条常驻）、pi 文档索引段。**幸存的**：`appendSystemPrompt`、`<project_context>`、`<available_skills>`、`Current working directory:` | Nomi 传自定义 systemPrompt（走 `createAgentSession` 的自定义提示词分支） | **没想到（与 1.1 复合成一个更大的洞）** | **阶段 2 前必补。** 这条和 1.1 是同一个洞的两面：Nomi 既**没有**给工具写 `promptSnippet`/`promptGuidelines`，又**用自定义提示词把渲染它们的那一段整个换掉**了。所以哪怕阶段 2 补上了这两个字段，**它们也不会出现在提示词里**——除非我们自己在自定义提示词里重建 "Available tools" 与 "Guidelines" 两段。补的时候要一起补，只补一半等于没补。**这是一条只有把两层放在一起看才能发现的缺陷**，也是本次审查最值钱的一条之一 |

---

### 层 5 · 模型与花费

> **这层管什么**：用哪个模型、这一轮花了多少钱、还剩多少上下文、能不能让它「多想一会儿」。今天 Nomi 面板上这三行永远是空的。

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **5.1 模型目录来源** | 三层合并：① **编译期内置** `pi-ai/dist/providers/data/*.json`（40 个文件约 1.3 MB，随包发布，键为 `api → modelId → Model`，带 `cost`/`contextWindow`/`maxTokens`/`reasoning`/`thinkingLevelMap`/`compat`）；② **运行期 pi.dev 覆盖层**——`GET https://pi.dev/api/models/providers/<id>`，4 小时刷新窗、ETag 重验、**比内置数据旧就整个忽略**（`core/remote-catalog-provider.js:32-39,58-121`），落 `~/.pi/agent/models-store.json`；③ 用户 `models.json` 自定义 provider/model | K7：Agent 文本模型清单 `apimartTexts.ts:54-62`（注释自陈来自 2026-08-21 一次手动探测）；阶段 5 改抓带鉴权的 `/v1/models`、退役 id 直接下架 | **一致（方向）**，pi 的做法更完整 | 阶段 5 建议抄两条：① **新鲜度戳**——pi 用 `data/.manifest.json` 的 `generatedAt` 判断「远端是不是真的更新」，Nomi 的目录也该带一个可比较的生成时间，否则「探测到了」和「探测数据比本地旧」分不开；② **ETag / 条件请求**——真实 key 的探测要花钱/限流，条件请求是白拿的省法 |
| **5.2 `calculateCost` 与 `tiers`（⚠️ 一条会静默归零的事）** | `pi-ai/dist/models.js:530-549`。单位 **USD / 每百万 token**，**就地改 `usage.cost` 并返回**。`tiers` 是**整请求重定价**、不是阶梯累进：按 `input + cacheRead + cacheWrite` 选中**阈值最高的那一档**，该档的四个费率替换掉整个请求（含 output）的费率。真实例子 `providers/data/cloudflare-ai-gateway.json` 的 `gpt-5.6-luna`：过 272 000 input token，**整个请求（含 output）翻倍**。另有一条：Anthropic 的 `cacheWrite1h` 按 **2 × input 费率**计，不按 `cacheWrite`（`models.js:546`）。调用点全在各 provider 的流循环里，**harness 一次都不调** | §2.3-1 + G5：单位 per-million、走 pi 的 `calculateCost`；I3「账只有一个算点」 | **一致（探针已实核，判断正确）**，但漏了致命的一条 → 5.3 | — |
| **5.3 谁填 `Model.cost`（⚠️ 本层最要命）** | 内置 JSON 是主来源；`models.json` 逐字段覆盖并回退到基础模型（`core/provider-composer.js:31-39`）。**关键**：`provider-composer.js:71` —— **自定义模型没声明 cost 就默认全零**：`cost: definition.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }` | G5：「花费/上下文/推理三行有真数字，三个数都 > 0，且花费与供应商账单同量级」 | **没想到** | **阶段 3 前必补，否则「花费永远是空的」会原样活过重做。** 仓库实核：`electron/harness/runtime/pi/model.mts:72` 就是 `cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }`。Nomi 的模型全是 APIMart / kie 的自定义模型，**没有一个在 pi 的内置目录里**，所以 `calculateCost` 会老老实实算出 **$0.00**——不报错、不告警、G5 的「> 0」直接失败。方案 §1.1 B7 把「价格清零」记成一处待修（`model.mts:72`），这是对的，但**没有跟上一条门岗**。必须加：`check:model-schema` 断言「每个 Agent 可选模型要么有非零费率、要么显式标 `free: true`」。⚠️ 单位换算是**第二个**坑：Nomi catalog 的 `pricing` 如果是「每 token」或「人民币 / 千 token」，直接填进去就是**三个数量级 + 汇率**两重错 |
| **5.4 思考档位** | 梯子是 **7 档**：`["off","minimal","low","medium","high","xhigh","max"]`（`pi-ai/dist/models.js:550`）。`getSupportedThinkingLevels`（`:551-562`）：`!model.reasoning` → 只有 `["off"]`；`thinkingLevelMap[level] === null` → 该档不支持；**`xhigh`/`max` 必须显式声明才出现**。所以 `claude-fable-5` 声明 `{"off": null, "xhigh":"xhigh", "max":"max"}` 意思是「**关不掉**思考，但能到最高两档」。`clampThinkingLevel`（`:563-581`）先往上找、再往下找。默认预算 `{minimal:1024, low:2048, medium:8192, high:16384}`，`xhigh`/`max` 折成 `high` 查预算（`api/simple-options.js:37-46`）。各供应商映射完全不同：Anthropic 走 `output_config.effort` 或 `thinking.budget_tokens`；OpenAI 走 `reasoning.effort`；Gemini 3 走 `thinkingConfig.thinkingLevel` 枚举、Gemini 2.x 走 `thinkingBudget` 数字 | §2.3-2 + G5：档位由 `getSupportedThinkingLevels` **derive**，不硬编码三档；`thinkingLevelMap` 里为 `null` 的档位在 UI 上不可选而不是报错；「任一档位下思考确实关闭时，那一行不渲染」 | **一致（写得很准）** | — 补一个会被忽略的边角：**有的模型 `off` 是 `null`，即「思考关不掉」**。方案的表述是「思考关闭时不渲染那一行」，反过来的情况（用户想关但关不掉）也要有对应的 UI，不能让「关闭」这个选项出现却不生效 |
| **5.5 多模型切换** | `setModel`（`agent-session.js:1254-1271`）：先 `checkAuth` 没 key 就抛、写一条 **`model_change` 条目进转录**、按「每模型覆盖 > 全局默认 > 当前 > 默认」重算思考档并 clamp。转录**不重写**：`model_change`/`thinking_level_change` 条目**零上下文贡献**（`session-manager.js:166-189` 返回 `[]`），但加载时被回放用来重建当前设置（`:146-161`）。**费用在响应产生的那一刻按当时的模型就地打戳**，之后换模型**不重算任何历史**。`getUsageCostBreakdown` 按 `provider/responseModel` 分桶（`usage-totals.js:24`）。Anthropic 服务端降级会用**实际返回模型**的费率重算（`api/anthropic-messages.js:403-406`） | 方案未涉及会话中途换模型 | **没想到（低危）** | 阶段 3 顺手：Nomi 的模型框就是给用户换模型的，换完之后「这一段是用哪个模型跑的」必须能追溯，`model_change` 条目是现成答案。**别自己在 UI 里记一份当前模型**——那又是一个第二真相源 |
| **5.6 `Usage` 形状与汇总** | `{input, output, cacheRead, cacheWrite, cacheWrite1h?, reasoning?, totalTokens, cost:{...}}`。`reasoning` 是 **`output` 的子集**（不是另加）；`cacheWrite1h` 是 `cacheWrite` 的子集。⚠️ `core/usage-totals.js:10-16` 的 `addUsageToTotals` **只累加 input/output/cacheRead/cacheWrite/cost，把 `reasoning` 和 `cacheWrite1h` 丢掉了** | G5：「推理走 `Usage.reasoning`」 | **一致（方向）**，一条实现陷阱 | 阶段 3 写死：推理那一行**逐消息取 `usage.reasoning`，不能走会话总计**（会话总计里没有它）。同时注意 `reasoning ⊆ output`，面板上「输出 1200 / 其中推理 800」是对的，「输出 1200 + 推理 800 = 2000」是错的 |
| **5.7 上下文占用（⚠️ 与 G5 直接冲突）** | `getContextUsage()`（`agent-session.js:2708-2748`）有一个**刻意的压缩后盲区**：如果当前分支上有压缩条目、且压缩**之后**还没有产生过有效的助手响应，它返回 **`{tokens: null, contextWindow, percent: null}`**——注释说明理由：压缩后最后一条助手消息的 usage 反映的是**压缩前**的上下文，不可信。另：新会话第一轮还没有助手用量时，估算**完全不含系统提示词与工具 schema**（`compaction.js:131-156` 只在有实报用量时才准），会**低估几千 token** | **G5 判据：「三个数都 > 0」** | **没想到（G5 的判据要改）** | **阶段 3 前必改判据。** 上游明确设计了「这个数现在不可知」这个**第三态**，而 G5 写的是「> 0」。刚压缩完 / 刚开新会话时按 G5 断言就是**假红**。正确判据：三行各自有 `有值 / 不可知 / 该档位下不适用` 三态，**「不可知」渲染成不渲染或一个明确的占位，绝不渲染 0**——这正是设计角色对「思考」那行的要求（「用一个断言性的词描述一件没发生的事，比不显示更糟」），只是它同样适用于上下文行。⚠️ 还有一条：**第一轮的上下文数字天然偏低**，因为不含系统提示词和工具 schema——而 Nomi 的工具 schema 今天是 12 641 token，这个低估不是小数 |

---

### 层 6 · 控制流

> **这层管什么**：它跑到一半你想插一句「不对，横屏」怎么办、网络抖一下要不要重来、什么时候该放弃。今天 Nomi 把重试整个关了，一次抖动 = 整轮白等。

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **6.1 steer vs followUp 的确切时机** | **steer** 在 run 内被轮询三次，全部在**下一次模型请求之前**（`pi-agent-core/dist/agent-loop.js:83` 首次请求前 / `:106-108` `prepareNextTurn` 之后 / `:158` 每个 turn 结束时），注入点 `:112-120`。**followUp** 只在**内层循环彻底跑干**（工具跑完 + steer 队列空）之后才轮询（`:160-166`），有就重启内层循环、没有就 `break`。一句话：**steer = 「本次 run 内的下一个请求边界」，followUp = 「这个 run 本来要结束了，让它继续活着」** | §6 阶段 3：「队列/steering 接 pi 的 `steer`/`followUp`/`cancelQueued`（面板上第一次有入口）」 | **一致（探针已实跑验证两条都被受理并到达模型）** | — |
| **6.2 队列模式（⚠️ 一个默认值差异）** | `QueueMode` 只有两个值 **`"all"` / `"one-at-a-time"`**（`agent.js:63-75`：`all` 一次全排空、否则只取第一条）。**三层的默认值不一样**：`Agent` 构造器 `one-at-a-time`（`agent.js:128-129`）、**harness `"all"`**（`harness/runtime/harness.js:44-45`）、settings-manager（CLI 实际读的）`one-at-a-time`（`settings-manager.js:477-487`） | 方案未涉及 | **没想到（产品语义，必须拍）** | **阶段 3 前必补一个产品决定。**我们要走 harness，而 **harness 默认 `"all"`**：用户连打三句「不对，横屏」「也换成夜景」「第 3 镜删掉」，会**一次性全部注入同一轮**。CLI 用的是 `one-at-a-time`（一轮吃一条）。对 Nomi 的创作场景，`one-at-a-time` 几乎肯定更对（每条指令的效果能被单独看见、单独撤销），但这是产品语义不是实现细节——**要在方案里显式声明并写死，不能继承 harness 的默认值** |
| **6.3 `cancelQueued` 的三态** | 返回 `{kind: "cancelled" \| "already_consumed" \| "not_found"}`（`harness/agent-harness.d.ts:32-34`，实现 `lane.js:1165-1194`） | 方案只列了 `cancelQueued` 这个名字 | **没想到（低危但会做出坏 UI）** | 阶段 3：「取消这条排队指令」有三种结果，`already_consumed`（它刚刚已经被吃进去了）必须给用户不同的反馈，不能和「取消成功」画成一样。这是典型的「七态 join 折进一态」那族（G6-④ 的同门） |
| **6.4 中断（`abort`）** | 三件值得抄的事：① `AbortResult` **把没被消费的 steer/followUp 原样返回给宿主**（`lane.js:799-808`），TUI 拿它 **把用户没送出去的话贴回输入框**（`interactive-mode.js:3615-3633` `restoreQueuedMessagesToEditor`）；② 被中断的工具会被写进**合成的工具结果**——`planned` 的写「Tool execution was cancelled before completion.」，跑到一半的写「已提交内容 + `INTERRUPTION_MARKER`」，**两者都 `isError:true` 且 `terminate:false`**（`drive/tools.js:96-121`）；③ 中途的助手消息**会被持久化**，带一句固定警告 *"Assistant request was interrupted. The preceding content is the latest committed partial; newer live output may be missing and the external outcome is unknown."*（`drive/recovery.js:12-27`） | 方案未涉及中断 | **没想到（三条都该抄）** | **阶段 3 补。**尤其①：用户按停止，他刚打的那句话**不能丢**——这是「一次网络抖动就要我重发一遍」那条抱怨的近亲。②③ 是「中断之后转录不留窟窿」的正确形状：**中断产生真实条目，不是产生空白**。今天 Nomi 的做法是整轮作废 |
| **6.5 重试与退避（⚠️ 四套实现）** | pi 里有**四套**：① `pi-ai/dist/utils/retry.js` `retryAssistantCall`——`delayMs = baseDelayMs * 2^(attempt-1)`，**无 jitter、无上限**（`:140`），在 pi 里**只用于压缩/摘要重试**；② `pi-ai/dist/utils/provider-retry.js`——SDK 传输层，读 `retry-after-ms`/`retry-after`，否则 `min(0.5*2^i, 8)*1000*(1-random*0.25)`（8s 上限 + 0~25% 抖动），**`maxRetries` 默认 0**；③ harness 持久化重试——`DEFAULT_RETRY_POLICY = {enabled:true, maxRetries:3, baseDelayMs:1_000}`（`harness/config.js:1`），归一成 `maxAttempts = maxRetries + 1` = 4 次；④ `AgentSession._prepareRetry`——CLI 用户真正看到的那个，`baseDelayMs` 默认 **2000**（`agent-session.js:2286-2331`）。**③ 和 ④ 的默认基准延迟不一样（1000 vs 2000）**。⚠️ **harness 的 `retry_scheduled`/`retry_start`/`retry_end` 事件在 `pi-coding-agent` 里零消费者** | G4：「① 自动重试 ② 面板出现『正在重试 2/3』③ 最终成功 ④ 转录里留有重试记录」；探针 §6.2 实跑过 loopback 三次 | **一致**，但要更正两处 + 认领一处 | ① **更正**：探针报告写「+ jitter」，实现里**没有 jitter**（`retry.js:140`）。G4 可以断言精确毫秒；同时意味着**多条 lane 同时 429 会同步重试**。② **更正**：方案与探针都把 `RetryPolicy` 当成一件东西，实际有四套、默认值不一致——阶段 3 要**显式选定用哪一套并写死数值**，不要「用 pi 的重试」这种模糊说法。③ **认领**：harness 的重试事件**上游自己没人消费**，我们会是第一个渲染「正在重试 2/3」的——这和层 3 的统摄性事实同源，要有「遇到问题得自己上报」的预期 |
| **6.6 错误分类（⚠️ 对我们的供应商基本失效）** | `isRetryableAssistantError`（`pi-ai/dist/utils/retry.js:167-174`）是**对 `errorMessage` 做正则**，不看状态码、不看错误类。先查不可重试表（`GoUsageLimitError`/`insufficient_quota`/`out of budget`/`quota exceeded`/`billing`/`available balance`/`Monthly usage limit reached`），再查可重试表（40 条：`429`/`5xx`/`overloaded`/`rate.?limit`/`fetch failed`/`ENOTFOUND`/`socket hang up`/`timed? out`/`terminated`/`ResourceExhausted`…）。**两张表都不命中 = 不重试**（保守默认）。唯一看状态码的是 `provider-retry.js:9-21`（`x-should-retry` 头 > `408/409/429/5xx`） | G4 + 方案 §1.1 B7：「重试打开」 | **没想到（对 Nomi 半失效）** | **阶段 3 前必补一条映射。**这 40 条正则是上游从约 30 个编号 issue 里攒出来的资产（`retry.js:20-77` 每条都带 issue 号），**绝对不该重写**（R20）。但它是**按英文错误文本匹配的**，而 Nomi 走 APIMart / kie，错误正文可能是中文或自定义 JSON（`余额不足` / `{"code": 402}`）。后果分两头：**该重试的不重试**（用户仍然一次抖动白等）、**不该重试的重试**（余额耗尽还烧三次）。**正解不是改上游的表**，是在 Nomi 的 provider adapter 里把厂商错误**归一成上游认得的文本**（例如把 402/余额不足映射成含 `insufficient_quota` 的消息），这样一条正则都不用动就白拿全部资产。这条要做成阶段 3 的一个零额度单测：喂进真实抓到的厂商错误报文，断言分类正确 |
| **6.7 超时（⚠️ 后端角色的问题在这里有确切答案）** | pi-ai 层**没有默认超时**，`timeoutMs` 一路透传（`api/simple-options.js:28`）。CLI 的默认链在 `core/sdk.js:186-199`，兜底 `DEFAULT_HTTP_IDLE_TIMEOUT_MS = 300_000`（**5 分钟**，`core/http-dispatcher.js:3`），并通过 `configureHttpDispatcher()` 设**全局 undici dispatcher** 的 `bodyTimeout`/`headersTimeout`。⚠️ **实核：`configureHttpDispatcher` 只在 CLI 入口被调用**（`main.js:456,686`、`rpc-entry.js:9`、`cli/setup.js:2`、`interactive-mode.js:1480`）——**库路径一次都不调**。另：超时表现为 `AbortError`，没有 `status`/`headers`，所以 `provider-retry` **不**重试它；但它的文本含 `timeout`/`terminated`，落进可重试表，**上层的重试会重试它**。**全仓没有任何 `isTimeout` 分支** | 后端角色在 G4 提的问题：「先确认 `observeNativeStream` 看门狗（90s 首响应 / 120s 空闲）与 pi 重试**会不会互相打架**」 | **可以结案了：不会撞全局 dispatcher，但会撞重试分类** | **确切答案，直接写进阶段 3 的验收门。**（a）**不会撞全局超时**：Nomi 走库路径，`configureHttpDispatcher` 不被调用（仓库实核 `grep configureHttpDispatcher electron/` 零命中），所以 pi 那个 5 分钟全局 dispatcher **对我们不存在**——好消息是没有隐藏的全局副作用，坏消息是**pi 一点传输层超时都不给我们**，`observeNativeStream`（`run.mts:168`：首响应 90s / 空闲 120s）是**唯一**的那道防线，不能删。（b）**会撞分类**：我们的看门狗一旦触发，产出的错误如果是 `stopReason:"aborted"` → 上游**永不重试**（`retry.js:121-125`），一次抖动照样白等；如果是 `stopReason:"error"` 且文本含 timeout → 上游**会重试**。**两种行为完全相反，而现在没人知道 `observeNativeStream` 产的是哪一种。** 这就是后端角色要的那个确认，把它写成阶段 3 的一条零额度断言：注入一次超时，断言 stopReason 与后续是否重试 |
| **6.8 `stopReason` 与步数上限** | 七个值：`pending`(流式中间态，**绝不出现在落盘 JSONL**) / `stop` / `length` / `toolUse` / `error` / `aborted` / `deferred`。循环停止只有四条路（`agent-loop.js:78-171`）：error/aborted 立停、没有工具调用且没有 followUp、整批 `terminate`、以及 **`await config.shouldStopAfterTurn?.(lastCompletedTurn)`（`:154`）**。**`maxSteps`/`maxIterations`/`maxTurns`/`stepLimit` 全仓零命中——没有步数上限。**且 `pi-coding-agent` **从不设置 `shouldStopAfterTurn`**。唯一的合成纠正消息是 `length` + 有工具调用时：*"…was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments."*（`agent-loop.js:272`） | §1.1 **B7**：「三层步数上限收成一层（删掉会说谎的第三条）」 | **有意不同（正确）**，措辞要改，且有一个官方挂点 | 见 1.19。这里补上**挂点**：`shouldStopAfterTurn`（`agent-loop.js:154`）就是上游给宿主放回合上限的官方口子，pi 自己没用。所以 B7 的正确表述是：**「上游提供挂点、不提供策略；Nomi 保留唯一一层策略，挂在 `shouldStopAfterTurn` 上」**——比现在的「三层收成一层」既准确又有落点。⚠️ 顺带：`stopReason: "pending"` 绝不能出现在落盘条目里（`lane.js:1118-1123` 会拒绝），迁移旧数据时要过滤 |

---

### 层 7 · 扩展 API

> **这层管什么**：pi 留给宿主的那一排插座。我们的审批、我们的画布工具、我们的领域记录，都得插在这些孔上——插错孔的代价不是报错，是静默失效。

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **7.1 事件表全集** | **37 个事件**（权威清单 `core/extensions/types.d.ts:907-942`）。**能改变行为的 14 个**：`project_trust`（首个 yes/no 定夺）、`resources_discover`、`session_before_switch`/`_fork`/`_compact`/`_tree`（`{cancel:true}`）、`context`（`{messages}`，**链式**）、`before_provider_request`（**替换 payload**，链式）、`before_provider_headers`（**原地改**，返回值被忽略，`null` 值 = 删头）、`before_agent_start`（`{message?, systemPrompt?}`，systemPrompt **链式**）、`message_end`（**替换已定稿消息**，链式，**必须保持同一个 role** 否则被拒）、`user_bash`（**首个真值短路**）、`input`（`{action:"handled"}` **短路整个 prompt**）、`tool_call`、`tool_result`（各 handler 的补丁**累积合并**）。其余 23 个是纯通知 | K2：审批/花费闸挂 `before_tool` | **一致（选对了那个孔）**，但只用了 37 分之 1 | 不是必补项，是**一份可用清单**。对 Nomi 立刻有价值的四个：① **`ui_prompt_start` / `ui_prompt_end`**（0.84.4 新增，CHANGELOG 原话：*"so host integrations can distinguish active agent work from waiting on user-facing `ctx.ui` prompts"`*）——**这正是「审批弹层挂着时看门狗不该计时」的官方信号**，直接进 6.7 那条断言；② `agent_settled`（所有重试/压缩/排队续跑都确定不会再发生之后才触发）——比 `agent_end` 更适合当「真的结束了，可以收面板」的判据；③ `session_before_compact` —— 4.2 那条领域摘要的挂点；④ `message_end` 可替换消息但**必须保持 role** |
| **7.2 失败隔离（⚠️ 一条精准的不对称）** | **除 `tool_call` 外，每一个钩子都是逐 handler try/catch**，错误走 `emitError({extensionPath, event, error, stack})` 变成一条 `extension_error`，**agent 继续跑**（`runner.js:631-649` 及十余处同款）。**`emitToolCall`（`runner.js:745-761`）没有 try/catch**，抛出后被 `agent-session.js:229-243` 接住并**故意重抛**，注释写死 *"Extension failed, blocking execution"*，最终变成一条错误工具结果。也就是：**`tool_call` 是全表唯一 fail-closed 的钩子，其余全部 fail-open。** 加载期同样隔离：某个扩展的工厂抛异常 → `discard()` 并**取消它已注册的一切订阅** → 继续加载下一个（`loader.js:466-508`, `:388-394`）。⚠️ 这条 0.84.3 才修对（[#8424](https://github.com/earendil-works/pi/pull/8424)「失败的扩展工厂会遗留事件订阅、provider 注册和 flag 默认值」） | K2 未声明失败方向 | **没想到（与 1.12 同一条，这里给出全表证据）** | **阶段 3 前必补。**这个不对称是**设计**不是巧合，而且方向完全正确：审批出错 = 拒绝，其他一切出错 = 记录并继续。Nomi 的 laneHost 要照抄这个形状，并做成 G6 那种零额度判据。⚠️ 同时抄 `discard()` 的教训：一个组件加载失败后**不能留下半注册的订阅**——[#8424](https://github.com/earendil-works/pi/pull/8424) 就是这个 bug |
| **7.3 `tool_call` 改参数：两条路，校验行为相反** | 扩展层**没有 `{args}` 返回形式**——改参数只能**原地 mutate `event.input`**，文档明写 *"No re-validation is performed after your mutation"*（`types.d.ts:716-720, 818-820`）。harness 层的 `before_tool` 返回 `{args}` 则**会重新校验**（`harness/execution/tools.js:44-53`）。相关上游需求 [#7607](https://github.com/earendil-works/pi/issues/7607)「per-tool opt-out of argument validation for host-validated tools」**仍 open** | §2.3④ 提到官方容忍钩子，未区分两条路 | **没想到（低危，一句话就能防）** | 见 1.14。阶段 3 写死：**Nomi 一律走 harness 的 `{args}`（有校验），永不原地 mutate。**这是一行注释的成本，防的是「我们自己把非法参数塞进执行」 |
| **7.4 `registerTool`** | 定义形状即层 1 的那个（`name/label/description/promptSnippet?/promptGuidelines?/parameters/prepareArguments?/executionMode?/renderShell?/execute/renderCall?/renderResult?`）。加载期与加载后**都能调**（`loader.js:218-225` + `refreshTools`）。**同名先注册者胜**（`runner.js:325-335`），自定义工具**会覆盖同名内建工具**。⚠️ **`pi-coding-agent` 对工具名不做任何校验**（未查到）；唯一的重名报错在 harness 的 `validateToolNames`（`pi-agent-core/dist/harness/config.js:2-9`，抛 `Duplicate tool name`），而且只查重名、不查字符集 | §3.1：正则取 pi 运行时正则与 Anthropic `^[a-zA-Z0-9_-]{1,64}$` 的**交集**，**在注册表处**校验 | **一致（且我们比上游严，理由是真机血的教训）** | — 这条要在方案里标成**「上游不提供，我们自建，且有真机证据」**：`layout.read` 那个带点的别名不合正则 → `createHostTools` 直接抛 → 整个 timeline/production 工具档一次请求都发不出去。上游连重名都只在 harness 查，字符集完全不管 |
| **7.5 slash command** | `registerCommand(name, {description?, getArgumentCompletions?, handler})`。重名自动加后缀 `name:1`、`name:2`（`runner.js:445-473`）。派发在 `prompt()` 最前面（`agent-session.js:828-835, 954-977`）——**在 `input` 事件之前、模板/技能展开之前，且 agent 正在流式时也会执行**。扩展命令**不能排队**：`steer()`/`followUp()` 遇到它会抛（`:1083-1090`） | 方案未涉及 | **有意不同（Nomi 有自己的 UI 入口）** | 不补 |
| **7.6 `ctx` 与 `ctx.ui`（⚠️ 无 UI 时的默认值）** | `ctx`：`ui / mode("tui"\|"rpc"\|"print"\|"json") / hasUI / cwd / sessionManager / modelRegistry / model / scopedModels / thinkingLevel`，方法 `isIdle() / isProjectTrusted() / signal / abort() / hasPendingMessages() / shutdown() / getContextUsage() / compact() / getSystemPrompt()`。**每个成员先 `assertActive()`**，跨 `newSession`/`fork`/`reload` 捕获的旧 ctx 会抛明确错误（`runner.js:554-557`）。`ctx.ui` 阻塞型四个：`select` / `confirm` / `input` / `editor`（+`custom`），全部被 `wrapUIPromptContext` 包成会发 `ui_prompt_start/end`。**无 UI 时（print/json 模式）`ctx.hasUI === false` 且 `confirm()` 立即返回 `false`、不弹、不报错**（`runner.js:89`），`select`/`input` 返回 `undefined` | K2：审批挂 `before_tool`；§1.3 付费闸永不投影给内部模型 | **一致（fail-closed 方向相同）**，一条要抄 | 阶段 3：**`ctx.hasUI` 这个显式信号值得抄。**Nomi 有真实的「没有 UI 可问」的场景——MCP 外部宿主调进来、后台批量跑、走查脚本。那时审批必须**明确地拒绝**而不是挂起等一个永远不会来的点击。pi 的三层保险（`hasUI` 显式判断 + `confirm` 默认 `false` + 示例里 `if (!ctx.hasUI) return {block:true}`）是完整的形状 |
| **7.7 参考扩展（79 个，全在包里）** | `dist/extensions/` 只有 `llama` 一个内建（而且它**一个 `pi.on` 都没注册**，只用 `registerProvider` + `registerCommand`）。**真正的参考语料是 `examples/extensions/`——79 个 TypeScript 源文件，随 npm 包发布**。与本次重做直接对口的：`permission-gate.ts`（危险命令弹 `ctx.ui.select`，**无 UI 时默认 block**）、`protected-paths.ts`、`plan-mode/`、`sandbox/`、`subagent/`、`tool-override.ts`、`truncated-tool.ts`（截断的完整示范）、`dynamic-tools.ts`、`kimi-deferred-tools.ts`（动态装载）、`custom-compaction.ts`、`trigger-compact.ts`、`entry-renderer.ts`、`structured-output.ts`（`terminate` 的最小示例）、`handoff.ts` | 方案未引用过其中任何一个 | **没想到（不是缺陷，是没被打开的书架）** | 不是必补项，是**阶段 2/3 动手前该读的**。特别点名三个：`permission-gate.ts`（= K2 的参考实现，20 行）、`truncated-tool.ts`（= 1.9 那条缺失规则的完整示范）、`dynamic-tools.ts`（= 1.15 的动态工具解法）。**这三个文件加起来不到 200 行，能省掉阶段 2 和阶段 3 各一次返工** |

---

### 层 8 · 观测与测试

> **这层管什么**：出事之后怎么知道出了什么事，以及怎么在不烧额度的前提下证明这套东西是对的。

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **8.1 遥测** | **不是 OpenTelemetry**（全仓 `opentelemetry\|otlp\|OTEL_` 零命中，`pi-telemetry` 包**零运行时依赖**）。它是一套 callback-scoped span 契约：`startSpan(options, cb)`，**没有 `span.end()`**——callback 的 promise settle 时 span 就结束。**默认关且没有开关**：`getTelemetryContext` 拿不到就返回 `NOOP`（`pi-agent-core/dist/harness/context.js:6-8`），而 `pi-coding-agent` **从不安装真实 context**（零命中）。声明了 11 个 span（`harness/telemetry.js`），**实际只有 `pi.harness.hook` 被真正发出**。属性里全是 id / 枚举 / 计数，**没有提示词、没有工具参数**；schema 支持 `sensitive?` 标记但**没有一个属性用它** | 2026-09-06 拍板：遥测默认关 + 白名单 + Aptabase | **一致（且对我们无风险）** | 顺带澄清一个**同名歧义**，免得以后误判：pi 里有**两个都叫 telemetry 的东西**。① 上面那套 span——网络零出口、默认关，**对我们无影响**；② `enableInstallTelemetry`——**默认开**，会 `fetch("https://pi.dev/api/report-install?version=…")`，并给 OpenRouter/NVIDIA/Cloudflare 加归属头（`HTTP-Referer: https://pi.dev`、`X-OpenRouter-Title: pi`）。**实核：安装上报只在 `interactive-mode.js:930-945` 触发，Nomi 走库路径不经过它。**但**供应商归属头在 `core/provider-attribution.js` 里，要在阶段 1 实抓一次出站报文确认它没跟着我们的请求出去**——我们的隐私承诺不能建立在「大概不会」上 |
| **8.2 磁盘日志** | **pi 不写任何常驻运行日志。**唯一的落盘是 `/debug` 手动命令写 `~/.pi/agent/pi-debug.log`（`interactive-mode.js:5406-5432`），而且它 dump 整个 TUI **加上每条 agent 消息的 JSONL**——**这个 debug 日志和转录一样敏感**，且 `writeFileSync` 没指定 mode。诊断走 stderr（`main.js:68-74`），`PI_TIMING=1` 的启动计时也走 stderr | `docs/plan/2026-09-06-logging-and-diagnostics-bundle.md`（本轮未展开读）；memory 记录「日志盘点结论：无统一落盘日志」 | **有意不同（我们必须比它多）** | 不补进本方案，但记一条：**上游在这一层什么都不给**，Nomi 的日志体系是 100% 自建，别指望从 pi 拿到任何现成的运行日志。抄的只有一条教训：**debug 转储和转录同等敏感，写它的时候要按 `0o600` 而不是默认 umask** |
| **8.3 pi 自己的一致性测试套件（⚠️ 直接可抄的最大一块）** | **三套 conformance suite，随包发布、runner 无关**，每个 case 是 `{group, name, run(): Promise<void>}`（`pi-agent-core/dist/harness/session/testing/types.d.ts:6-11`），用 `node:assert/strict` 断言，用一个循环就能注册进 vitest。① **`createStorageConformance`**（`conformance/storage.js:151`）**21 例**，覆盖事务原子性与回滚、共享 id 命名空间、parent 只能解析到更早的写、值/列表的同事务顺序、分支查询语义、usage 账本、**提交串行化**、**seal→drain→close 幂等**。② **SessionRepo conformance**（`conformance/session-repo.js`）**9 个工厂 / 16 例**，且**刻意按 `Pick<SessionRepo, …>` 拆分**（`session-repo.d.ts:4-20`），让只实现一部分的后端只跑对应的组——lifecycle / ownership（**拒绝重复打开同一会话**）/ messages / fork 行为 / fork 目的地预留 / fork 源快照一致性。③ **telemetry adapter conformance** `9 例`，其中 `unreadable()` Proxy 助手（`pi-telemetry/dist/testing/conformance.js:90-105`，对 `get`/`ownKeys` 等一律抛）用来证明**instrumentation 永远不会把被测代码搞崩** | G3：「冷重启顺序 —— 机器断言，不是人眼」；G7：两条新门岗基线归零 | **没想到（本层最大的一块白拿）** | **阶段 1 前必看，能省掉自己设计一套。**G3 要证的正是这几套在证的东西。三条具体动作：① Nomi 注入自己的 `FileSystem` 实现（3.2 的 `renameFile` 语义、`<project>/.nomi/` 布局），**就用 `createStorageConformance` 压它**——这是把「同步目录下 rename 不原子」变成 CI 断言的最省办法；② 抄两个设计而不只是抄用例：**runner 无关的 `{group,name,run}`**（同一套能在 vitest / 走查脚本 / CI 里跑）和 ***`Pick<>` 分组工厂***（部分实现只跑对应组）；③ `unreadable()` Proxy 值得单独抄进 Nomi 的测试工具箱 |
| **8.4 零成本测试替身** | 专用替身四个（`harness/session/testing/index.js:1-8`）：`StorageDecorator`（全 11 方法转发基类）、`InstrumentedStorage`（录下每次 commit 的写集）、**`GatingStorage`**（`arm()`/`waitPending(n)`/`next(n)`/`discard()`——**确定性地把提交停住**）、`CommitDiscarded`。生产用的内存实现也当替身：`MemorySessionRepo`/`MemoryStorage`（都可注入确定性时钟 `now`）、`InMemoryTelemetryContext`、`InMemoryCredentialStore`、`InMemorySettingsStorage` 等。⚠️ **没有假模型 provider**（`fake\|mock\|loopback` 在 `pi-ai/dist` 零有效命中）——跑完整回合的测试要么自建本地 HTTP server，要么花真钱 | R18「测试禁私有墙钟 waitFor / `Date.now()` 截止轮询」；「复现竞态必须有阳性对照」（memory 教训） | **没想到（`GatingStorage` 正中我们两条规矩）** | **阶段 1 抄。**`GatingStorage` 是 R18 想要的那个东西的成品：**用「停住第 N 次提交、等它真的挂起、再放行」代替 sleep 轮询**，天然是确定性的，而且 `discard()` 给出了「阳性对照」——模拟永久性存储丢失，证明测试真的能红。⚠️ 同时记下**上游不给的**：**假模型 provider 上游没有**，探针里那个 loopback 是我们自己写的。G2（一次写对率）和 G4（429 不死）的夹具都得自建，别指望白拿 |
| **8.5 RPC / JSON 作为可测接口** | RPC（`pi --mode rpc`）**不是 JSON-RPC**，是自定义行分隔 JSON，**33 个命令**（prompt/steer/follow_up/abort/clear_queue/fork/clone/compact/get_entries/get_tree/get_session_stats/bash…），外加一条双向的 Extension UI 通道（select/confirm/input/…）。**框架是严格 LF-only JSONL，文档专门警告 Node `readline` 不合规**（它还会在 `U+2028`/`U+2029` 上切，而那两个字符在 JSON 字符串里合法）。**是一个能驱动整个会话的可测接口**。JSON 模式（`--mode json`）：首行是 session header（`version: 3`），之后每行一个裸事件对象，**没有信封、没有序号、没有版本协商**——`--json` 是**未版本化**的内部形状，且 0.84.0 起 `message_update` 变成 delta-only | 方案未涉及 | **有意不同（我们不需要）** | 不补。两条备查：① 若将来 Nomi 要把「Agent 会话」暴露给外部宿主，这 33 个命令是一份现成的功能面清单；② **`--json` 未版本化**，任何基于它的自动化都是脆的——这条支持我们「投影层自己定契约」的做法 |
| **8.6 工具调用正确率的评测框架** | **上游一个都没有。**没有 `evals/`、没有任务集、没有 LLM-judge、没有工具调用金标对比、没有 fixture 录制回放。`testing/benchmark/**` 测的是**存储吞吐**，不是模型或工具正确性 | G2：「`canvas.write` 从 0/18 到 ≥90%，用 #547 同一套任务复测：5 任务 × 3 次、同模型、同隔离 profile」 | **有意不同（我们必须自建，且已有设计）** | 不补。**这条反而是好消息**：G2 那套「同任务 × 同模型 × 同 profile 复测 + 改前基线」的设计**没有上游可抄，是我们自己的资产**，方案里已经写对了。要做的只是把它固化成能反复跑的东西，并配上 §8.2 那条离线回归（把真机抓到的畸形参数钉成 fixture） |

---

### 层 9 · 安全

> **这层管什么**：pi 明说它不管哪些事——那些就是我们必须自己管的事。

> **一句话**：`docs/security.md` 的立场非常干脆——*"Pi does not include a built-in sandbox."*、*"Project trust … is not a sandbox and it does not restrict what the model can ask tools to do."*、*"Prompt injection … is expected local-agent risk and cannot be reliably prevented by pi."* 它是一个**信任本机用户的本地 CLI**。**Nomi 是打包桌面应用 + MCP 宿主 + 会花用户的钱，威胁模型不同——所以本层几乎全是「有意不同」，而每一条不同都是我们要自己扛的活。**

| # | pi 参考实现怎么做 | 我们重做方案怎么做 | 判定 | 若「没想到」阶段几之前必须补 |
|---|---|---|---|---|
| **9.1 project trust 到底管什么** | 只管**加载项目本地配置**：`.pi/settings.json`、`.pi/{extensions,skills,prompts,themes}`、`.pi/SYSTEM.md`/`APPEND_SYSTEM.md`、祖先目录的 `.agents/skills`、项目包安装。**不管的**：一切工具执行（未受信项目里 `bash`/`write`/`edit` 照跑）、全局资源、**以及 `AGENTS.md`/`CLAUDE.md`——那些无论信不信任都加载**。决策存 `~/.pi/agent/trust.json`，**向上继承**（信了 `~/code` 就等于信了以后 clone 到里面的每个仓库）。无 UI 时 fail-closed 到 `false` | Nomi 用空 ResourceLoader，整个面关闭 | **有意不同（我们更严，且已登记）** | 不补。见 4.5 |
| **9.2 沙箱** | **零。**`sandbox\|seatbelt\|landlock\|firejail\|bubblewrap` 全仓唯一命中是「**在别人的沙箱里跑 pi**」的兼容代码（`bun/restore-sandbox-env.js`）。文档给出理由并推荐容器/VM/micro-VM | §1.3：内部 agent 永远不能自己开付费闸；改成「够得着但永远批不动」 | **有意不同（领域不同）** | 不补。Nomi 的工具是领域工具（画布/时间轴），不是 `bash` —— 我们的「沙箱」是**工具面本身**，这个方向对。**唯一要补的是 9.3** |
| **9.3 路径包容（⚠️）** | **完全没有。**`resolveToCwd`（`core/tools/path-utils.js:42-44`）只做解析，**不做 `relative()` 前缀断言、不拒绝 `../`**；而且 `resolvePath`（`utils/paths.js:58-80`）还**主动扩大触达面**：`~` → homedir、`file://` → 路径、win32 上 `/mnt/c/...`→`C:\...`。实际规则是：**绝对路径原样用、相对路径按 cwd 解、`~` 和 `file://` 展开、`../` 永不拒绝**。harness 侧同理（`harness/tools/path-utils.js:8-10`，包容只可能住在注入的 `env` 里，而发货的 Node env 不加) | §3.3 有 provenance 规则（`receivedType` 只带类型名不带值），**没有路径包容规则** | **没想到** | **阶段 2 前必补（新增 S11）。**Nomi 有真正吃路径的工具：`document.read`/`document.write`、asset 类。上游一点包容都不给，**100% 是我们的活**。规则：**所有模型可达的路径参数必须被约束在项目目录内**（解析 + `realpath` + 前缀断言），`~`/`file://`/`../` 一律拒绝而不是展开。这条能被门岗机器化（扫「路径类字段的 transport adapter 有没有过统一的 `containPath()`」），且 R28 说得很清楚：这是能在最早一层拦住的事 |
| **9.4 密钥** | `~/.pi/agent/auth.json`，**明文 JSON，但 `mode: 0o600`、父目录 `0o700`**（`core/auth-storage.js:15,25,30,66,140`），锁用 `proper-lockfile`。**没有任何脱敏**：`redact\|scrub\|mask` 全仓在密钥语义上零命中，UI 也不打码。`pi auth print-api-key` 是**故意**把明文打到 stdout | 方案未涉及（Nomi 有自己的加密密钥存储） | **有意不同（我们更严）** | 不补。抄一条：**`0o600` 这个显式 mode 值得抄到我们所有敏感落盘上**——见 9.5 |
| **9.5 转录文件敏感度（⚠️ 一处上游自己的不一致）** | 会话 JSONL 里是 `JSON.stringify(entry)` **原样**：用户提示词、助手正文、**工具调用的完整参数**、**工具结果的完整文件内容 / 命令 stdout**，外加 `pi-ai` 挂上去的**错误堆栈**（`pi-ai/dist/utils/diagnostics.js:19-24`）。⚠️ **所有会话写入都没指定 mode**（`appendFileSync`/`writeFileSync` 裸调），落盘是 `0o666 & ~umask` ≈ **`0o644`，世界可读**——**而同一个产品里 `auth.json` 是刻意的 `0o600`**。`/share` 默认 `visibility=organization`（不是 private） | §3.3 定了**出站**的 provenance 规则（不回传值给模型），**没定落盘的** | **没想到** | **阶段 1 前必补（一行的事，但是承诺）。**Nomi 把转录写进 `<project>/.nomi/`——那是用户会用 Finder 打开、会同步、会分享给协作者的目录，里面装着**他的原稿正文**。上游在这里自己就不一致（密钥 0600 / 转录 0644），**别抄这个不一致**。规则：会话与 debug 转储一律 `0o600`，目录 `0o700`，和密钥同档 |
| **9.6 提示词注入** | **零防御。**`injection\|untrusted\|prompt-injection` 全仓只命中 OAuth 的 host 校验和 project trust 的 UI 文案。工具结果**作为普通内容直接插进对话**，没有「以下是不可信数据」的包裹、没有指令模式识别。`docs/security.md` 直接把它写成**预期风险**并划到安全边界之外 | §3.3 的 provenance 边界（只出不入的那一半） | **有意不同（我们的威胁面不同，且更大）** | **阶段 2 记一条、不必立刻做。**Nomi 的注入面和 pi **不一样**，而且有两条 pi 没有的：① **用户导入的原稿/素材**会整段进模型——那是外部文本；② **Nomi 自己是 MCP 宿主**，外部宿主（Claude Code 等）送进来的内容会经过我们的工具。上游明确不管，所以这条只能自建。**现在不做是对的**（重做期不该开新战线），但要**登记成一条已知缺口**而不是让它继续隐身——D4：缺口明着标 |

---

## 3. CHANGELOG 0.80 → 0.85.1：三条最要命的坑

> 全表见随包发布的 `pi-coding-agent/CHANGELOG.md`（553 KB，回溯到 0.75）。仓库 `https://github.com/earendil-works/pi`（旧链接里的 `pi-mono` 会重定向到同一个）。这里只挑**对「在 harness 上盖宿主」的人最致命的三条**。

**坑 1 · 0.84.0 是一次持久化层的整体换底，而它埋了一个只在生产才炸的条件。**
一次发布里同时落了四条破坏性变更：harness 的会话模型换成 lane-based `Session`/`SessionStorage`/`SessionRepo`；`AgentHarness` 从 experimental 提升为默认导出并**移除了 experimental 子路径**；**legacy JSONL 与内存仓库 API 直接删除**；以及——最要命的那条——**新增强制的 `FileSystem.renameFile()`，且要求「同文件系统替换」语义**（[#7707](https://github.com/earendil-works/pi/pull/7707)）。最后一条是典型的静默杀手：一个满足类型签名但底层是「跨卷 copy + delete」的实现，**只在被中断的那一刻**才破坏 JSONL 的原子发布——测试里全绿，生产里损坏会话。**这条对 Nomi 是直球**：我们要把会话写进 `<project>/.nomi/`，而用户项目住在 `~/Documents/Nomi Projects/`，**那可能是 iCloud 同步目录**。注入的 `FileSystem` 必须显式满足这条语义并有单测。

**坑 2 · 0.84.0 把 `message_update` 改成 delta-only，而失败方式是「静默地什么都不显示」。**
[#7290](https://github.com/earendil-works/pi/issues/7290)：JSON 与 RPC 流里**移除了累积的 `message` 字段和 `assistantMessageEvent.partial`**。一个靠读 `event.message` 渲染实时输出的宿主**不会崩、不会报错**——它只是**什么都不画**，看起来像 agent 卡住了；而 `message_end` 照常到达，所以**最终转录完全正确**。这就是教科书式的「最终态测试全绿、中间过程死掉」。必须改成从 `contentIndex` + `delta` 自己重组。同一条通道上还有一个配套陷阱：`docs/json.md` 明说顶层 `usage` *"may remain zero when a provider only reports usage at completion"* ——**建立在流式中途读 usage 上的花费显示，对整类供应商恒为 0**。这条直接关联我们的 G5。

**坑 3 · 工具参数校验连着四个版本在动，而 `tool_call` 的改写完全绕过它。**
0.80.4 放宽 `edit` schema 容忍模型自创字段（[#6278](https://github.com/earendil-works/pi/issues/6278)）→ 0.83.0 修可空**数组**参数的编译校验、同时删掉一批 TypeBox API → 0.84.0 修 `anyOf`/`oneOf` 强转会把 `null` 变成别的原始值（[#7328](https://github.com/earendil-works/pi/issues/7328)）→ 0.84.2/0.84.3 修单对象 `edit` 输入校验失败（[#7835](https://github.com/earendil-works/pi/issues/7835)）。**连续四个版本改变你的工具实际收到什么。**再叠上文档那条 *"No re-validation is performed after your mutation"*，以及 [#7607](https://github.com/earendil-works/pi/issues/7607)（「host 已校验的工具能不能逐个关掉校验」）**至今 open**——结论是：**这一层不稳定，且没有官方的退出口**。对我们的意思是岔路 3 的转换器必须有自己的门岗和 fixture（把真机畸形参数钉死），**不能假设「上游的校验行为是稳定的背景」**。

**另外三条与我们直接相关、值得单独记住的修复**（都不在上面三条里）：
- **0.84.4 [#8537](https://github.com/earendil-works/pi/issues/8537)**：扩展用 `triggerTurn:false` 送的消息**在 agent 运行中被插进了 tool call 与它的 result 之间**，导致校验消息顺序的供应商**拒绝整段重放历史**。⚠️ **这是岔路 2（用 `appendCustomEntry` 写审批卡）的直接雷区**——审批卡正是「在工具跑的过程中插一条记录」。修法是等这一轮的 tool result 都落地再追加。**阶段 3 必须照做，否则症状是「换了个供应商就整轮报错」。**
- **0.84.4 [#6879](https://github.com/earendil-works/pi/issues/6879)**：大工具结果**跨过自动压缩阈值后仍被发给供应商**才压缩。这是 1.9（工具必须自截断）那条规则的**事故来源**。
- **0.85.1 [#9132](https://github.com/earendil-works/pi/issues/9132)**：**0.85.0 因为误发布内部实验代码而直接把 SDK 导入搞坏了**，0.85.1 才修好。这条是对「只发布一天」那个担心的**实证**——上游在这个版本段确实翻过车，所以「锁精确版本、不用 `^`」和「PR-1 只升版本、验收就是 build/typecheck/151 条测试」这两条节奏是对的。

---

## 4. 「没想到」清单（按阶段排）

> 共 **24 条**。每条一句「怎么补」。排序依据是「不补会在哪个阶段咬人」，不是重要性。

### 4.1 阶段 2 之前必补（9 条）

| # | 层 | 一句话 | 怎么补 |
|---|---|---|---|
| **G-01** | 1.4 | **根级 `anyOf` 在部分供应商上会被静默丢弃**，我们有 11 处 `z.discriminatedUnion` | 把 S2「单工具 `anyOf` ≤ 4」升级成 **「模型可见 schema 的根必须是扁平对象，根级 `anyOf` 计数为 0」**；`operation` 降成 `StringEnum` 判别字段，分支专属字段设为 optional，跨字段约束在 `execute`/`before_tool` 里做 |
| **G-02** | 1.8 | **失败必须 `throw`，`return` 一个错误对象会被记成成功** | `ToolFailure` 改成「throw 出去的 Error 的序列化格式」，不是 return 的形状；`check:model-schema` 加一条断言「transport adapter 里不出现 `return …ToolFailure`」 |
| **G-03** | 1.1 + 4.7 | **描述三通道我们一个都没用，而且用自定义系统提示词把渲染它们的那段换掉了**（复合缺陷） | S4 拆成 S4a（description 只说「干什么 + 限制 + 截断」）+ S4b（跨工具消歧走 `promptSnippet`/`promptGuidelines`）；**同时**在自定义系统提示词里重建 `Available tools` 与 `Guidelines` 两段。只补一半等于没补 |
| **G-04** | 1.9 | **工具输出零截断**，而上游把它写成 MUST | 新增 **S10**：模型可见的工具结果必须自截断（建议同样 50KB / 2000 行），截断时在正文里给**可执行的下一步**（`使用 offset=N 继续`），全文落盘并把路径放 `details`；截断上限写进 description 且从同一常量插值 |
| **G-05** | 1.3 | **枚举没有用 `StringEnum`**，直译成 `const` 会在 Google 系上失效 | 岔路 3 的转换器加一条硬规则：枚举一律降成 `{type:"string", enum:[…]}`；门岗断言「模型可见 schema 里不出现 `const`」 |
| **G-06** | 1.5③ | **工具改名/合并/拆分后，迁移来的旧会话里的旧形状 tool call 会全部校验失败** | 每个被改名/改形状的工具配一个 `prepareArguments`，把旧形状折成新形状（这正是上游文档给的首要用途）；配一条 fixture 测试：喂旧形状、断言通过 |
| **G-07** | 9.3 | **路径参数零包容**，上游一点都不给 | 新增 **S11**：所有模型可达的路径参数走统一的 `containPath()`——解析 + `realpath` + 项目目录前缀断言，`~` / `file://` / `../` 一律拒绝（不是展开） |
| **G-08** | 1.6 | 「校验只发生一次」的那一次**必须是会强转的那一次** | 写死：唯一校验点复用 pi 的 `validateToolArguments`（含 `normalizeOptionalNulls` + `Value.Convert` 两道容忍），**不要**在转换器后面再接一个严格的 zod `.parse()` |
| **G-09** | 1.15 | **`addedToolNames` 动态装载**是 S7（≤12 工具）的上游解法，我们没评估过 | 阶段 2 至少做一次判断并写进方案：production profile 30 个工具靠静态合并很可能压不到 12，动态装载是现成的第二条路（且上游做了 KV-cache 友好的排序） |

### 4.2 阶段 3 之前必补（8 条）

| # | 层 | 一句话 | 怎么补 |
|---|---|---|---|
| **G-10** | 5.3 | **自定义模型不声明 cost 就静默算成 $0**，而我们的模型全是自定义的（`model.mts:72` 就是全零） | 门岗断言「每个 Agent 可选模型要么有非零费率、要么显式 `free:true`」；单独一条单测校验 catalog 的 `pricing` → `Model.cost` 的**单位换算**（per-million + 币种） |
| **G-11** | 6.7 | **看门狗与重试分类的相互作用没人确认过**（后端角色 G4 提的问题） | 零额度断言：注入一次超时，断言 `observeNativeStream` 产出的是 `aborted`（永不重试）还是 `error`+timeout 文本（会重试），并按产品意图选定 |
| **G-12** | 6.6 | **上游的 40 条重试正则按英文错误文本匹配，对 APIMart/kie 基本失效** | 不改上游的表；在 Nomi 的 provider adapter 里把厂商错误**归一成上游认得的文本**（402/余额不足 → 含 `insufficient_quota`）。配零额度单测：喂真实厂商报文，断言分类 |
| **G-13** | 1.12 + 7.2 | **`tool_call` 是全表唯一 fail-closed 的钩子**，我们没声明审批的失败方向 | 写死「审批模块抛异常 = 拒绝执行」，做成 G6 那种零额度判据（把审批换成必抛的版本，断言工具没跑） |
| **G-14** | 1.13 | **`block` 只拦被拦的那一次；一批 3 个工具里拒 1 个，另外 2 个照跑**；且是「先全部预检、再并发执行」 | 审批 UI 按真实时序设计（整批弹、不是逐个弹），并决定「拒一个是否等于拒整批」——要拒整批就得让整批都 `terminate` |
| **G-15** | 3.6 | **逐 customType 决定「模型该不该看见」**——注册了 projector = 每一轮都占 token | 出一张表：审批结果**进**上下文（它是模型下一步的依据），纯展示的任务卡/进度卡**不进**。抄 pi 的二分当命名约定：`nomi.ctx.*` 进、`nomi.ui.*` 不进 |
| **G-16** | CHANGELOG [#8537] | **在工具跑到一半插 custom entry，会插进 toolCall 与 toolResult 之间，让严格校验顺序的供应商拒绝整段历史** | 审批卡等待这一轮的 tool result 全部落地后再追加（上游的修法）。**这是岔路 2 的直接雷区** |
| **G-17** | 5.7 | **G5 的判据「三个数都 > 0」在刚压缩完/新会话时是假红**——上游明确设计了「不可知」第三态 | 三行各自改成 `有值 / 不可知 / 该档位下不适用` 三态；「不可知」不渲染或给明确占位，**绝不渲染 0**（与设计角色对「思考」行的要求同一条） |

### 4.3 阶段 1 之前必补（4 条 —— 比阶段 2 还早，因为它们是地基）

| # | 层 | 一句话 | 怎么补 |
|---|---|---|---|
| **G-18** | 3.2 | **同一进程把同一个会话打开两次会写重复 `seq` 并损坏文件**（[#8852](https://github.com/earendil-works/pi/issues/8852)），而 Nomi 是多窗口 Electron | 主进程里做「一个会话只能有一个打开者」的锁 + 一条断言，不能靠约定 |
| **G-19** | 3.2 / 坑1 | **`FileSystem.renameFile` 必须是同文件系统的原子替换**，而用户项目可能在 iCloud 同步目录 | 注入的 `FileSystem` 显式满足该语义并单测；用 **`createStorageConformance`（8.3）压它** |
| **G-20** | 9.5 | **会话文件默认 `0o644` 世界可读**，里面装着用户原稿正文（上游自己在这里不一致：密钥 0600 / 转录 0644） | 会话与 debug 转储一律 `0o600`、目录 `0o700` |
| **G-21** | 8.1 | **供应商归属头**（`HTTP-Referer: https://pi.dev` 等）要确认没有跟着我们的请求出去 | 阶段 1 实抓一次出站报文确认。隐私承诺不能建立在「大概不会」上 |

### 4.4 可延后（3 条）

| # | 层 | 一句话 | 怎么补 |
|---|---|---|---|
| **G-22** | 4.2 | 压缩摘要提示词是**为写代码调的**（"preserve exact file paths, function names"），丢了 anchor id 下一次画布写就只能瞎编 | 用 `/compact` 的 `customInstructions` 换掉那句；并抄「机器追加确定性清单」的手法，压缩后自动补 `<touched-shots>`/`<touched-nodes>` —— **id 不该交给模型去记** |
| **G-23** | 2.1 | **顺序修好 ≠ 画面修好**：pi 自己的 TUI 也是「全部文字，然后全部工具卡片」 | 投影层要把一条助手消息**拆成多个 view item**（text/thinking/toolCall 各一个），这是超出参考实现的一步，要写进 `laneViewModel` 契约 |
| **G-24** | 6.2 | **harness 的队列模式默认 `"all"`**（CLI 是 `one-at-a-time`），用户连打三句会一次性全注入 | 显式声明并写死，不要继承 harness 默认值。对创作场景 `one-at-a-time` 大概率更对 |

---

## 5. 「有意不同」清单

> 纪律：每条的理由必须是 **Nomi 的领域约束**（桌面创作 / 审批花钱 / 画布·分镜·时间轴 / MCP 宿主），不是偏好。写不出领域理由的，就不是「有意不同」，是「没想到」。

| # | 层 | 不同点 | 领域理由 | 代价（诚实标出） |
|---|---|---|---|---|
| **D-01** | 1.19 / 6.8 | **保留回合上限**（pi 一条都没有，`while(true)`） | pi 是 CLI，人盯着、Esc 随时能停；**Nomi 是打包桌面应用，用户点完就去干别的，而每一轮都在按 token 花钱**。没有上限 = 一个循环烧到额度见底 | 会把「刚好到上限的正常收尾」误报成失败——所以三层里**只有一层有权改变用户看到的结论**（方案 B7 已写对）。挂点用官方的 `shouldStopAfterTurn` |
| **D-02** | 1.18 | **逐能力的工具执行超时**（pi 没有，[#8857](https://github.com/earendil-works/pi/issues/8857)） | pi 的工具是本地 `rg`/`sed`，秒级；**Nomi 的工具会调云端生成，一跑几十分钟**。没有超时 = 供应商挂了我们永远转圈 | 要逐能力声明（读类 30s / 生成类几十分钟），不能一个数走天下；且**不能和模型请求看门狗混成一个数** |
| **D-03** | 2.4 | **同一工具连错 N 次折成一行** | pi 的用户是开发者，7 张卡片能读；**Nomi 的用户在做片子，7 张红卡片是纯噪音**，而且他读到「我来拆镜头」往下翻先撞见 7 条失败 | 折叠是投影层的语义判断，**天然违反 I1「不得排序」的字面表述**——I1 要改写成「不得**重排**」而不是「不得**分组**」，否则门岗 O1 会把这条设计拦掉 |
| **D-04** | 2.9 | **集中式渲染（8 个固定积木），工具不自带渲染器** | Nomi 有**已拍板的设计系统 + 57 张视觉基线**；「每个工具自带长相」会直接把基线打散，也让 R15 的 i18n 与 token 门岗失去着力点 | 失去 pi 那种「第三方工具自带展示」的扩展性。**但要抄两条**：渲染失败必须 try/catch 降级到兜底积木；渲染层与执行层可分离 |
| **D-05** | 4.5 / 9.1 | **空 ResourceLoader**，不加载任何项目本地指令文件 | pi 的 `AGENTS.md` **不受 project trust 约束**，一个敌意仓库无提示地就能改模型行为；**Nomi 的「项目」是用户的创作项目，可能来自别人分享**，没有理由让项目目录里的文件改我们的系统提示词 | 失去 pi 后续在这一层加的一切（已在 `framework-boundaries.json` 登记为**有意的隔离决定 + 债**）。这是**已经比参考实现更安全**的一处 |
| **D-06** | 4.6 | **保留显式 `load_skill` 工具**（pi 用 0 个工具做同一件事） | pi 的 progressive disclosure **依赖模型自觉**（文档自陈 *"models don't always do this"*）**且依赖 `read` 工具存在**（0.85.0 才修「Bash 是唯一工具时技能不可用」）。**Nomi 的技能正文不一定在磁盘上**（skill hub），也不给模型 `read` 工具 | 占掉一个 S7 名额（≤12 工具里的一个）。这条以前没写理由，现在补上 |
| **D-07** | 1.5① | **容忍时不静默——在结果里回一句「已按 JSON 字符串解析」** | pi 静默归一（`prepareEditArguments` 不告诉模型）。**Nomi 每一轮都花用户的真钱**，让模型学会正确形状比让它每次都错一遍再被我们悄悄修正更省钱 | 多几个 token，且要确认「回一句」不会被模型误读成失败 |
| **D-08** | 8.6 | **自建工具正确率评测**（pi 一个评测框架都没有） | `canvas.write` 真实成功率 0%，这不是打磨项是「画布 Agent 目前不可用」。**没有数字就没法说改好了** | 全部自建，包括假模型 provider（**上游也不给**）。好消息是 G2 的设计已经写对 |
| **D-09** | 9.5 | **会话与 debug 转储按 `0o600` 落盘** | 转录里装着**用户的原稿正文**，而 `<project>/.nomi/` 是用户会用 Finder 打开、会同步、会分享的目录 | 无。上游自己在这里就不一致（密钥 0600 / 转录 0644），我们只是不抄那个不一致 |
| **D-10** | §1.3 | **付费闸「够得着但永远批不动」** | pi 明确不做审批（`docs/security.md`）；**Nomi 的工具会花用户的真钱**，信任边界必须存在且独立于权限档位 | 无。这是方案已有的设计，此处只确认上游确实把这块留给宿主，不是我们重造轮子 |

---

## 6. 上游对齐检查流程草案

> **它解决哪个真实摩擦**：本次审查发现的绝大多数东西，来自三个**一次 `ls` 就能看见、但从来没人打开过**的目录（`docs/`、`examples/extensions/`、`CHANGELOG.md`）。这不是谁的疏忽——是**没有一个固定时机会去看它们**。pi 大约每周发一个版本，我们锁精确版本，所以「什么时候看、看什么、看完产出什么」必须是机器化的，否则下一次仍然是「等撞到了才知道」。
>
> **要权衡的那一个东西**：这道流程的成本是**每周一次几分钟的确定性脚本 + 有差异时一次分诊**；不做的成本是**每次升级都变成一次考古**，以及像这次一样，一整份方案在工具层留下 9 个洞才被发现。

### 6.1 发现层（确定性脚本，零额度，进 `radar:models` 的同一时机）

新增 `pnpm run radar:upstream`，对 `framework-boundaries.json` 里登记的每个框架（今天只有 pi 的三个包）做四件事，**全部是本地文件比对，不烧额度**：

1. **版本差**：`npm view <pkg> version` vs `package.json` 的 `pnpm.overrides` 锁定值。相等 → 后面全跳过，打印一行「无新版」收工。
2. **CHANGELOG 差**：拉新版 tarball，`diff` 出锁定版到最新版之间的所有 `### Breaking Changes` 与 `### Fixed` 条目。
3. **参考实现差**：对**我们真正挂在上面的那几个文件**做字节/结构比对——最小集是 `harness/execution/tools.js`（工具执行与钩子）、`harness/runtime/drive/*.js`（主循环）、`pi-ai/dist/utils/retry.js`（重试与分类）、`pi-ai/dist/models.js`（`calculateCost`）、`core/system-prompt.js`（提示词装配）、`core/tools/*.js`（内建工具的写法参考）。**清单住在脚本里，不住在文档里**（同 R17 的教训：规则清单以脚本为准）。
4. **文档与示例差**：`docs/*.md` 与 `examples/extensions/*` 的**新增 / 删除 / 改动文件名清单**（不 diff 正文，只报清单——正文交给分诊层看）。

输出 `docs/research/<date>-upstream-diff.md`，四张表。**脚本报错 = 明说「今天没查成」，不许说成「上游没变化」**（同 `radar:models` 的纪律）。

### 6.2 分诊层（有差异才起，人/agent 判断）

对每条差异，**按我们的九层归位**，产出一张五列表：

| 上游改了什么 | 落在我们哪一层 | 我们那一层现在怎么做 | 判定 | 动作 |
|---|---|---|---|---|
| （CHANGELOG 条目或 file:line） | 层 1–9 | 现状 file:line | **不影响** / **要跟** / **有意不跟（领域理由）** | 无 / 建 issue / 更新 §11 |

三条硬规则：
- **「不影响」也要写一行**，写清楚为什么不影响——否则下次同一条会被重新分诊一遍。
- **「有意不跟」必须写领域理由**，并同步进本文 §5。理由写不出来的，改判「要跟」。
- **凡是落在层 1（工具）或层 3（会话持久化）的差异，一律不得判「不影响」而不给证据**——这两层是本次踩坑最密集的地方。

### 6.3 挂在哪、谁来跑

- **时机**：跟 `radar:models` 同一时机（每 session 第一条消息），因为它同样是「确定性发现 + 按需分诊」的两层结构，且同样零额度。
- **落点**：R29（框架边界）的详解里加一节「上游对齐检查」，把 6.1/6.2 写进去；`framework-boundaries.json` 每个框架加两个字段 —— `pinnedVersion`（当前锁定版）与 `lastAlignedAt`（上次做完分诊的日期）。
- **门岗（advisory 起步，同 `advisory.promotion` 的手法）**：`lastAlignedAt` 距今 > 30 天且存在版本差 → warning。**先不阻断**——理由和现有 advisory 一样：一道天天红的门岗等于不存在。观察一个月，按真阳性率决定升不升红。
- **升级本身的节奏**（本次已验证过一次，写进流程）：**永远拆两个 PR**。PR-1 只动版本号（+ 清掉死 overrides），验收门就是 `build` / `typecheck` / `test:agent-runtime` 三条全绿；PR-2 才是行为改动。PR-1 翻车的回滚面积是一行。

---

## 7. 六角色评审（R7）

**CTO**
1. 这份审查最有价值的不是那 24 条，是层 3 开头那条统摄性事实：**`AgentHarness` 在 pi 自己的 coding agent 里还没有被使用**（`grep` 零代码引用 + [#9000](https://github.com/earendil-works/pi/issues/9000)/[#9042](https://github.com/earendil-works/pi/issues/9042)/[#6451](https://github.com/earendil-works/pi/issues/6451) 三条同向）。这不推翻岔路 1 的 A——探针的证据太硬了——但它把风险的**形状**从「新版本可能有 bug」换成「这条路上我们可能是最早的重度用户」。**这必须进拍板记录**，因为它改的是排期缓冲和心理预期，不是技术选择。
2. 我最认可的一条是 §6 那个上游对齐流程。本次 90% 的发现来自三个从没被打开的目录——**这说明缺的不是能力是时机**。把它挂在 `radar:models` 同一时机、advisory 起步，成本几乎是零而收益是「不再考古」。但它必须像 R17 说的那样：**规则清单住脚本不住文档**。

**设计**
1. **G-23 是我最在意的一条**，而且它是个坏消息：**pi 自己的 TUI 也是「全部文字，然后全部工具卡片」**（`assistant-message.js:105-109` 甚至为这个布局做了空行抑制）。所以「把数据修成有序」之后，画面**不会自动变对**——投影层必须把一条助手消息拆成多个 view item。这条要现在就说清楚，否则阶段 4 交付时会被判成「没修好」，而那时争论的是「当初说的是什么」。
2. **G-17 让我确认了一件事**：我对「思考」那行提的要求（*用一个断言性的词描述一件没发生的事，比不显示更糟*）**不是审美偏好，是上游的工程结论**——`getContextUsage()` 在压缩后刻意返回 `tokens: null` 而不是 0。所以三行都该是三态。顺带：`renderers/read.js:86` 那条「折叠时不显示输出，**但出错时强制显示**」值得抄，它是「用户要看的是出错的那个」的最小实现。

**PM**
1. 用户问的三件事，这份东西给出的答案分别是：**「一致了吗」= 骨架一致、工具层不一致**；**「调研完整吗」= 做得比大多数方案扎实，但漏了三个躺在 node_modules 里的目录**；**「工具有细节没弄好吗」= 有，9 条在阶段 2 之前**。三个答案都是「是，但」，**不能只报好的那一半**。
2. 我最关心 **G-01**。方案把 0/18 归因于「空 schema + 两个字节级相同的工具」，处方是拆成 3 个工具。现在多了第三个成因——**那 9 个分支有的模型根本没看见**——而**拆完仍然是根级 `anyOf`，处方不解决它**。意思是：按现在的方案做完阶段 2，**G2（≥90%）有可能仍然不达标，而我们会找不到原因**。这条要在阶段 2 开工前改掉，不是发现不达标之后再回头。
3. **G-10 是第二个「做完还是老样子」的候选**：`model.mts:72` 那行全零的 cost，会让 G5 的花费行在重做之后**依然是空的**。用户抱怨了三次的那一行，值得单独有一条门岗。

**前端**
1. **G-24 那个默认值差异**（harness `"all"` vs CLI `one-at-a-time`）是我最容易踩的坑：它不报错，只是行为和 CLI 不一样，而我们的直觉全来自 CLI。写死它。
2. **8.4 的 `GatingStorage` 我现在就想要。**「停住第 N 次提交、等它真的挂起、再放行」正是 R18 想要的替代品，而 `discard()` 给了「阳性对照」——这直接对上 memory 里那条「复现竞态必须有阳性对照，没有阳性对照的绿灯不作数」。它是随包发布的，不用自己写。
3. **6.4① 那个「abort 时把用户没送出去的话贴回输入框」**（`restoreQueuedMessagesToEditor`）是二十行的事，但它正好对着用户最烦的那条抱怨的近亲。阶段 3 顺手做。

**后端**
1. **我在 G4 提的那个问题，6.7 给了确切答案，我接受。**两半：(a) **不会撞全局 dispatcher**——`configureHttpDispatcher` 只在 CLI 入口调用，库路径零命中（仓库侧 `grep` 也零命中），所以 pi 那个 5 分钟全局超时对我们不存在；**代价是 pi 一点传输层超时都不给我们**，`observeNativeStream` 是唯一那道防线，**不能删**。(b) **会撞分类**——看门狗产出 `aborted` 则永不重试、产出 `error`+timeout 文本则会重试，**两种行为完全相反而现在没人知道是哪种**。这就是 **G-11**，我要求它进阶段 3 的验收门，用注入式零额度断言证。
2. **G-12 我要加重。**那 40 条重试正则是上游从约 30 个编号 issue 攒出来的资产，**按英文文本匹配**。我们走 APIMart/kie。后果是双向的：该重试的不重试（用户仍然一次抖动白等），**不该重试的重试（余额耗尽还烧三次）**。正解是在 adapter 里把厂商错误归一成上游认得的文本——**一条正则都不用改就白拿全部资产**，这是 R20 的正确读法。
3. **G-16 是岔路 2 的直接雷区**，我单独点出来：[#8537](https://github.com/earendil-works/pi/issues/8537) 是「运行中插入的消息落在 tool call 与 result 之间 → 严格校验顺序的供应商拒绝整段重放历史」。审批卡**正是**「在工具跑的过程中插一条记录」。症状会是「换个供应商就整轮报错」，排查成本极高。照上游的修法做：等这一轮 tool result 全部落地再追加。

**真实用户**
1. 我看不懂这里面 90% 的字，但有一句我看懂了——**「它可能根本没看见你给它的说明书」**（G-01）。那我之前骂它笨，好像有点冤枉它。
2. **那个「花费永远是空的」，你们说重做能修好，结果发现重做完还是空的**（G-10）——这种事发生一次我就不太信下一次了。这条能不能单独盯着。
3. 我最怕的还是那句「顺序修好了画面不一定对」（G-23）。**你们说完成的时候，我想看到的是我点一下之后，屏幕上从上到下就是它干活的顺序**，不是数据里对了但画面还是老样子。别到时候跟我解释数据层。

---

## 8. 自媒体来源（TikHub）

**本次未用 TikHub，因为**：这份东西核对的是一个 npm 依赖的编译产物与我们自己的内部架构方案之间的差异，判据全部是 `file:line` 与官方 issue。中文自媒体上没有 `@earendil-works/pi-*` 的一手使用经验（这个包 2026 年才发布、面向的是 CLI 终端用户而非我们这种嵌入宿主），检索它只会得到与本文无关的「AI coding agent 怎么用」内容。**明着标出来，不冒充覆盖。**
