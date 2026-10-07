# 发动机收敛：现状核查与第一刀施工计划

> 状态：📋 方案待拍板（2026-10-05，只读核查 + 计划；生产代码未动，只加了一份特征测试）
> 基线：`origin/main@a6e067250`（#977 合入后）。论断都带文件:行或命令；量不了的标 `unverified`。
> 上游方案：[`2026-09-26-architecture-single-owner-governance.md`](2026-09-26-architecture-single-owner-governance.md)（定稿决策、Phase 2 vertical pilot）、[`2026-09-21-one-generation-engine.md`](2026-09-21-one-generation-engine.md)、[`../audit/2026-09-26-phase-zero-construction-cards.md`](../audit/2026-09-26-phase-zero-construction-cards.md)（P0-1 / P0-2 / P1-6）、[`2026-09-28-production-shot-claim.md`](2026-09-28-production-shot-claim.md)。
> 特征测试：核查时写的 `engineConvergenceCharacterization.test.ts` 已在第 0 步改名为 `electron/productionRun/canvasShotClaimAttempt.test.ts` 并翻成普通回归测试（路径 6 已修，见 [`2026-10-05-canvas-claim-attempt-id.md`](2026-10-05-canvas-claim-attempt-id.md)）。

## 0. 一句话现状

钱现在从**两个口子**出去：画布那台（渲染层确认 → 主进程内存里的令牌 → `runtime.runTask` 直发供应商）和制作那台（Run 账本里的逐镜授权 → 提交出口 → 目录执行器）。0.23 把「同一镜两台各花一次」用一个判定口 `decideShotClaim` 夹住了，但两台的批准、派发、在途、状态仍是两套；画布那台**没有耐久的提交意向**，崩溃后说不出「花没花」。另外核查中新发现一条仍能复现的双扣路径（§3 路径 6）。

为什么要结构性地收：2026-09-20 以来 main 上提交说明命中「付费卡 / 双扣 / double」的非合并提交 59 条（`git log --oneline --no-merges --since=2026-09-20 --grep="paid card\|付费卡\|双扣\|double" origin/main | wc -l`），其中 27 条是 fix；同一批核心文件（`decideShotClaim.ts`、`canvasShotClaim.ts`、`submissionOutbox.ts`、`nodeSubmitInFlight.ts`、`generationRunController.ts`、`runtime.ts`）同期被改 31 次。每修一次都是在两台之间再加一道对账，而不是让对账消失。

---

## 1. 花钱入口地图（现状）

### 1.1 两台发动机各自的五件事

| | 画布那台（引擎 A） | 制作那台（引擎 B / ProductionRun） |
|---|---|---|
| **批准点** | 渲染层 `confirmGenerationSpend`（`src/workbench/generationCanvas/spend/spendConfirm.ts:246`），要不要弹卡由 `spendConfirmationRequirement` 判（同文件 `:233`：Agent 发起 / 一次多份 / 要托管披露才弹；用户单点 ↑ 不弹，09-25 拍板）→ 无论弹不弹，都向主进程要报价、再经 IPC `nomi:tasks:grant-spend` 铸令牌（`electron/tasks/taskIpcHandlers.ts:34-40` → `electron/spendGrant.ts:50`）。令牌**只在主进程内存**（`spendGrant.ts:28`），30 分钟过期，按 nodeId 计次 | 每点一次封一份只盖那一镜的授权信封，住在它自己那道门上（`electron/shared/productionSpendAuthority.ts:55`、`:69`）；卡上动作经 `confirmPendingSpendConfirmation` / `confirmRemainingSpendShots`（`electron/capabilityCore/appIntegrationSpendConfirm.ts:192`、`:201`）；派发前再核同意窗口 `dispatchConsentOpen`（`electron/shared/productionDispatchConsent.ts:37`）。全部落 Run 账本 |
| **派发点** | `runtime.runTask`（`electron/runtime.ts:303`）。发供应商前一行 `consumeTaskSpend`（`runtime.ts:355`，判据在 `electron/tasks/taskSpend.ts:8`）核销令牌，然后 `executeProfileOperation`（`runtime.ts:358`） | `productionGenerationSubmission.start` → `prepareAuthorizedSubmission`（`electron/productionRun/productionGenerationSubmission.ts:465`）→ 提交出口 `createSubmissionOutbox`（同文件 `:469`，出口本体 `electron/productionRun/submissionOutbox.ts:103`）→ `adapter.submit`（`productionGenerationSubmission.ts:487`）→ 目录执行器（`electron/capabilityCore/apimartGenerationProvider.ts`，按家装配在 `generationProviderBootstrap.ts:102`） |
| **幂等键 / 在途锁** | ① 进程内合并器 `runTaskWithIdempotency`，键 = 渲染层这次 run.id（`generationRunController.ts:326`；`electron/submissionLedger.ts:1-4` 自己写明「不是跨重启的 at-most-once」）；② 同节点一笔在途 `withNodeSubmitExclusive`（`electron/tasks/nodeSubmitInFlight.ts:25`，进程内）；③ 结果缓存 `readCachedTaskResult`（`runtime.ts:352`）；④ 节点绑了制作镜头时先 `claimCanvasProductionShot`（`runtime.ts:317` → `electron/productionRun/canvasShotClaim.ts:10`） | jobId = `productionGenerationJobId(runId, contractHash, attempt, shotId)`（`productionGenerationSubmission.ts:445`）；提交意向日志 + 出口进程内去重（`submissionOutbox.ts:331-335`）；派发闸 `createProductionShotDispatchGuard` 排在第一笔耐久写之前（`electron/productionRun/productionShotDispatchGuard.ts:13`）；调度推导也问同一判定口（`electron/productionRun/batchScheduleDerivation.ts:172`）；#962 起「写出去之后的失败」一律 `submission_unknown`、不盲重发 |
| **状态谁说了算** | 渲染层节点 meta（运行记录随项目存盘）+ 渲染层队列 `generationQueueStore` + 主进程内存 `taskCache`（异步任务）。**无耐久提交意向、无「结果未知」态**：重启后靠节点存的 taskId 找回；没拿到 taskId 就被收成空闲（`nodeSubmitInFlight.test.ts` 钉着「重启场景照旧收成空闲」） | Run journal（`productionRunRepository.ts` 事件溯源，唯一写口 reducer）；`submission_unknown` / `reconciling` 显式保留 |
| **怎么投影到画布 / 任务面板** | 画布：控制器自己写节点进度（`generationRunController.ts:284`）；任务面板：`GenerationTaskCenterProjection` 读渲染层队列（`src/workbench/taskCenter/taskCenterProjection.ts:32`） | 画布：`canvasLandingHost`（`electron/productionRun/canvasLandingHost.ts:70`）→ `applyShotGeneration`；镜头阶段唯一判据 `deriveProductionShotState`（`electron/shared/productionShotPhase.ts`）；任务面板：`ProductionRunTaskCenterProjection`（`taskCenterProjection.ts:47`）；Agent 面板：1.5 秒轮询 `pendingSpend`（`src/workbench/ai/v4/useAgentPanelSpendConfirm.ts:54`、`:181`） |

### 1.2 逐个入口

门数命令：`node scripts/door-map.mjs confirmAndRunNode confirmAndRunNodeVariants regenerateNodeInPlace runGenerationNode runGenerationNodesBatch runGenerationNodesByPlan confirmGenerationSpend runWorkbenchTaskByVendor` → 写 17 扇 · 读 1 扇；`node scripts/door-map.mjs runTask` → 主进程直接调 `runTask` 的写门 10 扇；`node scripts/door-map.mjs mintSpendGrant` → 铸令牌写门 9 扇；`node scripts/door-map.mjs submitOnce prepareAuthorizedSubmission` → 制作提交只有 1 个文件 2 扇。

| # | 入口 | 走哪台 | 批准点 | 派发点 | 幂等 / 在途 | 状态 | 投影 |
|---|---|---|---|---|---|---|---|
| E1 | 画布单节点 ↑、报错卡重试、节点按钮（`NodeGenerationComposer.tsx:325`、`NodeErrorReport.tsx:147`、`BaseGenerationNode.tsx:357`） | A | `confirmAndRunNode`（`generationRunController.ts:513`）→ 用户单点不弹卡 → `mintSpendGrant([nodeId])`（`:553`） | `runtime.runTask` | run.id + 节点在途锁 + 认领 | 节点 meta | 控制器写节点；渲染层队列 |
| E2 | 生成变体 ×N（`NodeGenerationComposer.tsx:320`；分镜行 `storyboardRowActions.ts:236`） | A | `confirmAndRunNodeVariants`（`:571`），一张卡、一颗令牌 N 次（`:600`） | 同上，串行 | 同上 | 同上 | 同上 |
| E3 | 原地重生成（`NodeGenerationComposer.tsx:324`、`TimelinePanel.tsx:345`、分镜行 `:203` / `:292`） | A | `regenerateNodeInPlace`（`:618`）→ `:651` 铸令牌 | 同上 | 同上 | 同上 | 同上 |
| E4 | 画布批量「生成全部」（`batchPlanPreview.ts:207`） | A | `confirmAndRunPlan`（`batchPlanPreview.ts:129`）→ `confirmAndMintGrant`（`spendConfirm.ts:166-187`）一张卡一颗令牌覆盖整批 | `runGenerationNodesByPlan` → `runGenerationNodesBatch`（`generationRunController.ts:459`）→ 每个节点 `runTask` | 同上 | 同上 | 同上 |
| E5 | 分镜表行操作 / 锚卡（`storyboardRowActions.ts:190/203/236/278/283/292`） | A | 同 E1–E3 | 同上 | 同上 | 同上 | 同上 |
| E6 | 分镜表整批 + **Agent `generate` 遇到文稿来的方案**（`storyboard.present`：`src/workbench/capability/storyboardPresent.ts:30` → `runStoryboardBatch` `storyboardRowActions.ts:319` → `confirmAndRunPlan` `:375`） | **A** | 同 E4 | 同 E4 | 同上 | 同上 | 同上 |
| E7 | 任务中心「重新生成」、结果未知放行后重生成（`TaskCenterPanel.tsx:188`、`useProductionStatus.ts:180`） | A | 同 E1（后者是**制作镜头经画布那台重拍**） | 同上 | 同上 + 认领 | 同上 | 同上 |
| E8 | 内置 Agent `generate` 起草的镜头（draft_shots） | B | 付费卡逐镜 / 生成剩下 N 张 | 调度器 `createMultiShotBatchScheduler`（`multiShotBatchScheduler.ts:111`）→ 提交出口 | jobId + 意向日志 + 派发闸 | Run | 落地宿主 + 阶段判据；Agent 面板轮询 |
| E9 | 外部 MCP `nomi_operation_*`（`mcpGenerationToolCatalog.ts:67-142`；`execute` 在 `mcpGenerationTools.ts:716-725`） | B | 与 E8 同一个语义生成能力实例（`mcpGenerationTools.ts` 末尾注释「agent/MCP 与 GUI 窄 IPC 共用同一实例」） | 同 E8 | 同 E8 | 同 E8 | 同 E8 |
| E10 | 制作镜头返工 / 继续剩余（`appIntegrationProductionActions.ts:130`、`:208`） | B | `decideRunOwnedGenerationGate`（`:172`）/ 续同意 | 调度器 | 新 attempt | Run | 同 E8 |
| E11 | **3D-BOX 3b**（`D:\Nomi-3dbox-3b` 分支 `feat/director-3dbox-3b`，只读） | 跟随所挂的视频节点：画布 ↑ 走 A；Agent `generate` 走 B（多镜）或 A（文稿来的） | 不新增批准点；加了一道**准入**判据 `directorPreviewSpendBlock`，挂在 `canRunGenerationNode` 与 `runGenerationNode`（分支上 `generationRunController.ts` +8 行）和 Agent 出卡前的渲染层预检 `director.preview-blocks`（`laneDesktopTools.ts`、`laneExtendedDesktopPorts.ts`） | 不变 | 不变 | 判据住渲染层节点 meta | 节点卡文案 |
| E12 | **节点一键派生**（未开工，仓库里无代码） | 若照现在的写法会走 A（复制节点 + `confirmAndRunNode`） | — | — | — | — | — |
| E13 | 附属付费口：模型试跑（`capabilityCore/modelOnboarding/tryModel.ts:104/115`）、接入认证（`integrationCertification/integrationSession.ts:425/470`、`integrationSessionRuntimeInstall.ts:38/43`）、ComfyUI 候选测试（`tasks/comfyCandidateTest.ts:130`）、新手试生成（`src/ui/onboarding/workflowPage/runTestGeneration.ts:69`）、视频拆解（`video/deconstructVideo.ts:262/453` 经 `spendConfirmGrant.ts:69`）、浏览器提示词提取（`src/ui/browser/prompt/browserPromptExtractionRunner.ts:93`） | A | 各自铸令牌 | `runTask` | 各自 | 各自 | 各自 |

**已经汇到同一个口子的**：E8 / E9 / E10（同一个语义生成实例、同一个提交出口、同一个派发闸、同一份 Run）；画布与制作「这一镜归谁」只有 `decideShotClaim` 一个判定口（`electron/shared/decideShotClaim.ts:55`，读者：`canvasShotClaim.ts:17`、`productionRunReducer.ts:316`、`productionShotDispatchGuard.ts:21`、`batchScheduleDerivation.ts:172`、渲染层置灰 `productionShotOwnership.ts:28`）；两台的出站报文都由 `buildProfileHttpRequest` 渲染（`apimartGenerationProvider.ts:331`、`:556`）。

**还各走各的**：E1–E7 整组（画布那台），E13 附属口；E11 的准入判据只在渲染层。最出乎意料的一条是 **E6：Agent 的 `generate` 遇到文稿来的方案时走的是画布那台**，所以「Agent 都走制作流程」这句话今天不成立。

**死口与遗留（顺手发现，第一刀一起删）**：
- `electron/capabilityCore/core.ts:395` `generateOnProject` 及其审片环（`core.ts:691-712`、`shotVerifyDeps.ts`）、两跳首帧（`i2vTwoHop.ts`）、`gateway.confirmSpend`：`node scripts/door-map.mjs generateOnProject` 返回 0 扇门，只剩测试在调——一条没人用、却能铸令牌直发供应商的口。
- 旧剧本驱动 `productionRunDriverOps.ts:417` `driveGeneration` 在非语义 Run 上仍会请求 `production.generate-node`（`:515`），渲染层早已拒收（`src/workbench/capability/legacyGenerationPathGuard.test.ts`），等于一条 fail-closed 的死口。

---

## 2. 09-26 方案与施工卡对账

| 条目 | 结论 | 证据 |
|---|---|---|
| 定稿决策 1：不新增第三套 `GenerationIntent` | 已做（一直遵守） | `grep -rn "GenerationIntent\b" electron src` 生产代码 0 处 |
| 定稿决策 2：owner 按四元组计数 | 已做 | `concept-owners.json` 现 126 个概念、门岗 `check:concept-owners` 在 `gates:contracts` 里 |
| 定稿决策 3：durable commit 复用 intent log / outbox，补 commit marker | 部分 | intent log、outbox、`submission_unknown` 都在；`commitId` / commit marker / crash-injection 测试 0 处（`grep -rn commitId electron/productionRun` 无生产命中） |
| 定稿决策 4：single write 迁移 | 未做（画布那台还没开始迁） | §1 |
| 定稿决策 5：先做 direct canvas paid → ProductionRun 的 vertical pilot | **未做**——这就是本计划的第一刀 | `concept-owners.json` 的 `spend.pending-identity` 仍是 pending，迁移判据原文就写着「直接画布那条 nodeId + quoteId 的旧路随 Phase 2 试点迁走」 |
| 定稿决策 6：`submission_unknown` 显式保留、不自动重提 | 部分：制作那台已做（#962）；画布那台没有这个态 | `submissionOutbox.ts:283-325`；`submissionLedger.ts:1-4` |
| 定稿决策 7：投影只读 canonical facts | 部分：镜头阶段、任务分组、落地已是单一 owner；画布节点仍由控制器直写、Agent 面板仍轮询 | `productionShotPhase.ts`、`taskCenterProjection.ts`、`useAgentPanelSpendConfirm.ts:181` |
| Phase -1 / Phase 0 账本 | 已做 | `docs/audit/2026-09-26-phase-minus-one-entrance-matrix.md`、`2026-09-26-phase-zero-architecture-ledger.md` |
| Phase 1 治理门 | 部分：形状层 owner 门已落地；「UI 按 raw status 分组」扫描、「跨入口是否汇到同一 handler」扫描、语义对拍、durable commit 未做 | 09-26 方案「Phase 1 进度」表；本次复核无变化 |
| Phase 2 vertical pilot | 未做 | 同上 |
| Phase 3 / 4 | 未做 | — |
| A 线：统一生成合同 | 部分：变体、参数值 schema、出站提示词与参考已各收成一个 owner（`generation.variant-resolution`、`generation.parameter-value-schema`、`storyboard.shot-outbound` 均 converged）；**引擎 B 的就绪判据仍是自己的一份**（#975 就是它） | `concept-owners.json`；`D:\Nomi-975` 分支设计卡「方向检查」 |
| B 线：统一生产事实和投影 | 部分：`productionShotPhase` / `canvasLandingHost` / `taskCenterProjection` 已是唯一 owner；渲染层轮询未删 | 同上 |
| C 线：作者内容与执行内容 | 部分（本次未深查，`unverified`）：`storyboard.shot-outbound` 已收；E6 说明文稿方案仍由画布那台执行 | §1.2 E6 |
| 施工卡 P0-1 生成/生产双生命周期 | 部分：认领（#921）、逐镜授权与同意窗口（#947）、派发闸前置（#921）、不盲重发（#962）、切项目落图（#966）已做；`legacy_paths`「`generationRunController → catalogTaskActions → runtime.runTask` 直提交」原样还在；commit marker、crash injection 未做 | §1、§3 |
| 施工卡 P0-2 语义/状态/投影多 owner | 大部分已做：`resolveArchetypeVariant`、`deriveProductionShotState`、任务分组都已单一 owner；画布节点状态仍是控制器自己写 | `concept-owners.json` |
| 施工卡 P1-6 Agent/MCP/审批/回执多入口 | 部分：Agent 与 MCP 共用一个语义生成实例、`laneApprovalGate` 已收（`agent-lane.awaiting-user` converged）；`mcpGenerationToolCatalog.ts` 五个手写工具仍在、未进统一 registry；真实 stdio MCP 收据 `unverified` | `mcpGenerationToolCatalog.ts:67-142` |
| 09-21 一个引擎 · 步骤 A | 已做：参数从 mapping 引用键派生（`paramTranslate.ts` 的 `wireReferencedParamKeys`）、两路提示词投影（`runtime.ts:323`、`executionContract.ts`）、MCP 两个开关已删（`mcpGenerationPolicy.ts:9` 只剩注释） | grep 结果 |
| 09-21 一个引擎 · 步骤 B | 部分：执行器按家装配已做（`47e4a5f1a`，`generationProviderBootstrap.ts:102`）；七项差异里 multipart、本地进程、自定义调用脚本在引擎 B 是**拒发**而不是支持（`apimartGenerationProvider.ts:226-231`、`:305`）；「只许一个模块发供应商请求」的边界门岗未做 | `electron/parity/engineDifferences.test.ts` |
| 09-28 镜头认领 | 已做（#921 合入），本次发现一处同类缺口（§3 路径 6） | — |

---

## 3. 双扣地图核实

路径 1–5 取自 [`2026-09-28-production-shot-claim.md`](2026-09-28-production-shot-claim.md) §1（协调会话记忆里的「暂停后画布生成再点继续剩余」「确认卡等待时画布生成」「删节点后调度器照生成」分别对应 1、2、3）。

| # | 路径 | 现在还能复现吗 | 锁住它的测试 |
|---|---|---|---|
| 1 | 暂停 / 停下后画布生成同一镜，再点「继续剩余」 | 不能 | `multiShotBatchScheduler.e2e.test.ts`「paused → canvas claim: scheduler submits zero and canvas submits exactly once」「同意过期停下 → 画布接手 shot-2 → 用户点「继续」：只续上、只派 shot-3」；`productionBatchSettlesAfterRelease.e2e.test.ts`「the canvas taking over a queued shot while the batch is paused」；`canvasShotClaimAttempt.test.ts` 第 1 条（走真实的主进程认领入口 `claimCanvasProductionShot`） |
| 2 | 确认卡等着时在画布生成（原「提额续拍卡」那条已随 Run 级预算停在 #947 删掉） | 不能：等确认的镜归制作，画布被拒（`awaiting_confirmation`） | `productionShotPhase.test.ts`「报价卡等确认：付费范围里的镜归制作流程，不在范围里的不归」「approval gate waiting follows the run stop state…」；#921 付费真机 S1 |
| 3 | 删掉镜头节点后调度器照样生成 | 不能 | `multiShotBatchScheduler.e2e.test.ts`「canvasDetached after node deletion: scheduler submits zero」；`productionShotDetachReport.e2e.test.ts` 两条；`productionRunReducerCanvasLanding.test.ts`「detach marks an unsubmitted job detached…」；#966 补了「切项目被误判成删节点」的反方向 |
| 4 | 制作已发出、可能已扣（在途 / 结果未知 / 对账中）时画布再生成 | 不能 | `multiShotBatchScheduler.e2e.test.ts`「submission_unknown/reconciling: canvas is rejected with needs_reconcile…」；`productionShotPhase.test.ts`「a canvas claim record never outranks a same-attempt job that may already be paid」「unknown/reconciling remain production-owned」；`submissionNotDispatched.test.ts`「⑤ 结果未知的镜：放行前画布不能生成…」 |
| 5 | Run 处于需要处理（needs_attention）时调度器照样派 | 不能 | `multiShotBatchScheduler.e2e.test.ts` 两条「同意过期停下」都断言停下后「过期的镜一笔都没交」；`decideShotClaim` 把 needs_attention 算停下（`productionRunStop.ts:11-17`）。**缺口**：`batchScheduleDerivation.test.ts:324` 的「停下不派」循环只列了 pausing / paused / cancelled，没列 needs_attention（建议补一格，第一刀第 0 步顺手） |
| 反向 | 返工卡被拒后整批永久卡死 | 不能：被拒的镜交还画布，可再返工 | `multiShotBatchScheduler.e2e.test.ts`「rejected rework gate releases canvas once and allows a later rework attempt」；`productionShotPhase.test.ts`「rejected gate releases an unsubmitted shot」 |
| **6（新）** | **同一镜第二次被画布接手，认领被命令号重放吞掉**：批次停下 → 画布接手 shot-2 → 用户又让制作返工 shot-2（批了，但这类停下不随返工解除，Run 仍停着）→ 用户在画布再生成 shot-2 → 点「继续」→ 制作照派 attempt 2 | 核查时**能**（夹具复现，零花费；真 App `unverified`）；第 0 步已修（分支 `fix/canvas-claim-attempt-id`） | `canvasShotClaimAttempt.test.ts` 的 reported case 与「第 2、3 次认领各自落盘」；同类的删节点上报（撤销后再删）一并修，见该文件 detach 一条 |

**路径 6 的机理**：画布认领写的命令号是 `shot.claim:<runId>:<shotId>`（`canvasShotClaim.ts:29`），不带 attempt；仓库按命令号幂等重放、原样返回第一次的结果（`productionRunRepository.ts:482-486`）。第二次认领没落盘，attempt 2 的 job 仍是 authorized，认领记录还停在 attempt 1，于是 `decideShotClaim` 对制作判「归制作」（`decideShotClaim.ts:84` 只认同 attempt 的认领）。把命令号换成带 attempt 的写法，同一条测试就不再双扣（本地验证过，临时探针已删）。它和 #966 直接原因 ③「纠正型绑定命令号与当初一字不差、被幂等重放吞掉」是同一类：**写命令的人没把「这是哪一次」放进命令身份**。这一类在收敛后会整体消失（画布不再需要向制作「认领」，见 §5）。

---

## 4. 前置项状态（09-29 拍板的顺序）

| 前置 | 状态 | 证据 |
|---|---|---|
| 付费卡①（批准范围 = 派发范围、回执读 Run 状态、参考图带画布连线、失败文案） | **已合入**：#947（`d1dfa423f`，2026-10-03）。逐镜授权住在各自的门上，presentations 只追加，逐镜结局一个值，画布连线参考进卡，同意窗口 + 删 Run 级预算停 | PR #947 正文；`productionSpendAuthority.ts`、`productionGenerationPresentation.ts`、`productionDispatchConsent.ts` |
| B 付费卡并进对话投影（删 1.5 秒轮询，「等用户」只留一种表示） | **未开工** | `useAgentPanelSpendConfirm.ts:54` `POLL_INTERVAL_MS = 1500`、`:181` `setInterval`；对照报告 §8 的前置风险「删轮询之前先枚举不走 lane 的待决付费」仍成立 |
| C1 一次工具调用一条（字段对齐 `ToolUIPart`） | **未开工** | `electron/shared/agentLane/laneContracts.ts:75/83` 仍是 `tool-call` / `tool-result` 两种 part；`src/workbench/ai/lane/laneViewModel.ts:203/263/298/338` 的 `receiptFor` / `mergeAssistantTextPerTurn` / `settledStatus` / `slots` 都还在 |

**一处命名冲突，需要协调会话定**：`docs/plan/2026-10-01-tech-stack-line-0.24.md` 的 S4 也叫「两台发动机收敛」，但那里指的是「主进程文本任务栈与 pi 运行时」，和本文（画布直接生成 vs 制作流程）不是一件事。建议把那一步改名，免得两条线都以为自己在做「发动机收敛」。

**B / C1 与收敛的关系**：第一刀的第 1、2 步不碰 Agent 面板，与 B / C1 无冲突，可以并行；第 3 步（批量与 E6 进 Run）会改 `PendingSpendConfirm` 的生产者和 `generate` 回执，必须排在 B 之后、与 C1 错开（见 §5.3）。

---

## 5. 第一刀施工计划：画布付费生成并进制作流程

### 5.1 唯一 owner 与范围

- **唯一 owner**：`ProductionRun`（批准、派发、在途、状态四件事都归它）。写口仍是 `productionRunRepository.execute` + reducer；派发口仍是 `productionGenerationSubmission.start` → 提交出口；授权仍是逐镜信封；判定口不新增。
- **一个画布节点 = 一个镜头**：节点第一次付费生成时建一个单镜 Run，节点 meta 记 `productionRunId` / `productionShotId`（今天已有的绑定字段，`catalogTaskActions.ts:335-336`）；以后每次 ↑ 是**同一个 Run 的新 attempt**，各带一份由真人手势封的授权。这样「画布和制作争同一镜」从结构上不存在了：只剩一个 Run、一条 job 队列，认领（`claimCanvasProductionShot`）整段可删，路径 6 这一类随之消失。
- **用户手感不变**：单点 ↑ 仍不弹卡（手势本身就是批准，09-25 拍板不变）；变体 ×N、原地重生成、批量仍是今天那张卡；节点上的进度、失败文案、任务中心分组看起来不变（来源从控制器换成 Run 投影）。
- **不做**：不改执行器——画布那台的传输（mapping HTTP、multipart、本地进程、自定义调用脚本、同步音频 / 文本、无 mapping 兜底、对话出图兜底、结果缓存）原样保留，第 1 步把它包成一个 `GenerationProvider`（`electron/capabilityCore/generationRuntimeAdapter.ts` 的接口）挂到提交出口后面；两种传输合一是第二刀。不碰 ComfyUI 本地（不花钱，按 09-26 方案保留独立 bounded context）。不碰 E13 附属付费口（试跑、认证、视频拆解、新手试生成、提示词提取）——它们继续用令牌，登记成带到期日的例外（待拍板 D）。不改价格、不改同意窗口规则、不加新界面。

### 5.2 先写的特征测试（全部先红后绿，走真实边界）

1. **对拍**：同一节点同一参数，经旧路 `nomi:tasks:run` 与新路「单镜 Run → 提交出口 → 引擎 A 传输」，出站报文逐字节相同（复用 `electron/parity/generationParity.matrix.test.ts` 的夹具与 loopback 供应商）。覆盖 mapping 异步、同步返回、自定义调用脚本、multipart 四种传输。
2. **画布 ↑ 的耐久性**：发出请求后在「写出去之后、回执之前」杀进程，重启后这一镜是 `submission_unknown`、节点写「结果没法确认」、不能再点 ↑（今天会被收成空闲、可再扣一次）。
3. **单节点在途**：同一节点连点两次，只有一个 attempt 发出（替代 `nodeSubmitInFlight` 的进程内锁）。
4. **绑定了制作镜头的节点**：画布 ↑ 等于该 Run 的新 attempt；§3 的 6 条路径在新结构下各有一条「供应商只收到一次」的端到端（路径 6 已在第 0 步由 `canvasShotClaimAttempt.test.ts` 锁住）。
5. **旧项目**：带旧运行记录（含在途 taskId）的节点打开后照旧能找回结果；新一次 ↑ 才建 Run。
6. **3D-BOX 准入**：预演未好时，主进程准入拒绝建 attempt（不止渲染层置灰）。
7. **性能**：单次 ↑ 从点击到供应商请求发出的额外耗时，和 500 个画布 Run 的项目打开耗时（见格 7）。

### 5.3 分几步，每步都能独立合入、真机验收

| 步 | 做什么 | 删什么（同一提交） | 真机验收 | 规模 |
|---|---|---|---|---|
| 0 止血 + 清死口 | 认领命令号带 attempt（路径 6 的 `.fails` 摘掉）；补 `needs_attention` 不派那一格；删 `core.generateOnProject` 一族（审片环、两跳、`gateway.confirmSpend`） | 死代码与它们的测试 | 夹具 + 网络闸重放路径 6（零花费），中英各一遍 | S，约 1 天 |
| 1 单节点 ↑ 进 Run | 主进程新命令「画布生成这一镜」：建 / 复用节点的单镜 Run → 手势封授权 → 提交出口；引擎 A 传输包成 `GenerationProvider`；节点进度与任务中心改读 Run 投影（`canvasLandingHost` / `deriveProductionShotState`） | E1 的 `mintSpendGrant`（`generationRunController.ts:553`）、`claimCanvasProductionShot` 在这条路上的调用、这条路的 `nodeSubmitInFlight` | 真 App：图片 / 视频各 1 次小额真付费；切项目、关窗、断网、重启各一遍（格 5）；任务中心与节点状态一致 | L，约 4–5 天 |
| 2 其余单节点入口进同一个口 | 变体 ×N（一张卡 = N 个 attempt 的授权）、原地重生成、任务中心 / 报错卡重试、分镜行操作、结果未知放行后重生成（E2 / E3 / E5 / E7） | 这些入口的铸令牌调用；`runWorkbenchTaskByVendor` 的付费用法 | 真 App 逐入口各 1 次；变体中途点 × 只发出已点的那几次 | M，约 2–3 天 |
| 3 批量进 Run（**排在 B 之后**） | 「生成全部」与分镜整批（E4 / E6）建一个多镜 Run，一张批量卡 = 一份盖住卡上所列镜头的授权，逐镜结局沿用 `generationPresentationOutcome`；`storyboard.present` 不再驱动画布那台，改成交回 operation | `confirmAndMintGrant`、`runGenerationNodesByPlan` 的付费路、画布那条 `nomi:tasks:grant-spend` / `quote-spend` 用法、`submissionLedger` 的画布用法、`nodeSubmitInFlight` 整个文件、`claimCanvasProductionShot` 整个文件 | 真 App：分镜 3 镜整批、中途点 ×、急停后继续；Agent 对文稿方案 `generate` 一次 | L，约 4–5 天 |
| 4 收尾 | `spend.pending-identity` 从 pending 转 converged（判据：`PendingSpendConfirm` 只剩 Run 投影一个生产者）；旧剧本驱动的 `production.generate-node` 分支删除；E13 按待拍板 D 的结论处理 | 旧令牌在画布侧的全部调用 | 全功能走查 pb 系列 + 付费 5 条走查 | M，约 2 天 |

合计约 13–16 个工作日（不含等 B）。每步一个 PR，同一概念按阶段推（一个概念一个 PR 的规矩下，第 1–3 步可以是同一个 PR 的三个阶段推送，也可以分开，交协调会话定）。

### 5.4 改哪些文件（第 1 步为主，后几步同理）

- 主进程：`electron/productionRun/productionGenerationOperationStore.ts`（单镜草稿，origin host 记 `canvas`；`origin.host` 是字符串，旧版本读得懂，`productionRunTypes.ts:423`）、`productionGenerationSubmission.ts`（接受第二种 provider）、新文件 `electron/capabilityCore/canvasTransportProvider.ts`（把 `runtime.ts` 的 `executeProfileOperation` / `buildProfileTaskResult` / `fetchTaskResult` 包成 `GenerationProvider`，不复制传输代码）、`electron/productionRun/productionActionIpc.ts`（新命令，受信 IPC 盖真人手势章）、`electron/runtime.ts`（`runTask` 不再是画布付费的入口，只留给 E13 与免费调用）。
- 渲染层：`src/workbench/generationCanvas/runner/generationRunController.ts`（`confirmAndRunNode` 改发新命令；控制器不再写节点进度）、`catalogTaskActions.ts`、`src/workbench/taskCenter/taskCenterProjection.ts`（画布 Run 走 `ProductionRunTaskCenterProjection`）、`src/workbench/production/productionShotOwnership.ts`（置灰判据改读 Run 的 attempt）。
- 登记：`docs/engineering/concept-owners.json`（新增 / 改写画布生成相关概念的 write_api；`canvas.node-submit-in-flight` 在第 3 步删除）、`docs/engineering/self-written.json`（只新增 `canvasTransportProvider` 一条接线，理由：领域内两种传输挂到同一提交出口）、根因合同 `docs/fixes/<日期>-canvas-paid-into-production-run.root-cause.json`（门表用 `node scripts/door-map.mjs confirmAndRunNode mintSpendGrant runTask claimCanvasProductionShot withNodeSubmitExclusive runTaskWithIdempotency` 生成）。

### 5.5 旧项目数据怎么迁移

- **不改写旧数据**（legacy read，single write）：旧节点 meta 里的运行记录和 taskId 只读；打开旧项目时，仍在途的旧任务照旧经 `fetchTaskResult` 找回，直到终态；从升级那一刻起，新的付费生成只写 Run。
- 旧节点没有绑定：第一次 ↑ 时才建 Run 并写绑定，不批量补建（避免打开项目就多出几百个 Run）。
- 已经绑定制作镜头的节点（Agent 起草落下来的）：直接成为那个 Run 的新 attempt，不再建第二个 Run。
- 判不清的（节点 meta 里同时有旧在途 taskId 和 Run 绑定）：先按旧 taskId 找回，找回前不许新 attempt（与「可能已扣钱的优先」同一条规则），不猜。

### 5.6 回滚

- 每步一个 revert。新版本建的画布 Run 用的是现有 Run schema（单镜语义计划、origin host 是字符串），0.23 读得懂；节点上的 `productionRunId` / `productionShotId` 绑定 0.23 也认——回滚后用户在这些节点上点 ↑，0.23 会走它的「认领 → 画布那台」路，不会卡死、不会重复（Run 里已结束的 attempt 判 `terminal`，在途的判归制作）。这一条是读代码得出的，第 1 步合入前要在 0.23 安装包上实打一次（`unverified`）。
- 已经发出去的请求、已经封的授权不回滚、不重放（09-26 方案定稿）。

### 5.7 设计卡（花钱 + 长跑 + 可打断，9 格全填）

```
改动名：画布付费生成并进制作流程（发动机收敛第一刀）   线/负责人：待派（建议 Opus 实现线 + 另一条验收线）   类别：[花钱][长跑][可打断]
```

| 格 | 结论 | 证据 |
|---|---|---|
| ★1 用户怎么用 | 当我在画布上点 ↑（或变体、重生成、生成全部、在分镜表里生成），我想它和今天一样快、一样少打扰，并且**不管我中途切项目、关窗、重启，这一镜都不会被扣两次，也不会出现「不知道花没花」**。步骤：选节点 → 点 ↑ → 节点显示提交中 / 生成中 → 出图落节点 → 任务中心同一条。**不做**：不改执行器、不改价格与同意窗口、不加界面、不碰附属付费口。**已知坑**：每个画布生成的节点会多一个 Run 文件夹；画布里几百个节点的项目要量打开耗时。真实任务：(a) 一个 30 节点的短片项目，逐个 ↑ 出图再挑几个变体；(b) 分镜表 3 镜整批，中途点 × 再继续；(c) Agent 起草 2 镜后，用户在画布上对其中 1 镜手动重生成 | 真实任务脚本待写：`tests/ux/` 下新增付费走查（第 1 步）；(a)(b)(c) 现在 `unverified` |
| ★2 谁说了算 | 「这一镜的付费生成」批准 / 派发 / 状态唯一 owner = ProductionRun（`productionRunRepository.execute` + reducer、`productionGenerationSubmission.start`、提交出口）；概念 `spend.pending-identity` 从 pending 收口；`production.shot-generation-ownership`（`decideShotClaim`）保留为 Run 内判定，画布侧调用随第 3 步删除；`canvas.node-submit-in-flight` 第 3 步删除。碰 4 个概念 | 门表：`node scripts/door-map.mjs confirmAndRunNode confirmAndRunNodeVariants regenerateNodeInPlace runGenerationNode runGenerationNodesBatch runGenerationNodesByPlan confirmGenerationSpend runWorkbenchTaskByVendor`（写 17 · 读 1）、`node scripts/door-map.mjs mintSpendGrant`（写 9 · 读 1）、`node scripts/door-map.mjs runTask`（写 10 · 读 12） |
| ★3 一致与复用 | 复用：Run 账本、逐镜授权、同意窗口、提交出口、派发闸、`submission_unknown`、落地宿主、镜头阶段判据、任务中心 Run 投影、`buildProfileHttpRequest`、引擎 A 的全部传输。**不引新库**：持久状态机已是自己的事件溯源 reducer（09-26 方案定稿决策 3）；XState 只活在内存、进程死了状态就没了，不适合当这一层（同理由见 `2026-09-15-integration-session-terminal-guarantee.md:143`），若 0.24 用它，只用于付费卡界面态。自写的只有 `canvasTransportProvider` 一个接线文件（领域约束：两种传输挂到同一个按镜头花钱的提交出口） | `pnpm run check:self-written`；`grep -n "xstate" package.json` 无 |
| ★4 全状态 | 节点：空闲 / 提交中 / 生成中 / 成功 / 失败（带原因）/ 结果没法确认（去任务中心核对，不给重试）/ 已取消（没发出去，不扣）/ 停下待继续。文案全部复用现有 i18n 键（`generationCommon.production.*`、`classifyGenerationError`），不新增界面 | `check:i18n`；截图第 1 步交付时补，中英各一 |
| 5 中途表 | 见下表 | 第 1 步的随机打断脚本 + 真窗口走查 |
| 6 外部数据与失败 | 外部来源：供应商 API（各家 mapping 声明）、用户保存的连接、参考素材。偏差处理全部沿用：出站报文由 `buildProfileHttpRequest` 渲染；「有没有写出去」只认 `outboundDispatchEvidence.ts`；未知不当失败、不重提；上游失败原文脱敏后说人话，不甩锅给 key。新增风险：引擎 A 的同步传输（自定义脚本、同步音频）在提交出口里没有「受理号」，包装时用 attempt 身份当 providerTaskId，结果直接进物化 | 官方规范按各 mapping 注释；`electron/parity/engineDifferences.test.ts` |
| 7 性能预算 | 实测（本机 Windows、临时目录、测试辅助函数）：单镜 Run 建草稿 + 封存 + 批准 p50 33.6 ms / p95 37.8 ms / max 59.7 ms（30 次）。未测、作为第 1 步的门：① 点击到供应商请求发出的额外耗时 p95 ≤ 150 ms；② 500 个画布 Run 的项目打开耗时与内存；③ 任务中心 500 条 Run 的渲染 | 本次临时探针（已删）；第 1 步交付 `test:canvas:performance` 输出 |
| 8 真实条件 | 全部 `unverified`：Windows 真 App、英文界面、最小窗口、真规模（500 节点）、干净安装、真付费（每种 kind 1 次小额）、0.23 回滚兼容 | 第 1、3 步各交截图（自己亲眼 Read） |
| ★9 验收与回滚 | 验收（另一条线）：§5.2 的 7 组测试全绿；付费走查里每个入口「供应商只收到一次」；`canvasShotClaimAttempt.test.ts` 全绿；`check:concept-owners` 显示 `spend.pending-identity` converged。回滚：每步 revert 一个提交，无数据回写（§5.6） | `## 独立验收` 待补（验收线不得是实现线） |

**格 5 中途表**（第 1–3 步完成后的样子；「今天」一列是对照）

| 处境 | 停 / 点 × | 关窗 | 断网 | 重启 | 连点 |
|---|---|---|---|---|---|
| 点了还没发出去 | 不发、不扣；节点回空闲（今天同） | Run 里是 authorized，重开后节点写「停下待继续」，点一下才发（今天：渲染层队列丢了，节点空闲） | 发不出去 = 确定没写出去，重试 1 次，再失败写失败、不扣 | 同关窗 | 只有一个 attempt（今天靠进程内锁） |
| 写出去了、还没回执 | 不能撤，等结果；× 只对没发的生效 | 主进程还在就照常收；窗口重开看到生成中 | 写出去之后断 = 结果未知，不重发，去任务中心核对 | **结果未知、不能再 ↑**（今天：被收成空闲，可再扣一次） | 被拒，提示「这一镜还在生成」 |
| 供应商受理、在出图 | 制作侧急停：已受理的照常收完 | 重开后落地宿主补落图（#966 已有） | 轮询失败下轮再查 | 按 Run 续轮询 | 同上 |
| 出完图、落盘中 | 不受影响 | 重开补落 | 下载失败按物化规则重试 | 按 receipt 补 `artifact.add` | 同上 |
| 失败 | 无 | 无 | 无 | 失败原因从 Run 读回 | 新 attempt，各封一份授权 |

花费：「扣 / 不扣」以「有没有写出去」为准（`outboundDispatchEvidence.ts` 唯一判据）；回执一律在 Run 账本与任务中心。

---

## 6. 岔路：拿什么当那「一台」发动机

| 选项 | 做什么 | 用户这边 | 工作量 | 风险 | 和 09-26 定稿的关系 |
|---|---|---|---|---|---|
| **A 一步到位** | 画布直接走 ProductionRun **加**目录执行器（钱口、状态、传输一次合一） | 最干净；但目录执行器今天对 multipart、本地进程、自定义调用脚本是拒发，对本机 / 声明供应商还有 #975 列的三条缺口（无 key 的本机适配器、内联参考图、私网产物）——不先补齐，这些模型在画布上会**不能用** | XL（先补七项传输差异，再迁入口），约 5–6 周 | 高：画布是最常用的面，回归面最大 | 符合目标，但违反「先 pilot 再扩」 |
| **B 先合钱口和状态，传输暂留两种挂同一接口（推荐）** | ProductionRun 成为唯一的批准 / 派发 / 状态 owner；画布那台的传输包成一个 `GenerationProvider` 挂到同一提交出口后面；传输合一放第二刀 | 手感不变；马上消掉「画布崩溃后说不出花没花」和整类「两台争同一镜」 | L，约 13–16 个工作日，分 5 步 | 中：每次点击多一次落盘（实测约 35 ms）；任务中心画布那半边要换数据源 | 正是 Phase 2 vertical pilot 写的那条路 |
| **C 另立一层「统一准入」** | 在两台前面加一个耐久的准入服务（按节点 / 镜头记在途），执行和状态仍各管各的 | 少一部分双扣；画布仍没有「结果未知」 | M，约 1–1.5 周 | 中：多出第三个 owner，两套状态仍在，同类问题会从状态差异里回来 | 违反定稿决策 1（不新增第三套 owner） |
| D 维持现状，继续逐条补认领 | 每发现一条补一条 | 继续偶发双扣、继续修 | 每次 S | 高（复发）：§3 路径 6 就是最新一例 | 违反方向检查规则 |

**推荐 B。** 理由：钱的问题出在「谁批准、谁派发、谁记账」有两份，而不是「报文怎么拼」——两台的报文早就同源（`buildProfileHttpRequest`）。B 先把真正分裂的那一半收掉，传输差异留到第二刀按 #975 那种「同一份目录给同一个答案」的思路逐项补，不用先冻住画布几周。

**用户要权衡的核心**：是先让「钱只从一个口子出去、崩了也说得清花没花」尽快落地、代价是传输层暂时还是两种实现挂在一个接口后面；还是等把画布能用的所有模型都在制作那台上补齐、一次换干净，代价是这几周画布付费路线照旧是两套、双扣问题继续靠打补丁。

---

## 7. 对在跑的几条线的影响

| 线 | 现在怎么接的 | 收敛后应该怎么接 | 冲突 |
|---|---|---|---|
| **#975 声明登记的自定义供应商进正式生成**（`D:\Nomi-975`，分支 `fix/declared-provider-production`，只读） | 改的是目录执行器的就绪判据（`generationProviderBootstrap.ts`，删掉对非 direct-key 家的「让出」），让声明卡供应商能进制作那台 | 不变，照合。它修的是「传输合一」那一半的就绪判据；B 方案下画布付费仍用引擎 A 传输，所以 #975 不影响第一刀。它的设计卡里「重写」那一行（就绪直接派生自同一份可用性 + 传输能力表）正好是第二刀的入口 | 无代码冲突（第一刀不碰 `generationProviderBootstrap.ts`）。若选 A，#975 的三条预测（无 key 本机适配器、内联参考、私网产物）会变成画布回归，必须先拍板它的待拍板 A / B |
| **3D-BOX 3b 预演挂视频节点 + 花钱闸**（`D:\Nomi-3dbox-3b`，分支 `feat/director-3dbox-3b`，只读） | 准入判据 `directorPreviewSpendBlock` 只在渲染层：`canRunGenerationNode`、`runGenerationNode`，以及 Agent 出卡前问渲染层 `director.preview-blocks`（fail-closed） | 判据不搬家（它是按镜头的花钱语义，归渲染层节点 meta 是对的），但**问它的地方要收成一处**：第 1 步起「画布生成这一镜」的主进程命令在建 attempt 前问同一判据（经现有的渲染层请求通道），渲染层的两处只留置灰；Agent 出卡前预检照旧 | 文件重叠：`generationRunController.ts`（3b 加了 8 行，在 `runGenerationNode` 开头）。按「3b 先合、第一刀后改」排就没冲突；第一刀第 1 步把那一道闸挪进主进程命令的准入，同一提交删掉 `runGenerationNode` 里那行 |
| **节点一键派生（点了直接开跑）** | 未开工 | 派生 = 「复制节点 + 这个新节点的第一次 ↑」。第一刀合入前：**只许**调 `confirmAndRunNode({ rerun: true })`（它本来就是复制再跑，`generationRunController.ts:542-551`），不许自己铸令牌或直调 `runGenerationNode`——`spend.pending-identity` 的冻结名单里有 `mintSpendGrant`，新增调用处 `check:concept-owners` 会红。第一刀合入后：调「画布生成这一镜」命令，派生出的节点建自己的单镜 Run | 若它在第一刀之前开工并自己写一条付费路，就是第三条钱口——建议排在第一刀第 2 步之后，或严格只走 `confirmAndRunNode` |

---

## 8. 待拍板（交协调会话，本线不擅自决定）

- **岔路**：选 A / B / C（推荐 B）。
- **B 先于第 3 步**：第 3 步要动 `PendingSpendConfirm` 的生产者，必须在 B（删轮询）之后；第 1、2 步可以与 B / C1 并行。请确认这个排期。
- **一个 PR 还是分开**：第 1–3 步同一概念，按「一个概念一个 PR」可以合成一个 PR 分阶段推；但第 3 步要等 B，合成一个 PR 会让它挂很久。推荐第 0 步单独、第 1–2 步一个 PR、第 3–4 步一个 PR。
- **D. 附属付费口（试跑、认证、视频拆解、新手试生成、提示词提取）**：推荐这一刀不动、登记成带到期日的例外（它们不落画布、不争镜头）；或者随第 4 步一起进 Run。
- **命名**：0.24 技术栈文档的 S4 改名（§4）。

## 自己写了什么、为什么必须

核查时只加了一份特征测试（第 0 步已改名为 `electron/productionRun/canvasShotClaimAttempt.test.ts`），没有生产代码。计划里唯一的新文件 `canvasTransportProvider.ts` 是接线（领域约束：把画布那台的传输挂到按镜头花钱的同一提交出口），没有新判据、没有新状态机、不引新库。
