# Phase -1 入口矩阵：生成、提交、物化与投影

> 状态：✅ 审计产物完成；生产证据未完成（迁移放行：**PARTIAL/BLOCKED**）
> 审计基线：`origin/main@1f39ea3cf`（已纳入制作镜头重开修复、Windows 付费走查 harness 和素材物化边界修复）；当前交付工作树没有生产代码改动。
> 审计范围：`src/`、`electron/`；测试文件不计入 door-map 主计数。

## 结论

当前仓库存在两条真实的 provider 执行生命周期：

1. 语义/分镜链：`PlanCandidate → ExecutionContractV1 → AuthorizationEnvelope → ProductionRun/ProductionJob → provider → artifact → projection`。
2. 画布直生成链：`GenerationCanvas → generationRunController → catalogTaskActions → runtime.runTask/submissionLedger → canvas result`。

两条代码链都具备触达 provider 的能力；最新 main 还加入了 `tests/ux/canvas-spend-policy.paid.mjs`、`agent-video-landing.paid.mjs` 和隔离真实 profile 的 paid harness，说明 direct canvas 与 Agent/Run 都被当作真实付费入口维护。但本轮没有执行 `NOMI_SPEND_OK=1` 的真实 Electron/provider/计费走查，仍不能把本次审计写成 live paid receipt。第二条不创建 `ProductionRun`、授权 envelope 或 `ProductionJob`。因此 Phase -1 的结构裁定是：**所有被确认的付费或远端 provider generation 迁移到 ProductionRun seam；明确标记为本地、非付费、非远端的画布操作才可以保留独立 bounded context。** 本阶段不迁移代码，只登记迁移目标。

## 入口表

| 入口/面 | 代码锚点 | 当前 owner/写入 | 身份 | 是否经过语义合同 | Phase -1 结论 |
|---|---|---|---|---|---|
| 画布单镜/批量 | `src/workbench/generationCanvas/runner/generationRunController.ts`、`generationRunWaves.ts`、`tests/ux/canvas-spend-policy.paid.mjs` | `runGenerationNode(sBatch)`、节点 generation index、renderer progress/result | node `run.id`、`extras.idempotencyKey`、provider task id | 否；经 `runtime.runTask` 与 `submissionLedger` | paid harness 已登记该入口，但本轮没有 live receipt。确认属于远端/付费后列为迁移目标；本地非付费路径需单独登记 |
| 画布节点 composer | `NodeGenerationComposer.tsx`、`BaseGenerationNode.tsx` | `confirmAndRunNode`、`regenerateNodeInPlace`、`confirmAndRunNodeVariants` | node id + current node state | 部分；准入/变体/确认仍有 surface 写口 | 只保留 UI intent，最终走 shared command |
| 分镜行执行 | `src/workbench/creation/storyboard/exec/storyboardRowActions.ts` | `confirmAndRunNode` / `regenerateNodeInPlace` | storyboard target + node/run identity | 当前与画布入口相连，需按真实调用图切开 | 不允许分镜行再做 provider submit 或独立 readiness 判定 |
| Agent/MCP 语义计划 | `electron/capabilityCore/mcpGenerationTools.ts`、`mcpGenerationMultiShot.ts`、`productionGenerationOperationStore.ts` | operation store adapter → Run repository | `projectId + operationId (= runId) + candidateId + revision` | 是 | 作为 canonical semantic path |
| 合同编译 | `electron/capabilityCore/executionContract.ts:compileExecutionContract` | compiler | `candidateId + candidateRevision + contractHash` | 是 | 单一编译 owner；parity test helper 不是生产 owner |
| 授权准备 | `prepareProductionGenerationAuthorization.ts`、`productionGenerationAuthorization.ts` | envelope creator + gate/recheck | `runId + gateId + authorizationDigest + expiresAt` | 是 | 单一花费 authority |
| Run command | `productionRunRepository.ts`、`productionRunReducer.ts` | `ProductionRunRepository.execute` + reducer | `projectId + runId + revision + commandId` | 是 | 单一 durable state owner；side-ledger 原子关系仍是 Phase 1 gap |
| provider submit/poll/materialize | `productionGenerationSubmission.ts`、`submissionOutbox.ts`、`singleShotGenerationObserver.ts` | submission + outbox + runtime envelope | `runId + jobId + attempt + providerTaskId?` | 是 | 语义链唯一提交 owner；`generationSingleShot.ts` 需继续确认生产调用者 |
| 产物物化 | `generationOutputMaterializer.ts`、`productionRunDriverOps.ts` | materializer + `artifact.add` reducer | `artifactId + jobId + contentHash` | 是 | receipt/asset/artifact.add 顺序固定 |
| 画布 Run 落地 | `canvasLandingHost.ts`、`multiShotCanvasLanding.ts`、`productionRunCanvasLandingReducer.ts` | Run→canvas host | `runId + shotId + sourceRevision` | 是 | 只读/落地适配器，不决定 provider 状态 |
| 任务中心 | `src/workbench/taskCenter/productionRunTaskCenter.ts`、`taskCenterEntries.ts`、`TaskCenterButton.tsx`、`TaskCenterPanel.tsx` | `buildProductionRunTaskRows`、`mergeProductionRunSummaries` | `production-run:${runId}` | 消费 Run summary | Button/Panel 的重复组装需收成一个 projection consumer |

## 机器门表收据

命令：`node scripts/door-map.mjs <file>`，扫描 2,590 个 `src/`、`electron/` 文件。

| 文件/符号 | 写入口 | 读入口 | 总门 | 解释 |
|---|---:|---:|---:|---|
| `src/workbench/generationCanvas/runner/generationRunController.ts` 相关符号 | 23 | 12 | 35 | 画布生成、分镜行、任务中心和时间轴仍共同触达 direct runner |
| `electron/productionRun/productionRunRepository.ts` | 4 | 17 | 21 | 多个服务读取同一 repository；写入口集中在四个装配点 |
| `electron/productionRun/productionGenerationSubmission.ts` | 4 | 20 | 24 | semantic submit/poll/materialize 的消费面较广，写 owner 仍集中 |
| `electron/productionRun/submissionOutbox.ts` | 2 | 18 | 20 | outbox 由 legacy wrapper 与 semantic submission 两处装配 |
| `electron/capabilityCore/generationOutputMaterializer.ts` | 2 | 3 | 5 | materializer 装配集中，但必须确认两处装配是否共享同一实例语义 |
| `src/workbench/taskCenter/productionRunTaskCenter.ts` 相关符号 | 5 | 0 | 5 | Button 与 Panel 目前各自调用任务行构造/标签函数 |
| `compileExecutionContract` | 2 | 0 | 2 | 一处生产调用、一处 parity helper；helper 不计第二生产 owner |
| `productionShotPhase` / `productionRunRecordId` / `isProductionRunRecord` | 10 | 5 | 15 | 最新 main 已把制作节点记录身份和运行态判定收进共享 owner；这修复了重开窗口时画布收敛器误删制作记录，但不等于 provider execution seam 已统一 |

`door-map` 是入口事实收据，不等于决策 owner 数。画布 35 扇门的重点不是全部合并成一个文件，而是把 provider submit、花费准入、状态决定和投影读取的权限分开，并把付费路径接入同一 semantic seam。

## 待迁移路径

| 结构问题 | 现状 | 后续 lane | 放行条件 |
|---|---|---|---|
| direct canvas remote/paid candidate | 绕过 `ExecutionContractV1`/authorization/ProductionRun；最新 main 有 paid harness，但本轮未执行 live paid receipt | 生成执行 seam | 同一输入生成同一 canonical contract/hash，submit/reconcile 与 Run 一致，并有真实 provider/计费证据 |
| canvas/storyboard readiness | 多个 UI/surface 读写 `GenerationApprovalGuards`、`GenerationConfirmationGuards`、`canRunGenerationNode` | generation admission owner | UI 只消费 `grantable/readiness` projection |
| task center row assembly | Button 与 Panel 都调用 row/label 构造 | task center projection | 一个 read model builder，两个纯渲染消费者 |
| generic `generationSingleShot` | 存在 submission facade，调用关系尚未完全闭合 | semantic submission audit | 找到全部生产调用者并标注保留/删除；关闭所有绕过 canonical seam 的生产调用者 |
