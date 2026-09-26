# Phase -1 生命周期对象账本

> 状态：✅ 审计产物完成；生产证据未完成（迁移放行：**PARTIAL/BLOCKED**）
> 审计基线：`origin/main@1f39ea3cf`（已纳入制作镜头重开修复、Windows 付费走查 harness 和素材物化边界修复）；当前交付工作树没有生产代码改动。

## 账本

| 生命周期 | 真实对象 | owner / 写口 | 稳定身份 | 持久化 | 允许转换 | 未解决风险 |
|---|---|---|---|---|---|---|
| author/desired | `PlanCandidate`、`GenerationOperation` | `createGenerationDraft`、Run-backed `productionGenerationOperationStore`、`generationPlanPatch` | `projectId + operationId (= runId) + candidateId + revision` | Run events + snapshot under `.nomi/runs/<operation>` | `draft → sealed/cancelled`; patch increments revision | 画布直生成有自己的 node intent，尚未映射到该对象 |
| frozen execution | `ExecutionContractV1` | `compileExecutionContract` | `candidateId + candidateRevision + contractHash` | generation plan / sealed Run event | seal 后 immutable；修改产生新 candidate/revision | parity helper 与生产 compiler 的输入矩阵需要继续钉住 |
| spend authority | `ProductionGenerationAuthorizationEnvelopeV1` | `prepareProductionGenerationAuthorization` + gate/reducer | `runId + gateId + authorizationDigest + expiresAt` | generation plan + approval records | approve/revoke/expire；submit-time recheck | direct canvas paid path 没有该 envelope |
| semantic execution | `ProductionRun`、`ProductionJob` | `ProductionRunRepository.execute` + `productionRunReducer` | `projectId + runId + revision + jobId + attempt` | event journal、snapshot、commands、approval、budget ledger | job state machine；CAS by expected revision | approval/budget/event/snapshot 写入目前不是一体化 commit |
| direct canvas execution | node run/progress/result、`submissionLedger` | `generationRunController`、`catalogTaskActions`、`taskIpcHandlers` | node `run.id` + extras idempotency key + provider task id | canvas node state/result and submission ledger | queued/running/result/error/retry | latest main 已有 direct canvas paid harness，但本轮未执行 live receipt；若确认是远端/付费，则与 semantic execution 共享 provider/花费事实但没有同一 Run owner |
| provider observation | semantic runtime envelope、job `providerStatus/providerState`; direct canvas result/task status | semantic provider adapter + reconcile；direct canvas runtime | `runId/jobId/attempt/providerTaskId?` 或 node run/provider task | runtime envelope sidecar + Run event / canvas result | accepted → polling → terminal；unknown → reconcile | 两条链的 unknown/reconcile 语义不一致，需要迁移或显式分域 |
| materialized artifact | `GenerationOutputMaterializationReceipt`、`ProductionArtifact`、`artifact.add` | `generationOutputMaterializer` + Run reducer | `artifactId + jobId + contentHash + version` | project asset store + Run artifact event | receipt → file → artifact.add → ready/adopted | direct canvas 结果可能先落节点而未形成统一 artifact fact |
| Run→canvas projection | `canvasLandingHost`、`multiShotCanvasLanding`、canvas landing reducer | Run event follower / landing host | `runId + shotId + sourceRevision` | project canvas JSON / node bindings | materialize → bind; `canvasDetached` blocks resurrection | 直画布路径不是该 projection 的消费者 |
| task center projection | `productionRunTaskCenter`、task center row builders | read-only projection | `production-run:${runId}` + source revision | derived read model | rebuild from Run summaries | Button/Panel 各自调用 builder，存在投影组装重复 |

## Owner 裁定

1. **所有已确认的付费或远端 provider generation 的 canonical execution owner 是 `ProductionRun/ProductionJob`。** 画布直生成是后续迁移候选；本轮尚未用真实 provider/计费证据证明其实际付费属性。
2. **本地、非付费、无远端 provider 的画布操作可以保留独立 bounded context**，但必须登记为 `local_canvas_execution`，不得复用付费 Run 状态、预算、授权或“已提交”语义。
3. `productionGenerationOperationStore` 是 Run-backed adapter，不是第二个 draft store。
4. `provider observation` 不得直接覆盖 `materialized artifact`；`submission_unknown/reconciling` 不能等同失败。
5. task center、canvas landing、Agent result 和 MCP result 都是 projection/adapter，只能消费 canonical facts。

## 身份关系

```text
operationId (= runId)
  └─ candidateId + candidateRevision
      └─ contractHash
          └─ authorizationDigest + gateId
              └─ jobId + attempt
                  └─ providerTaskId
                      └─ artifactId + contentHash
                          └─ projection sourceRevision
```

任何路径出现“只带 node id、当前页面、provider 实例或旧列表”而没有这条身份链，均记为越界写风险。

## Phase -1 结论

最新 main 已把“制作节点运行记录由谁写”收进 `electron/shared/productionShotPhase.ts`，并让画布重开收敛器跳过制作投影记录；这关闭了一个投影层的第二写口，但没有关闭 provider execution 的第二条生命周期。对象和 owner 的审计登记已完成，直接画布 remote/paid candidate 已明确标为迁移目标；下一阶段可以围绕这条 seam 设计治理门和 vertical pilot，但在真实 provider/计费 live receipt、冷重启和存储恢复证据补齐前，迁移放行保持 **PARTIAL/BLOCKED**，不能把两个执行链临时双写。
