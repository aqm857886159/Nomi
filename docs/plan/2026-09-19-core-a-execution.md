# Core A execution and acceptance

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 2026-09-20 重新实施：现行指令以 [core-a-restart](2026-09-20-core-a-restart.md) 为准。本文件后续内容保留为历史记录；旧 T3 扩范围解释不再生效。

Status: implementation in progress; no release approval.

## Scope correction after resumed review (2026-09-20)

The user reconfirmed that this task is **the simplified Plan A plus T7**, not the complete Plan B. The user also reconfirmed that restoring the old page alone is insufficient: the requested fixes and features must work through the reused editor. Both constraints apply together.

- Implement and accept K0–K7 / C01–C30 / CJ1–CJ4, with the explicitly added T7 assertions. Do not promote B's final architecture into an automatic full-T3 implementation mandate.
- A §1.2 labels `Run.authoring.plan` as the complete-plan target; A K4 expressly requires repairing the current legal owner, preferably through a read projection, and forbids assembling incomplete T3 format/prepared-migration/IPC changes into the core candidate. The earlier resumed-review interpretation that immediately dispatched full authoring work was too broad. That dispatch was stopped before production changes; no migration was started.
- The required creation outcomes remain: multiple documents and plans, captured Agent targets, recoverable edits, no cross-target writes, original editor capabilities, explicit Place/View, and placement that preserves existing edits/results without duplicates. A restored shell alone does not meet these outcomes.
- Determine the smallest complete dependency from actual field/write-path evidence. If an exposed outcome cannot be implemented safely inside A, record the specific missing contract and seek a concrete scope decision under A K4; do not silently remove the feature, duplicate its writable data, or expand the entire full taskbook.
- Reference isolation belongs to K6/T7 (C27/S39); original-message/replay/compaction/Stop belongs to K5. Earlier conversational labels calling payment reference isolation “K5” were incorrect.

Current evidence is partial: async payment-owner isolation and sidebar delete parity have controlled regression results; the existing Run replacement page still fails original-editor acceptance. Final package journeys, final-tree gates and PR delivery remain outstanding. Prior green runs identify their historical tree only.

### Bounded K4 implementation decision

After checking the actual types and the user's renewed scope instruction, the selected core repair keeps `generationPlan` as the current legal owner. Its candidate fields already represent prompt/model/parameters/pinned assets; typed editorial metadata may represent only facts absent from that contract (reference-slot bindings, anchor relationships, scene/default/keyframe and prompt-segment structure). A single projection and inverse write must preserve those facts through the existing editor, with an atomic draft update, stable identities, captured source/version checks and invalidation of stale approvals. No duplicate editable prompt/model/parameter/asset record is permitted. Sealed/submitted execution data remains protected by its existing boundary.

This is the minimum current-owner repair allowed by A K4, not a claim to have delivered B T3. It does not import `Run.authoring.plan`, project format changes, migration/prepared protocols, legacy data guessing or a parallel execution service. Full-T3 migration remains deferred. The original editor must remain the sole page; acceptance must exercise actual controls, full round trips and placement, not merely the new metadata adapter. The earlier withdrawn candidate-only proposal was insufficient because it omitted these missing facts and behavior proofs; neither that proposal nor B's final architecture can override the user's explicit A + T7 scope.

## Verified source authority (resumed review)

The original user-supplied taskbooks were located and read during resumed review. This file is an execution record, not a substitute specification. Resolve decisions against the original clauses and the user's later explicit instructions; do not promote a coordinator's summary or an executor's design proposal into a product decision.

| Source filename | SHA-256 | Role |
| --- | --- | --- |
| `Nomi_plan_A_core_fixes_2026-09-19.md` | `ada6d3fca6b0f7d7005348f6a5ddb13f1a1b4a21a5ad30042075403da425a690` | Active K0–K7, C01–C30, CJ1–CJ4 scope |
| `Nomi_Plan_B_Full_Reviewed_Taskbook_2026-09-19.md` | `a016edb9ddbc2659c9a862ef47a2d6ed1244acfe26f05bd0891e6db4c143e98e` | Full architecture and explicit added T7/S30–S34/S39 requirements; other full-plan items are not automatically authorized |
| `2026-09-19-merged-next-ai-taskbook(1).md` | `b9fffebb735e036751299350aac5ca802fcf5cb65aede7924e676f08ada8e8a9` | Original M source; hash matches A's source index despite downloaded filename suffix |
| `2026-09-19-merged-taskbook-review-and-revisions.md` | `21a71c853b0cfa38fdaa905dd8c6bf0375d4a20b710e3c916c39d6c50a7a2d4e` | V amendments; hash matches A's source index |

Source corrections that must govern further work:

- A §2.2 / K4 forbids unfinished authoring migration and double-writable ledgers, but explicitly requires identifying necessary T3 dependencies when the exposed creation flow cannot satisfy its safety assertions. It does not authorize a reduced replacement editor.
- B Global constraints explicitly says not to rebuild the table/canvas and to retain one row per shot, text editor, reference slots, model parameters and reusable anchors.
- B T3 explicitly selects `ProductionRun.authoring.plan` as the single editable authoring owner and `generationPlan` as versioned execution snapshots. The resumed review's unimplemented suggestion to distribute all missing authoring facts into generation candidates is withdrawn pending alignment with that architecture. Do not call `authoring.plan` a forbidden duplicate merely because the current partial branch lacks the intended compile/snapshot boundary.
- CJ1 is payment scope/close/reopen; CJ2 is creation edits and ownership; CJ3 is message/replay/compaction/Stop; CJ4 is node editor/gesture/trace/export. The creation-only Electron script is partial CJ2 evidence, not CJ1/CJ3 acceptance.
- No original file was modified. Source files and hashes, repository design contract, baseline commit and later user changes must accompany subsequent task briefs. If a source is unavailable, report that before proposing an architecture from summaries.

## User correction: preserve the existing storyboard editor

### Mandatory instruction for every executor and reviewer

用户明确要求：**不能新造另外的页面，尽可能复用而不是新造。** 本条优先于之前的执行分工和实现方便程度，是本轮任务的硬约束。

- 开工先读现有页面、组件及其数据和动作入口；任务书必须列出将复用的真实组件路径。缺少数据连线时，修输入适配与原有写入边界，不以另造页面绕过。
- 分镜继续复用 `StoryboardPlanEditor`、`StoryboardShotTable`、参考卡和模型参数控件及原交互。禁止并行页面、复制 JSX 成另一套编辑器、简化表单替代原功能，以及只复用外壳却重造主体。
- 允许为复用提取必要的无界面适配器或共享逻辑，但不能引入第二份可写方案或重复执行通道。发现现有契约不能表达的能力，先提交具体差距和最小接线方案给协调者，不擅自删功能、禁用控件或重设计。
- 收货必须逐项对照原页面的布局、控件、编辑、参考、模型参数、增删镜、生成及 Undo 行为；既检查真实截图，也检查写入目标和保存重开。外壳截图、单测通过或新页能运行均不能替代功能等价验收。
- 协调者在每份后续派工消息中重申本条；执行者必须确认理解。越界实现不得因投入时间或测试已绿而被接收。

### Executor rule readback and coordinator acceptance

用户进一步明确：所有 subagent 必须阅读仓库 `AGENTS.md` 和适用的规则原则，避免重复越界。后续派工执行以下开工与收货要求：

1. 开工前完整读取当前工作区的 `AGENTS.md`；再按任务触发读取其中指向的工程规则、根因技能、设计规范和相关教训。不得只搜关键词或沿用旧会话记忆。`AGENTS.md` 是生成文件，不得手改。
2. 执行者先回报实际读取的路径、适用原则及其对本任务的具体约束、现有可复用 owner/组件、允许修改的范围和验收要求。只回复“已读”不算完成；与用户最新指令冲突的旧方案必须指出。
3. 对本次分镜纠偏，至少核对 P1 单一实现、P2 根因共享边界、P3/R13 真实用户任务验收、P5/R8 既有界面与授权、R4 执行文档、R15 国际化。适用的其他规则仍须遵守，此列表不替代原文。
4. 协调者先检查规则回报再接受实施方案；收货时核对实际 diff、原组件复用情况、原功能逐项对账及真实截图/行为证据。出现另造页面、双 owner、功能缩水、改预算掩盖失败或证据不支持结论，退回修正，不能仅凭执行者报告接收。
5. 交接或上下文压缩后仍保留本约束；新执行者必须重新读取，已有执行者规则或任务范围变化时补充核对。协调者承担最终把关责任。

The user rejected the visibly different Run plan page during resumed acceptance. `CreationRunPlanEditor.tsx` introduced a separate title/prompt/parameter form instead of reusing `StoryboardPlanEditor` and its existing shot table, reference cards, model controls and interactions. This is an implementation deviation, not an approved redesign. The prior creation-columns screenshots only verified shell layout and did not establish editor parity.

Do not deliver this replacement page as completed K4. Restore the existing editor presentation and interactions for document-owned Runs while retaining the canonical Run write owner, captured source identity, revision fence and explicit canvas placement. Do not copy Runs into writable legacy plans or restore automatic placement as a shortcut. Check all existing editor mutations and execution actions against their correct owner before connecting the shared view; a prompt-only adapter does not establish functional parity. Remove the separate form implementation when the shared editor connection is ready.

Resumed verification: source build passed on macOS outside the sandbox; refreshed remote has no commits ahead of this branch at this checkpoint. Targeted error-surface, model-face, verb-host, prior-art, symptom-cluster and vocabulary checks passed. The walkthrough checker exposed three unproven zero-write assertions in the reference isolation probe; positive writer controls have been added but are not yet rerun. The isolated Electron creation journey failed after selecting the first plan because the next plan row was no longer found; it did not verify save, placement or restart. No package/live-provider/Windows acceptance is implied. Reference execution scope remains awaiting the user's earlier choice.

Coordinator checkpoint: the complete K0-K7 / C01-C30 / CJ1-CJ4 contract remains active. User refinements to creation are additions within K4, never substitutes for payment, task identity, persistence/Undo, message lifecycle, T7 or final delivery. The coordinator owns overall judgment, dependencies, progress and independent acceptance; executors supply scoped commits and evidence. For efficiency, retain one meaningful red reproduction per root cause, then affected and safety-adjacent regressions; run integrated delivery checks and candidate journeys after convergence. Repeat checks only for changes, failures or unresolved risk. No discretionary visual polish or full-plan expansion.

## Authority and baseline

The user approved execution of `Nomi_plan_A_core_fixes_2026-09-19.md`, with the coordinator owning decisions, task issuance and acceptance, and GPT-6 medium subagents implementing. The source specification's K0-K7, C01-C30 and CJ1-CJ4 remain the acceptance contract. Paid providers, real user project mutation, publishing and merging are not authorized.

User clarification: T7 from `Nomi_Plan_B_Full_Reviewed_Taskbook_2026-09-19.md` is explicitly mandatory in this iteration because a mouse click sometimes fails to reveal the node parameter bar. Include its S30-S34/S39 behavior and actual hit/input/save-reopen checks, without expanding into the full repair plan or a layout rewrite. This clarification strengthens K6; it does not replace the original core scope with the conflicting historical summaries pasted alongside it.

Additional user reproduction: clicking New Plan in creation sends an Agent request to split the current document; the resulting storyboard appears on canvas but creation still lists only old plans. Trace the real launcher, captured source, created Run, notification, selection and creation reader before diagnosing it as a refresh defect. A missing connection may be repaired at the existing owner, but copying the result into a second writable plan is prohibited. Record the exact blocker if correcting this requires the deferred full migration. The user also reports easier node-parameter access before React Flow: compare actual pre/post migration selection, lightweight rendering and composer mounting before attributing the symptom solely to gesture cleanup.

The user also requires multiple documents per project, multiple plans per document, and a visible document/plan target in the right Agent. The existing document collection is retained. The bounded K4 implementation persists trusted captured document provenance on new Runs, projects their canonical generation shots into the existing shot grid, and routes draft edits through the existing generation owner with revision checks. Legacy plans remain separate existing records; there is no copy into legacy B and no authoring migration. Submitted snapshots stay immutable with a visible state. Run selection is project-scoped and mutually exclusive with legacy plan selection. Untagged historical Runs must not be assigned to whichever document is currently active.

K4 acceptance adds two documents with two new plans each, preserving old plans; actual prompt/model/reference content opens from the creation tree; requests completed after switching still belong to their captured document; right Agent identifies the addressed document/plan; save/reopen retains ownership and content. Stale edits preserve the user's draft and surface a conflict instead of silently raising the expected revision. Creation-list presence alone is insufficient.

### User-approved separation of plans and canvas

The user explicitly changed the creation interaction during implementation: remove the plan editor's Discard Plan and Re-split actions and replace them with **放到画布 / Place on canvas**. A new document-owned plan is saved and editable under its document before any canvas nodes exist. Placing projects existing content; it neither asks the model to split again nor authorizes paid generation. Once placed, the action becomes **在画布中查看 / View on canvas** and focuses the existing plan group. Repeated clicks and reopening must not duplicate nodes; distinct plans must not overwrite each other's groups. The existing sidebar delete affordance is outside this removal request.

This is an explicit user action, not an extra Agent question/answer round. The Agent should identify the addressed document/plan and report plan creation truthfully without claiming canvas placement. The current ownership repair remains mandatory: removing automatic landing alone cannot make an unlisted plan accessible.

Payment owns the durable placement intent and the existing shared landing boundary, covering draft hooks, confirmation, result observation and project reconciliation. Canvas owns the two editor surfaces, labels, group navigation and content projection independent of canvas existence. Messages owns captured provenance, visible Agent target and any directly conflicting completion text. Preserve existing canvas content and ordinary non-creation generation behavior; do not infer source ownership for historical untagged Runs. Do not add a second materialization pipeline, duplicate editable plan, automatic regeneration, or full historical migration.

Additional acceptance: create multiple plans without increasing canvas node count; open/edit their actual content; explicitly place only one and observe exactly its nodes; repeat the action without duplication; reopen with unplaced plans still unplaced and placed content intact; verify placement does not call paid providers. Existing user edits and results on placed nodes must not be silently overwritten by navigation or reconciliation.

Fresh `origin/main`: `dfca9990b89c9c401b8ac81ea9ce30ab032e1be4`; tree `b03bf18849c7d9189c591733a440bb783e5289a1`. Integration preflight passed with a clean worktree. All worktrees are siblings of the main checkout. Existing source worktrees remain read-only.

Initial source manifest SHA-256: `99a87fbd285f1845ecf0a1777bb4a83233b84a816e2eb6f9be2dd3048280c18c`. Per-file staged/unstaged/untracked and content/patch hashes are preserved locally. Source counts (unstaged/untracked): main 1/3, final-journeys 87/79, reliability 89/41, creation-owner 21/16, F12 10/5, pi 0/0; all staged counts are zero. These counts are inventory, not permission to include those files.

## Task ownership

| Executor | Unique branch / worktree basename | Scope and initial budget |
| --- | --- | --- |
| Coordinator | `codex/core-a-integration-20260919` / `Nomi-core-a-0919` | K0, taskbook, source manifests, independent acceptance and K7 delivery; documentation only before integration |
| payment_identity | `codex/core-a-payment-20260919` / `Nomi-core-a-payment-0919` | K1-K3; productionRun and shared payment/task identity contracts; approximately 70 files / 4,000 changed lines including existing deltas and tests |
| messages_stop | `codex/core-a-messages-20260919` / `Nomi-core-a-messages-0919` | K5; pi history, replay, input lifecycle and admission cancellation; approximately 55 files / 3,500 lines including existing deltas and tests |
| persistence_canvas | `codex/core-a-canvas-20260919` / `Nomi-core-a-canvas-0919` | K4/K6 plus document-owned explicit deletion Undo; approximately 45 files / 2,500 lines including existing deltas and tests |

Absolute execution roots are issued directly to each executor and are not embedded in committed evidence. Every executor runs delivery preflight and installs frozen dependencies before edits/commits. No executor writes another branch or the original source trees. Over-budget work requires an explained inventory, not a broad transplant.

Payment owns `productionRun`, production IPC/preload/API, spend confirmation UI, generation adapters, task routing and failure contracts. Messages owns lane history/runtime/client/actions and resident shell; its edits to task routing/failure files require coordination with payment. Canvas owns canvas/editor/document launch/save paths. Shared workbench store, i18n and framework registry changes must be reported as explicit independent hunks for integration. No partial `Run.authoring` migration or new legacy storyboard Agent write surface.

K4 coordinated addition: payment owns the durable Run origin fields and generation patch authorization semantics; messages owns captured input provenance through the generation planning adapter and the existing Agent target label; canvas owns creation projection, selection and draft editor adaptation. Canvas may add approximately six frontend files / 450 implementation lines plus focused tests; payment approximately five to seven provenance files. Reference writes from the reused panel composer must use the same host-owned write boundary as the payment card.

## Prior-art and implementation judgment

Existing investigation: `docs/plan/2026-09-18-tool-layer-prior-art-verdict.md` compares MCP, pi, Vercel and neighboring tools; payment authorization belongs to the host and binds the actual validated payload. Existing `docs/research/2026-09-18-storyboard-single-ledger/prior-art.md` supports one editable owner with immutable execution snapshots. Executors recheck relevant installed source before adopting APIs.

Use existing ProductionRun CAS, authorization history and submission outbox; do not add a task index or global lock. Use pi 0.85.1 branch entries for full UI history, existing watch for execution state, and existing model context separately. `watchSession` is not implemented in the installed version. Preserve React Flow positioning and repair editor/gesture ownership without a toolbar migration.

Candidate reusable deltas, subject to independent review: payment `b39333729` plus `883f6904b`; history `45a8293be`; canvas `93ff9c20a`. These are source commits, not acceptance evidence. F12 `27fa8888d` is prohibited as a transplant baseline. Source dirty authoring changes and unknown-price approval mode are excluded.

## Required red-green work

- Payment: real adapter 33-to-3 scope; empty/duplicate/unknown IDs; independent later batches; stale quote confirm/close and concurrent refresh; unknown submission blocks repayment; close preserves full creative state on reopen. Domain-tagged task references and typed owner-produced absence must prevent cross-domain cancellation and secret leakage.
- Messages: replay the original input with skill/attachment references while preserving a new draft; cancellation restores input; two real SDK compactions retain readable branch history while model constraints are checked separately; pre-admission Stop and late ACK cannot admit the old request or stop a newer input.
- Persistence/canvas: capture document/project/plan identity before awaits; late result cannot overwrite a new draft; save/reopen fixtures; explicit group deletion and one Undo preserve structure and target identity. History, single selection, drag cancellation/blur/unmount/read-only changes and lazy/zero-size recovery preserve a reachable editor in both hosts.

Every recurring repair first records a machine-generated door map and schema-v3 root-cause contract. Run a compilable reported-case red test before production changes, then changed class tests and adjacent regressions. Missing APIs or dependencies are infrastructure failures, not defect reproductions. Preserve logs with commit/tree, dirty diff hash, lock hash, fixture, mode, command and exit status.

## Acceptance and delivery

Coordinator personally compares implementation to the specification, checks two-point diff and baseline lag, and independently reviews payment, cancellation and persistence. Worker reports are evidence indexes, not acceptance decisions. No enabled data loss, wrong cancellation or unauthorized submission may be deferred as a minor issue.

Each worker commits scoped units after green focused verification and reports unresolved C assertions accurately. Do not push worker branches. Integrated delivery uses final-commit branch review, findings resolution, risk-selected gates and integration ci-chain. No hook bypass, fabricated review receipt or raised gate baseline. Commands already holding the gates lock must not be wrapped in another lock.

Build a macOS arm64 candidate from the final identified tree, then run CJ1-CJ4 with isolated controlled providers and project fixtures where supported. Preserve app/package hashes and inspect actual screenshots/hit tests. Source builds do not prove package acceptance. Windows, other architectures, unrun provider paths and incomplete journeys remain unverified. A code PR is separate from a release recommendation; no automatic merge or publish.

## Rollback and reporting

Revert only this task's scoped commits through review if required; do not reset or clean another worktree. No data migration is introduced. Evidence must include K/C-to-commit/test/package status and deferred-item-to-full-plan mapping. Keep raw profiles/logs local; commit only sanitized indexes and hashes.

Workers must finish or explicitly stop their own command sessions before reporting. No indefinite watch, unattended background verification or final response while required tests still run. Report a progress/evidence checkpoint at least every 15 minutes; escalation at 90 minutes per implementation unit is a review checkpoint, not permission to abandon authorized work.


## 2026-09-19 handoff execution checkpoint

The current handoff K0–K6 and CJ1–CJ4 are the bounded acceptance scope. No package publication, paid generation, default-branch push or merge is authorized.

- K0: existing three dirty frontend files preserved and reviewed; `origin/main` refreshed at `dfca9990b89c9c401b8ac81ea9ce30ab032e1be4`. Preflight correctly reports dirty-worktree; this is the explicitly handed-off integration checkout, not a clean new task. PR #806 (`181375628`) and #807 (`496386ab6`) remain open and are not transplanted. Neither head is an ancestor of this branch.
- K1/K4: canonical generationPlan projection and a disposable Run edit buffer replace the broken Run-to-legacy-editor route. Legacy hand-authored designs retain their existing owner; no Run-to-legacy copy or migration. Metadata `authoring.title` is persisted alongside the canonical candidates; it does not duplicate shot content.
- K2: capture source/document revision, request ID and target Run at send; new-plan launcher allocates a fresh target. Editing an existing plan uses the captured Run revision, with only successful writes from the same request advancing its fence.
- K3: explicit placement command now connects through renderer admission to the existing canvas landing host. Durable shot bindings indicate completed placement; explicit intent alone never claims nodes exist.
- K5: preserve prior parameter composer lifecycle work. Existing focused browser/lifecycle regression is run once by the placement executor.
- K6: coordinator regression across payment scope/batches, late ACK/Stop, task routing, replay, trace and storyboard ownership: 13 files / 124 tests passed. This proves controlled fixture behavior, not live paid providers or Windows.

Implementation assignments: run_projection owns frontend/editor and controlled Electron journey; agent_target owns send snapshots and transport/operation fencing; placement owns IPC/landing and parameter regression; coordinator owns the atomic authoring save, cross-cutting review, integration validation and Git delivery. Tests are repeated only after relevant changes or unresolved failures.

Final integrated typecheck/build, Electron CJ journey, repository contracts, branch review and delivery remain pending at this checkpoint. Windows release-ready: unverified.

## 先查别人

本节补齐已有调查与本次源码复核索引；不增加方案 B 范围，也不把历史调查的方案字母当成本轮授权。

- 单一账本：[2026-09-18 storyboard prior art](../research/2026-09-18-storyboard-single-ledger/prior-art.md) 已记录 Run、分镜表投影与现成 reducer 的关系；本轮只采纳一个可写 owner，不整体引入该报告的迁移方案。
- 持久化 owner：[productionRunRepository.ts](../../electron/productionRun/productionRunRepository.ts) 在执行命令前检查 expectedRevision，并保存 Run 与事件；编辑和 placement 继续通过它，不新增账本。
- 画布落地 owner：[canvasLandingHost.ts](../../electron/productionRun/canvasLandingHost.ts) 检查来源文稿方案的显式 placement，并通过已有 shot binding 落地；生成保存与用户放入画布分离。
- 参数条调查：[2026-09-10 composer prior art](../research/2026-09-10-node-composer-placement/prior-art.md) 已核对 React Flow 与定位能力边界；保留现有定位、修复生命周期，不做框架替换。

结论：复用已集成的 Run CAS、落地边界与参数组件，补投影和请求身份连线。未新增外部研究；PR #806/#807 的交付状态以本计划交接核对为准。

## 付款卡验收补修（A06/A07，2026-09-20）
仅复用既有 NodeGenerationComposer 与模型档案，不创建页面或画布节点。卡片节点按待确认候选投影；镜头地址不由可见条数推断，宿主验证后才写指定候选。保留异步写令牌。验证：真实 hook 受控浏览器红绿与现有异步归属回归；真实 Electron 另验。先查现有 spendCardDraft、modelArchetypes、productionPendingSpend 和付款宿主，不引入通用框架。回滚限定本节对应适配和测试，不撤其他 dirty 工作。

付款 A05/A08：复用 reliability 工作树现有参考素材适配，shared schema仅导出现有pinned identity；卡内引用进局部账本，revise时向项目素材owner导入/pin，关闭先保存再dismiss。引用上传复用现assetLocalization，异步前后复验项目/内容身份。12文件预算扩至约18文件已报root，新增仅引用适配与回归；不引入分镜新页或新编辑owner。
