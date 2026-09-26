# 架构方案质量清单与当前方案逐条审查

> 用途：判断一份架构方案是否足以指导真实迁移，而不是判断文档是否写得完整。
> 被审方案：`docs/plan/2026-09-26-architecture-single-owner-governance.md`
> 审查基线：`origin/main@1f39ea3cf`，审查日期：2026-09-26。
> 状态：✅ 方案质量审查定稿；Phase 0 账本已完成。
> 当前结论：**方案设计和 Phase 0 账本可施工；Phase 1 治理门、生产实施与真实旅程证据仍未产生。**

## 先查别人

| 问题 | 依据 | 本清单采用的判断 |
|---|---|---|
| 依赖里已有？ | `electron/productionRun/productionRunIntentLog.ts:1-260`、`electron/productionRun/submissionOutbox.ts:1-240`、[`docs/audit/2026-08-22-agent-runtime-source-review.md`](../audit/2026-08-22-agent-runtime-source-review.md) | 先复用现有 primitive，不把新框架当作结构修复 |
| 仓库里已有？ | [`docs/audit/2026-08-22-agent-runtime-source-review.md`](../audit/2026-08-22-agent-runtime-source-review.md)、[`docs/research/2026-09-18-storyboard-single-ledger/prior-art.md`](../research/2026-09-18-storyboard-single-ledger/prior-art.md)、`electron/capabilityCore/executionContract.ts:1-120` | owner、单账本、恢复和投影的检查项必须进入清单 |
| 生态里已有？ | Automerge（https://automerge.org/docs/concepts/）、IETF Idempotency-Key（https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/）、OpenTimelineIO（https://opentimelineio.readthedocs.io/）、Temporal（https://docs.temporal.io/workflows） | 采纳稳定身份、幂等、不可变执行规格、可重建投影；不引入外部运行时服务 |
| TikHub 自媒体怎么说？ | 本清单检查的是内部架构和真实故障边界，不是竞品内容；没有能增强这些结论的自媒体证据，本轮不查并保留理由 | 不把自媒体内容当作架构证据 |
| 结论 | 方案的 prior-art 资料和未查理由均已落档 | 方案必须有来源，也必须诚实记录不适用的来源面 |

## 判定方式

- **通过**：方案已经给出可证伪的决策、owner、证据和完成门。
- **部分通过**：方向正确，但缺少对象映射、边界、证据或回滚细节，不能直接开工。
- **不通过**：方案会引入新的结构风险，或无法安全迁移。
- **未证明**：不能从方案和现状证据推断，必须补调查或真实验证。

“有提到”不等于通过。每一项都要能回答：谁负责、事实存在哪、谁可以写、失败如何恢复、如何证明没有第二个口。

## 好的架构方案必须满足的标准

### 1. 从用户任务和真实摩擦开始

必须有具体用户任务、当前失败行为、可复现证据和完成后的可见变化。不能只从目录、框架或抽象概念出发。

### 2. 类根因已经去重

必须区分症状、直接原因和类根因，并证明多个 bug 是否真的属于同一结构问题。按目录或最近提交数量聚类只能作为线索，不能直接当成结构簇。

### 3. 有明确的 bounded context 和 owner

每个事实都要有 subject、lifecycle、authority kind、trust domain、唯一写 owner、允许消费者和禁止重新派生的规则。`write owner = 1` 不是全球单例：框架内核、应用租约、运行时谓词、持久化 owner 可以各自存在，但必须声明谁控制谁。`canonical facts` 只在 bounded context 内成立，跨 context 使用版本化事件、窄引用或 anti-corruption adapter。

### 4. 生命周期和状态转换是显式的

至少区分 author/desired、draft、frozen execution、provider observation、materialized artifact、projection。每个状态要有身份、可变性、TTL、转换条件、未知态和冲突处理。

### 5. 数据一致性可恢复

必须说明 command、event、snapshot、approval、budget、receipt、artifact 的原子关系；包括 CAS、幂等键、重放、崩溃恢复、repair 和未知提交。只写“持久化”不算。

### 6. 契约有单一来源且语义闭合

TS、Zod、JSON wire、持久化 schema、默认值、可选字段、unknown 处理和 strictness 必须同源或有双向守卫。MissingKeys 只能证明字段集合，不能证明 optional/default/unknown 的运行时语义。

### 7. 安全、信任和花费边界独立成立

必须区分 trusted host、untrusted envelope、actor、lease、credential、spend grant、submit-time recheck 和 destination/project binding。判定顺序固定为 `untrusted input → parse/normalize → canonical domain command/hash → policy+grant → auth/lease envelope`；不能先去掉 auth/lease 再比较原包。不能因为共享 command 就把权限一起共享。

### 8. 扩展路径真实可用

新增 provider/model/framework 时，要明确哪些内容由档案声明、哪些由适配器负责、哪些能力可以 `unsupported`，以及新增字段、版本、兼容和失败行为如何传播。不能只说“以后接入更容易”。

### 9. 迁移可以执行和回滚

必须有旧数据矩阵、schema/version/backfill、legacy read、single write、cutover、回滚、到期删除和损坏数据处理。禁止没有期限的双写和隐形 fallback。

### 10. 运行时可观察、可诊断

每条 command → contract → provider request → observation → artifact → projection 都要有可查询的 correlation ID、revision、source、observedAt、状态转换和错误类别。要能回答“界面显示和实际出站哪里不一致”。lineage 只能记录 ID/hash/revision/observedAt；prompt、reference URL、credential、provider raw response 必须走现有 redact/sanitizer 分级，不能把 canonical envelope 原样写日志。

### 11. 性能和容量有预算

必须说明 journal 增长、snapshot/compaction、projection rebuild、目录读取、节点数量、批量规模、provider 限流、磁盘占用和迁移耗时的预算与降级行为；还要覆盖同步盘/杀毒软件/Windows sharing violation、跨设备 stale lock、revision conflict 和 storage environment contract。

### 12. 验收覆盖结构和真实体验

需要静态结构检查、负向/变异测试、属性或对等测试、并发/重放/崩溃测试、真实 Electron、真实素材、真实 provider、冷重启、跨项目和跨平台旅程。mock 不能替代原始故障边界。

### 13. 用户价值可量化

至少有 2–3 条真实用户任务，以及重复生成、重复扣费、状态错误、恢复成功率、完成耗时或错误可恢复率等指标。架构健康指标不能替代用户结果。

### 14. 方案有明确的依赖和决策顺序

必须说明先做什么、为什么，哪些对象不能同时迁移，哪些是前置合同，谁拥有概念 lane，哪一步完成才允许下一步。

### 15. 方案有外部和内部反证

通用能力要有近邻开源/官方实现和反方证据；框架边界要有逐字段裁决；外部格式要有规范和偏差理由。不能仅凭记忆说“这是通用最佳实践”。

### 16. 完成标准和债务出口清楚

每个 residual risk 必须有 owner、证据、到期日和阻断规则。现状文档、owner registry、结构门岗、真实旅程和交付状态必须同步更新。

## 对当前方案的逐条审查

| # | 检查项 | 当前状态 | 结论与缺口 |
|---:|---|---|---|
| 1 | 用户任务与真实摩擦 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已写入三条闭环任务、可见行为和重复提交/恢复/投影延迟门；真实 Electron/provider 仍需 Phase 2 验证。 |
| 2 | 类根因去重 | DESIGN_PASS | Phase 0 已完成 `class_root` 去重、粗聚类误报规则、反例和 shared boundary 账本；实现仍待验。 |
| 3 | bounded context / owner | DESIGN_PASS / IMPLEMENTATION_PENDING | 已按 subject/lifecycle/authority_kind/trust_domain 定义 owner，补充跨 context 的事件/窄引用/adapter 边界。 |
| 4 | 生命周期模型 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已冻结 PlanCandidate、ExecutionContractV1、授权 envelope、ProductionRun、provider observation、artifact、projection 的映射、身份、未知态和禁止事项。 |
| 5 | 数据一致性与恢复 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已选定 Run journal + intent log + 可重建副本协议，补 commitId、恢复矩阵和 crash-injection 门；代码尚未落地。 |
| 6 | 契约闭合 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已规定 canonical compiler、optional/default/unknown/strictness、双向守卫、入口 parity 顺序和 mutation test；尚未生成门岗。 |
| 7 | 安全、信任、花费 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已明确 typed trust、ProjectBinding、grant/envelope、destination guard、submit-time recheck 和 hash 锚点；需真实授权/出站验证。 |
| 8 | 扩展性 | DESIGN_PASS / IMPLEMENTATION_PENDING | provider/model 只接入既有候选合同与 adapter，unsupported 显式传播；禁止新 `GenerationIntent` owner，版本升级显式迁移。 |
| 9 | 迁移与回滚 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已补旧 draft/contract/envelope/Run/canvas/legacy MCP/storage 的 single-write、compatibility、回滚和损坏矩阵。 |
| 10 | 可观察性 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已定义 command→contract→provider→observation→artifact→projection lineage、指标、repair audit 和 redaction；需运行时收据。 |
| 11 | 性能与容量 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已给出 commit/replay/projection/compaction/批量和 storage-environment 初始预算；需真实项目和真实 provider 测量。 |
| 12 | 结构与真实验收 | 部分通过 | 方案已覆盖静态、负向/变异、CAS/concurrency、crash/replay、真实 Electron、素材、provider、冷重启和平台边界；所有实现证据仍未跑。 |
| 13 | 用户价值量化 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已把三条用户任务绑定重复提交、跨项目写入、恢复路径和投影延迟等指标；真实用户任务尚未执行。 |
| 14 | 依赖和顺序 | 通过 | Phase -1 → Phase 0 → durable commit/gates → 一条 vertical pilot → A/B/C 扩展，且明确不新增第三套合同。 |
| 15 | 外部/内部反证 | 通过（已有证据） | 已接入仓库已有 storyboard ledger、provider integration、agent runtime、Automerge/Idempotency-Key/OpenTimelineIO/Temporal 对照资料；不因 prior art 新造框架。 |
| 16 | 完成标准与债务出口 | DESIGN_PASS / IMPLEMENTATION_PENDING | 已规定 owner、evidence、due/阻断规则、ARCHITECTURE-NOW、registry、结构门岗、真实旅程和最终收据；落地后才可把条目记为 resolved。 |

## 当前方案的放行结论

当前方案已经可以作为**施工蓝图**，但不能把它误报成**生产迁移已完成**。定稿和 Phase 0 解决的是“要建成什么、按什么顺序建、如何证明不再长出第二个 owner”；代码实施、门岗和真实旅程从 Phase 1 准入开始。

Phase 0 已完成以下五项账本工作：

1. 四态生命周期对象图与现有合同映射已进入 Phase -1 审计包和逐合同账本。
2. `ExecutionContractV1`、授权 envelope、Run journal 已冻结为候选基础，禁止新增第三套合同。
3. Run command/approval/budget/event/snapshot/artifact 的 durable commit 和 crash recovery 已写入 Phase 1 准入卡，代码尚未落地。
4. 旧数据、schema 版本、backfill、cutover、rollback 和损坏数据处理已列入七簇施工卡。
5. lineage、权限/信任、性能预算和用户任务指标已进入清单与真实验收门。

进入生产代码前，仍必须满足 Phase 1 准入：`check:concept-owners`、commit marker/crash injection、真实 Electron/provider、冷重启/Windows 证据，以及每张施工卡的 red test、门表、旧路径删除点和回滚收据。

现有 `productionRunIntentLog.ts`、`submissionOutbox.ts` 和 artifact replay 机制必须优先复用；不得因为“需要统一事务”而另造一套持久化框架。

完成这五项后，A/B/C 三条纵向主线才具备开工条件。若跳过它们直接写实现，会把当前的“一个事两个口”变成“一个事三个合同、四种状态、五个投影”。

## 每次架构评审的固定输出

每份架构方案都要留下：

- 问题簇去重结果和反例；
- bounded context / subject / owner / authority kind 表；
- 生命周期与身份转换图；
- command/event/snapshot/side-ledger 原子关系；
- schema、权限、provider、版本和迁移矩阵；
- 性能、可观测性、运维预算；
- 结构门岗、负向/变异、真实用户任务和平台验证矩阵；
- rollback、residual risk、owner、due date 和完成状态。
