# Phase -1 恢复与幂等探针收据

> 状态：✅ 审计产物完成；真实恢复边界未完成验证（迁移放行：**PARTIAL/BLOCKED**）
> 审计基线：`origin/main@1f39ea3cf`（已纳入制作镜头重开修复、Windows 付费走查 harness 和素材物化边界修复）；当前交付工作树没有生产代码改动。

## 已运行的现有测试

以下一组是在最新 `origin/main@1f39ea3cf` 工作树上重新运行的联合收据，包含制作节点重开回归和素材物化回归：

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run src/workbench/generationCanvas/store/canvasSnapshotNormalizer.test.ts electron/productionRun/productionRunResume.test.ts electron/productionRun/productionRunIntentLog.test.ts electron/productionRun/submissionOutbox.test.ts electron/productionRun/productionRunRepository.test.ts electron/productionRun/productionGenerationSubmission.test.ts electron/productionRun/artifactProjection.test.ts electron/capabilityCore/generationOutputMaterializer.test.ts src/workbench/generationCanvas/runner/catalogTaskActions.test.ts electron/tasks/taskIpcHandlers.test.ts electron/submissionLedger.test.ts electron/capabilityCore/generationRuntimeAdapter.test.ts electron/shared/canvas/generationNodeStatus.test.ts` | **PASS**：13 files / 384 tests |

工作树先执行 `pnpm install --frozen-lockfile`，依赖安装完成。以下是针对本阶段链路的实际结果：

| 命令 | 结果 |
|---|---|
| `pnpm exec vitest run electron/productionRun/productionRunResume.test.ts electron/productionRun/productionRunIntentLog.test.ts electron/productionRun/submissionOutbox.test.ts electron/productionRun/productionRunRepository.test.ts electron/productionRun/productionGenerationSubmission.test.ts electron/productionRun/artifactProjection.test.ts` | **PASS**：6 files / 57 tests |
| `pnpm exec vitest run src/workbench/generationCanvas/runner/catalogTaskActions.test.ts electron/tasks/taskIpcHandlers.test.ts electron/submissionLedger.test.ts electron/capabilityCore/generationRuntimeAdapter.test.ts electron/shared/canvas/generationNodeStatus.test.ts` | **PASS**：5 files / 313 tests |
| `pnpm exec vitest run electron/productionRun/productionRunDriver.test.ts electron/productionRun/productionRunResume.test.ts electron/productionRun/productionGenerationSubmission.test.ts electron/productionRun/productionRunIntentLog.test.ts electron/productionRun/submissionOutbox.test.ts` | **PASS**：5 files / 38 tests |

这些测试证明了：intent log 链完整性、command 幂等、Run journal replay、provider unknown/reconcile、provider-safe release、submission resume、artifact projection、direct canvas 的现有局部行为，以及最新制作节点重开回归。旧的三组命令存在文件与测试重叠，不能把 `57 + 313 + 38` 当成唯一测试总数；最新联合收据也只是当前测试集合的收据。它们不证明两条执行生命周期已经统一，也不替代真实 Electron/provider、冷重启、存储环境或 Windows 证据。

## 已验证的恢复语义

| 场景 | 证据 | 结果 |
|---|---|---|
| committed intent 重进 submit | `submissionOutbox.test.ts`、`productionGenerationSubmission.test.ts` | 不自动重提，进入 reconcile/unknown |
| provider 回执丢失 | `submissionOutbox.test.ts`、`productionRunDriver.test.ts` | `submission_unknown` + unsettled，需 reconcile |
| definitely-not-submitted | `submissionNotDispatched.test.ts`、submission tests | 只有持久证据证明未出站才能释放 reservation |
| Run event replay | `productionRunRepository.test.ts`、driver tests | snapshot/event 重建和 command replay 有覆盖 |
| artifact materialization | `productionGenerationSubmission.test.ts`、`artifactProjection.test.ts` | receipt/contentHash/artifact projection 有覆盖 |
| direct canvas local runtime | `catalogTaskActions.test.ts`、`taskIpcHandlers.test.ts`、`submissionLedger.test.ts` | direct path 自己的幂等/结果行为有覆盖，但未与 ProductionRun 对账 |

## 未验证但已登记为 Phase 1 阻断项

| 探针 | 当前状态 | 必须补的证据 |
|---|---|---|
| crash after event before side-ledger/index/snapshot | **UNVERIFIED** | commitId + crash injection + restart repair |
| crash after provider write before receipt | **PARTIAL** | semantic path 有 unknown 守卫；需真实 socket/provider boundary |
| direct canvas paid submit vs semantic submit | **UNVERIFIED** | 同一输入 canonical hash、授权和重复扣费对账 |
| artifact file exists but `artifact.add` missing | **UNVERIFIED** | receipt/contentHash repair probe |
| sync drive/Windows sharing violation/stale lock | **UNVERIFIED** | Windows real-device/storage-environment journey |
| cross-project late write | **PARTIAL** | semantic binding tests存在；direct canvas path仍需绑定对账 |
| task center projection lag and duplicate row assembly | **UNVERIFIED** | sourceRevision/lag probe and single builder migration |

## Phase -1 结论

已有测试和探针收据足够证明当前局部机制不是空壳；同时也证明 Phase 1 不能绕过 durable commit、direct canvas migration 和 storage environment。未知项没有被写成 PASS，保持 `UNVERIFIED/PARTIAL`，交给后续 implementation lane。审计收据完成，但迁移放行仍为 **PARTIAL/BLOCKED**。
