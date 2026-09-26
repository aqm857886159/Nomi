# Phase 0 七簇施工卡

> 状态：✅ 七张施工卡完成；生产 writer 尚未切换
> 基线：`origin/main@1f39ea3cf` · 日期：2026-09-26
> 全量合同映射：[`phase-zero-contract-cluster-map.json`](2026-09-26-phase-zero-contract-cluster-map.json)

这些卡把结构簇索引中的摘要展开成下一阶段可以直接派工的边界。卡里的 owner 是目标 owner；“当前旧路径”明确保留到切换门通过为止。每张卡必须与逐合同映射、根因合同门表和真实收据一起收货。

## P0-1：生成/生产双生命周期与身份断裂

| 字段 | 内容 |
|---|---|
| `cluster_id` / `class_roots` | P0-1；见映射文件中 `cluster_id=P0-1` 的 209 份合同，代表生成执行、付费、提交未知、Run 节点和产物物化类根因 |
| `concepts` | 生成执行、花费授权、提交观察、ProductionRun、产物物化、重试身份 |
| `lifecycle` | frozen execution → spend authority → execution → provider observation → materialized artifact → projection |
| `authority_kind` / `trust_domain` | durable state machine + provider boundary；trusted main process / untrusted renderer-Agent-MCP envelope / external provider |
| `decision_owner` | `electron/capabilityCore/executionContract.ts#compileExecutionContract`、`electron/productionRun/productionRunReducer.ts` |
| `write_owner` | `electron/productionRun/productionRunRepository.ts#execute` 与现有 intent log/outbox；provider 只写 observation |
| `identity_fields` | `projectId + runId + operationId + candidateRevision + contractHash + jobId + attempt + providerTaskId?` |
| `doors` | `generationRunController`、`catalogTaskActions`、`runtime.runTask`、`productionRunRepository.execute`、`submissionOutbox`、`generationOutputMaterializer`；每个符号切换前必须重跑 `node scripts/door-map.mjs` |
| `persistence` | Run journal、intent log、submission outbox、approval/budget side-ledger、artifact record |
| `allowed_consumers` | canvas/task/Agent/MCP read projections、reconcile service、artifact exporter |
| `forbidden_derivations` | renderer 不推断收费状态；provider 请求返回不等于 accepted；unknown 不得自动变 failed 或重提 |
| `legacy_paths` | `generationRunController → catalogTaskActions → runtime.runTask/submissionLedger` 直提交 provider |
| `red_test` | duplicate charge、ECONNRESET 后 `submission_unknown`、multi-shot paid scope、grantable duplicate、Run task badge、failure lookup identity、generate-all Agent shot filter（T-AG-24 至 T-AG-30） |
| `changed_tests` | `productionRun` reducer/repository/outbox/replay、authorization parity、artifact materializer、真实 provider contract |
| `real_evidence` | 真实 Electron 付费旅程、真实 provider receipt、冷重启/重开、crash injection、Windows storage |
| `rollback` | writer 切换前回到现有 journal/outbox 读取；已提交 provider 请求和已授予花费不回滚、不重放 |
| `due` / `blockers` | Phase 2 pilot 前；durable commit marker、crash recovery、真实 provider 和 Windows 证据未齐前 BLOCKED |

## P0-2：语义/状态/投影多 owner

| 字段 | 内容 |
|---|---|
| `cluster_id` / `class_roots` | P0-2；映射中 6 份直接命中状态、投影、owner、readiness 类根因；其余同类合同以共享 boundary 关联 |
| `concepts` | variant、parameter admission、production shot phase、task grouping、reference readiness、状态词表 |
| `lifecycle` | domain decision → canonical fact → read projection |
| `authority_kind` / `trust_domain` | semantic rule + projection；main/shared domain → renderer read-only |
| `decision_owner` | `variantResolution`、`compileParameters`、`productionShotPhase#deriveProductionShotState`、`taskCenterProjection`、reference slot/shot-row readiness |
| `write_owner` | 对应 shared predicate/command；projection store 只写重建结果，不写领域事实 |
| `identity_fields` | `projectId + operationId/runId + sourceRevision + shotId/nodeId` |
| `doors` | `resolveArchetypeVariant`、`compileParameters`、`deriveProductionShotState`、`summarizeTaskCenterRows`、`missingRequiredSlotsOf`、`assignEdgeToSlot` |
| `persistence` | catalog/ExecutionContract、Run snapshot、storyboard facts；投影带 source revision |
| `allowed_consumers` | canvas、shot table、task center、Agent card 的只读投影 |
| `forbidden_derivations` | UI 不按 raw status/flag 重分组、不自行判缺依赖、不从 model id 猜 variant |
| `legacy_paths` | renderer/local store 的 variant、mode、task status、reference readiness 二次判断 |
| `red_test` | variant parity、parameter parity、task-center state owner、planned first-frame slot、model spec parity |
| `changed_tests` | shared predicate unit + parity + mutation tests；所有入口 canonical command 对等 |
| `real_evidence` | 同一输入从 GUI/Agent/MCP/恢复路径得到同一 canonical facts 和出站参数 |
| `rollback` | 保留只读 projection adapter；移除第二 decision function 后若失败回滚 adapter，不恢复旧 writer |
| `due` / `blockers` | Phase 1 governance gate；`check:concept-owners`（T-QA-24）未实现 |

## P0-3：分镜/计划/画布双账本

| 字段 | 内容 |
|---|---|
| `cluster_id` / `class_roots` | P0-3；映射中 72 份命中 storyboard/shot/plan/ledger/projection 类证据 |
| `concepts` | storyboard authoring、generationPlan、reference snapshot、first-frame slot、canvas/table projection |
| `lifecycle` | author/desired → sealed plan → Run execution reference → canvas/table projection |
| `authority_kind` / `trust_domain` | author document + execution plan；renderer/Agent/MCP adapters → main durable owner |
| `decision_owner` | 作者正文 `storyboardDesignsByDocumentId`；执行意图 `ProductionRun.generationPlan`；参考槽 `referenceSlots/shot-row` |
| `write_owner` | `setStoryboardPlan`/窄 RPC 与 Run command；禁止 Agent 新写 ledger B |
| `identity_fields` | `projectId + documentId + storyboardRevision + operationId + shotId + sourceRevision` |
| `doors` | storyboard editor/table write、`setStoryboardPlan`、Run plan patch、canvas projection、MCP storyboard adapter、reference snapshot |
| `persistence` | storyboard document store；Run journal 保存 execution reference/snapshot/receipt，不保存作者正文第二份 |
| `allowed_consumers` | storyboard table、canvas nodes、Agent/MCP read projections、timeline adoption bridge |
| `forbidden_derivations` | 画布和表格不得各自重算 readiness/reference；MCP 不得创建“外部输出”第二个家 |
| `legacy_paths` | `storyboardDesignsByDocumentId` 的 Agent 写入、Run override 作为正文、table async write 的旁路、外部 MCP storyboard 独立 ledger |
| `red_test` | Run projection parity、first-frame slot、external MCP convergence、async write ownership、reference snapshot freshness |
| `changed_tests` | storyboard schema/type parity、set plan command、projection replay、one-row-one-shot real table flow |
| `real_evidence` | 真实分镜表编辑→生成→画布/任务投影；关闭重开后同一 operationId；MCP 与 local plan 对等 |
| `rollback` | legacy read adapter 可保留；禁止恢复旧 Agent writer；文档正文损坏进入 repair，而不是双写补偿 |
| `due` / `blockers` | ledger B 退休目标 2026-10-16；消费者迁移和 Run projection parity 未完成前 BLOCKED |

## P0-4：Provider/Model/Catalog/参数契约分叉

| 字段 | 内容 |
|---|---|
| `cluster_id` / `class_roots` | P0-4；映射中 215 份命中 provider/model/catalog/parameter/adapter/mode/variant 类证据 |
| `concepts` | capability declaration、model/vendor landing、mode、variant、parameter admission、auth/protocol、provider adapter |
| `lifecycle` | catalog declaration → validation → execution contract compilation → provider request → observation |
| `authority_kind` / `trust_domain` | capability/value object + external adapter；catalog/main trusted → provider external |
| `decision_owner` | catalog declaration/validator、`compileExecutionContract`、`compileParameters`、`compareVendorLanding`、`variantResolution` |
| `write_owner` | catalog/contract compiler；UI 只能保存用户选择，不保存推导后的能力判据 |
| `identity_fields` | `modelKey + vendor + modeId + variantId + contractHash + providerTaskId?` |
| `doors` | catalog bootstrap、model admission、generation plan patch、MCP generation tools、provider mapping/dispatch、asset ingestion |
| `persistence` | catalog declaration、ExecutionContract、provider integration/session evidence |
| `allowed_consumers` | model picker、Agent tool face、ExecutionContract compiler、provider adapter |
| `forbidden_derivations` | 新 provider 不新增 renderer 规则；unsupported 不用 undefined；同一字段不在 TS/Zod/JSON 各自默认 |
| `legacy_paths` | `mcpGenerationToolCatalog.ts` 手写五个外部工具、provider-specific UI mode/parameter 判据、重复 mapping schema |
| `red_test` | mode/variant/parameter parity、authScheme/modelVendor parity、framework surface、external five-tool registry decision |
| `changed_tests` | catalog declaration tests、schema/type parity、provider outbound contract、model face frozen |
| `real_evidence` | 至少一个真实 provider 的 catalog→compile→outbound→receipt；unsupported/unknown/credential 失败路径 |
| `rollback` | 版本化 catalog/contract read adapter；不恢复 renderer 的旧 default/infer 逻辑；provider request 只接受旧合同兼容版本 |
| `due` / `blockers` | Phase 1 gate；live provider、工具 registry 收编和 mode/parameter parity 未闭合 |

## P0-5：身份、寿命、写入边界

| 字段 | 内容 |
|---|---|
| `cluster_id` / `class_roots` | P0-5；映射中 26 份直接命中 identity/lifetime/storage/project binding/write boundary 类证据，另外关联 Phase -1 ownership-lifetime census |
| `concepts` | ProjectBinding、RunBinding、operationId、state lifetime、write trigger、asset publication identity、canvas zoom、pending spend identity |
| `lifecycle` | process/session/project/run/operation/artifact/viewport preference 各自显式分层 |
| `authority_kind` / `trust_domain` | durable identity + storage contract；main process/storage trusted，renderer input untrusted |
| `decision_owner` | `ProductionPlan.operationId`/Run identity；React Flow transform live zoom；store category viewport 仅偏好 |
| `write_owner` | Run repository/plan command；viewport persistence adapter；pending spend owner promotion 后才允许 durable writer |
| `identity_fields` | `projectId + documentId + runId + operationId + revision + artifactId`；zoom 用 viewport/category key，不冒充 operation identity |
| `doors` | background run IPC、project open/reopen、asset publication, shot-table async write、viewport readers/writers、fsync/storage barrier |
| `persistence` | project metadata、Run journal、artifact store、category viewport preference |
| `allowed_consumers` | explicit binding readers、reconcile/replay、read projections；既有 pending consumers按例外表允许读取 |
| `forbidden_derivations` | await 后从当前页面/provider instance 猜身份；把 quoteId 当 operationId；把 persisted zoom 当 live transform |
| `legacy_paths` | direct canvas nodeId+quoteId spend path、五个 canvas store zoom readers、ambient UI identity、进程内 provider cache |
| `red_test` | cross-project write rejection、cold restart identity、pending spend key、canvas live zoom vs preference、storage fsync/barrier |
| `changed_tests` | binding contract、reopen/replay、Windows storage, canvas zoom performance and provider identity tests |
| `real_evidence` | close/reopen/switch project/cross-host; Windows sharing violation; real canvas zoom interaction; spend card resumes same operation |
| `rollback` | retain explicit legacy read adapter and preference migration; never add a second durable identity writer |
| `due` / `blockers` | Phase 1 admission；canvas zoom readers、pending spend owner、cold restart/storage/Windows 证据未齐 |

## P1-6：Agent/MCP/审批/回执多入口

| 字段 | 内容 |
|---|---|
| `cluster_id` / `class_roots` | P1-6；映射中 44 份命中 agent/MCP/approval/receipt/tool/lane/harness 类证据 |
| `concepts` | verb declaration、transport projection、approval gate、durable operation、typed receipt、skill loading |
| `lifecycle` | verb declaration → transport envelope → approval/policy → durable operation → typed receipt → read projection |
| `authority_kind` / `trust_domain` | command/receipt + trust wrapper；GUI/Agent/MCP 不同信任域，领域 owner 统一 |
| `decision_owner` | `verbDeclarations`/model-facing registry、`laneApprovalGate`、ProductionRun gate/receipt |
| `write_owner` | domain command handler + Run repository；lane/MCP 只提交，不写事实 |
| `identity_fields` | `projectId + operationId/commandId + runId + expectedRevision + receiptId` |
| `doors` | lane tool catalog、MCP tool catalog、approval before_tool、capability apply handler、receipt projection |
| `persistence` | Run journal/receipt store；skill files由 pi framework discovery 管理，Nomi只记录 identity/orchestration |
| `allowed_consumers` | Agent panel、MCP result、GUI cards、audit/log projection |
| `forbidden_derivations` | 入口各自改 schema/permission/status；receipt 成为第二状态机；Agent 面板替 main process 判 approval |
| `legacy_paths` | `mcpGenerationToolCatalog.ts` 五个手写工具；旧 Agent/MCP approval branches；renderer action receipt patch paths |
| `red_test` | internal/external tool-face parity、approval fail-closed、disconnect receipt、operation idempotency、skill format surface |
| `changed_tests` | registry projection, tools/list, before_tool, receipt/replay, MCP handshake and negative tests |
| `real_evidence` | 真实 stdio MCP、真实 Agent lane、审批拒绝/断连/重试/收据回放；无凭据时明确 blocked |
| `rollback` | retain transport adapter only; rollback to command/receipt version, never add a parallel domain write path |
| `due` / `blockers` | Phase 1 governance gate；T-QA-24、外部五工具 registry 和真实 MCP receipts 未闭合 |

## P1-7：交付/测试/治理反馈回路

| 字段 | 内容 |
|---|---|
| `cluster_id` / `class_roots` | P1-7；映射中 31 份命中 CI/E2E/release/test/gate/validation 类证据 |
| `concepts` | validation scope、contract gate、unit/Electron/provider evidence、real media、cold restart、Windows tooling、delivery receipt |
| `lifecycle` | change classification → risk-matched gates → evidence receipt → PR/merge SHA → merged verification |
| `authority_kind` / `trust_domain` | delivery policy + evidence receipt；CI/local/real device evidence separately trusted |
| `decision_owner` | `scripts/validation-policy.mjs`、contract gates、delivery preflight/verify-merged、real journey owners |
| `write_owner` | validation receipt and docs ledger; production evidence writers remain their respective test harnesses |
| `identity_fields` | `baseSha + headSha + tree + mergeSha + journeyId + fixture/media/provider/platform` |
| `doors` | `gates`, contracts, unit, Electron/provider, cold restart, Windows, real-media, `review:branch`, `delivery:verify-merged` |
| `persistence` | CI artifacts, Ponytail receipt, delivery ledger, evidence directories |
| `allowed_consumers` | PR review, merge train, release acceptance, architecture ledger |
| `forbidden_derivations` | local green = merged proof; skipped = pass; deferred review = completed review; docs baseline warnings = new fix |
| `legacy_paths` | duplicated terminal guarantee tests, coarse symptom-cluster module, stale CI base SHA, Windows tooling and paid E2E default skip debts |
| `red_test` | T-QA-15/17/18/19/20/24/25/33/34/35; contract/door-map/concept-owner/merged-SHA gates |
| `changed_tests` | validation policy tests, delivery ledger tests, real media checks, platform harness and CI workflow checks |
| `real_evidence` | exact merged SHA receipt, real Electron/provider, real media, cold restart, Windows and cross-project journey evidence |
| `rollback` | revert documentation/gate change to previous policy while preserving evidence; never erase failed receipts or raise baselines |
| `due` / `blockers` | before each Phase 1/2 cutover；existing docs-index/doc-status baseline failures remain separately tracked |

## 收货规则

七张卡齐全只代表“可以按卡派工”。实际实现收货仍要满足：旧 writer 删除、门表由 `door-map` 生成、red test 先红后绿、跨入口 canonical parity、真实证据和 merged-SHA 收据。任何卡的 `real_evidence` 未完成，都不能把对应簇标为 `resolved`。
