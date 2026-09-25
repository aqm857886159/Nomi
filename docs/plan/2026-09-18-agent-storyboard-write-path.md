# Agent 分镜写入路径调查：`draft_shots` 的产出落在哪、为什么不是分镜表

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：只读调查 + 方案（未改生产代码）· 2026-09-18 · 基线 `origin/main` = `18641f951`（2026-09-17 23:39 +0800）
> 方法：纯读代码 + git 历史 + 一支不起 Electron、不调模型的 `tsx` 探针（§7）。所有结论带 file:line 或 commit；拿不准的进 §6「未证实」。

## TL;DR

1. **`draft_shots` 成功后产物落在主进程的 `ProductionRun.generationPlan`**（durable，`.nomi/runs/<runId>/`），再被 `canvasLandingHost` 投影成画布上的 **image/video 占位节点 + 一个「分镜组·…」编组**。它**从不**写 `storyboardDesignsByDocumentId`，也**从不**产生 `shot_table` 节点。用户点「新建方案」后看的分镜页读的是 `storyboardDesignsByDocumentId`——两份账本之间**没有任何投影**。
2. **但你那 5 轮里连第 1 条都没走通**：多镜 `draft_shots`（≥2 镜，或任一镜带 `role`）在宿主 handler 里**必然抛错**——`draftShotFromPlan` 要求每镜带一个完整 `candidate`（`candidateId/revision/moduleId/providerId/modelId/mode`），而动词翻译层只送 `{prompt, taskKind, modelId, …}` 这种语义字段。探针实证（§7）：过了 `generationPlanInputSchema`，死在 `mcpGenerationMultiShot.ts:124` 的 `ZodError: Required`。**你已修的 `durationSec`/`title` 两处不解决这一条**——修完仍然 0 节点。「第 5 轮调了 4 次、节点仍 `[]`」与此完全吻合（每次失败 → 模型重试）。
3. 判定：**这不是「缺一条投影」，是一次没做完的迁移留下的两套并行实现（P1 违规）**——2026-09-14 `afe85411d` 把 lane 上唯一能写分镜方案的动词（`nomi_storyboard_write` / `propose_storyboard_plan`）删了、点名 `draft_shots` 接班，但 `draft_shots` 写的是另一份账本；「新建方案」入口、分镜页、SKILL.md、golden-path 走查全部还指着旧账本，且那条走查从切换那天起就没在任何 CI 里跑过。
4. 推荐：先修 (2) 那个 bug（一处、共享边界、必须做）；再按 §5 方案 B 把分镜表变成 **Run 落地节点的表格表示**（与 2026-09-01 拍板「分镜表 = 画布节点的表格表示版」同向），而不是往两份账本之间加同步（方案 A）。

---

## 1. 事实表：两份状态、谁写、谁读、谁投影

| | **账本 A：`ProductionRun.generationPlan`** | **账本 B：`storyboardDesignsByDocumentId`** |
|---|---|---|
| 住哪 | 主进程；每个 Run 一份 `generationPlan { operationId, state, cardHidden, candidate, shots[] }`（`electron/productionRun/productionRunTypes.ts:225-259`），持久化在项目 `.nomi/runs/<runId>/`（`productionRunRepository.ts:234-272`） | 渲染层 zustand（`src/workbench/workbenchDocumentSlice.ts:18`），随项目记录持久化（`src/workbench/project/projectRecordSchema.ts:67`；`workbenchProjectSession.ts:21,35`） |
| 谁写（Agent 侧） | `draft_shots` 动词（`electron/shared/agentCapabilities/verbs/writeVerbs.ts:108-132`）→ `laneVerbTransport.ts:55-71` 翻成 `GENERATION_METHODS.plan {operation:'create'\|'patch', cardHidden:true}` → `laneExtendedDesktopPorts.ts:178-181` 交给生成适配器 → `generationTransportAdapters.ts:67-86` 用 `generationPlanInputSchema` 校验、`:97-105` 换成 `create` 方法、`:213-226` 以 `origin.host="nomi"` 调 planning → `mcpGenerationTools.ts:504-533` → `productionGenerationOperationStore.ts:72-101` `owner.createGenerationDraft(...)` | **今天 lane 上没有任何动词能写它。** 渲染层写入口 `applyCanvasToolCall.ts:252-289`（`patch_shots`）与 `:291+`（`propose_storyboard_plan`）只经 `nomi_canvas_plan`/`nomi_canvas_edit` 可达，即**外部 MCP 宿主**（`electron/surfacePortPreloadBridge.ts:114`；`electron/shared/agentCapabilities/canvasWrite.ts:176,454,531`）。lane 的三个画布写动词映射表 `verbs/verbSemanticInput.ts:61-87` 只认 `arrange_canvas / make_artifact / stage_shot`，头注释 `:58-59` 明说旧名「不在这里兼容」 |
| 谁写（用户侧） | 付费卡上改参数 `revise`（`productionGenerationOperationStore.ts:173-192`） | 「新建方案」按钮（`DocumentListSidebar.tsx:395-403 → :121-125`）、方案编辑器逐字段编辑（`setStoryboardPlan` `workbenchDocumentSlice.ts:250-305`）、`addStoryboardDesign :185-207`、新建项目的起手架（§2.4） |
| 谁读 | 报价卡 `productionPendingSpend.ts:67-111`（`cardHidden` 时不投影 `:82-85`）；任务中心；画布落地链 | 分镜页 `StoryboardWorkspace.tsx:20-23`、`StoryboardPlanEditor.tsx:69`、侧栏方案列表 `DocumentListSidebar.tsx:36`、`ShotTableNode.tsx:34` |
| 投影到画布 | `create/patch/present` 每次 `notifyPlanChanged`（`productionGenerationOperationStore.ts:98-99,114-115`）→ `appIntegration.ts:171-174` → `canvasLandingHost.ts:89-92 landDraftOnCanvas`（**只在项目开着时**）→ `multiShotCanvasLanding.ts:117-189 buildMaterializeShotsPayload`（节点 kind 恒 `image`/`video` `:106-110`，组名 `分镜组·<goal>` `:186`）→ `requestRenderer("production.materialize-shots")` `:214` → 渲染层 `src/workbench/capability/multiShotCanvasLanding.ts:152-305`（`create_canvas_nodes` `:230`，编组 `:261-268`，立刻落盘 `:302`） | `workbenchStore.ts:241-244` 把 `applyStoryboardPlanProjection` 注入 slice → `ensureStoryboardShotTable.ts:9-18` 建一个 **`kind:'shot_table'`** 节点（`source.kind='storyboard'`，`electron/shared/canvas/shotTable.ts:50-60`）→ `projectStoryboardDesign`（`storyboardProjection.ts:72-82`）**只更新已绑定的节点，不建节点**；生成类节点由行内动作按需建（`storyboardRowActions.ts:118 materializeShotRow → :97 create_canvas_nodes`） |
| A ↔ B 之间 | **无。** `shot_table` 的 source 只有 `storyboard` 与 `deconstruction` 两种（`shotTable.ts:50-78`），没有 `run`/`production`；grep 全仓无任何 `generationPlan → StoryboardDesign` 或反向的转换 | |

结论一句话：**Agent 现在只能写 A；用户点「新建方案」看的是 B；A 落地成画布节点组，B 落地成一张 `shot_table`。两者是两条互不相识的落地链。**

## 2. 五个问题的答案

### Q1 `draft_shots` → `create` 之后产物在哪

调用链（每一跳 file:line 见 §1 表「谁写」行）。落点：`owner.createGenerationDraft` 建一个新 Run，`run.generationPlan.candidate` = 第一镜候选、`run.generationPlan.shots[]` = 每镜 `{shotId, role, included, candidate}`（`productionGenerationOperationStore.ts:76-95`；`mcpGenerationTools.ts:511-513`「顶层 candidate = 第一个 shot 的 candidate」）。`cardHidden:true` 存在 `plan.cardHidden`（`productionRunTypes.ts:233`），报价卡投影跳过它（`productionPendingSpend.ts:82-85`）。

建完立刻 `notifyPlanChanged` → 落画布（§1「投影到画布」行）。渲染层节点带 `metadata.productionRunId / productionShotId / materializationOperationId=canvas-landing:<runId>`（`src/workbench/capability/multiShotCanvasLanding.ts:214-221`），`shotId→nodeId` 再经 `plan.bind-shot-nodes` 写回 Run（`canvasLandingHost.ts:71-79`）。

单镜（1 镜且无 `role`）走 `laneVerbTransport.ts:65-69` 的单镜 create → `semanticCandidateFromParams`（`mcpGenerationTools.ts:520-526`）→ 也落画布（`buildMaterializeShotsPayload` `:127-133` 专门兼容无 `shots[]` 的单镜）。

### Q2 分镜表读的是哪份

`storyboardDesignsByDocumentId[activeDocumentId]` 里 `activeStoryboardId` 那份（`StoryboardWorkspace.tsx:20-23`），编辑器 `StoryboardPlanEditor.tsx:69`。画布上的 `shot_table` 节点也只认 `source.kind='storyboard'` + `documentId/designId`（`ensureStoryboardShotTable.ts:10-13`，`shotTableActions.ts:28,46`）。**不读 Run。**

### Q3 有没有投影 / 产品怎么设想

- **没有 A→B 投影**（§1 末行）。
- 产品设想（v2 工具面，2026-09-14）：`docs/plan/2026-09-14-agent-tool-face-v2.md:88`——「20 动词下**分镜是草稿直接落画布、卡在 `generate`**」；同文 `:74`「对外 `nomi_canvas_edit` 的 operation 分支含分镜写入（`propose_storyboard_plan`/`patch_shots`），它们在内部面**归 `draft_shots`**」。也就是说 v2 的设计是：**Agent 拆的分镜 = 画布上的草稿节点组，不再经过「分镜方案」**。这与根因合同 `docs/fixes/2026-09-11-agent-generation-second-door.root-cause.json` 的不变量「只有 `draft_shots` 能造出生成类节点」和 `2026-09-10-agent-draft-single-ledger.root-cause.json`「plan candidate 是意图、画布节点是它的投影」一致，也与 2026-09-01 拍板「分镜表 = 画布节点的表格表示版」（`docs/lessons/shot-table-is-a-projection-of-canvas-nodes.md`）同向。
- **但读侧一处都没跟着改**：「新建方案」按钮仍然 `storyboardPlannerLauncher()`（`DocumentListSidebar.tsx:124`）→ 常驻 Agent 发 `agentResident.storyboardRequest`「把当前文稿拆成一份分镜方案…」并挂 `workbench.storyboard.planner` 技能（`ProjectAgentResidentShell.tsx:240-250`；`src/i18n/locales/agentResident.ts:7`）；用户随后看的分镜页读 B。SKILL.md 自己也自相矛盾：`:44` 「通过一次 `draft_shots` 调用产出」、`:50` 「草稿落在画布上」，而 `:203` **「绝不调用写画布/生成类工具——你只产出方案对象，落画布与生成由用户确认后系统处理」**（这一句是 2026-06-13 `44304dd42` 时代为 `propose_storyboard_plan` 写的，`draft_shots` 那些句子是 2026-09-15 `8bd61d0f4` 加的，两代指令叠在一起）。frontmatter `:3` 的 description 还是「不直接落画布或生成」。**4/5 轮模型只读不写、把三镜写成聊天文字，读侧这三处指令就是直接原因**。
- 「这 5 轮为什么没触发投影」：没有投影可触发；而且第 5 轮的写入本身没成功（Q5 补充 / §3）。

### Q4 `starter-doc-*` 两镜空白起手架

- 新建空项目时 `src/workbench/project/projectRepository.ts:171-186` 直接往项目记录塞一条 design：`id: \`starter-${seededDocument.id}\``（文档 id 由 `mintDocumentId` 造成 `doc-<uuid>`，`workbenchTypes.ts:198-203`，所以拼出来就是 `starter-doc-<uuid>`）、`title` 空、`plan: createEmptyStoryboardPlan()`。
- 2 镜 / video / 5 秒的出处：`src/workbench/generationCanvas/agent/storyboardPlan.ts:234-247`——`shots: [1,2].map(index => ({ index, shotId: \`shot-${index}\`, shotKind:'video', durationSec:5, anchorIds:[], prompt:'' }))`；配套判据 `isEmptyStoryboardPlan :249-258`。设计动机见 `docs/fixes/2026-09-05-empty-project-storyboard-entry.root-cause.json`（空项目要能进分镜编辑器）与 `2026-09-05-storyboard-starter-projection.root-cause.json`（planner 结果要**替换**这个起手架：`setStoryboardPlan` 的 `replaceEmptyStarter`，`workbenchDocumentSlice.ts:262`）。
- 你 5 轮落盘「完全相同且是空的」= 从来没有人调过 `setStoryboardPlan(…, createNew=true)`，起手架原样躺着。

### Q5 历史：从来没接上，还是接上过又断了

**接上过，2026-09-14 断的。** 时间线（全部 git 可查）：

| 日期 | commit | 事件 |
|---|---|---|
| 2026-06-13 | `44304dd42` | `propose_storyboard_plan` 激活，SKILL.md 写下「绝不调用写画布/生成类工具」 |
| 2026-08-25 | `852dcbd27` | P4 S6.5 多镜 `create` 入口：`draftShotFromPlan` 要求每镜带完整 `candidate`（`mcpGenerationMultiShot.ts:121-126`）；语义→候选的合成只给了 `scriptText` 分支（`draftShotFromStoryboard :133-169`） |
| 2026-09-08 | `a369215de` | 切 pi lane 时给 `generationPlanInputSchema.shots[]` 加了 `prompt/taskKind/modelId/...` 语义字段（`generationPlanSchemas.ts:55-68`）——**schema 收了，handler 从没学会展开它** |
| 2026-09-10 | `dc113e712` | `ensureStoryboardShotTable`：B → `shot_table` 节点接通；同日走查 `docs/audit/2026-09-10-shot-table-storyboard-walk.md` 「点『新建分镜方案』，真实模型返回三个图片镜头并审批保存」「复验立即生成表节点成功」——**那天的写入走的是 `nomi_canvas_plan → propose_storyboard_plan → setStoryboardPlan`（账本 B）**（`git grep propose_storyboard_plan dc113e712 -- electron/shared/agentCapabilities/canvasWrite.ts:174,446,469`） |
| 2026-09-11 | `a12dded21` | 动词声明化：lane 上仍有 `nomi_storyboard_write`（operation=`propose_storyboard_plan`/`patch_shots`） |
| 2026-09-14 | `afe85411d` | **20 动词替换 37 名**：`git show afe85411d` 删掉 `nomi_storyboard_write` 整段（diff 第 221-256 行），只留一句「旧名不在这里兼容」（`verbSemanticInput.ts:58-59`）。`--stat` 里**没有任何 storyboard/shotTable 文件被改**——账本 B 的 Agent 写入口被删，没有接班者 |
| 2026-09-14 | `4753f64af` | lane 走一张 typed 传输表；`draft_shots` 翻成 `nomi_generation_plan create`（今天的 `laneVerbTransport.ts`） |
| 2026-09-15 | `8bd61d0f4` / `2b9af6c48` | SKILL.md 改成「一次 `draft_shots`」（但 `:203` 那句没删）；`golden-path.e2e.mjs` 改成发 `draft_shots`（`:191-197`，带 `title`）却仍断言 **账本 B** 里有 3 镜（`planFromPayload :117-121` 读 `storyboardDesignsByDocumentId`；`:223-226`；分镜页 3 行 `:240`）。`docs/plan/2026-09-14-agent-tool-face-v2.md:88` 自述「这些 Electron 走查未在本机重跑」；`test:golden` 只在 `package.json:149`，**不在任何 workflow / `test:e2e` / `check:walkthroughs` 里** |

所以 09-10 的「复验成功」是真的，但它证明的是账本 B 那条链；09-14 把那条链的 Agent 入口删了以后，没有任何一条自动化证据再跑过「Agent 拆镜头 → 用户在表里看到」。

## 3. 判定

**两套并行实现（P1 违规），根源是一次只做了写侧、没做读侧的迁移；叠加一个让新写侧在多镜时恒失败的 bug。**

- 不是「缺一条投影」：v2 设计（§2.3）明确不想要 B 作为 Agent 分镜的落点；补一条 A→B 同步等于把被删的第二个 owner 从后门请回来。
- 不是「产品设计上本来就要用户手动落表」：产品入口「新建方案」的行为定义（`ProjectAgentResidentShell.tsx:243`「把当前文稿拆成一份分镜方案」）与 v2 设计（草稿直接落画布）是两份互相矛盾的产品叙述，没有人拍板过「用户手动把 Agent 的草稿抄进表里」。
- 叠加 bug（必修，独立于路线选择）：多镜 `draft_shots` 在 `mcpGenerationMultiShot.ts:124` 恒抛。证据：§7 探针；`resolveCreateShots :235-239` 对 `params.shots` 逐镜调 `draftShotFromPlan`，后者 `parsers.candidateFrom(raw.candidate)` = `generationCandidateSchema.parse(undefined)`（`mcpGenerationTools.ts:309-311`；schema `generationPlanSchemas.ts:22-28`）。错误经 `safeFailure`（`generationTransportAdapters.ts:56-65`）变成 `generation_execution_failed` + ZodError JSON，再由 `laneExtendedTools.ts:61-65` 包成「`draft_shots could not complete … Read the current project state … before requesting a new action`」回给模型——模型的自然反应就是换个写法再试，这正是「调了四次」。**渲染层零报错是必然的：整条路没碰渲染层。** 现有测试没有一条把语义 `shots[]` 送进真 handler：`laneExtendedDesktopPorts.test.ts:88-121` 与 `tests/system/agent-tool-face-real-model.mjs:107` 都把生成适配器 stub 掉；`mcpGenerationTools.test.ts:695-698` 的多镜用例用 `shotFrom(...)` 带完整 candidate；只有 `scriptText` 用例（`:707-730`）走到候选合成。

## 4. 所有权问题（单独点名）

**「Agent 拆出来的一份分镜」有两个 owner，各带一条落画布链、各有一套编辑动作，却共用同一个 UI 入口和同一个词。**

| | 账本 A（Run） | 账本 B（StoryboardDesign） |
|---|---|---|
| 行的真相 | `PlanCandidate`（provider/model/mode/prompt/parameters/references） | `PlanShot`（shotKind/durationSec/anchorIds/keyframe/params/scene/profile 骨架…） |
| 编辑 | `generation.patch` / `revise`（改候选 revision → 重绑定节点） | 编辑器逐字段、`patch_shots`、行覆写 `storyboardOverrideActions` |
| 落画布 | `canvasLandingHost` → `materializeShots`（`canvas-landing:<runId>` 幂等章） | `storyboardRowActions.materializeShotRow`（按 design/shot 绑定） |
| 花钱 | `generate` 出卡 → 封印/收据 | 行内 `confirmAndRunNode` → spendConfirm |
| 谁能写 | 内部 lane（`draft_shots`）、外部 MCP（`nomi_operation_*`） | UI、外部 MCP（`nomi_canvas_edit` 分镜 operation）；**内部 lane 不能** |

这已经不只是「表没同步」：同一个用户任务（把剧本拆成可生成的镜头）在内部 Agent 和外部 MCP 宿主上会落进**不同的账本、不同的画布对象、不同的付费门**。`docs/plan/2026-09-14-agent-tool-face-v2.md:74` 已经承认这一点（外部面暂留分镜 operation 是因为「MCP 侧的生成面还没收编」），但没有登记到期日。按 R17 这算「登记不是防线」的那类欠账。

顺带一条事实澄清（不是判断）：09-11 合同把 `propose_storyboard_plan` 描述成「一次落一整排永不出卡的生成类节点」；**在 HEAD 上**账本 B 的投影只建一张 `shot_table`、只更新已绑定节点（`ensureStoryboardShotTable.ts:14-17`；`storyboardProjection.ts:72-82`），生成类节点由行内动作按需建并经 spendConfirm。也就是说今天的 B 并不绕付费门——删它的理由是「一效果一动词」，不是安全。这影响方案 A 的代价评估，不影响判定。

## 先查别人

报告：`docs/research/2026-09-18-storyboard-single-ledger/prior-art.md`（四问全答，自媒体一问如实写「未查」及理由）。结论抄在这里：

- 依赖里已有：`@xyflow/react` 的节点数据就是画布单一真相，官方状态管理指引要求派生视图从 nodes 读、不另存 — https://reactflow.dev/learn/advanced-use/state-management ；`zod` 的 `z.never().optional()` 让「表不存行」在 schema 上不可能（`electron/shared/canvas/shotTable.ts:60`）。
- 仓库里已有：storyboard 表 `rows: z.never()`（`electron/shared/canvas/shotTable.ts:53`）、表与方案同生（`src/workbench/creation/storyboard/exec/ensureStoryboardShotTable.ts:16`）、deconstruction 表证明 union 已容纳多种表源（`src/workbench/generationCanvas/nodes/shotTable/factBridge.ts:23`）、reducer 早就按 shotId 改一镜（`electron/productionRun/productionGenerationPlanEdits.ts:105`）、2026-09-01 拍板 `docs/lessons/shot-table-is-a-projection-of-canvas-nodes.md`、09-10 单一账本合同 `docs/fixes/2026-09-10-agent-draft-single-ledger.root-cause.json`。
- 生态里已有：Automerge 单文档+派生视图 https://automerge.org/docs/concepts/ ；IETF Idempotency-Key（幂等键粒度 = 被改对象粒度）https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/ ；OpenTimelineIO 单结构+投影视图 https://opentimelineio.readthedocs.io/ 。
- 结论：用已有——Run 账本 + `rows: z.never()` 表源 + reducer 的按镜 patch；自研只有第三种表源的行派生与对应表上 `lift` 一档。不做方案 A（第二份真相）、不做方案 C（两扇门）。

## 5. 修法选项

### 前置（不论选哪条都要做）：修多镜 `draft_shots` 的候选合成

- **改哪层**：`electron/capabilityCore/mcpGenerationMultiShot.ts` `resolveCreateShots` 的 `params.shots` 分支——当一镜没有 `candidate` 时，按 `draftShotFromStoryboard`（`:133-169`）的同一条路合成候选（它已经会从 `prompt/modelId/modeId/durationSeconds/parameters/references` + `defaultModelForTaskKind` 合成 `candidateId/revision/moduleId/providerId/mode`）。`taskKind` 的推断复用 `:299-316` 那段（`anchor→text_to_image`，有 references→`image_to_video`，否则 `text_to_video`）。**不要**在 `laneVerbTransport` 里造候选（它不认目录，而且外部 MCP 语义面同样会撞这条）。
- **门岗**：给 `mcpGenerationTools.test.ts` 加一条「语义 `shots[]`（无 candidate）→ create 成功且 `operation.shots[i].candidate.modelId` = 默认模型」；`laneVerbTransport.test.ts` 已有的「翻出的方法名被适配器认」再加一层「翻出的参数被 handler 接受」（对着真 `createGenerationPlanningHandler` + 内存 store 跑一遍 `draft_shots` 三镜）。先验它会红：§7 探针就是红的样子。
- **代价**：一处、小；**连带**：外部 MCP 的 `nomi_operation_create` 语义多镜同时被修好（同一入口）。
- 同时把 `skills/workbench-storyboard-planner/SKILL.md:203` 那句删掉、`:3` description 改成与 `:44/:50` 一致（这是 4/5 轮不调工具的直接原因）。

### 方案 A：补一条 A→B 投影（`generationPlan` → `StoryboardDesign`）

- **改哪层**：主进程 `notifyPlanChanged` 之后多发一条 `requestRenderer('storyboard.upsert-from-run')`；渲染层把 `shots[].candidate` 映射成 `PlanShot` 写进 `setStoryboardPlan(..., createNew=true)`，`replaceEmptyStarter` 自然吃掉起手架。
- **代价**：中；**连带**：从此每一份 Agent 分镜有两份真相（Run 候选 vs PlanShot），用户在表里改一行要反向 `generation.revise`，Run 侧 `patch` 又要盖回表——就是 09-10 单账本合同刚刚消灭过的那种「两个账本分叉」（`docs/fixes/2026-09-10-agent-draft-single-ledger.root-cause.json` `class_root`）。`shotKind/durationSec/anchorIds/keyframe/scene/profile` 在候选里没有对应物，映射必然有损。**不推荐**：它是症状修法，把 §4 的两个 owner 焊死。

### 方案 B（推荐）：分镜表读 Run 落地的节点；「新建方案」入口对准账本 A

- **改哪层**：
  1. `electron/shared/canvas/shotTable.ts` 加第三种 source `{ kind:'production', runId }`；行从画布上 `metadata.productionRunId === runId` 的节点派生（节点已带 `productionShotId/productionShotRole/candidate 戳`，`src/workbench/capability/multiShotCanvasLanding.ts:214-221`），左半列按现行「片种模板 derive」规则、右半列按该节点模型 `mode.slots`（照 `docs/lessons/shot-table-is-a-projection-of-canvas-nodes.md` 两半列纪律）。
  2. 主进程落地成功后（`canvasLandingHost` 已知 runId+groupId）在同一事务里建那张 `shot_table` 节点（复用 `ensureStoryboardShotTable` 的形状，source 换成 `production`），整批仍一个 Cmd+Z。
  3. 分镜页/侧栏「方案」列表增加一类条目 = 有 `shot_table(production)` 的 Run；「新建方案」按钮语义改成「让 Agent 起草」，落地后自动激活该表（不再制造/依赖 `starter-*` design；起手架只在用户手动新建方案时出现）。
  4. 表内改提示词/模型 → 走既有 `generation.revise`（候选 revision +1 → `rebindLandedShots` 同步节点），不新增写路径。
- **代价**：大于 A，但方向对：账本 A 成为 Agent 分镜唯一 owner，表是节点投影（拍板一致），付费门只有 `generate` 一条。
- **连带影响谁**：`StoryboardPlanEditor` 要能以「只读候选 + revise」模式渲染一类新 source；`golden-path.e2e.mjs:223-240` 的断言改读画布节点组与 `shot_table(production)`；`docs/plan/2026-09-14-agent-tool-face-v2.md:74` 的外部面欠账要登记到期日（外部 MCP 的 `propose_storyboard_plan` 与内部 `draft_shots` 最终应收敛到同一入口）。账本 B 保留给用户手写方案，**但要在方案里明写它的去留日期**，否则 §4 的双 owner 长期存在。

### 方案 C：把 lane 上的分镜写动词加回来（恢复 09-10 的 B 链）

- **改哪层**：`writeVerbs.ts` 加回一个写 `canvas.write propose_storyboard_plan` 的动词；SKILL.md 改回「产出方案对象」。
- **代价**：最小、一天内可见「表里有三镜」；**连带**：直接推翻 09-11 合同的不变量「同一效果只有一个动词」（`check:tool-face mutual-tiebreak` 会红），并把 §4 的双 owner 固化成模型可见的两个工具——正是 09-11 那份合同要消灭的「多扇门」。只适合作为**可丢弃的对照原型**证明用户体验，不适合合入。

**推荐：前置 bug 修 + 方案 B。** 理由：D2（结构优先）——问题的根在「一份分镜两个 owner」，A 和 C 都是在两个 owner 之间修桥；B 是把 Agent 那一半彻底归到已被三份拍板/合同选定的 owner 上，剩下的 B 账本才有可能在后续一刀退役。D4（诚实）——B 落地前，「新建方案」入口应该先按前置修好后的真实行为改文案（Agent 起草落画布、在分镜组里看），别再让用户等一张不会出现的表。

## 6. 未证实

- **那 4 次 `draft_shots` 的真实 tool_result 文本**：我没有你那 5 轮的 lane 转录（`.nomi/agent-sessions/**/*.jsonl`）。结论「每次都死在 `candidate` 校验」是从 HEAD 代码 + 探针推出的必然，不是从转录读出的。请对照转录里 4 条 `draft_shots` 的结果，预期看到 `generation_execution_failed` 与 `"received": "undefined"`。若其中有单镜无 `role` 的调用，它应当已经落了一个节点——那就与「nodes 仍 `[]`」矛盾，需要再查 `isProjectOpen`（`canvasLandingHost.ts:90`）当时是否为假。
- **你那棵树里的修法是否碰到了候选合成**：任务书只说修了 `durationSec→parameters.duration` 与删 `title`。若你已经顺手合成了 candidate，前置项就是已完成，其余判定不变。
- **外部 MCP 宿主今天的多镜 `nomi_operation_create`（语义 `shots[]`）是否同样失败**：同一 handler、同一分支，按代码应当同样失败；没跑外部宿主实证。
- **golden-path 最近一次真跑的结果**：文件历史与 `docs/plan/2026-09-14-agent-tool-face-v2.md:88` 都说没重跑；我也没跑（任务纪律：不起 Electron）。按代码它至少在 `:223-226` 必红（三个独立理由：`title` 被 strict 拒；多镜候选缺失；即便成功也不写账本 B）。

## 7. 探针（可复跑，不起 Electron）

`scratch/probe-multishot.ts`（本分支未提交脚本，命令与输出如下；`tsx` 直接跑 `electron/` 源码）：

```ts
import { verbToTransportCall } from '<repo>/electron/agentLane/laneVerbTransport'
import { draftShotFromPlan } from '<repo>/electron/capabilityCore/mcpGenerationMultiShot'
import { generationCandidateSchema, generationPlanInputSchema } from '<repo>/electron/shared/agentCapabilities/generationPlanSchemas'

const call = verbToTransportCall({ toolCallId: 't1', toolName: 'draft_shots', args: { shots: [
  { prompt: '镜1 月光纸船', taskKind: 'text_to_video', modelKey: 'seedance' },
  { prompt: '镜2 水面安静', taskKind: 'text_to_video', modelKey: 'seedance' },
  { prompt: '镜3 远景',     taskKind: 'text_to_video', modelKey: 'seedance' },
] } })
generationPlanInputSchema.safeParse(call!.call.args).success            // → true
draftShotFromPlan((call!.call.args as any).shots[0], 0, {
  candidateFrom: (v) => generationCandidateSchema.parse(v), record: (v, l) => v as any })
```

输出（2026-09-18，HEAD `18641f951`）：

```
1) transport call: { lane: "generation", call: { toolName: "nomi_generation_plan",
   args: { operation: "create", shots: [ { prompt, taskKind, modelId }, ... ], cardHidden: true } } }
2) generationPlanInputSchema ok? true
3) draftShotFromPlan THREW: ZodError [ { "code": "invalid_type", "expected": "object",
   "received": "undefined", "path": [], "message": "Required" } ]
```

即：翻译层 ✓ → 入参 schema ✓ → handler 多镜分支 ✗（`mcpGenerationMultiShot.ts:124`）。


## 8. 实施记录（2026-09-18 · 方案 B 第一刀，分支 `fix/storyboard-single-ledger-20260918`）

> 用户拍板原话：「他读账本 A，那你这个肯定得修复呀，而且他们得合并成一个账本吧。」= Agent 分镜只认账本 A。

### 8.1 做了什么（外观零改动那一半）

| 子项 | 落点 | 说明 |
|---|---|---|
| B.1 第三种表源 | `electron/shared/canvas/shotTable.ts` `productionShotTableSchema` | `source = { kind:'production', runId, materializationOperationId }`，`rows: z.never()`——表**不存一行**，持久化边界拒收缓存行（fail-closed，与 storyboard 表同一条纪律） |
| B.2 表与节点同生 | `src/workbench/capability/multiShotCanvasLanding.ts` `materializeShots` | 只在**这次真建了节点**且 N≥2 时建表（与分镜组同一阈值），挂同一 txn（一个 Cmd+Z 撤节点+组+表）；按 `source.runId` 幂等；纯补齐重放不建、用户删了表不复活（删表 = 删视图）。标题 = 计划名（主进程新增 wire 字段 `planName`，组名仍是它加前缀） |
| 行 derive | `src/workbench/generationCanvas/nodes/shotTable/productionShotRows.ts` | 行 = 画布上 `meta.productionRunId === runId` 的镜头节点（锚不占镜号；跨分类副本/基于此重生成的不算），按画布顺序 = 落地序。左半列 = 节点 prompt；右半列 = 该节点模型的 `mode.slots`（绑定按 `referenceSlotStorage` 从 meta 读回）；状态词表复用 `SHOT_ROW_STATUSES`（`deriveNodeRowExec`：节点自身 > Run 占位三态补位） |
| 表内「生成 N 镜」 | `shotTableActions.ts` | production 行 = 节点：勾选的节点走节点**既有**的付费门 `confirmAndRunPlan`（spendConfirm），不另造第二条执行通路 |
| B.4 改一镜走 Run 账本 | `verbTransportRoutes.ts`（表）→ `verbFieldMap.ts`（`lift`）→ `generationPlanSchemas.ts` → `generationTransportAdapters.ts`（规范门从 schema 分支派生，自动带上）→ `mcpGenerationTools.ts` → `productionGenerationOperationStore.ts` | `draft_shots(draftId, shots[{shotId}])` 的 `shotId` 此前在动词→宿主对应表上被声明成 `absentOn.patch = drop`（「多镜逐镜 patch 还没做」），四层 schema/handler/store 都没它的位置（reducer 的 `applyGenerationCandidatePatch` 早就支持按 shotId 改）。它不是候选字段，是 plan patch **信封**上的寻址字段——所以表上的处置改成新的一档 **`lift`**（`{disposition:'lift', to:'shotId'}`）：`liftedByFieldMap` 把它提到信封上，父表在装配期核信封真有这个位置（没有就抛）；翻译层里不出现任何字段名（与 verb-host 那一刀同一纪律）。来源改成真的：`from-read:draft_shots.shotId`（模型从 `draft_shots` 的返回 `operation.shots[].shotId` 拿到它；此前写的 `look_at_canvas.id` 是节点 id，递给宿主只会得到 "Generation shot not found"）。现在五跳全通：那一镜候选 revision +1 → 已落节点重绑定 → 表行跟着变。语义门与规范门都收 `shotId`；幂等键 = `generation.patch:{op}:{shotId}:{那一镜的 revision}`；handler 对着**那一镜**的候选合并与算变更集（不是顶层候选） |
| 门岗补洞 | `scripts/check-verb-host-conformance.mjs` R3 | 逐字段探针从最小实例出发一次只加一个字段，够不到「没 `draftId` 就过不了动词 refine」的 `shotId`——于是 09-18 白天它被声明成 drop 而门岗全绿。现在 R3 再从**每个示例**出发跑一遍（示例里给了值的字段都必须到达宿主，同一份 `TRANSLATOR_CONSUMED` 登记）；自测里加 `lift→drop` 变异，确认它红。`TRANSLATOR_CONSUMED` 里 `shots[].shotId` 那条删除 |
| 点名模型 | `semanticGenerationCandidate.ts` `identityForNamedModel` | 金路径真机第一条红：Agent 照 `list_models` 只给 `modelKey`，宿主答「没有配置可用的图片模型」——providerId/moduleId 只能从「用户保存过的默认模型」带出，显式点名的模型从不去目录查它属于谁。现在显式 `modelId` 从注册表取 provider/module（只认目录真有的行，查不到照旧拒绝，绝不编供应商）|
| 组名文案 | `electron/productionRun/multiShotCanvasLanding.ts` → `src/workbench/capability/multiShotCanvasLanding.ts` | 主进程原本发硬编码 `分镜组·${planName || "多镜计划"}`，盖过渲染层带 zh/en 的 `groupFallbackName`——英文用户看到中文组名（与同日删掉的「镜头 N」同病）。wire 只带 `planName`，组名由渲染层 `canvasLanding.groupName`（`分镜组·{{name}}` / `Shot group · {{name}}`）拼；没有计划名落渲染层 `groupFallbackName` |
| 走查 | `tests/ux/golden-path.e2e.mjs` | 全部断言改读账本 A（画布节点 + `shot_table(production)` + 分镜组）；草稿带模型拟的 `title`，断言节点标签 **等于** 它、节点模型 **等于** 草稿点名的模型、表里那一行的画面列 **等于** 那一镜的提示词（断「值抵达了」不是「没报错」）；**接进 CI**：`quality-gate.yml` desktop-linux job 新增 `Golden path` 步（`journeys` 触发），`validation-policy.mjs` 把它登记为 journey 文件 |

**外观逐项对账**：表节点复用同一个 `ShotTableNode`/`ShotTableGrid`——列（镜/关键帧/时长/画面/参考槽/状态）、密度三档、勾选、footer「已选 N 镜 / 生成 N 镜」全部不变；storyboard 与 deconstruction 两种表的分支逐字未动。production 表**多**出来的只有：它出现在画布上（这就是修的东西）、空态一句「这组镜头已从画布删除」（新 i18n 键 `shotTable.productionSourceMissing`，zh/en）、footer 没有「打开分镜表」按钮（同 deconstruction 表——它没有方案可打开）。行标题：本表没有标题列（与 storyboard 表一致）；表头标题 = 计划名。**唯一一处可见文字变化**（如实上报）：分镜组名——zh 有计划名时逐字不变（`分镜组·<计划名>`）；**没有**计划名时从主进程的 `分镜组·多镜计划` 变成渲染层既有兜底 `分镜组`；en 从中文变成 `Shot group · <name>` / `Shot group`。这是删主进程硬编码文案（今天立的规矩）的直接结果，不是设计改动。

**分镜表的行标题优先级（既成事实，表要跟它一致，不再造第四种）**：模型拟的 `title`（`draft_shots` 信封字段，`electron/shared/generationShotEnvelope.ts`）> 提示词派生 > 渲染层 i18n 兜底（`generationCommon.production.canvasLanding.shotFallbackTitle`）。表若将来加标题列，**读节点已有的 `title`**，不许自己从 prompt 截一段，也不许在主进程编中文兜底。

### 8.1.1 真机走查记录（`tests/ux/golden-path.e2e.mjs`，隔离 profile，loopback 零额度）

九步全绿：新建项目 → 三句剧本 → `draft_shots` 落 3 镜 + `shot_table(production)` + 分镜组 → 画布表里 3 行（行 id = 节点 id、行序 = 落地序、第 2 行画面列 = 第 2 镜提示词、节点标签 = 模型拟的 `title`、节点模型 = 草稿点名的模型）→ 表里勾第 2 镜 → Agent `draft_shots(draftId, shots[{shotId:'shot-2'}])` 改它（1/3 镜逐字未变、表行跟着变）→ 表 footer「生成 1 镜」→ 花钱确认卡 → loopback 出图回到该行（审片请求拿到的是模型拟的标题与改后提示词）→ 真进程退出 → 冷启动「继续创作」→ 盘上与表里修改和图都在、同一 SDK session、零模型调用。阳性对照（`--positive-control`：关 app 后把盘上第 2 镜节点提示词改回旧值）必须在「重启后盘上第 2 镜的提示词丢了」那一条红——见 8.1.2。截图 `.tmp/golden-path-<ts>/01…11-*.png`。

走查一路挖出并修掉的东西（都是用户路径上的）：

| 现象 | 根因 | 处置 |
|---|---|---|
| 点「重置视图」滑块 70→95 又被拉回 59 | 重置走 React Flow 的 d3 过渡（`setViewport({duration:200})`），紧跟「适应视图」时 fit 那 200ms 的 rAF 动画逐帧盖回去——与 #503（`docs/fixes/2026-09-05-canvas-perf-marquee-autopan`）同一类：视口动画只许有一个 owner（`useReactFlowViewportAnimation`） | **产品修**：`GenerationCanvasReactFlow.tsx` 重置改为 `cancelViewportAnimation()` + `animateViewportTo(1, 原点, 200)`，与 fitView 零时长那条同款。无自动覆盖（金路径最终不走重置——见下一行），如实记 |
| 打开画布后 360ms 内的任何视口动作都会被盖掉 | 落节点/重开项目补齐都会 `requestCanvasFit`，画布挂载后 `useCanvasFitSignal` 延迟 360ms 自动 fit（产品意图：让用户看到新落的东西） | **走查修**：共享 helper `waitForCanvasViewportSettled`（`tests/ux/_canvasHit.mjs`，滑块连续 800ms 没动才算停）——人是看画布停了才动手；不改产品 |
| 「重置视图」回到画布原点，表不在那儿（`onlyRenderVisibleElements` 下连 DOM 都没有） | 表由 `addNode` 自动摆位，不在原点 | **走查修**：适应视图 → 空白处按住拖到舞台正中 → 滑块 80%（真实控件，绕视口中心缩放） |
| 100% 时表 960px 宽、舞台 800px，左沿出界，勾选框点不到 | 表的 full 密度阈值是 ≥80%（`shotTableDensityForZoom`） | **走查修**：拨 80% 而不是 100%，并断整张表在舞台内 |
| 收尾报「1 个未登记的模型请求 /v1/chat/completions」 | 表里的「生成」走画布批次 runner（`confirmAndRunPlan`），批次跑完 runner 拿真图问一次审片 | **走查修**：预登记审片请求，顺手断它拿到的标题/提示词 |

**没修、要另案的 UX 发现（眼见于截图）**：① 画布左侧浮动「加节点」工具条压在拖到正中的表的第一列上（勾选框在它底下，点得到但看不见）——任何节点被拖到左侧都会被它盖住，是画布通用问题；② 分镜组的标题条压住第一个节点的「镜头 1 · 标题」那一行（与 09-09「标签行不与动作条互遮」那条拍板同族）；③ 草稿刚落地时占位节点写「排队中 · 第 1/3」，可此刻什么都没在跑（cardHidden 草稿）——文案与状态不符；④ 重启回到画布时底部弹出「生成全部 2 个」批次条（画布对未生成节点的既有提议），与表 footer 的「生成 N 镜」是同一件事的两个入口（8.4 第 2 条那两扇付费门）。

### 8.2 没做的（要样张拍板 / 另案）

- **B.3 分镜页与侧栏「方案」列表增加 Run 条目、「新建方案」改语义、落地后自动激活** —— 改的是外观与交互（`StoryboardPlanEditor` 要以「只读候选 + revise」渲染一类新 source；侧栏多一类条目），按 R8 先出样张、用户拍板，本刀不做。现状诚实说明：Agent 草稿在**画布**的分镜表里可见、可选、可生成；分镜页/侧栏仍只列用户手写方案。
- 表内改提示词/模型 → `generation.revise`：没有做表内编辑（storyboard 表本来也不在表内编辑，走全页）。Agent 侧的「改一镜」已通。
- `draft_shots(draftId)` 一次只改一镜（动词契约的例子就是这个形状；多镜同调只取第一镜，与此前行为一致）；改标题（信封字段）不在 patch 面。

### 8.3 账本 B（`storyboardDesignsByDocumentId`）的退役承诺

- **保留场景**：仅用户手写方案（分镜页编辑器 / 侧栏「新建方案」/ 拆解表「复制成方案」/ 外部 MCP `nomi_canvas_edit` 的 `propose_storyboard_plan`/`patch_shots`）。Agent lane **不写**它（09-14 起）。
- **退役日期：2026-10-16。**
- **退役条件（全部满足才删）**：① B.3 落地（分镜页/侧栏能渲染 `shot_table(production)`，样张拍板）；② 外部 MCP 的分镜 operation 收编到 `draft_shots`（与 #754 同刀，`docs/plan/2026-09-14-agent-tool-face-v2.md` §6 那张表的到期项）；③ `projectRepository.ts` 的 `starter-*` 起手架删除（空项目由 Agent 起草进入分镜，不再靠两行空白方案）；④ golden-path 与四条分镜走查在单一账本上全绿。
- **到期未满足**：按 R17 算红——但**仓库今天没有通用的「带到期日的欠账」门岗**（只有 `check:framework-boundary` 对框架债到期即红），本条登记在 `docs/roadmap/TODO.md` T-DS-19，到期由人核。这是一条结构性发现（见 §8.4）。
- 到期前每一处新读分镜的面（表/页/栏/走查）**只许读账本 A**；往 B 加 Agent 写门 = 复活双 owner，`check:tool-face mutual-tiebreak` 会红。

### 8.4 结构性发现

1. 仓库没有通用的「带到期日的欠账」登记与门岗：`framework-boundaries.json` 的到期机制只服务框架债。分镜账本 B 这类「留一份到某天」的承诺没有机器核的地方。
2. 一个 Run 落地的节点有**两扇付费门**（Run 的 `generate` 报价卡；节点自己的画布生成按钮/表内「生成」→ spendConfirm）。两条都早已存在，本刀没有收敛；「付费门只有 `generate` 一条」（§5 方案 B 的目标）要另案裁决。
3. 对外 MCP 面的分镜 operation（`nomi_canvas_edit`）仍写账本 B，与内部 `draft_shots` 写账本 A 分叉——`docs/plan/2026-09-14-agent-tool-face-v2.md` §6 登记过但无日期；本文把它绑到账本 B 的退役日 2026-10-16。
4. **（已修）** `check:verb-host-conformance` R3 的逐字段探针只从最小实例出发，够不到「只有和另一个字段同在才合法」的字段（`shotId` 要 `draftId`）；一个字段可以被声明成 drop 而门岗一整天全绿。现在从示例再探一遍（见 8.1）。同类：任何靠 `superRefine` 跨字段约束的动词，其被约束的字段都曾是探针盲区。
5. **（未修）** 同一门岗的 R5「信封不许手抄」只匹配无嵌套花括号的对象字面量，`{ shotId: x.shotId, ...(x.role ? { role: x.role } : {}) }` 这种 spread-conditional 写法看不见——in-memory store 的 `create` 就是第六处手抄，`title` 死在那里（本刀改成 spread `generationShotEnvelopeOf`）。R5 要认这种形状才算封上。
6. **（未修）** `generate.shotIds` 在动词上声明了、对应表翻了、schema 收了，handler 的 `present` 分支**从不读** `params.shotIds`（永远返回全部 included 镜）。「声明→翻译→收下→忽略」与 shotId 被 drop 是同一形状的洞：门岗核到宿主收下为止，核不到宿主用没用。
7. **（登记，归 verb-host lane）** `fix/verb-host-contract-sweep-20260918` 合进来后 `check:i18n` 红：`verbFieldMap.ts`（23）/ `verbTransportRoutes.ts`（8）/ `laneVerbTransport.ts`（1）的装配期不变量 throw 是中文串、基线 0。本刀按门岗自己的机制把三个文件登记进 `ELECTRON_EXCLUDED_FILES`（装配期/开发者可读；唯一一条运行时 refuse 带 code、受众是模型）。那条 lane 若另行处置（改错误码），以它为准。
8. **（未修）** 门表按 `path:line` 登记，邻居一改文件就过期：本刀让 verb-host / multishot 的三份合同同时红，只能机械重生（`--read=/--write=` 同一符号集、同一路径集）。重生后门数变了（40→110、16→32、175→180），因为原作者的门表显然还经过一道人工去重而门岗不知道那道规则。结构上要么门岗按 `(path, symbol)` 校验、要么 `door-map` 输出稳定的去重形状——否则每次合并都是一轮手工重生。
