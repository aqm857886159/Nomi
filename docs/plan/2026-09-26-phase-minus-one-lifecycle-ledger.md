# Phase -1：真实对象与生命周期账本执行计划

> 状态：✅ 已交付（审计账本与收据完成）；迁移放行：**PARTIAL/BLOCKED**（生产迁移尚未开始）
> 上位方案：[全仓架构治理定稿](2026-09-26-architecture-single-owner-governance.md)
> 审计基线：`origin/main@1f39ea3cf`（已纳入制作镜头重开修复、Windows 付费走查 harness 和素材物化边界修复）；当前交付工作树没有生产代码改动。
> 本阶段性质：只读代码审计 + 账本 + 对账/崩溃探针；不做生产行为迁移，不新增统一框架。

## 先查别人

| 问题 | 证据 | 结论 |
|---|---|---|
| 依赖里已有？ | `electron/productionRun/productionRunIntentLog.ts:1-260`、`electron/productionRun/submissionOutbox.ts:1-240` | 复用现有 intent/outbox/replay，不新造持久化框架 |
| 仓库里已有？ | `electron/capabilityCore/executionContract.ts:1-120`、`electron/productionRun/productionRunRepository.ts:450-640`、[`docs/audit/2026-08-22-agent-runtime-source-review.md`](../audit/2026-08-22-agent-runtime-source-review.md) | 先盘点已有 owner 和恢复路径，再决定迁移 |
| 生态里已有？ | Automerge（https://automerge.org/docs/concepts/）、IETF Idempotency-Key（https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/）、Temporal replay（https://docs.temporal.io/workflows） | 采用稳定身份、幂等和可重放原则；不引入外部运行时服务 |
| TikHub 自媒体怎么说？ | 这是内部代码、持久化和故障恢复审计，不是竞品或内容策略；本轮没有比源码、协议和故障探针更强的自媒体证据 | 不查，并记录理由，不把缺查伪装成结论 |
| 结论 | 现有代码锚点和已审查 prior art 足够指导 Phase -1 | 先实扫、再定 owner、最后开工 |

## 这一步要解决什么

先把真实代码里的“一个事情经过了哪些对象”画出来，再决定哪些对象应该合并、哪些对象必须保留为不同生命周期。

本阶段先追一条完整链路：

```text
分镜行 / 画布入口
  → PlanCandidate / GenerationOperation
  → ExecutionContractV1
  → ProductionGenerationAuthorizationEnvelopeV1
  → ProductionRun / ProductionJob
  → submission outbox / provider observation
  → materialize / artifact.add
  → canvas / task center / Agent / MCP projection
```

选择这条链路是因为它同时覆盖作者意图、执行合同、花费授权、异步供应商、持久化恢复和多界面投影，也是当前“一个事两个口”最容易造成重复生成和重复扣费的路径。TODO 中的 `T-AG-24` 是本阶段的产品风险锚点，但本阶段先做事实审计，不直接修该条行为。

## 第一轮实扫已经确认的结构分裂

当前确实存在两条真实的付费执行生命周期，不能把它们都假设成 `ProductionRun`：

```text
语义/分镜链：PlanCandidate
  → ExecutionContractV1
  → AuthorizationEnvelope
  → ProductionRun / ProductionJob
  → provider observation
  → artifact
  → canvas/task projection

画布直生成链：GenerationCanvas node
  → generationRunController
  → catalogTaskActions
  → runtime.runTask / submissionLedger
  → canvas result/progress
```

已确认的代码锚点：

- 语义链的 durable draft owner 是 `electron/productionRun/productionRunRepository.ts:createGenerationDraft`；`electron/productionRun/productionGenerationOperationStore.ts` 是它的 MCP/operation 适配器，不是第二个草稿存储。
- 合同编译和 hash 在 `electron/capabilityCore/executionContract.ts:compileExecutionContract`；封存和授权在 `productionRunReducer.ts`、`prepareProductionGenerationAuthorization.ts` 与 `productionGenerationAuthorization.ts`。
- 语义提交、未知态和物化由 `productionGenerationSubmission.ts`、`submissionOutbox.ts`、`productionRunRuntimeEnvelope.ts`、`generationOutputMaterializer.ts` 共同完成。
- 画布直生成入口在 `src/workbench/generationCanvas/runner/generationRunController.ts`、`src/workbench/generationCanvas/.../catalogTaskActions.ts`，经 `electron/tasks/taskIpcHandlers.ts` 和 `electron/submissionLedger.ts` 调用 `runTask`；它有自己的 node `run.id`、幂等键、队列、进度和 provider 结果，但不会创建 `ProductionRun`、授权 envelope 或 `ProductionJob`。
- `generationSingleShot.ts` 还存在一个通用 submit/poll facade，必须在入口矩阵中确认是否仍有生产调用者；`plan.attach` 也可能独立追加 job，需区分 storyboard 绑定和真正的 provider 提交。

因此 Phase -1 的第一个裁定不是“马上把画布直生成搬进 Run”，而是先回答：画布直生成是有意的独立 bounded context，还是历史遗留的第二个付费执行 owner。无论最后选哪一条，必须先把它登记为明确的 owner 边界或迁移目标，不能继续让两条链路共享模糊的“生成完成”语义。

## 不在本阶段做的事

- 不新增 `GenerationIntent`、EventStore、Operation DB 或全局 store。
- 不改 renderer、provider、Run reducer 的生产行为。
- 不做长期双写、隐式 fallback 或“先接一套新状态再慢慢删旧状态”。
- 不把 `author/desired`、`frozen execution`、`provider observation`、`materialized artifact` 压成一个状态枚举。
- 不用 mock 结果证明 provider、磁盘、冷重启或跨项目恢复已经成立。

## 工作包与产物

### 1. 固定审计范围与入口矩阵

先列出这条链路的所有入口，不按目录猜：

| 面 | 首批代码锚点 | 要记录的入口 |
|---|---|---|
| 作者草稿 | `electron/capabilityCore/executionContract.ts`、`generationOperationTypes.ts`、`generationPlanPatch.ts`、`electron/productionRun/productionGenerationOperationStore.ts` | create/read/patch/present/seal/withdraw/revise |
| 执行合同 | `compileExecutionContract` 及其调用者 | candidate normalize、mode/variant、参数、reference、contractHash |
| 花费授权 | `electron/productionRun/productionGenerationAuthorization.ts`、`prepareProductionGenerationAuthorization.ts` | gate、digest、grant、expiresAt、submit-time recheck |
| Run 与账本 | `productionRunRepository.ts`、`productionRunReducer.ts`、`productionRunTypes.ts` | command、CAS、event、approval、budget、snapshot、artifact |
| provider 出站 | `submissionOutbox.ts`、`productionGenerationSubmission.ts`、provider adapter | intent claim、idempotency、unknown、reconcile、poll |
| 物化产物 | `generationOutputMaterializer.ts`、`productionRunDriverOps.ts` | receipt、文件落盘、contentHash、`artifact.add`、adopt |
| 投影 | `productionRunService.ts`、`productionRunProjections.ts`、`canvasLandingHost.ts`、`multiShotCanvasLanding.ts`、`src/workbench/taskCenter/*` | read model、source revision、投影延迟、是否二次判定 |
| 直画布执行 | `src/workbench/generationCanvas/runner/generationRunController.ts`、`catalogTaskActions.ts`、`electron/tasks/taskIpcHandlers.ts`、`electron/submissionLedger.ts` | node run、幂等键、provider task、进度/result；确认是否与 ProductionRun 共享花费和恢复规则 |

产物：`phase-minus-one-entrance-matrix.md`，每个入口包含文件、符号、调用者、输入、输出、身份字段、写权限和是否能绕过 shared handler。

### 2. 建立生命周期对象表

对每个对象填同一张表，不允许只写概念名：

| 字段 | 必填内容 |
|---|---|
| `subject` | 它描述的是哪一个用户/系统事实 |
| `lifecycle` | author/desired、frozen execution、spend authority、execution、provider observation、materialized artifact、projection |
| `authority_kind` | durable fact、state machine、value object、adapter、projection、framework authority |
| `trust_domain` | renderer、trusted host、untrusted MCP、provider、local storage 等 |
| `owner` / `write_api` | 唯一可写符号和调用边界 |
| `identity_fields` | project/operation/candidate/revision/run/job/attempt/provider/artifact 等字段 |
| `storage` | 文件、journal、snapshot、内存缓存或远端回执 |
| `transitions` | 谁通过什么 command/event 推进到下一状态 |
| `unknown/conflict` | provider 未知、CAS 冲突、I/O 不可读、重复提交如何表达 |
| `replay_strategy` | 冷启动、重放、reconcile、repair 从哪恢复 |
| `allowed_consumers` | 允许哪些读取者/投影者消费 |
| `forbidden_derivations` | 哪些入口不能再次 infer/default/group/判 ready |

产物：`phase-minus-one-lifecycle-ledger.md`。它必须把 `PlanCandidate`、`ExecutionContractV1`、授权 envelope、`ProductionRun`、`ProductionJob`、provider receipt、artifact record 和各投影逐一落行。

### 3. 画出状态转换和耐久提交边界

对每个状态转换写出：

```text
输入事实 → canonical command/hash → policy/grant → durable write → event/receipt → projection
```

重点核对 `productionRunRepository.executeUnlocked` 当前分开写入 approval、budget ledger、event、command index、snapshot 的窗口，并把它与现有：

- `productionRunIntentLog.ts` 的 `prepared/committed/aborted`、链式 hash、fencing epoch、MAC；
- `submissionOutbox.ts` 的 intent claim、`submission_unknown`、reconcile-only；
- artifact receipt → `artifact.add` → job ready 的重放路径；

逐项对齐。

产物：`phase-minus-one-commit-boundary.md`，包含每个崩溃点的可证明结果、恢复动作、是否允许重试和用户可见状态。

### 4. 做入口语义对账

选同一组输入，从 GUI、Agent、MCP、批量/Run、恢复路径分别走到 canonical command。比较顺序固定为：

```text
untrusted input
  → parse/normalize
  → canonical domain command/hash
  → policy + grant
  → auth/lease envelope
```

允许差异只能是显式登记的 actor、trace、auth、lease、transport、idempotency 包装；model、mode、variant、parameters、references、target、project binding 的差异必须报红。

产物：`phase-minus-one-parity-matrix.md`，至少包含 3 个同类入口和 3 个故意制造差异的负例。

### 5. 对 legacy 与恢复做小范围探针

只读或测试夹具验证：

- 旧 `ProductionRun` snapshot 能否从 journal 重建；
- 缺 optional/default/unknown 字段时是否明确拒绝或显式降级；
- `submission_unknown` 重启后是否只进入 reconcile；
- artifact 文件已存在但 `artifact.add` 缺失时是否能区分“可恢复”和“无法匹配”；
- 跨项目、旧 revision、旧 provider 实例的迟到写入是否被拒绝；
- 同一个 `commandId`/intent key 重放是否只有一个结果。

产物：`phase-minus-one-recovery-probes.md`，每条记录夹具、故障点、实际输出和 `PASS/PARTIAL/BLOCKED/UNVERIFIED`。

## Phase -1 的交付顺序

1. **入口普查**：先跑 `node scripts/door-map.mjs`，再补调用图和语义决策门；事实入口和决策入口分开统计。
2. **对象账本**：完成生命周期表和 owner registry 草稿；发现同语义对象先标红，不马上合并。
3. **提交边界**：根据现有 intent log/outbox/replay 明确 commit marker、side-ledger、snapshot 和 repair 的关系。
4. **入口对账**：建立 canonical command/hash parity 和负向测试；确认哪些差异属于合法信任包装。
5. **恢复探针**：覆盖重启、回执丢失、I/O 错误、CAS 冲突和重复命令。
6. **反方复审**：由独立 agent 审 ledger，专门寻找“仍有第二个 owner”“把观察态当事实”“从当前页面猜身份”的遗漏。
7. **开工裁定**：只有当账本、提交边界、入口对账和恢复探针都达到放行门，才进入 Phase 0/Phase 1 的治理门和 vertical pilot；否则留下带 owner、证据和到期日的 residual risk。

## 审计完成门与迁移放行门

审计包完成必须同时满足：

- 每个 lifecycle object 有唯一 owner、唯一写口、稳定身份和允许消费者；
- 每个跨 `await` 写入都能回到 `projectId + operationId/runId + revision`；
- 每个 provider 请求都有可解释的 prepared/submitted/unknown/reconciled 结果；
- command、approval、budget、event、snapshot、artifact receipt 的关系可重放；
- 至少三条入口的 canonical command/hash 对等矩阵通过，故意差异能失败；
- 所有未决重复 owner 都进入账本，有明确的后续 lane，不以“先留着”通过；
- 真实代码锚点和现状文档一致；没有把 mock、单测或目录统计写成真实完成。

本轮已满足“审计包完成”并交付五份收据；“迁移放行”仍需满足真实 provider/计费、durable commit、冷重启、存储环境和跨入口 parity 证据，当前状态为 **PARTIAL/BLOCKED**。

## 本阶段完成收据

Phase -1 的审计交付物已经落在：

- [`2026-09-26-phase-minus-one-entrance-matrix.md`](../audit/2026-09-26-phase-minus-one-entrance-matrix.md)
- [`2026-09-26-phase-minus-one-lifecycle-ledger.md`](../audit/2026-09-26-phase-minus-one-lifecycle-ledger.md)
- [`2026-09-26-phase-minus-one-commit-boundary.md`](../audit/2026-09-26-phase-minus-one-commit-boundary.md)
- [`2026-09-26-phase-minus-one-parity-matrix.md`](../audit/2026-09-26-phase-minus-one-parity-matrix.md)
- [`2026-09-26-phase-minus-one-recovery-probes.md`](../audit/2026-09-26-phase-minus-one-recovery-probes.md)

机器/测试收据：

- `node scripts/door-map.mjs src/workbench/generationCanvas/runner/generationRunController.ts`：35 扇相关门；
- `node scripts/door-map.mjs electron/productionRun/productionRunRepository.ts`：21 扇相关门；
- `node scripts/door-map.mjs electron/productionRun/productionGenerationSubmission.ts`：24 扇相关门；
- `node scripts/door-map.mjs electron/productionRun/submissionOutbox.ts`：20 扇相关门；
- `node scripts/door-map.mjs electron/capabilityCore/generationOutputMaterializer.ts`：5 扇相关门；
- `node scripts/door-map.mjs src/workbench/taskCenter/productionRunTaskCenter.ts`：5 扇相关门；
- 最新 main 联合回归收据：13 files / 384 tests passed（包含制作节点重开和素材物化回归）；此前三组收据分别为 6 files / 57 tests、5 files / 313 tests、5 files / 38 tests，文件有重叠，不能相加为唯一测试总数；
- `pnpm run check:prior-art`：passed；`git diff --check`：passed。

Phase -1 审计包的结论是 **COMPLETE**：对象、入口、owner、身份和现有局部恢复机制已盘清，五份收据和机器验证均已落盘。Phase -1 迁移放行的结论是 **PARTIAL/BLOCKED**：direct canvas remote/paid candidate 的真实 provider/计费边界、Run side-ledger commit marker、真实 Electron/provider/crash/storage/Windows 证据仍是下一阶段阻断项，并已明确登记。

迁移开工前还必须关闭以下明确阻断项：

- `docs/engineering/concept-owners.json` 中仍有 pending owner 项，尤其是出价/待决身份；
- 真实 Electron/provider、冷重启、存储故障、跨项目晚到写入和 Windows sharing violation 证据；
- artifact 文件已经存在但 `artifact.add` 缺失时的 repair 证据；
- 所有 `generationSingleShot` 生产调用者的保留/删除裁定；
- direct canvas 付费 harness 的真实 Electron/provider/账单 live receipt（代码已有脚本，但本轮未执行 `NOMI_SPEND_OK=1`）。

## Phase -1 完成后才做什么

下一阶段不是马上全仓重写，而是选一条 vertical pilot：

```text
一行分镜 → 现有 ExecutionContractV1 → authorization envelope
→ Run command/outbox → 真实 provider observation
→ materialize → canvas/task projection
```

pilot 通过后，才把同一条 seam 扩到 Agent、MCP、批量和其他模型。任何 pilot 中暴露的新重复 owner 都回到账本，由协调 lane 收口，不在旁边临时再造一份补丁。

## 参考

- [`2026-09-26-architecture-single-owner-governance.md`](2026-09-26-architecture-single-owner-governance.md)
- [`docs/roadmap/TODO.md`](../roadmap/TODO.md) 中的 `T-AG-24` 制作流程 × 画布重复扣费
- [`docs/audit/2026-09-25-agent-run-canvas-projection-structure-review.md`](../audit/2026-09-25-agent-run-canvas-projection-structure-review.md)
- [`docs/audit/2026-09-26-generation-derived-facts-two-engines-structure-review.md`](../audit/2026-09-26-generation-derived-facts-two-engines-structure-review.md)
