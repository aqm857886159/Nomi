# Phase 0 结构簇索引

> 状态：✅ 结构簇完成；每簇已绑定 owner、旧路径和阻断条件
> 基线：`origin/main@1f39ea3cf` · 日期：2026-09-26

逐合同归属和 graph evidence 见 [`phase-zero-contract-cluster-map.json`](2026-09-26-phase-zero-contract-cluster-map.json)；七簇完整施工字段见 [`phase-zero-construction-cards.md`](2026-09-26-phase-zero-construction-cards.md)。宏簇是派工索引，不替代每个 `class_root` 的语义复核；映射中 16 条合同已明确标记 `manual_review_required`。

## 读法

下面的“owner”是该簇的目标决策/写入 owner，不表示当前代码已经迁移。`projection` 可以有多个；`decision_owner` 和 `write_owner` 在一个 `(concept, lifecycle, authority_kind, trust_domain)` 内只能各有一个。旧路径在 Phase 1/2 迁移完成前保持可读，但不得新增写口。

## 七个结构簇

| ID | 根因主题与证据 | 目标 owner / 单向边界 | 当前旧路径与阻断 | 优先级 |
|---|---|---|---|---|
| **P0-1** | 生成/生产双生命周期与身份断裂。`2026-08-30-generation-executor-lifecycle`、`2026-09-10-agent-draft-single-ledger`、`2026-09-18-agent-storyboard-single-ledger`、`2026-09-25-agent-run-node-state-single-owner`、`2026-09-25-canvas-generate-ignores-production-shot`、`2026-09-26-inflight-shot-reload-display`；审计 `docs/audit/2026-09-25-generation-canvas-ownership-review.md` | 付费/远程路径统一进入 `ProductionRun`、`ExecutionContractV1`、授权 envelope、submission outbox、provider observation、artifact materializer。只有明确的本地非付费操作才保留自己的 bounded context。 | `generationRunController → catalogTaskActions → runtime.runTask` 仍可直达 provider；还没有 durable commit/crash 注入和真实重开证据。TODO：T-AG-24 至 T-AG-30。 | V0 |
| **P0-2** | 语义、状态、投影多 owner。`2026-09-18-ownership-single-source`、`2026-09-25-task-center-state-owner`、`2026-09-26-generation-variant-single-owner`、`2026-09-26-storyboard-planned-first-frame-slot`、`2026-09-21-model-spec-parity`、`2026-09-07-generation-strategy-resolver-duplicate-judgements` | `variantResolution` 管变体，`compileParameters` 管参数准入，`productionShotPhase` 管制作镜头状态，`taskCenterProjection` 管任务分组，`referenceSlots/shot-row` 管分镜参考和 ready 判据。renderer 只消费派生事实。 | mode、parameter、状态标签和 readiness 仍有局部判断；`check:concept-owners` 尚未实现。 | V0 |
| **P0-3** | 分镜/计划/画布双账本。`2026-09-18-agent-storyboard-single-ledger`、`2026-09-10-storyboard-projection-receipt-composition`、`2026-09-20-run-storyboard-overrides`、`2026-09-20-production-reference-snapshot`、`2026-09-10-shot-table-async-write-ownership`、`2026-09-26-storyboard-planned-first-frame-slot` | `ProductionRun.generationPlan` 是 Agent durable intent；画布和分镜表是 projection。`storyboardDesignsByDocumentId` 只保留作者正文边界并执行现有退休目标（2026-10-16）；禁止新的 Agent 写入。外部 MCP storyboard 必须收敛为普通 local plan。 | 旧 ledger B 仍有消费者；Run override、reference snapshot 和表格 async write 需要迁移顺序。TODO：T-AG-22。 | V0 |
| **P0-4** | Provider/Model/Catalog/参数契约分叉。`2026-09-26-generation-variant-single-owner`、`2026-09-21-run-path-parameter-compilation`、`2026-09-22-parameter-admission-one-owner`、`2026-09-22-vendor-landing-one-owner`、`2026-08-30-flagship-provider-declaration-boundary`、`2026-08-29-anthropic-protocol-boundary`、`2026-09-18-provider-adapter-cluster-structural-review`、`2026-09-21-model-spec-parity` | Catalog declaration/validator → `compileExecutionContract/compileParameters` → provider adapter。UI 只能消费能力派生结果；新 provider 不得新增 renderer 规则。Pi framework 拥有 skill discovery/format，Nomi 只拥有 identity/language/orchestration。 | `mcpGenerationToolCatalog.ts` 仍手写五个外部 generation tools；mode/parameter parity 和 live provider 证据未闭合。 | V0 |
| **P0-5** | 身份、寿命、写入边界。审计 `docs/audit/2026-09-17-ownership-lifetime-census.md`；合同 `2026-09-17-background-run-project-identity`、`2026-09-19-core-task-identity`、`2026-09-17-asset-publication-identity`、`2026-09-22-spend-draft-owner`、`2026-09-10-shot-table-async-write-ownership`、`2026-09-03-windows-directory-fsync-barrier`、`2026-09-17-project-artifact-storage-and-projection` | 每条异步链携带 `ProjectBinding`/`RunBinding`/`operationId`；显式记录 state lifetime、write trigger、revision source。出价待决身份和画布缩放先作为有界例外，完成 owner 迁移后才关 pending。 | 进程内状态、renderer store 副本、provider instance 仍会被部分路径当成耐久身份；cold restart/storage/Windows 证据未齐。 | V0 |
| **P1-6** | Agent/MCP/审批/回执多入口。`2026-09-10-agent-draft-single-ledger`、`2026-09-08-agent-lane-single-shot`、`2026-09-08-agent-lane-receipt-authority`、`2026-09-14-agent-panel-action-receipts`、`2026-09-03-mcp-remaining-holes`、`2026-09-14-mcp-connection-truthfulness`、`2026-09-10-mcp-run-gate-receipt-fail-closed`、`2026-09-25-agent-run-node-state-single-owner` | verb declaration/transport → 一个 durable operation/approval gate → typed receipt；GUI、Agent、MCP 只保留信任包装和 UI 差异。 | internal lane registry 已共享；`laneModelRead` 已收编。剩余 `mcpGenerationToolCatalog.ts` 五个手写工具、审批分支和断连回执需 parity/negative tests。 | V1 |
| **P1-7** | 交付、测试、治理反馈回路。`2026-09-05-ci-doc-gates-friction`、`2026-09-18-e2e-job-fail-fast-serializes-findings`、`2026-09-22-advisory-check-still-blocked-via-annotation-hygiene`、`2026-09-08-agent-runtime-flakes`、`2026-09-23-release-candidate-browser-runtime`；审计 `docs/audit/2026-09-18-delivery-pipeline-structure.md` | 分离 static contract、unit、Electron/provider、cold restart/storage/Windows、cross-project 和真实素材证据；结构合同和真实旅程分别出收据。`check:concept-owners`、identity aliases、safe failure 进入治理门。 | terminal guarantee 规则有重复；CI base SHA、Windows tooling、retired version e2e、paid E2E 默认 skip 等仍是债。TODO：T-QA-15、17、18、19、20、24、25、33、34、35。 | V1 |

## 跨簇固定关系

- P0-1 的 `ProductionRun` 是执行事实 owner；P0-3 的 storyboard 是作者正文/计划 owner。两者通过 `operationId`、candidate revision 和执行合同连接，不能互相覆盖。
- P0-2 的派生判据必须在 P0-4 的执行合同之前完成；否则 UI 可能先显示一个 mode，provider 又按另一个 mode 编译。
- P0-5 的身份账本是 P0-1/P0-3 的先决条件。没有 `ProjectBinding + operationId + revision`，恢复和幂等只能靠猜。
- P1-6 的 receipt 只能记录 P0-1/P0-4 已确认的 canonical facts；receipt 不是第二个状态机。
- P1-7 的门岗验证结构事实和运行事实，不能用静态门替代 provider、Electron、冷重启或 Windows 证据。

## 施工卡最低字段

每个簇进入实现前必须有：`cluster_id`、`class_roots`、`concepts`、`lifecycle`、`authority_kind`、`trust_domain`、`decision_owner`、`write_owner`、`identity_fields`、`doors`、`legacy_paths`、`forbidden_derivations`、`red_test`、`changed_tests`、`real_evidence`、`rollback`、`due`、`blockers`。缺任一字段只能停在 Phase 0，不得进入生产 lane。
