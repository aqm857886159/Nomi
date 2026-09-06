# Agent 面板 v4 · 接线阶段实施计划（2026-09-06）

状态：📋 方案待拍板 —— 含**必须先拍板的产品决策 5 条**（§6）与**两条前提被实查推翻**（§0.2）。
拍板前不动接线轨与删除轨（P5：想清楚再动手；硬规矩：设计与宿主真冲突就停下上报，不自己挑一条）。

上游：设计定稿 `docs/design/2026-09-06-agent-panel-v4.md`（用户 2026-09-06 拍板「画布的设计没有问题」）、
逐板对账 `docs/qa/2026-09-06-agent-panel-v4-lab-reconcile.md`（57 态基线已落，PR #534 已合 `a85055d81`）。

---

## 0. 动手前实查到的三件事（这一节决定了本计划的形状）

### 0.1 v4 不是「已实现待接线」，是「样张的组件化版本」

`src/workbench/ai/v4/` 共 2068 行 9 个组件。逐个读完后的事实：

| 事实 | 证据 |
|---|---|
| 9 个组件**零回调**：没有 `onSend` / `onStop` / `onConfirm` / `onReject` / `onAdopt` / `onUndo` / `onPermissionChange` | `AgentPanelV4Panel.tsx:65-130` 的 props 只有 `flow/slot/queue/context/composer/width/height/darkMode`；头部两个按钮无 `onClick` |
| composer「发送」= **清空输入框** | `AgentPanelV4Composer.tsx:96` `const submit = React.useCallback(() => setValue(''), [])` |
| 模型弹层、Skill 弹层的内容是**组件内硬编码字面量** | `V4ModelPopover` 的 `rows`、`V4SkillPopover` 的 `skills` |
| 8 个积木只接**已拼好的 view model**，没有一处读 store / 契约 | `AgentPanelV4Panel.tsx` 在 `src/workbench/` 下**零 importer**，只被设计实验室引用 |

「接线」= **从零建交互层 + 建投影层**，不是把现成组件挪个位置。本计划按真实体量排。

### 0.2 任务书里两条前提，实查不成立

| 任务书原话 | 实查结果 | 影响 |
|---|---|---|
| 「模型清单吃 catalog 派生（#535 的 `keepRunnableVendorOptions` 之后的输出）」 | **#535 是 OPEN，未合 main**；仓库 grep 不到该符号 | 本轮只能先接现役 `filterUsableAssistantTextModels`，#535 合后换一行 |
| 「面板默认展开 + 记住上次状态（#503 已落，复用那条持久化）」 | #503 已合（`ae85ffc98`），但合进来的是**画布视口那两条**；`editingPanelLayoutSlice.ts` 里**没有 `persistRevision`**，`agentDockPersistence.test.ts` 不存在 | **「记住上次状态」在 main 里不存在**。默认展开成立（`EDITING_PANEL_DEFAULTS.visibility.assistant = true`），持久化要新建，不是复用 |
| 「旧 lab screen `agent-panel` 及其 **5 张**基线」 | 实查 **45 张**（`states/01-forms` 22 + `02-p0-exceptions` 16 + `03-live-only` 7） | 「5 张」是对账文档里因 accent-soft 转蓝而更新的那 5 张，不是这一屏的全部 |

### 0.3 走查的 DOM 契约完全不重合——这是本轮最大的单点阻塞

- 现役面板树发出 **141 个**不同的 `data-agent-*` 属性（`grep -rohE 'data-agent[a-z0-9-]*' src/workbench/ai/ | sort -u | wc -l`）；`tests/ux/` 下 **23 个**文件绑在上面，其中包括
  **每日闸** `tests/ux/golden-path.e2e.mjs`、941 行的 `agent-real-user-conversation.walk.mjs`、
  1012 行的 `agent-ui-conformance.walk.mjs`。
- v4 只发 `data-v4-block/control/popover/chip/piece` + 泛型 `data-status/mode/height/permission/...`，共 ~17 个。
- `grep -rn "data-v4" tests/` **零命中**——没有一条走查认识 v4 的锚点。

`tests/ux/agent-runtime-walk-support.mjs:11-13` 只是**面板根选择器**的收口处（`CREATION_PANEL`/`CANVAS_PANEL`），
其余 140 个锚点散在 23 个走查文件里，没有收口。
另：`agent-ui-conformance.walk.mjs` 由 `docs/design/agent-ui-spec.generated.json` 驱动，
**要靠重新生成 spec 迁移，不是手改那 1012 行**——而生成 spec 需要一份 v4 的可计算设计契约，本身是一件独立的活。

---

## 1. 范围

### 1.1 做（拍板后）

1. **投影层（纯函数 + 单测）** `src/workbench/ai/v4/agentPanelV4Projection.ts`：
   宿主快照 → `V4FlowItem[]` / `InterventionData` / `QueueRowData[]` / `ContextUsage`。唯一 owner，不在组件里 derive。
2. **回调面**：给 9 个 v4 组件补 props 回调。**一个像素都不改外观**——57 张视觉基线是这条的机器防线。
3. **容器**：`ProjectAgentResidentShell.tsx` 保留全部宿主接线，渲染体换成 `<AgentPanelV4Panel>`；
   超 800 行按「宿主命令 / 投影装配 / 渲染」拆（R9/R12）。
4. **弹层吃真数据**：模型 ← `listWorkbenchModelCatalogModels` + `filterUsableAssistantTextModels`；
   Skill ← `listWorkbenchSkills`；权限 ← `PERMISSION_POLICIES`（已是合同派生）。
5. **走查迁移**（§5.3）+ 情绪摩擦日志。
6. **删旧**（§5）。

### 1.2 不动

- v4 已拍板的**外观**：尺寸、间距、颜色、icon、文案位置、8 积木的形态与状态词。
- `electron/projectAgentHost/` 的 reducer / 状态机语义。缺字段只补**投影与契约声明**，不改执行语义。
- `NomiMarkdown` 的 `agent-v4` 档（#534 已落）。
- `editing` / `host-config` / `settings` 三屏实验室与其基线。

### 1.3 回滚

单 PR、单分支。回滚 = revert 该 PR 的 merge commit。
**不留 feature flag、不留 `agentPanelV4Enabled` 开关**（P1：无并行版、无 fallback、无逃生口）。
按 §7 的 commit 分段，也可只 revert 最后一个「删旧」commit。

---

## 2. 映射表：v4 每个构件 ← 宿主哪个字段

真相源：`electron/shared/projectAgentContracts.ts:1-626`、`electron/harness/runtime/runtimePort.ts`、
`electron/shared/agentCapabilities/capabilityContract.ts`、`src/workbench/ai/projectAgentProjectionStore.ts`。

渲染层拿得到的**全量**是 `useProjectAgentSnapshot()` → `ProjectAgentHostState`
（`threads / turns / items / queue / proposalApprovals / activeThreadId / hostRevision`），
投影store 逐条 apply 12 种 change，**这一层不丢真相**。
丢真相的是 `projectAgentUiProjection.ts`（把 8 状态压成 5、把 tool item 压成一个字符串）——v4 **不要走它**。

### 2.1 ① 用户气泡 `V4UserBubble`

| v4 字段 | 宿主来源 | 状态 |
|---|---|---|
| `text` | `ProjectAgentUserItem.text`（`:244`） | ✅ |
| `chips[]` | `ProjectAgentQueueItem.attachmentRefs`（`:344`）→ `display.kind: 'image'\|'file'` | ⚠️ v4 要 `'file'\|'skill'\|'clip'` 三种；`skill` 走 `turn.skillVersions`，**`clip`（时间轴片段）在 attachmentRefs 里没有对应 ref 类型**（G7） |

### 2.2 ② 助手文本 `V4AssistantMessage`

| v4 字段 | 宿主来源 | 状态 |
|---|---|---|
| `text` | `ProjectAgentAssistantItem.text`（`:246`，带 `textRevision`） | ✅ |
| `status: streaming / complete / interrupted` | item.status `drafting\|running` / `done` / `stopped` | ✅ |
| 「继续」按钮 | — | ❌ 主进程 IPC 有 `turn.steer` / `turn.interrupt`（`projectAgentIpc.ts:537-542`），但 **`ProjectAgentCommand['type']` 不含它们，`src/` 下零调用方**。见 G1 |

### 2.3 ③ 一行收据 `V4ToolReceipt` ← **本表最难的一处**

| v4 字段 | 宿主来源 | 状态 |
|---|---|---|
| `label` | `ProjectAgentToolItem.capability` → `residentToolDisplay.readableToolName` | ✅ 复用现役 |
| `action`（19 个 icon 家族） | 需**新建** capability → `V4ActionFamily` 表 | ⚠️ 现役 `residentToolDisplay.ts`(453) 有显示名映射但**无 icon 家族维度**；新表挂在唯一 owner `AgentPanelV4Icons.ACTION_ICONS` 旁，不另立第二份 |
| `summary` / `trailing` | `residentToolTiming.ts` + `readableToolSummary` | ✅ |
| `input` / `output` | `ProjectAgentToolItem.resultRef` + `residentToolProjections` 会话内缓存 | ✅（live 结果 ref-only，正文靠渲染层缓存） |
| `undoable` | `useCommittedProposal` + `runProposalUndo` | ✅ |
| **`status`（AI Elements 七态）** | — | ❌ **宿主里根本没有「运行中的工具调用」这条记录** |

**为什么最难**：`ProjectAgentToolItem` **只在回合结束时**一次性从 `response.toolCalls` 生成
（`projectAgentExecutionHelpers.ts:90-127`，`ok→done` / `cancelled→stopped` / 其余 `failed`，**`denied` 并进 `failed`**）。
跑的过程中，状态里**一条 tool 记录都没有**。唯一的活记录是执行协调器内存里的
`PendingToolDecision`（`projectAgentExecutionCoordinatorTypes.ts:93-101`），它**从不进 `ProjectAgentHostState`**。

所以七态要靠渲染层**自己 join 三路**：

| `V4ToolStatus` | 来源 |
|---|---|
| `input-streaming` | ❌ 拿不到（args 在 `tool-call` 事件里是整包到达，没有流式片段） |
| `input-available` | `tool-call` 事件已到、无待决 |
| `approval-requested` | 待决登记表 `state==='pending'` |
| `approval-responded` | 待决登记表 `state==='approved'\|'denied'` |
| `output-available` | 终态 tool item `status==='done'` |
| `output-denied` | 终态 `failed` **且**渲染层记得它是被拒的（宿主不区分） |
| `output-error` | 终态 `failed` |

现役是用**模块级 `Map`**（`ProjectAgentResidentShell.tsx:75` `residentPendingTools`）扛这件事。
接线时这套 join 要提到投影层并单测，**不能再散在组件文件里**。
`input-streaming` 建议**不使用**（拿不到就别渲染一个永远不出现的态），或退化成 `input-available` 并在单测里钉死这条退化。

### 2.4 ④ 任务卡 `V4TaskCard`

| v4 字段 | 宿主来源 | 状态 |
|---|---|---|
| `title` / `action` | `ProjectAgentTaskItem.task`（`TaskRef`，`:283`） | ✅ |
| 其余全部（`status/progress/candidates/cost/error/params/excerpt`） | — | ⚠️ **task item 是 ref-only**：整包 payload 只有 `{kind:'production-run', runId, expectedRunRevision?, stageId?}`，`status` 硬钉 `'done'`（`projectAgentExecutionHelpers.ts:204`，注释明写「never a second Host-owned status ledger」）。全部要**用 `runId` 去 join ProductionRun 域投影** |
| `cost` / `footnoteTrailing`（「已花 ¥0.24」） | — | ❌ 宿主与 ProductionRun 都无逐任务实付金额。见 G2 |
| `error` / `errorAction` | `ProjectAgentFailureItem.code/message/nextAction`（`:311`） | ✅ |

### 2.5 ⑤ 介入槽 `V4Intervention`

| v4 `V4InterventionKind` | 宿主来源 | 状态 |
|---|---|---|
| `approval-irreversible` / `approval-reversible` / `spend` | `kind:'approval'` × `CapabilityEffectClass`（`irreversible` / `reversible_local` / `spend`，`capabilityContract.ts:9`） | ✅ 三对三，干净 |
| `question` | `InterventionKind:'question'` + `residentQuestionOptions` | ✅ |
| `credential` | `'missing_credential'` | ✅ |
| `plan` | `propose_edit_plan` → `useTimelinePlanRows` | ✅ |
| `deviation` | `ReconcileDeviationCard` | ✅ |
| `reject-reason` | 现役是 approval 槽内的输入框，非独立 kind | ⚠️ 渲染层子状态，投影层按 `approval-*` 的子态处理 |
| — | `'missing_param'`（`InterventionSlot.tsx:6`） | ❌ **八 kind 里没有它的家**。见 D4 |

**这个槽今天的数据不来自宿主状态**：`ProjectAgentResidentShell.tsx:617` 从模块级 `Map` 里挑
`primaryPending`，`kind` 是**嗅 `args` 的 key** 猜出来的（`:620` 看有没有 `missingCredential`/`missingParam`/`question`），
`costLabel` 是一个**静态字符串**不是数字（`:633`）。接线时这套「嗅探」要么提到投影层并单测，要么走 §6-D4 收口。

**按钮语义冲突（重要）**：现役是 **once / session / always 三档批准 + 拒绝**；v4 是 **确认 / 不要 +「不再问 →」**。

- 现役 `onApproveAlways`：对**这一个 capability** 的长期通行证；
- v4「不再问 →」：`escalatePermission` 把**全局** `approvalPolicy.mode` 抬一档（`agentPanelV4Logic.ts:80`）。

作用域从「一个能力」变成「整个项目的所有能力」。这是**扩大授权面**，不是换个说法。见 D2。
另注：`approvalPolicy` **只能在 enqueue 时写入**（无 `policy.*` mutation），所以抬档只对**下一个**回合生效，
已排队的项保留各自冻结的快照——UI 要诚实表达这一点，不能让用户以为立即生效。

### 2.6 ⑥ 队列行 `V4Queue`

| v4 字段 | 宿主来源 | 状态 |
|---|---|---|
| `title` | ⚠️ **队列项上没有文本**，要 join `queue[i].turnId` → `items` 里同 turnId 的 user item（现役 `:694` 就是这么做的） | ✅ 可派生 |
| `status` | `ProjectAgentQueueItem.status` | ⚠️ 宿主另有 `paused?`（`:349`），v4 三态里没有「暂停」 |
| `actions`（插队/删） | `moveProjectAgentQueueItem` / `deleteProjectAgentQueueItem` | ✅ 命令齐全 |
| `destructiveAction`（立即中断） | `stopProjectAgentTurn` | ✅ |

### 2.7 ⑦ 收起坞 `V4CollapsedRail`

> **2026-09-06 已被用户改掉**：收起态不再是右侧 32px rail 上的两颗 icon，而是右上角一枚 Nomi logo 钮
> （`V4CollapsedLogoDock`），状态叠在 logo 上（词表 `agentPanelV4DockStatus.ts::V4DockStatus`）。
> 本节下表描述的是被替换掉的那一版，留作接线来源的记录；现役合同看
> `docs/design/2026-09-06-agent-panel-v4.md` 拍板 ⑪。


| v4 字段 | 宿主来源 | 状态 |
|---|---|---|
| `running` 状态点 | `useResidentActivityStore` | ✅ |
| 默认展开 | `EDITING_PANEL_DEFAULTS.visibility.assistant = true` | ✅ |
| **记住上次状态** | `editingPanelLayout` 在 store 里、也在 `projectRecordSchema.ts:80` 的 schema 里，但**改它不 bump `persistRevision`** | ❌ **不存在，要新建**（见 §0.2） |

### 2.8 ⑧ composer + Context 环

| v4 字段 | 宿主来源 | 状态 |
|---|---|---|
| 权限三档 ↔ `approvalPolicy` | `PERMISSION_POLICIES`（`agentPanelV4Types.ts:160`）↔ `ProjectAgentApprovalPolicy`（`:54`）；默认 `safe-auto`/`confirm` 与 `DEFAULT_PROJECT_AGENT_APPROVAL_POLICY`（`:60`）**同值** | ✅ 已对齐，零改动 |
| 写入路径 | `useWorkbenchStore` → `runWorkbenchAgent` → `ProjectAgentTurnCommandInput.approvalPolicy` → 冻结进 turn + queueItem | ✅ 通 |
| 模型钮文字 / 清单 | `getAssistantModelPref` + `labelForModel` + `listWorkbenchModelCatalogModels` | ⚠️ #535 未合（§0.2） |
| 三类默认预设 | `generationModelDefaultsContract.ts` | ✅ |
| Skill 清单 | `listWorkbenchSkills` | ✅ |
| `+` 收任意文件 | `useComposerAttachments` + `COMPOSER_ATTACHMENT_ACCEPT` | ✅ |
| composer 高度 | `useComposerHeight`（纯函数，已单测） | ✅ |

**Context 环 `ContextUsage` —— 缺口最集中的一处**：

| v4 字段 | 宿主来源 | 状态 |
|---|---|---|
| `input` / `output` / `cache` | `ProjectAgentTurn.usage` = `RuntimeUsage{promptTokens, completionTokens, cachedPromptTokens, totalTokens}`（`runtimePort.ts:41-46`），逐 turn 持久化（`projectAgentReducer.ts:536`） | ✅ **按 threadId 汇总即可派生**，今天没人这么做 |
| `used` | 末次 turn 的 `promptTokens` | ✅ 可派生 |
| `max` | `NomiModelConfig.contextWindow?`（`runtimePort.ts:13`，主进程 default 128_000） | ❌ **从不过 IPC**：`src/` 下 `contextWindow` 零命中 |
| `reasoning` | — | ❌ `RuntimeUsage` 四个字段里没有 |
| `cost` | — | ❌ 无价格表、无金额字段；现役直接印 `agentResident.costUnknown`（`:707`） |

⚠️ **别接 `agentUsageStore`**：它是 **App 会话累计、跨线程、跨项目**（`agentUsageStore.ts` 注释自陈），
且把 `cachedPromptTokens` 在入口就丢了（`:26-32`）。v4 的环画的是**本线程**，接它数字就是错的。

⚠️ **今天面板上那个「还能聊 ~40 轮」是编的**：`ProjectAgentResidentShell.tsx:610`
`const remainingRounds = Math.max(1, 40 - sessionTurns)` —— 一个写死的常数减法，不是任何真实用量。
v4 要把它换成真数字，正是这一条的意义；换不成的分项**宁可不渲染，也不许再编一个**。

---

## 3. 宿主缺字段清单（fixture 里有、宿主里没有）

按 **P4 通用第一**：缺的**在契约里声明槽**，通用系统负责填；**一个都不在 UI 里 hardcode**。
按 **D4 诚实交付**：缺时明着不渲染，不用 `?? 0` 糊成假数据（现役的「~40 轮」就是糊出来的反面教材）。

| # | 缺的东西 | 建议落点 | 缺时的诚实降级 |
|---|---|---|---|
| G1 | 「继续」/ 真中断命令 | `ProjectAgentCommand['type']` 补 `turn.steer` / `turn.interrupt`（**主进程 IPC 已支持，只是渲染层没有调用方**），`projectAgentTurnCommands.ts` 加封装 | 不渲染「继续」钮，不留假钮 |
| G2 | 逐任务实付/预估金额 | ProductionRun 投影加 `spend:{estimated?, actual?}` | 卡尾不显示金额行，不显示 `¥0.00` |
| G3 | `reasoning` tokens | `RuntimeUsage` 加 `reasoningTokens?: number`（provider 给才填） | 该行整行不渲染，不写 `0` |
| G4 | 模型上下文窗口 | `ModelCatalogModelDto` 带出 `contextWindow?: number` | 无 `max` 时环画灰、不给百分比，展开卡只列分项 |
| G5 | 线程累计花费 | 与 G2 同一条投影，按 threadId 汇总 | 「本线程花费」行不渲染 |
| G6 | 活的 tool 状态（七态） | **不加宿主态**；投影层 join `tool-call` 事件 + 待决登记表 + 终态 item（§2.3），并单测「宿主快照永远赢」 | `input-streaming` 不使用 |
| G7 | `clip`（时间轴片段）作为 attachment | `ProjectAgentAttachmentRef` 加 kind 判别，或走 references 通道 | 片段 chip 取现役 `TimelineSelectionChips` 的数据，不进 attachmentRefs |
| G8 | 面板收起状态持久化 | `editingPanelLayoutSlice` 改动时 bump `persistRevision`（#503 分支上有 `agentDockPersistence.test.ts` 的六条规格可直接借） | 默认展开可用，「记住」暂缺 |

**纪律**：G1–G5、G8 每一条，投影层返回 `undefined` 而不是占位数；组件侧 `undefined` = 不渲染那一件。
单测钉死「缺字段时不渲染」，防止以后有人拿 `?? 0` 把缺口糊成假数据。

---

## 4. 验收门

| 门 | 内容 |
|---|---|
| 单测 | 投影层逐条：状态映射、`undefined` 不渲染、权限三档↔合同两字段、队列 join、七态 join「宿主快照永远赢」 |
| `check:design-lab` 视觉道 | v4 的 **57 张基线一张不动**——这是「接线不改外观」的机器证明。动一张 = 接线改了长相。`agent-panel-v4` 容差 `{threshold:0.2, maxDiffPixels:40}`，仅 darwin 跑 |
| `check:i18n` | `agentResident.*` 约 **390 处引用**在切换那一刻同时死掉；dead-key 闸是**只减不增**、`OVERBROAD_NAMESPACE_DEBT` 现在是空的（没有东西挡着），所以**必须同 PR 删干净 zh+en 两侧** |
| `check:filesize` | 容器 ≤800 行 |
| 走查（R13） | loopback 零额度：三面真实对话 · 冷重启不丢 · 介入槽确认与拒绝 · 权限三档切换 · 停止三态。用 `tests/ux/_assert.mjs`；`expectAbsent` 必须配 `proveProbe` 阳性对照 |
| 每日闸 | `tests/ux/golden-path.e2e.mjs` 绑 `data-agent-*`，**切换当天就会红**，必须同 PR 迁移 |
| 摩擦日志（R16） | `docs/qa/2026-09-06-agent-panel-v4-wire-walkthrough.md`：「让 Agent 从零做一条 20 秒短片」全程，逐处不爽点记录并修掉 |

**走查前置**：`uptime` 看负载、`lsof -nP -iTCP:5241` 确认端口没被别的 worktree 占
（对账文档记的第 1 个坑：连到别人家的 vite，截出来每张都很正常）。

---

## 5. 旧件删除清单

> ⚠️ 本节**在 §6 拍板之后**执行。删除会连带删掉 §6 里那些「v4 没有家」的功能。

### 5.1 组件

现役面板闭包：**47 个文件 / 4880 行**（`src/workbench/ai/` 内）。

**删（长相，v4 有对应件）**：`ResidentUiPrimitives.tsx`(187) · `ResidentExceptionStates.tsx`(260) ·
`ResidentMenus.tsx`(155) · `ResidentReferenceChip.tsx`(59) · `ResidentCollapsedDock.tsx`(69) ·
`ResidentBatchStack.tsx`(73) · `composer/AttachmentRail.tsx`(149) · `InterventionSlot.tsx`(82，⛔ 待 D2)

**改（容器）**：`ProjectAgentResidentShell.tsx`(760) —— 渲染体替换，宿主接线保留

**⛔ 待拍板**：`GenerationProposalEditor.tsx`(382, D3) · `TimelineSelectionChip(s).tsx`(58+64, D5)

**保留**（纯逻辑，容器继续用）：`residentToolDisplay.ts`(453) · `residentReferences.ts`(150) ·
`residentContextSnapshot.ts`(200) · `residentToolProjection.ts`(100) · `generationProposalEditing.ts`(239) ·
`residentExceptionProjections.ts`(70) · `residentShellDisplay.ts`(76) · `residentTranscriptScroll.ts`(37) ·
`residentToolTiming.ts`(27) · `residentProposalDisplay.ts`(62)

**⚠️ 不可删（共享管道，不是面板 UI）**：`agentTurnLifecycle.ts`（11 个外部 importer）·
`projectAgentClient.ts` · `projectAgentProjectionStore.ts` · `workbenchAgentRunner.ts` · `workbenchAiTypes.ts` ·
`composer/composerAttachmentTypes.ts` · `composer/AutoGrowTextarea.tsx` · `composer/useComposerAttachments.ts` ·
`residentActivity.ts`

**⚠️ 删前先断外部依赖**：`residentReferences.ts` ← `creation/storyboard/StoryboardPlanEditor.tsx` ·
`AutoGrowTextarea.tsx` ← `StoryboardAnchorCard.tsx` / `StoryboardShotRowExpand.tsx` ·
`residentActivity.ts` ← `preview/PreviewWorkspace.tsx`

**顺手可清的孤儿**（无任何 importer，与本轮同族）：`AiReplyActionButton.tsx` · `AssistantModelPicker.tsx` ·
`CreationPromptPicker.tsx` · `WorkbenchAiHeaderActions.tsx` · `aiComposerKeyboard.ts` · `useRafCoalesce.ts` ·
及只被它们引用的 `ConversationHistoryList/Popover.tsx` · `NoTextModelRecoveryCard.tsx` · `NomiIdentityRow.tsx`

### 5.2 设计实验室

- 屏 `agent-panel`：`agentPanelKit.tsx`(200) · `agentPanelStates.tsx`(24) · `agentPanelFixtures.ts`(207) ·
  `states/01-forms.tsx`(22 态) · `02-p0-exceptions.tsx`(16) · `03-live-only.tsx`(7) · `staleConversationDivider.tsx`（只被实验室引用）
- 基线 `tests/ux/design-lab/__baselines__/agent-panel/` —— **45 张**（不是任务书写的 5 张）
- 注册表**两处同时改**：`src/devlab/designLab/labScreens.ts` + `tests/ux/design-lab/labStates.mjs`（门岗会对，只改一处必红）
- `tests/ux/design-lab-agent-panel.walk.mjs`

📌 **值得先想一下**：`agentPanelKit.tsx` 的 `ShellStage` 不是假 UI——它把一份假快照
`install()` 进**真的** `projectAgentProjectionStore`，再渲染**真的** `ProjectAgentResidentShell`。
这 45 张是「宿主数据 → 真面板」整条通的视觉证据。删掉它 = v4 接线后**没有同等级别的证据**，
除非把同一套 `ShellStage` 手法搬到 v4 屏上（推荐：搬，别删证据）。

### 5.3 走查与结构测试

**20+ 条**，全部绑 `data-agent-*`（§0.3）：

`golden-path.e2e.mjs`（**每日闸**）· `agent-real-user-conversation.walk.mjs`(941) ·
`agent-ui-conformance.walk.mjs`(1012，**要重新生成 spec，不是手改**) · `agent-runtime-editing.walk.mjs`(342) ·
`agent-runtime-production.walk.mjs`(255) · `agent-runtime-provider.walk.mjs`(215，**付费**) ·
`agent-timeline-ops.walk.mjs`(309) · `agent-ui-a-composer.walk.mjs`(104) ·
`agent-ui-exception-states-runtime.walk.mjs`(160) · `agent-panel-system-prompt.walk.mjs`(89) ·
`agent-vertical-spine-m0-m5.red.e2e.mjs`(526) · `resident-composer-receipt-fix.e2e.mjs`(266) ·
`real-user-long-video.e2e.mjs`(378) · `design-fidelity.e2e.mjs`(487) · `editing-real-user-pass.walk.mjs`(637) ·
`ia-audit-shots.walk.mjs`(399) · `custom-prompt-realtask.walk.mjs`(206，**付费**) ·
`agent-runtime-walk-support.mjs:11-13`（面板根选择器收口处）· `agent-ui-computable-contract.node-test.mjs` ·
`agent-runtime-walk-support.test.mjs` · `tests/ux/fixtures/agent-ui-coverage-matrix.json` ·
`src/workbench/ai/ProjectAgentResidentShell.structure.test.ts` ·
`src/workbench/ai/resident/residentPromptLibrary.structure.test.ts` ·
`src/workbench/production/productionStatusStructure.test.ts` ·
`scripts/validation-policy.mjs`（+ 其 node-test 的路径断言）

### 5.4 i18n

`src/i18n/locales/agentResident.ts`(661) —— 现役闭包里 **402 处** `t('agentResident.…')`（`grep -rho "t('agentResident\." src/workbench/ai/ | wc -l`）。
切换那一刻全部变 tier-A dead，`check-i18n-dead-keys.ts` 的基线**只减不增**、
`OVERBROAD_NAMESPACE_DEBT` 是空的，所以**同 PR 删干净 zh + en 两侧**，否则闸必红。

⚠️ 按 `docs/lessons/dead-i18n-keys-two-causes.md`：删前先做「译文值 × 源码硬编码」交叉比对，
免得把「组件改成硬编码中文了所以 key 看着死了」误当成真死条。
**不许**往 `i18n-dead-keys-baseline.json` 里加条目（脚本头明文禁止）。

---

## 6. 必须先拍板的产品决策（本轮**不自己挑**）

这五条会**删掉用户现在能用到的东西**，且没有「他显然会选的那版」。
按 CLAUDE.md「才问用户：产品方向 / 不可逆取舍」与硬规矩「设计与宿主真冲突就停下上报」。

### D1 · 工作方式三档（Ask / 编辑选中 / Agent）是不是就此删掉？

- **现状**：`data-agent-run-mode` 是面板上的 segmented，对应 `ProjectAgentWorkMode`（`ask`/`editSelection`/`agent`，`:31`）。
- **设计**：定稿 §2 写「工作方式与介入档合并为一个概念」，v4 只剩权限三档。
- **冲突**：同一份契约文件里**明写这两轴刻意独立**——`workMode` 管「能碰项目的哪个面」，
  `approvalPolicy` 管「停不停下来问」，且注释写死「Changing the work mode never widens approval」。
- **后果**：合并 = 所有回合按 `agent` 跑，原来用 `ask`（只解释、不写项目）的用户失去「不许动我项目」这个开关。
- **选项**：① 真删（`workMode` 恒 `agent`）；② 保留，挪进权限弹层作第二行；③ 保留独立控件（则 v4 底栏多一个钮 = 改外观，要重出样张）。

### D2 · 「不再问 →」把作用域从「这个能力」扩大到「整个项目」，可以吗？

- **现状**：once / session / always 三档，`always` 只对该 capability 生效，且对 `spend`/`irreversible` **不提供**（`InterventionSlot.tsx:56`）。
- **设计**：确认 / 不要 +「不再问 →」= 抬全局 `approvalPolicy.mode` 一档。
- **冲突**：从「以后这个操作不用问」变成「以后所有这一类都不用问」——**扩大授权面**。
  且因为 policy 只能在 enqueue 时写，抬档**只影响下一回合**，已排队的保持旧快照。
- **选项**：① 就要全局抬档（则 UI 要说清「从下一条开始」）；② 「不再问」保持 per-capability，只是长相变链接；③ 两个都要（则不止两个钮 = 改外观）。

### D3 · 生成提案编辑器（382 行、可编辑）折进只读的「计划槽」，编辑能力怎么办？

- **现状**：`GenerationProposalEditor.tsx` 让用户在批准前**改**提案（提示词/参数）。
- **设计**：v4 `plan` kind 是「清单，不勾就是不做」+「主动作 · 改一下 …… 收起 ▴」——「改一下」是个动作，不是内联编辑器。
- **选项**：①「改一下」打开现役编辑器（保留组件，不内联）；② 真删编辑能力，只能勾/不勾；③ 别的。

### D4 · `missing_param`（缺参数）介入没有 v4 的家

- 八 kind 里最近的是 `credential` 与 `question`，语义都不对。
- 另注：今天这个 kind 是**嗅 tool args 的 key** 猜出来的（`ProjectAgentResidentShell.tsx:620`），本身也该收口。
- **选项**：① 归到 `question`（一行文字 + 选项 chip）；② 加第九个 kind（改外观，要重出样张）；③ 确认这条路已废弃。

### D5 · 提示词库预设 / `@` 引用选择器 / 时间轴选中 chip，三个入口去哪

- 现役有 `ResidentPromptMenu` + `PROMPT_PRESETS`、`ResidentAtPicker`、`TimelineSelectionChips`。
- v4 底栏只有 `[+] [模型名] | [Skill] … [权限] [↑]`——**没有提示词库入口、没有 @ 入口**。
- **选项**：① 提示词库并进 Skill 弹层；② `@` 靠「选中即成 chip」替代（那 @ 就真删了）；③ 保留但收进 `+`。

---

## 7. commit 分段

1. `docs(plan)`: 本文件 ← **本轮只做到这里**
2. `feat(agent-v4)`: 投影层 + 回调面 + 容器接线（外观零变化，57 张基线不动）
3. `test(ux)`: 走查迁移 + `agent-ui-spec` 重生成 + 摩擦日志
4. `refactor(agent)`: 删旧（组件 / lab 屏 / 45 张基线 / 402 条死 i18n / 旧选择器）

---

## 8. 外部依赖与体量诚实交代

| 依赖 | 状态 | 影响 |
|---|---|---|
| PR #535 `keepRunnableVendorOptions` | **OPEN** | 模型清单先接现役 filter，#535 合后换一行 |
| 面板收起持久化 | **main 里不存在**（§0.2） | 要新建，不是复用 |
| #515 无损历史 | 已合，但**它是主进程侧的不透明 snapshot blob**（`StoredAgentContext.snapshot`，不过 IPC），**不是渲染层的 message parts** | 收据的输入/输出仍要靠 `resultRef` + 渲染层缓存 |
| `agent-ui-spec.generated.json` | 只覆盖旧面板 | 迁移 `agent-ui-conformance.walk.mjs` 要先有 v4 的可计算设计契约 |

**体量**：接线（投影层 + 回调面 + 容器）+ 20+ 条走查迁移 + 一份可计算设计契约重生成 +
47 文件 4880 行的删除 + 390 条 i18n 清理 + 8 个宿主缺口中至少 4 个的主进程→渲染层新管道。
这是一条**多轮的轨**，不是一次提交能收口的活。硬把它塞进一个 PR 只会做出用户明令不要的半成品
（2026-08-01 拍板：不留半成品），而且当天就会红掉 `golden-path.e2e.mjs` 这道每日闸。

建议按 §7 分段推进，**§6 五条拍板后再开第 2 段**。

---

## 先查别人（2026-09-07 补 · 收起态返工与滚动位置还原这一段）

R27：动手之前先证明「别人做过没有」。这一段实施动的是收起角标（顶栏那一格）与「点角标原宽**原状态**还原」，四问逐条实查如下。

| 问 | 实查到的 | 结论 |
|---|---|---|
| 依赖里已有？ | `ls node_modules \| grep -iE "stick\|scroll"` 只命中 `react-switch` / `react-tooltip`（名字里的字母误命中），**没有任何滚动粘底/位置记忆的库**；现役「跟到底」是自家 3 行（`src/workbench/ai/v4/AgentPanelV4Panel.tsx:210`） | 依赖里没有，不是「装个包就有」 |
| 仓库里已有？ | 全仓 `scrollTop =` 的写点只有浏览器素材条的拖动滚动（`src/ui/browser/popover/useBrowserAssetMarquee.ts:117`）；**没有第二份**「收起/展开保位置」的实现。收起角标那一格本身**不新建**：现役 `src/ui/app-shell/CollapsedAiChip.tsx:29` 就是它的家，按定稿 §11.4 泛化（一个组件一条 if/else） | 角标复用已有；滚动记忆仓库里确实没有，要写 |
| 生态里已有？ | `use-stick-to-bottom`（bolt.new 在用的那个 hook，https://github.com/stackblitz-labs/use-stick-to-bottom ）解决的是「新内容进来时粘底、上方内容 resize 时画面不跳」，**不解决**「组件卸载再挂载后回到原来读的位置」——它连自己的 `isAtBottom` 都活在组件里 | 引它要装包 + 换掉现役跟底逻辑，而我们要的那件事它不做：不引 |
| 机制出处 | React 官方 `useLayoutEffect` 文档写明：「Before your component is removed from the DOM, React will run your cleanup function.」（https://react.dev/reference/react/useLayoutEffect ） | 这就是「在节点还挂在文档里时量 scrollTop」的依据——普通 effect 的清理跑在移除之后，量到的是 0 |
| TikHub 自媒体怎么说？ | 本轮**没跑**：这是一段实现机制（卸载前把位置存哪儿），不是产品取舍，用户侧没有可检索的讨论面 | 诚实标注，未查 |

**结论：用已有 + 自研一小块。** 角标用已有（`CollapsedAiChip` 泛化，不新建第二颗）；跟到底用已有（现役 3 行）；
只自研「位置存哪儿、什么时候存」这 40 行（`src/workbench/ai/v4/agentPanelV4ScrollMemory.ts` + 面板里的布局 effect），
因为生态里那个最接近的库恰好不做这件事，而这件事的难点全在**时机**（卸载前那一刻），不在算法。
