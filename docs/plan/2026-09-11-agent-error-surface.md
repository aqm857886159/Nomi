🚧 进行中 · 2026-09-11 · Agent 面板错误呈现：结构化码 + i18n，顺带修掉「刚打开就动手」的竞态

# Agent 面板的错误原文泄漏（`docs/fixes/2026-09-11-agent-error-surface.root-cause.json`）

## 一句话

用户真机截图里 Agent 面板顶部飘出一行**红色英文原文**：
`The agent is opening a conversation. Try again after it opens.`
那不是「这句忘了翻译」，是**主进程的一句内部不变量断言变成了产品文案**。这份方案把它修成
「主进程只出码、渲染层按码取本地化文案」，并顺手把那个让用户撞上它的竞态本身也修掉。

## ① 为什么会出现这个状态（竞态）

真正的抛出点不在 `laneIpc`，在 **`electron/agentLane/laneWorkspace.mts:84`** 的 `assertReady()`：

```
structuralPending > 0  →  throw new Error('The agent is opening a conversation. …')
```

`structuralPending` 由 `changeStructure()` 计数，四条路会把它抬起来：**换模型**（`configureModel`）、
新建 / 切换 / 删除对话。其中「换模型」走的是 `switchTo(同一条 lane, 新模型)`——**关掉 pi 会话再开一条**
（读盘 + 载入转录），几百毫秒到几秒。

于是用户的真实动作序列是：

1. 打开面板 / 在模型框里挑一个模型 → `configureModel` 开始换（同一条对话，慢）；
2. 他接着打字回车，或者点卡上的按钮（同意 / 停 / 付费确认）；
3. `execute()` → `assertReady()` → 抛 → 红色横幅。

这里的判断本身是**「拒」而不是「等」**，而换模型这件事的语义恰恰是「我要用它发下一句」。
拒的代价是：那句话还得他自己重打一遍。

同族的第二处在 `electron/agentLane/laneIpc.ts` 的 `switching` 判断——形状一模一样（一个
「已排上、还没跑」的计数 + 直接抛），只是它的窗口窄得多。两处一起改。

**改法**：不再拒，**等这一轮落定再按落定后的真相判一次**（`settleStructure` / `settleLifecycle`）。
但**换对话不等**——等完再执行，用户那句话就落进了**另一条**对话里；它该以
`agent_lane_workspace_stale`（「对话换过了，重新发一次」）收尾。原有「命令绝不碰正在关闭的 handle」
那条不变量不动：等的是新 handle 就位，从头到尾没碰过关闭中的那个。

## ② 为什么原始串能直接渲染到 UI（通路）

```
laneWorkspace: throw new Error('The agent is opening a conversation. …')
  → laneIpc catch:  { ok:false, code:'agent_lane_execute_failed', message: error.message }   ← 原文过桥
  → useAgentPanelV4Actions.checked():  throw new Error(result.message)                       ← 码被丢掉
  → friendlyError → classifyGenerationError(散句) → kind:'unknown', reason = 原文
  → ProjectAgentResidentShell.tsx:461  <div role="alert" class="text-workbench-danger">{原文}</div>
```

三层各自只做了一点点「转手」，合起来就是原文上墙。

**`check:i18n` 为什么没拦**：那条门岗在 `electron/` 侧**只扫中文**（`hasHan`）。写中文 throw 会红，
**写英文 throw 反而安全**——等于把「别让原文漏出去」这条规矩教成了「换成英文就行」。这是这次泄漏的
制度性成因，不是谁手滑。

## 先查别人

| 谁 | 怎么做的 | 出处 |
|---|---|---|
| **Claude Agent SDK** | 码与人话**并存**，码是闭集：`SDKAssistantMessageError = 'authentication_failed' \| 'billing_error' \| 'rate_limit' \| 'invalid_request' \| 'server_error' \| 'unknown' \| 'max_output_tokens'`，挂在 `SDKAssistantMessage.error` 上；结果侧 `SDKResultError.subtype` 是码、`errors: string[]` 是诊断袋；限流状态全结构化（`rateLimitType` / `overageDisabledReason`）。用户文档按类别给恢复动作。 | https://code.claude.com/docs/en/errors · `@anthropic-ai/claude-agent-sdk@0.2.70` `sdk.d.ts:1538,1543,1925-1947` |
| **OpenAI Codex CLI** | 最完整的那一版：`CodexErrorDetails` 每个变体**自带写好的英文人话**（不是透传上游串），另有 payload-free 的 `CodexErrKind` 供分析；**在进程边界显式收窄**成更小的客户端码集（`to_codex_protocol_error()`，`_ => Other` 兜底）；线上事件两样都带 `ErrorEvent { message, codex_error_info }`，TUI **按码分支、按串显示**。供应商原话只从 `UnexpectedStatus` 一条放行，还要 `extract_error_message()` 抠 `error.message`、优先服务端给的 `user_message`、正文截 1000 字节、UI 截 2KB。工具错误是第三条通道（`FunctionCallError`，写给模型看）。 | https://github.com/openai/codex/blob/main/codex-rs/protocol/src/error.rs （L34,72-78,372,432,468,541-596）· https://github.com/openai/codex/blob/main/codex-rs/tools/src/function_call_error.rs |
| **pi SDK**（我们的底座） | 分子系统给**稳定的后端无关码**：`FileErrorCode` / `ExecutionErrorCode` / `ModelsErrorCode`，每个是 `Error` 子类，`code` + `message` + `cause` 三样都在；失败**返回**不抛（`Result<T, FileError>`）。但**没有**任何宿主侧呈现/本地化建议——文档只说「设置 I/O 错误自己 drain 了在 app 层报」。**「用户看到什么」明确是我们的活。** | https://pi.dev/docs/latest/sdk · `@earendil-works/pi-agent-core/dist/harness/types.d.ts:8-24,115-146,174-198` · `@earendil-works/pi-ai/dist/types.d.ts:287,322` |
| **VS Code / Electron 惯例** | 传输 `SerializedError { name, message, stack, code, cause }`（`transformErrorForSerialization`）；码是独立枚举（`FileSystemProviderErrorCode` / `FileOperationResult`）+ `toFileOperationResult(error)` 归一；每处 throw **码与人话成对**：`new FileOperationError(localize('fileNotFoundError', …), FileOperationResult.FILE_NOT_FOUND)`。已知坑：自定义 Error 子类过 IPC 会掉类型，只剩 `message` + `code`——所以 `code` 必须是普通可序列化字段，**不能靠 `instanceof`**。 | https://github.com/microsoft/vscode/blob/main/src/vs/base/common/errors.ts · `platform/files/common/files.ts:813-824,896,1453-1497` · `fileService.ts:141,199,430,496` · https://github.com/microsoft/vscode/issues/235322 |

**我们与他们的偏差（和理由）**：VS Code 在 **throw 处**本地化，因为主/渲染共用一份 nls bundle。
Nomi 的语言只住在渲染层（`src/i18n`），主进程拿不到它——所以我们取**主进程出码、渲染层
`t(LANE_ERROR_TEXT_KEY[code])`**。这条偏差是领域约束（进程边界上语言不在同一侧），不是口味。
其余三条照抄：闭集码 + 边界收窄 + 必有兜底码（Codex `Other` → 我们 `agent_lane_execute_failed`）；
诊断串封顶 2KB（Codex 同一格的做法）；码是普通字段不是 `instanceof`（VS Code 踩过的 IPC 坑）。

供应商原话**照旧露出**（Codex 也没有一刀切）：配额、内容安全、余额、账号档位这些用户唯一
能据以行动的事实仍走 `classifyGenerationError`，D4「缺口明着标」不变。

## 改了什么

| 层 | 文件 | 改动 |
|---|---|---|
| 中立契约 | `electron/shared/agentLane/laneErrorCodes.ts`（新） | `LANE_ERROR_CODES` 闭集 20 个码 + `laneErrorCodeOf()`（边界收窄） |
| 契约类型 | `electron/shared/agentLane/laneDesktopContracts.ts` | 失败分支 `{ code: string; message: string }` → `{ code: LaneErrorCode; diagnostic: string }`。**改名是防线**：tsc 当场点名每一个消费者（R28 让编译器拦） |
| 主进程 | `laneIpc.ts` / `laneWorkspace.mts` / `laneHost.mts` / `laneSession.mts` | 用户会读到的 throw 全改成码；catch 走 `laneErrorCodeOf`；诊断串截 2KB；`settleLifecycle` / `settleStructure`（换对话除外） |
| 渲染层 | `src/workbench/ai/lane/laneCommandFailure.ts`（新） | **唯一**的「失败 → 界面文案」边界：带码走码，兜底码交分类器，分类器也不认且是拉丁散句 → 本地化兜底句 + `console.error`。码 → 文案键用 `LANE_ERROR_TEXT_KEY` 存**整键**并 `satisfies Record<LaneErrorCode, TranslationKey>`——拼 `agentLaneError.${code}` 会成为一条覆盖整个命名空间的动态前缀，等于让死键门岗对这片全瞎（`OVERBROAD_NAMESPACE_DEBT` 已清零、只减不增）。整键表只能住在消费方：`src/i18n/locales/` 被死键门岗当词典跳过，写在那里的字面量不算引用 |
| 渲染层 | `laneClient.ts` | `open` 在飞时，后续命令**等自己这次 open 落定**再带真身份发（以前带空身份撞上去被拒） |
| 文案 | `src/i18n/locales/agentLaneError.ts`（新） | 20 个码 × zh-CN / en |
| 渲染层 | `laneCommandFailure.ts` 的 `LaneCommandFailure` 构造器 | `diagnostic` 在**构造处**收成字符串。这个构造器长在 IPC 边界上，实参是刚过完桥的原始格；类型说它是 `string`，但那是我们这侧的声明——Error 子类过 IPC 掉类型（「先查别人」里 VS Code 那条）、preload 与渲染层版本不齐，这一格就可能不是字符串。它跑在 **catch 里**，一抛就等于这次失败连兜底句都没有、用户什么都看不到，比印英文原文更糟 |
| 门岗 | `scripts/check-error-surface.mjs`（新） | ①码↔文案硬零 ②`diagnostic` 不许进显示汇 硬零 ③lane 命令路径英文散句 throw 棘轮（19，只减不增） |

## 同类扫描结论（为什么只收这一族）

`electron/` 全仓有 **1488** 处英文散句 `throw`。绝大多数**到不了界面**——它们是工具实现写给
**模型**看的 tool result（`laneCodingTools` / `laneCanvasTools`…），或纯内部不变量。把它们一并
「翻译」既没有用户价值，也会逼人加一堆豁免、把门岗做失真。

所以防线建在**消费端**（R28「建在最早能拦住的那层」，这里最早能拦的是类型）：
渲染层再也不会把一个未分类的跨进程字符串当界面文字。棘轮③只覆盖 **lane 命令路径那 9 个文件**
（它们抛的东西会被 `laneIpc` 的 catch 接住变成一次命令失败），存量 19 条，只减不增。

## 残留风险

- 生成域的 `classifyGenerationError` 在自己的通路上仍有同形状的 `unknown → 原文` 兜底。
  本次只收口了对话域（面板横幅 + 项目横幅）。生成域的错误卡有「技术详情」折叠，泄漏的
  可感知程度低一档，但同一族——留作下一批。
- 规则②的「进显示汇」那一半**不设 `TOUCHES_LANE` 闸**：报障现场 `ProjectAgentResidentShell.tsx`
  渲染的是一路转手下来的字符串，通篇不出现任何 lane 类型名，按那道闸筛会被整个跳过——
  等于门岗看不见报障现场本身（这条是复核时用变异测试量出来的，不是推想）。「只是提到」
  那一半仍留着闸，否则 `projectCategoryMigration.ts` 的同名字段会被误伤。
- 那几处 `vi.fn()` 是无类型的，所以契约改名时 `check:test-types` 没点名它们，红是在
  `pnpm run test` 才冒出来的。把 lane 夹具都标上类型是更早的一道防线（R28），留作下一批。
- `showableRaw` 用「有没有汉字」区分「已本地化的人话」与「没翻译的散句」。对 `en` 用户而言
  一句中文兜底同样是泄漏；那个方向由 `check:i18n` 的 electron 中文基线（只减不增）在收。

## 真机走查（2026-09-11 20:16 · development · 零额度夹具）

`node ./tests/ux/agent-error-surface.walk.mjs` → `passed`，`paidCalls: 0`，`unexpected: []`。
这一跑真机落在**替换当中**那一侧（`racedMessageLandedFirstTry: false`），正好是报障用户撞上的那半：

- 横幅上出现过的**全部**文案（MutationObserver 全程记，不是轮询采样）只有一条，中文：
  「对话已经换过了，刚才那句没发出去，重新发一次。」——原来那句
  `The agent is opening a conversation. Try again after it opens.` 一次都没再出现。
- 截图 `01-after-racing-a-send-right-after-switching-conversation.png`：横幅在位的同时，
  他抢着打的那句**还留在输入框里**（`ERRSURF_RACED：…`）——按横幅说的重发一次即可，不用重打。
- 截图 `02-raced-message-landed-in-the-new-conversation.png`：重发后那句落进新对话并拿到回复，
  横幅归零（`ERROR_BANNER` count = 0）。

拉丁散句断言是**类级**的（「横幅里不许出现由空格隔开的两个拉丁词」），不是盯那一句；
换一句没翻译的英文提示同样会红。

## 门岗先验会红（R17 · 三条规则逐条变异，2026-09-11）

| 规则 | 变异 | 结果 |
|---|---|---|
| ① 码 ↔ 文案 | 从 `agentLaneError.ts` 删掉 `agent_lane_workspace_stale` 的 zh-CN 一行 | 红：`zh-CN 缺 'agent_lane_workspace_stale'` |
| ② `diagnostic` 进显示汇 | 在**报障现场** `ProjectAgentResidentShell.tsx:461` 那条 `role="alert"` 上挂 `title={laneFailure.diagnostic}` | 红：`:461: diagnostic 是诊断串不是界面文案` |
| ③ 英文散句 throw 棘轮 | 在 `laneIpc.ts` 加一句新的英文 `throw new Error('This is a brand new English sentence…')` | 红：点名那一句 + `从 19 涨到 20——棘轮只减不增` |

②**必须选报障现场来验**：第一次拿 `laneCommandFailure.ts` 试是绿的，因为它在
`DIAGNOSTIC_ALLOWED` 里——变异打在豁免文件上，量到的是豁免生效，不是规则失效。
三次变异全部还原后 `check:error-surface` 复绿。
