# Project Agent Phase 3C: Canonical Canvas Reversible Write

> 状态：✅ 本地闭环完成。canonical contract、Registry aliases、durable proposal identity、真实 renderer transaction、receipt correlation、exact result pointer 与旧 owner 删除均已完成；全量发布门保留到 Phase 3/4 联合出口。

## 目标与范围

Phase 3C 建立一个 canonical `canvas.write@v1`，通过现有 Project Agent Host、
Capability Registry 和绑定的 Canvas Surface，最终调用已有画布领域事务。首个最小
垂直切片只迁移 `set_node_prompt`。后续把 `connect_edges`、`create_nodes`、`tidy`
连同 exact result/version refs 合为一个 Canvas completion 大批；批内仍按依赖顺序
RED/GREEN，但只做一次 closure、评审、完整 push gate、提交和恢复 push。

本阶段复用以下现有 owner，不另建替代品：

- `applyCanvasToolCall`：工具语义到画布领域操作的 adapter；
- `applyProposalBatch`：原子批次、补偿、reconcile 和一个 Undo barrier；
- `proposalUndo`、`canvasUndoJournal`、`canvasWriteBoundary`：持久恢复与互斥；
- `projectAgentProposalReceiptStore`：durable Canvas proposal receipt；
- `projectAgentExecutionCoordinator`：Host proposal 和能力调用生命周期；
- 当前 Canvas store/domain/persistence：节点、边、组和 revision 的唯一事实源。

发布 cutover 已固定为旧 Agent 会话/Pi context 只读归档、新 Host 干净启动；旧
Canvas proposal 不导入、不重放、不伪装成仍可撤销。此简化只作用于旧系统切换，
不削弱新 Host proposal、Canvas receipt、Undo 与崩溃恢复链。

明确不进入本合同：

- `delete_canvas_nodes`：破坏性操作，归 Phase 4；
- `run_generation_batch`：付费操作，必须进入 Phase 4 ProductionRun；
- timeline 操作：独立 Phase 3D 切片；
- staging/camera move：先冻结媒体副作用和补偿边界；
- `canvas.apply` 整图替换：不得作为 canonical 精确写执行器。

## Canonical 合同

| 字段 | 冻结值 |
| --- | --- |
| capability | `canvas.write` |
| version | `1` |
| effect | `reversible_write` |
| approval | `proposal` |
| port | `canvas` |
| availability | `renderer_required` |
| exposure | Phase 3 保持 `internal_only` |
| required scope | `canvas:write` |
| target kind | `canvas` |

首个 operation 为 `set_node_prompt`：semantic input 只有非空 `nodeId` 与 `prompt`；
target 固定为该节点；precondition hash 域覆盖节点 identity/kind/title/prompt/lock、
model selection、current result pointer、group/category membership，有 current result
时另存 result pointer hash。

Pi alias 是 `set_node_prompt`。MCP 的 `nomi_set_node_prompt` 在 Phase 3 不宣称迁移，
也不得提前暴露 canonical capability；它作为 Phase 5 的 legacy hard blocker，届时
必须通过 verified project-session lease 和 Registry-derived schema 一次切换。

## 不可打乱的执行顺序

1. 绑定的 Canvas Surface 读取 canonical raw evidence。renderer 只能返回原始
   node/result/group/edge 证据，不能提供权威 hash、binding、policy 或 action hash。
2. main 校验 sender/frame/project generation/surface instance/port revision，规范化
   raw evidence，计算 target/preconditions，并 mint `VerifiedCapabilityInvocation`。
3. 用户确认只表达 approval intent；renderer decision callback 不得写画布。
4. main 预分配唯一 `receiptProposalId`，持久化 Host proposal 的 pending/claimed
   状态，并原样保存该 ID 与 verified invocation 的 target、preconditions、
   `policyRevision`、`inputHash`、`actionHash`。`ProposalApprovalRef` 必须扩展这些
   字段；coordinator 不得另算一份 action hash，renderer 不得替换 receipt ID。
5. Host proposal durable readback 成功后，main 才能 dispatch Canvas write Surface。
6. renderer 在既有 `canvasWriteBoundary` 内同步重读 raw evidence，并按 main-issued
   expectations 重算同一 hash 域；任何漂移都在 mutation 前返回
   `capability_target_stale`。
7. 通过复验后把 main 预分配的 `receiptProposalId`、`approvalId`、`actionHash`
   注入既有 `applyProposalBatch`。现有 Canvas committed-proposal/receipt record 扩展
   immutable `hostApprovalId`、`hostActionHash`；main 在 receipt prepare 和恢复时
   必须逐项对比 binding + receipt proposal ID + Host approval ID + action hash。
8. exact match 后才由既有 transaction 完成 receipt prepare、one Undo、apply、
   reconcile、commit、失败补偿和 idempotent Undo。Host 路径禁止内部重新 mint ID；
   preserved 非 Host caller 可暂时 mint，直到对应旧 owner 同批删除。

## Crash 窗口

- Host proposal durable 前崩溃：没有 Surface dispatch，也没有 Canvas mutation。
- Host proposal durable 后、Surface dispatch 前崩溃：proposal 可恢复，只能显式
  resume 或 fail，不能冒充 applied。
- Canvas apply 期间崩溃：沿用既有 durable receipt 与 compensation/Undo recovery。
- Canvas commit 后、Host terminal projection 前崩溃：重启读同一 Canvas receipt，
  只有四项关联 exact match 才完成同一个 Host proposal，不重放 mutation。
- receipt 缺失、被复用或 binding/approval/actionHash 任一错配：不终结 success，
  不 redispatch/replay mutation；持久化 `capability_receipt_unresolved` 为
  `failed`、`retryable:false`，保留证据并要求人工检查画布后提交新 proposal。

## Typed outcome

唯一 durable owner 是现有 `ProjectAgentFailureItem`，固定保存 `code`、`message`、
`nextAction`、合法 `ProjectAgentStatus` 和独立 `retryable`。映射冻结为：

| code | status | retryable | nextAction |
| --- | --- | --- | --- |
| `capability_declined` | `declined` | `false` | edit the request or submit a new proposal |
| `capability_cancelled` | `stopped` | `true` | submit the request again when ready |
| `capability_timeout` | `failed` | `true` | retry the capability request |
| `capability_unsupported` | `failed` | `false` | use a capability supported by this surface |
| `capability_target_stale` | `failed` | `true` | review the current canvas and submit a new proposal |
| `capability_surface_unavailable` | `failed` | `true` | reopen the canvas and retry |
| `capability_receipt_unresolved` | `failed` | `false` | review the canvas and submit a new proposal; do not retry automatically |

renderer/Pi 可以本地化显示文字，但不能再建状态 owner，也不能只返回
`cancelled: true` 或 free-form message。每个非成功 outcome 必须在一次 Host durable
commit 中把 terminal Turn、对应 queue item、FailureItem，以及已存在的 ProposalItem
写成同一 `{status,retryable}`；restart/replay 不得漂移。若 admission 在 proposal item
创建前失败，则不伪造 proposal item。

## 首个切片的删除边界

同一 checkpoint 必须删除 `set_node_prompt` 的重复 owner：

- `electron/harness/tools/canvasDescriptors.ts` 中的手写 schema；
- `electron/harness/agentChatPolicy.ts` 中对 `canvas.set_node_prompt` 的手写选择；
- `src/workbench/generationCanvas/agent/gate.ts` 中的 `TOOL_META` effect/approval
  owner 与 prompt 特判；
- `CanvasAssistantPanel.tsx` 中该 alias 的直接执行/审批 dispatch。

保留 `applyCanvasToolCall.ts` 中的 prompt domain adapter、proposal transaction 的
restore-prompt compensation、receipt/reconcile/Undo，以及纯展示 summary；它们不是
schema 或 approval owner。

## Round 07 Hard Fail

- Canvas mutation 或 Surface dispatch 早于 durable Host proposal readback；
- proposal 没有原样保存 `receiptProposalId` 与 verified
  target/preconditions/policy/input/action hashes，或 renderer 重铸/替换 receipt ID；
- Canvas receipt 没有 immutable Host approval/action correlation，或 main 接受非 exact
  match receipt；unresolved recovery 终结 success 或再次 dispatch mutation；
- renderer-supplied authority/hashes 被信任，或 capture→write 漂移仍落地；
- typed outcome 没有在 Turn/queue/FailureItem/已有 ProposalItem 上形成一致、可重启
  重放的 `{status,retryable}`；
- 已迁 Pi alias 仍有第二 schema/effect/approval/transport owner；
- 新建第二个 Host、Canvas transaction、receipt、Undo、reconcile 或 Surface registry；
- 为验证该切片反复运行全量测试、build、package 或 GUI journey。

## Focused 验证

实现中只运行当前失败边界的直接测试。主干批次覆盖 raw evidence/hash、verified
invocation、Surface transport、executor 和 Host ordering/typed outcome；领域切换批次
覆盖 proposal transaction/property/receipt lifecycle、Canvas write boundary、renderer
adapter 与 owner gate。每批只在批末执行一次相关 focused closure、一次只读评审
和一次完整 push gate，随后形成一次 scoped 提交和一次恢复 push；app/electron
TypeScript、scoped ESLint 与 `git diff --check` 也只在批末按影响面执行。完整 gate
是仓库 push 纪律，不代表每批追赶 `main`；Phase 3/4 联合出口才整合一次 `main`
并更新远端 stage checkpoint。

最终本地证据：3C closure 为 17 个直接相关测试文件、194 项通过；真实 renderer
集成另外明确覆盖 create+edge exact IDs、existing connect、all-skipped zero effect、
category tidy、stale mutation、locked target 与 proposal/approval/actionHash correlation
共 7 个场景。app/electron TypeScript、test-types、capability owner 与 `git diff --check`
通过。result/version closure 使用当前 `resultId + pointerHash` 进入 precondition；结果
切换后旧 proposal 返回 `capability_target_stale`，不把 renderer store 复制进 Host。

## 历史 PR 门禁

本切片不替代历史 PR evidence。每个 MCP/Skill/Registry/UI lane 在 RED 前必须先
阅读直接重叠证据并记录 `adopt/adapt/reject`；Phase 5 做一次全量增量审计，Phase 6
只补 UI 和新 PR 差异。固定索引为：

- `docs/audit/2026-08-29-project-agent-pr-evidence.md`
- `docs/audit/2026-08-29-project-agent-pr-coverage-index.md`

历史 PR 即使落后届时的 `main`，其严重问题、核心方案和 review 异议仍是设计输入；
代码基线始终是届时最新 `main`。UI 先对照现有批准设计、真实工作台和设计系统，
不能用历史分支恢复第二套状态或 owner。
