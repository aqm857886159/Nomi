# Phase 0：全仓架构账本与迁移准入

> 状态：✅ 已完成（Phase 0 ledger package）
> 迁移准入：🚫 BLOCKED，直到 Phase 1 治理门与 durable commit 条件满足
> 基线：`origin/main@1f39ea3cf` · 日期：2026-09-26

## 这阶段完成了什么

Phase 0 把“一个事两个口”的发现结果从零散合同、审计和 TODO，整理成可以派工和验收的全仓结构账本：历史合同怎么处理、哪些合同属于同一结构簇、每个概念谁负责、入口和决策门如何区分、下一阶段的依赖顺序和放行条件都已固定。

这阶段没有改生产代码，没有切换任何 writer，没有新增状态机、全局 store 或第三套生成意图对象。它完成的是架构施工前必须存在的事实层和准入层。

## 先查别人

| 问题 | 已查证据 | 结论 |
|---|---|---|
| 依赖里已有？ | `electron/productionRun/productionRunIntentLog.ts:1-260`、`electron/productionRun/submissionOutbox.ts:1-240`、`electron/capabilityCore/executionContract.ts:1-120` | 复用现有 intent log、outbox、执行合同和授权 envelope；不新造 EventStore 或第三套 intent。 |
| 仓库里已有？ | `docs/ARCHITECTURE-NOW.md:1-12`、`docs/engineering/concept-owners.json:1-8`、`docs/audit/2026-09-26-phase-minus-one-entrance-matrix.md:1-40`、`docs/fixes/` 606 份合同 | 真实 owner、生命周期、入口和旧路径已在本仓；本阶段做账本与聚类，不凭目录猜架构。 |
| 生态里已有？ | [Automerge concepts](https://automerge.org/docs/concepts/)、[IETF Idempotency-Key](https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/)、[OpenTimelineIO](https://opentimelineio.readthedocs.io/)、[Temporal Workflows](https://docs.temporal.io/workflows) | 采纳稳定身份、幂等命令、可重建 projection 和 replay 思路；不引入对应外部运行时。 |
| TikHub 自媒体里怎么说？ | 本阶段处理的是仓库内部契约、持久化和恢复架构，外部自媒体无法提供比源码、协议和真实故障证据更强的依据 | 不用内容观点替代代码和运行证据。 |
| 结论 | 证据已进入本方案引用的契约卫生、结构簇和依赖闸门文档 | 用已有 owner + 单向 adapter；先完成 ledger，再进入生产迁移。 |

## 交付物

- [契约卫生账本](../audit/2026-09-26-phase-zero-contract-hygiene.md)：606 份合同的版本、字段、证据和历史例外处理。
- [逐合同结构映射](../audit/2026-09-26-phase-zero-contract-cluster-map.json) 与 [契约例外账](../audit/2026-09-26-phase-zero-contract-exceptions.json)：606 条映射、字段缺口、历史版本和责任人/到期日。
- [结构簇索引](../audit/2026-09-26-phase-zero-cluster-index.md)：七个真实结构簇、目标 owner、旧路径、阻断和跨簇依赖。
- [七簇施工卡](../audit/2026-09-26-phase-zero-construction-cards.md)：每簇的生命周期、owner、身份、门、旧路径、红测、真实证据、回滚和 blocker。
- [依赖与迁移闸门](../audit/2026-09-26-phase-zero-dependency-gates.md)：施工默认值、G0-G8 DAG、Phase 1 准入条件和禁止捷径。
- [Phase -1 生命周期账本](2026-09-26-phase-minus-one-lifecycle-ledger.md)：对象、身份、提交、恢复的只读基线。
- [方案质量清单](2026-09-26-architecture-solution-quality-checklist.md)：架构方案的 16 项审查标准。

## 七个施工簇

| 簇 | 先解决的结构问题 | 第一条决策 |
|---|---|---|
| P0-1 | 生成与 ProductionRun 双生命周期、重复扣费、未知提交 | 付费/远程统一走 ProductionRun |
| P0-2 | 状态、语义、projection 多处重新判断 | 派生判据回到 variant/parameter/phase/task owner |
| P0-3 | 分镜正文、计划、画布双账本 | Agent durable intent 只留 Run projection，旧 ledger B 停止新增写入 |
| P0-4 | provider/model/catalog/parameter 分叉 | declaration → compiler → adapter，UI 只读能力 |
| P0-5 | 身份、生命周期、写入触发不完整 | 所有异步链携带 ProjectBinding/RunBinding/operationId |
| P1-6 | Agent/MCP/审批/回执多入口 | 一个 durable operation、一个审批门、typed receipt |
| P1-7 | 交付与真实证据反馈回路粗糙 | 静态、单测、Electron/provider、重启、Windows、真实素材分开收据 |

## 已冻结的 owner 决策

- 生成合同沿用 `PlanCandidate → ExecutionContractV1 → ProductionGenerationAuthorizationEnvelopeV1`，不新增 `GenerationIntent`。
- 作者正文和执行 Run 分开；Run 保存引用、快照和 receipt，不成为 storyboard 正文的第二个家。
- durable spend identity 是 `projectId + operationId`；`quoteId` 只表示报价/版本指纹。直接画布 `nodeId + quoteId` 记录为另一个 bounded context，迁移前不新增消费者。
- live canvas zoom 由 React Flow transform 提供；store 中的 category viewport 是持久化偏好，五个直接读取者列入迁移卡。
- terminal guarantee 共享规则代数，但 Run/session 继续拥有各自生命周期。
- pi 拥有 skill discovery/format；Nomi 拥有 identity/language/orchestration。laneModelRead 已从已知例外中关闭；外部五个 generation tools 仍在 `mcpGenerationToolCatalog.ts` 例外账本中。

## 完成收据

| 收据 | 结果 |
|---|---|
| 基线 | `origin/main@1f39ea3cf`，工作树从干净状态开始 |
| 合同盘点 | 606 份；591 个唯一 `class_root`；历史 v1/v2 不改写 |
| 概念 owner | registry 当前 38 个概念；“出价/待决身份”“画布缩放”保留有界 pending |
| 入口账本 | door map 与 decision gate 分开；不以门数推断 owner 数 |
| 结构聚类 | P0-1 至 P1-7 七簇，保存 class_root/shared boundary/entry/door evidence；16 条合同显式标记人工复核 |
| 反方审查 | 已纳入对象映射、生命周期拆分、入口语义对等和 commit/replay 要求 |
| 生产代码 | 未修改；未切换 writer；未新增长期双写 |

## 下一步

Phase 1 只做治理门、schema/owner parity、lifecycle identity 和 durable commit/replay 的最小落地，并先写能让旧路径变红的 red tests。Phase 1 完成前，任何新生成入口、付费执行入口或新的 Agent/MCP 写入都不能绕过本账本。第一条 vertical pilot 推荐沿 direct canvas paid → ProductionRun seam 验证重复扣费、未知提交、重开和产物投影；真实 provider、Electron、冷重启、存储环境和 Windows 证据必须单独出收据。
