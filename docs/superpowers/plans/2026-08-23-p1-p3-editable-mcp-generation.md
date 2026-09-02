# MCP 真实可编辑单镜生成（P1→P3）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不要求用户离开当前 MCP 客户端、只做一次明确确认的前提下，完成一条通用、可编辑、可恢复的单镜 AI 生成链路：同一套语义同时服务 MCP 与 GUI，模型/供应商/模式/参数/参考素材可在封存前自由调整，封存后不会被静默修改，并最终产出可重新打开的 Artifact。

**继续推进（2026-08-24）：** provider-owned output/materialization seam、真实 semantic GUI fallback 和运行时 policy 接线已完成；供应商没有稳定结果提取能力时仍保持“远端完成但本地未落盘”的诚实状态，不把某一家 API 字段硬编码成所有模型的共同能力。

**Architecture:** `ProductionRun` 继续是唯一的持久事实源；`RuntimeTask` 负责执行边界；Module Manifest 声明能力与参数；纯编译器把 `PlanCandidate` 编译成哈希固定的 `ExecutionContract`；P3 只允许 `generationRuntimeAdapter` 进入 provider，Run-owned intent WAL/outbox 负责一次提交、重启恢复与未知结果的 reconcile。MCP 与 GUI 只做同一语义的输入/投影，不各自维护 provider、审批或任务状态。

**Tech Stack:** Electron main process, TypeScript, Zod, Vitest, existing MCP stdio/RPC/dispatcher, existing ProductionRun repository/intent log/outbox/lock, Playwright/Node UX harness.

---

## 用户价值与阶段边界

这不是把同一个功能拆成三次收费或三次确认，而是逐层把“用户想要的结果”变成“安全可执行的结果”：

| 阶段 | 用户看到什么 | 解决的真实摩擦 | 退出时能承诺什么 |
|---|---|---|---|
| P1：边界通用化 | 仍可用现有界面/MCP；系统能清楚告诉用户某个模型、模式、素材是否支持 | 换模型/供应商/输入形式时，不必记 Nomi 私有格式，也不会悄悄丢参数 | 输入被统一成有类型的任务与资产引用；未授权、未知能力、过期素材在付费前失败 |
| P2：可编辑合同 | MCP 与 GUI 都能预览“将用哪个模型/模式/参数/参考素材”；用户可以直接改，预览会更新 | 用户反复试错时，不想重新填一套表单，更不想因隐式降级得到意外结果 | 同一语义输入得到同一合同与 hash；所有删字段/警告可解释；封存前可改，封存后改动会生成新草稿 |
| P3：一次确认、后台完成 | 在当前 MCP 客户端完成一次标准确认；有进度、取消、失败后的明确下一步；不需要切到 Nomi 点第二次 | MCP 客户端与 Nomi 来回切换、重复点击、崩溃后重复扣费 | 一个 Run、一个 Job、一次 provider submit、一个 Artifact；重启/超时只能恢复或核账，绝不盲目重提 |

### 本计划的通用性不变量

- 生产代码不为供应商或模型复制 UI/dispatcher 分支；供应商差异只通过 Manifest/Capability/Parameter Schema 注入。
- 模型可替换、供应商可替换、image/video/audio 等模式可替换；参数集合可增减；参考素材可添加、删除、替换、排序。
- 所有编辑都先作用于未封存的 `PlanCandidate`；每次编辑都重新做 capability/asset/预算预检并生成新的预览与合同 hash。
- 合同封存后，编辑不会 patch 原 Job；返回 `new_draft_required` 并保留原合同可恢复。
- P0 已完成的 policy、lease、receipt、legacy firewall、typed transport error、pure read 继续作为硬边界；本计划不恢复旧 `nomi_generate` 或 `production.generate-node→arrange→export` 路径。

### 用户体验不变量（真实用户看到的每一处都适用）

- 当前 MCP 客户端是主场：标准 elicitation 能在客户端确认且客户端能提供主进程可验证的 attestation，就只确认一次；客户端没有可验证证明时，沿用同一个 challenge 走一张 GUI fallback card，不再生成第二个独立审批。
- 少即是多：预览只显示用户需要做决定的模型/供应商、模式、关键参数、参考素材和费用边界；内部 Run、WAL、fencing、receipt 等只作为状态证据，不要求用户学习。
- 用户可控且可撤销：封存前可以像真实界面一样改模型、供应商、模式、任意参数以及参考素材的增删替换排序；取消保留草稿；封存后明确告诉用户“新草稿”，不偷偷改旧任务。
- 状态不靠颜色：进行中同时有短文案、图标和进度；失败明确回答“发生了什么、是否可能已提交、下一步只有什么”；`submission_unknown` 用“需要核账”解释，不要求用户猜内部术语。
- 通用而非硬编码：UI/dispatcher 不按具体供应商或模型分支；能力、参数、输入模式和素材约束来自可替换 manifest，未知项在付费前说明并阻塞。
- 真实页面自由度验收：测试不是只把固定 candidate 送进编译器，而是模拟用户来回换模型/供应商/模式、改参数、换参考素材、重排素材、重启和断线，验证每一步的可见结果和恢复动作。

### 本计划唯一需要用户决策的点

P1/P2/P3 的 fake-provider、零额度、崩溃恢复和真实 MCP/UI 旅程都由工程自主完成。只有在 P3 零额度证据全绿后，才停在真实 provider smoke 前，请用户决定真实供应商凭证、模型和预算上限。能力降级原则已确认：供应商缺少原生幂等/查询/核账/取消能力时，不因此禁用一次明确提交；`submission_unknown` 只允许 reconcile，不允许人工确认后盲重提。

### 当前执行进度（2026-08-23）

- [x] P1 typed Module/Runtime/Asset boundary：模块能力声明、Run binding、RuntimeTask binding、资产稳定 identity/lease。
- [x] P2 pure `PlanCandidate → ExecutionContract`：稳定 hash、字段解释、封存前编辑/封存后新草稿。
- [x] P2 shared planning seam：semantic dispatcher 已有 MCP/GUI 共用 callback，未触碰 legacy provider path。
- [x] P3 first seam：provider-neutral adapter、durable runtime envelope、unknown/reconcile-only recovery classifier、single-shot ordering tests。
- [x] P2 semantic tool vocabulary + shared planning handler：MCP/GUI 共用 `context → operation → patch → preview`，目录只声明能力，handler 不调用 provider。
- [x] P3 first durable planning wiring：semantic operation 草稿已由 `ProductionRun` events/snapshot/CAS 持有；真实 MCP JSON-RPC create/edit/preview 零额度旅程已通过。
- [x] P3 provider adapter submit/recovery default wiring、真实 UI confirmation journey、full gates 与零额度决策包：Run-owned 零额度 seam、用户模型目录驱动 registry、可验证 attestation 一次确认链、完整编辑矩阵、APIMart 1K transport smoke、provider capability degradation gate、provider query → runtime envelope poll、`nomi_reconcile_generation(found)` 默认 wiring、结果 Artifact/materialization、跨进程 Run recovery 以及 `generation.single-shot` 精确 challenge 的真实 GUI fallback 均已完成。真实 provider 付费 smoke 单独留在用户决策门，不混入零额度交付。

## 文件地图与唯一 owner

| 文件 | 本计划中的职责 |
|---|---|
| `electron/capabilityCore/moduleManifest.ts` | 创建：通用模块、参数 schema、输入/输出类型、provider recovery capability 的纯 schema |
| `electron/capabilityCore/moduleRegistry.ts` | 创建：按 Run 快照解析 module/provider/model capability；不联网安装 |
| `electron/capabilityCore/moduleCatalogBootstrap.ts` | 创建：内置测试/生产 module 注册；不把 vendor 写死进 UI |
| `electron/productionRun/productionExecutionBinding.ts` | 创建：immutable project/generation/run/shot/contract/runtime/provider namespace 的校验 |
| `electron/productionRun/productionRunTypes.ts` | 修改：给 `ProductionJob`/`ProductionRun` 增加 typed binding、fingerprint、envelope、receipt/provenance 字段 |
| `electron/capabilityCore/executionContract.ts` | 创建：`PlanCandidate → ExecutionContractV1` 纯编译器、canonical hash、field ledger |
| `electron/capabilityCore/generationContext.ts` | 创建：项目范围的只读 planning packet；不产生 Run/Job/provider side effect |
| `electron/capabilityCore/generationRuntimeAdapter.ts` | 创建：唯一 `ExecutionContract → ResolvedTaskRequestV1 → submit/poll/reconcile` provider seam |
| `electron/capabilityCore/generationSingleShot.ts` | 创建：P3 单镜编排；禁止调用 legacy driver |
| `electron/capabilityCore/mcpGenerationTools.ts` | 创建/修改：context、operation、plan、preview、gate、start、observe、artifact 的 typed MCP handlers |
| `electron/productionRun/productionRunIntentLog.ts` | 已有：扩展为 Run-owned prepare/commit/replay WAL |
| `electron/productionRun/submissionOutbox.ts` | 已有：接入 Run-owned intent、lock/fencing；local `inflight` 不再是 authority |
| `electron/productionRun/productionRunRuntimeEnvelope.ts` | 创建：sealed runtime envelope 的 durable sidecar/replay |
| `electron/productionRun/productionRunResume.ts` | 创建：generation.single-shot 重启/reconcile 分支；绕过 legacy resume/driver |
| `electron/productionRun/productionRunRepository.ts` | 修改：binding/envelope/receipt 的校验与原子 command/event 追加 |
| `electron/productionRun/productionRunService.ts` | 修改：contract-aware create/preview/submit/reconcile 方法；读投影保持纯读 |
| `electron/productionRun/productionRunDriverOps.ts` | 只加隔离断言/测试，不接入 P3 provider |
| `electron/tasks/taskResultQuery.ts` | 修改：持久化精确 provider/model/task query payload，支持重启续查 |
| `electron/assets/projectAssetStore.ts` | 修改：稳定 content hash/state/materialization receipt；不新造 Asset owner |
| `electron/capabilityCore/dispatcher.ts` | 修改：MCP 与 GUI 调同一 semantic service；legacy alias 继续 typed block |
| `electron/capabilityCore/mcpToolCatalog.ts` | 修改：只曝光阶段允许的 semantic tools；`nomi_generate` 保持 legacy 标记 |
| `electron/capabilityCore/rpcServer.ts`, `mcpStdioServer.ts`, `host.ts` | 修改：传递同一 lease/receipt 并保留完整 typed error envelope |
| `electron/preload.ts`, `src/desktop/bridge.ts` | 修改：只传递 challenge/decision projection，不暴露 spend grant |
| `electron/capabilityCore/*Generation*.test.ts` | 新增：schema、compiler、adapter、single-shot、MCP round-trip 与伪造输入测试 |
| `electron/productionRun/productionRun*test.ts` | 新增/修改：binding、WAL、outbox、resume、crash/restart、legacy isolation 测试 |
| `tests/ux/mcp-generation-single-shot.e2e.mjs` | 新增/修改：真实 Electron stdio + 当前 MCP 客户端用户旅程 |
| `tests/ux/mcp-generation-single-shot.real-provider.mjs` | 新增：显式 opt-in 的真实 provider smoke；绝不进入零额度 CI |
| `docs/audit/2026-08-23-p1-p3-evidence.md` | 创建：每阶段用户价值、测试证据、真实旅程截图、决策门记录 |

## Task 0：基线锁定与计划自检

**Files:**
- Read: `docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md`
- Read: `docs/superpowers/plans/2026-08-22-mcp-ai-generation-vertical-slice.md`
- Create: `docs/superpowers/plans/2026-08-23-p1-p3-editable-mcp-generation.md`

- [x] **Step 1: 对账现有 P0 交付**

```bash
git branch --show-current
git status --short
git log -6 --oneline
```

Expected: 当前为隔离分支 `codex/p0-runtime-foundation-20260822`，工作树 clean；P0 firewall/typed error/pure-read/active-client confirmation commits 已存在。

- [x] **Step 2: 写入本计划并扫描占位词**

```bash
rg -n 'T(BD|ODO)|implement[[:space:]]+later|fill[[:space:]]+in[[:space:]]+details|Similar[[:space:]]+to[[:space:]]+Task' docs/superpowers/plans/2026-08-23-p1-p3-editable-mcp-generation.md
```

Expected: no matches。计划中的每个生产改动都有明确文件、失败测试、通过命令和 commit 门。

- [x] **Step 3: 提交计划文档**

```bash
git add docs/superpowers/plans/2026-08-23-p1-p3-editable-mcp-generation.md
git commit -m "docs: plan editable generic MCP generation through P3"
```

Expected: one documentation-only commit，未触碰 provider、额度或用户项目文件。

## Task 1：P1 建立通用 Module/Runtime/Asset 边界

**Files:**
- Create: `electron/capabilityCore/moduleManifest.ts`
- Create: `electron/capabilityCore/moduleRegistry.ts`
- Create: `electron/capabilityCore/moduleCatalogBootstrap.ts`
- Create: `electron/productionRun/productionExecutionBinding.ts`
- Modify: `electron/productionRun/productionRunTypes.ts`
- Modify: `electron/runtime.ts`
- Modify: `electron/assets/projectAssetStore.ts`
- Test: `electron/capabilityCore/moduleManifest.test.ts`, `electron/capabilityCore/moduleRegistry.test.ts`, `electron/productionRun/productionExecutionBinding.test.ts`, `electron/runtime.task-envelope.test.ts`, `electron/assets/projectAssetLease.test.ts`

- [x] **Step 1: 先写失败测试，证明差异来自声明而不是 vendor 分支**

测试必须使用两个仅存在于 fixture 的 capability profile：一个声明 image + `aspectRatio/seed`，另一个声明 video + `duration/fps`；测试同时覆盖参数增删、模式切换、参考素材替换/排序、未知 module/provider capability、过期/foreign asset lease。断言：所有失败发生在 provider dispatch 前，且错误带字段路径和恢复动作。

```bash
pnpm exec vitest run electron/capabilityCore/moduleManifest.test.ts electron/capabilityCore/moduleRegistry.test.ts electron/productionRun/productionExecutionBinding.test.ts electron/runtime.task-envelope.test.ts electron/assets/projectAssetLease.test.ts --reporter=dot
```

Expected: FAIL，原因是 typed manifest/binding/lease seam 尚不存在；不得调用真实网络或 spend grant。

- [x] **Step 2: 实现最小通用 schema 与 registry**

`ModuleManifest` 必须声明 input/output kinds、parameter schema、asset input schema、provider recovery capabilities（submit idempotency/query/reconcile/cancel）和 allowlist；`ModuleRegistry` 为一次 Run 固定 snapshot。任何不支持的字段返回显式 `unsupported_capability`，不能静默删掉；provider/model 名称只作为数据，不成为代码分支。

- [x] **Step 3: 给 RuntimeTask/ProductionJob 加 typed binding**

绑定至少包含 immutable project UUID/generation、runId/shotId、contractHash、runtimeTaskId、provider namespace、provider idempotency key、request fingerprint、fencing epoch 和 envelope ref。旧记录读入时只能生成只读 migration projection，不能在普通 read 中写回或改状态。

- [x] **Step 4: 统一资产引用与 lease**

`AssetRef` 以 project/generation/contentHash/version/privacy/expiry 为边界；写入、替换、删除、排序只改变 candidate；provider 前验证 lease/state。列表读取与生成结果使用同一个稳定 identity，不能同时保留随机写入 ID 与重算 ID 两套真相。

- [x] **Step 5: 运行红→绿与提交**

```bash
pnpm exec vitest run electron/capabilityCore/moduleManifest.test.ts electron/capabilityCore/moduleRegistry.test.ts electron/productionRun/productionExecutionBinding.test.ts electron/runtime.task-envelope.test.ts electron/assets/projectAssetLease.test.ts --reporter=dot
pnpm run typecheck
pnpm exec eslint electron/capabilityCore/moduleManifest.ts electron/capabilityCore/moduleRegistry.ts electron/capabilityCore/moduleCatalogBootstrap.ts electron/productionRun/productionExecutionBinding.ts electron/productionRun/productionRunTypes.ts electron/runtime.ts electron/assets/projectAssetStore.ts
git diff --check
```

Expected: targeted tests PASS，provider request counter 为 0；typecheck/eslint/diff-check PASS。

```bash
git add electron/capabilityCore electron/productionRun electron/runtime.ts electron/assets/projectAssetStore.ts
git commit -m "feat: add generic runtime module and asset boundaries"
```

## Task 2：P2 实现 PlanCandidate → ExecutionContract 纯编译器

**Files:**
- Create: `electron/capabilityCore/executionContract.ts`
- Create: `electron/capabilityCore/generationContext.ts`
- Test: `electron/capabilityCore/executionContract.test.ts`, `electron/capabilityCore/generationContext.test.ts`
- Reference: `electron/capabilityCore/mcpGenerateParams.ts`, `electron/runtime.ts`, `electron/productionRun/productionRunTypes.ts`

- [x] **Step 1: 写失败测试覆盖“真实页面式编辑”**

同一 candidate 依次执行以下操作并比较每次 preview：切换模型、切换供应商、切换 image/video 模式、修改任意参数、增加/删除/替换/重排参考素材、恢复上一次版本。断言：每次都生成新的 candidate revision；未封存时可以继续编辑；同一输入 + 同一 registry snapshot 得到完全相同的 contract hash；不同输入绝不沿用旧 hash。

```bash
pnpm exec vitest run electron/capabilityCore/executionContract.test.ts electron/capabilityCore/generationContext.test.ts --reporter=dot
```

Expected: FAIL，原因是 compiler/context 尚未实现。

- [x] **Step 2: 实现 canonicalization、hash 与 field ledger**

编译器只接受结构化 `PlanCandidate` 与 registry snapshot，输出 `ExecutionContractV1`、canonical JSON/hash、保留字段 ledger、warning/dropped-field ledger、required confirmation scope 和 provider-neutral `ResolvedTaskRequestV1` 输入。排序只对明确的集合字段 canonicalize；用户素材顺序和参数语义不得被意外重排。

- [x] **Step 3: 实现能力/资产/预算预检**

`generationContext` 只读地合并当前 project lease、素材状态、module/provider/model manifest 与费用估算。任何 unsupported parameter、过期素材、provider 不具备 native submit idempotency/query/reconcile 的情况，在 contract 生成阶段返回可读错误；不得在 preview 阶段发起 provider 请求或 mint grant。

- [x] **Step 4: 实现封存语义**

封存时记录 `contractHash` 与 `baseRevision`。封存前修改只更新 draft；封存后修改原 candidate 必须返回 `new_draft_required`，原 Job/receipt/artifact 可继续查询。provider/model/参数/素材变化都必须纳入 hash，不能只比较 display name。

- [x] **Step 5: 红→绿、提交并记录 P2 证据**

```bash
pnpm exec vitest run electron/capabilityCore/executionContract.test.ts electron/capabilityCore/generationContext.test.ts --reporter=dot
pnpm run typecheck
pnpm exec eslint electron/capabilityCore/executionContract.ts electron/capabilityCore/generationContext.ts
git diff --check
```

Expected: all compiler/editability tests PASS，preview providerCalls=0，hash stability and no-loss assertions PASS。

```bash
git add electron/capabilityCore/executionContract.ts electron/capabilityCore/generationContext.ts electron/capabilityCore/*.test.ts
git commit -m "feat: compile editable generation plans into contracts"
```

## Task 3：P2 让 MCP 与 GUI 共享可编辑语义

**Files:**
- Create: `electron/capabilityCore/mcpGenerationTools.ts`
- Modify: `electron/capabilityCore/generationDispatcher.ts`
- Modify: `electron/capabilityCore/dispatcher.ts`
- Modify: `electron/capabilityCore/mcpToolCatalog.ts`
- Modify: `electron/capabilityCore/rpcServer.ts`, `electron/capabilityCore/mcpStdioServer.ts`, `electron/capabilityCore/host.ts`
- Modify: `electron/preload.ts`, `src/desktop/bridge.ts`
- Test: `electron/capabilityCore/mcpGenerationTools.test.ts`, `electron/capabilityCore/generationDispatcher.test.ts`, `electron/capabilityCore/nomiMcpGenerationPlanning.test.ts`, `electron/capabilityCore/rpcServer.test.ts`

- [x] **Step 1: 写失败的跨入口一致性测试**

用同一 candidate 分别从 MCP stdio、RPC、renderer/GUI adapter 提交 preview/edit；断言三者返回相同 `candidateRevision`, `contractHash`, `warnings`, `nextAction`。对旧 alias（`nomi_generate`、`production.*`）携带任何 semantic binding 继续返回 `legacy_path_forbidden`；裸 legacy read 兼容不变。

```bash
pnpm exec vitest run electron/capabilityCore/mcpGenerationTools.test.ts electron/capabilityCore/generationDispatcher.test.ts electron/capabilityCore/nomiMcpGenerationPlanning.test.ts electron/capabilityCore/rpcServer.test.ts --reporter=dot
```

Expected: FAIL，原因是 planning/edit routes 未接到共享 compiler/service。

- [x] **Step 2: 接入只读 context 与草稿操作**

提供 `context/read`、`operation/create`、`plan/patch`、`preview`、`plan/submit`；每个写操作要求已验证 `ProjectLease`、使用 Run repository CAS，并返回结构化 `nextAction`。只读 projection 不调用 `resumeUnfinishedRuns`、不修复文件、不触发 driver。

- [x] **Step 3: 做可编辑交互的最小 projection**

MCP 结果显示摘要、当前模型/供应商/模式、参数变更、参考素材缩略/顺序、估算费用、warning 和单一 primary action；GUI 若被 MCP 客户端能力限制，只显示同一摘要和一个“在当前客户端确认”的 fallback card，不创建第二个审批流程。错误文本使用普通语言，状态同时用文字/图标表达，不只靠颜色。

- [x] **Step 4: 红→绿并提交**

本步证据：`mcpGenerationTools.test.ts` 4 tests，连同 dispatcher/policy/RPC/MCP 相关 5 suites 共 87 tests；semantic tool catalog 已进入 `tools/list`，`nomi_start_generation` 接入标准进度 token。该 handler 仍是可替换的纯 planning seam；默认 Run-owned durable adapter 与真实 MCP/UI 旅程留在 Task 4/5，避免把内存 fixture 当生产事实源。

语义 gate 已补为同一 challenge 的一键链：`request_generation_gate` 在封存前生成 contract/challenge；MCP 客户端提交可验证 attestation 后由主进程签发 receipt，`decide_generation_gate` 持久批准后自动进入 `start_generation`。没有可验证 attestation 时只允许 GUI fallback，不接受裸 `confirm`。

```bash
pnpm exec vitest run electron/capabilityCore/mcpGenerationTools.test.ts electron/capabilityCore/generationDispatcher.test.ts electron/capabilityCore/nomiMcpGenerationPlanning.test.ts electron/capabilityCore/rpcServer.test.ts --reporter=dot
pnpm run typecheck
pnpm exec eslint electron/capabilityCore/mcpGenerationTools.ts electron/capabilityCore/generationDispatcher.ts electron/capabilityCore/dispatcher.ts electron/capabilityCore/mcpToolCatalog.ts electron/capabilityCore/rpcServer.ts electron/capabilityCore/mcpStdioServer.ts electron/capabilityCore/host.ts electron/preload.ts src/desktop/bridge.ts
git diff --check
```

Expected: MCP/GUI semantic parity PASS；没有 provider/spend side effect。

```bash
git add electron/capabilityCore electron/preload.ts src/desktop/bridge.ts
git commit -m "feat: expose one editable generation semantic flow"
```

## Task 4：P3 接通 Run-owned WAL/outbox 与唯一 Runtime Adapter

**Files:**
- Create: `electron/capabilityCore/generationRuntimeAdapter.ts`
- Create: `electron/capabilityCore/generationSingleShot.ts`
- Create: `electron/productionRun/productionRunRuntimeEnvelope.ts`
- Create: `electron/productionRun/productionRunResume.ts`
- Modify: `electron/productionRun/productionRunIntentLog.ts`
- Modify: `electron/productionRun/submissionOutbox.ts`
- Modify: `electron/productionRun/productionRunRepository.ts`, `electron/productionRun/productionRunService.ts`, `electron/productionRun/productionRunLock.ts`
- Modify: `electron/productionRun/productionRunDriverOps.ts`
- Modify: `electron/tasks/taskResultQuery.ts`
- Test: `electron/capabilityCore/generationRuntimeAdapter.test.ts`, `electron/capabilityCore/generationSingleShot.test.ts`, `electron/productionRun/productionRunRuntimeEnvelope.test.ts`, `electron/productionRun/productionRunResume.test.ts`, `electron/productionRun/submissionOutbox.test.ts`

- [x] **Step 1: 写失败的 crash/idempotency matrix**

fake provider 必须可配置在以下窗口抛错：准备前、intent commit 后 dispatch 前、provider 已接受但响应丢失、polling 中重启、materialization 前后。断言：

```text
same (runId, contractHash, shotId) -> same receipt/job
raw provider submit count -> 1
provider accepted without task id -> submission_unknown + reconcile_required
submission_unknown -> no blind retry
definitely_not_submitted -> explicit retry with same provider idempotency key only
legacy arrange/export driver calls -> 0
```

```bash
pnpm exec vitest run electron/capabilityCore/generationRuntimeAdapter.test.ts electron/capabilityCore/generationSingleShot.test.ts electron/productionRun/productionRunRuntimeEnvelope.test.ts electron/productionRun/productionRunResume.test.ts electron/productionRun/submissionOutbox.test.ts --reporter=dot
```

Expected: FAIL，原因是默认 production path 还没有用 Run-owned WAL/outbox 和 P3 adapter。

- [x] **Step 2: 实现 durable prepare 顺序**

在任何 provider call 前按固定顺序写：sealed contract → reservation → runtime envelope → `generation.submit.intent` prepared/committed → job status `submit_intent_persisted/submitting`。每一步使用 Run lock/fencing + repository CAS；恢复时以 WAL 记录而不是进程内 Map 判断是否已提交。

- [x] **Step 3: 实现唯一 provider seam 与 provider capability gate**

`generationRuntimeAdapter` 只接收 sealed `ExecutionContract` 和 resolved request；provider adapter 必须声明 native submit idempotency/query/reconcile/cancel。缺任一能力直接 `provider_capability_missing`，不发请求。模型与供应商特有字段由 manifest schema 映射并保留 ledger；不支持的字段不能静默 fallback。

- [x] **Step 4: 持久化 receipt、providerTaskId、poll payload 与 Artifact**

本轮先完成零额度的可验证部分：Run-owned job binding、runtime envelope、provider task id/raw receipt 和 unknown 状态已持久化；poll payload、真实 Artifact/materialization 仍在 provider opt-in 前保持未调用。

provider 返回后，先在同一 Run command 中写 providerTaskId/raw request fingerprint/receipt，再进入 polling；查询 payload 可跨进程重建。成功只通过 provider-owned output descriptor → Asset store content hash/materialization receipt 写 Artifact；失败、取消、unknown 分别 settle/release/unsettled，unknown 保持 `needs_attention`。没有 output/materialize 能力的 provider 仍可提交，只返回人工核对，不假装有本地 Artifact。

- [x] **Step 5: 接入 P3 resume 并隔离旧 driver**

Run-owned `productionGenerationSubmission` 已具备单独的 resume/reconcile seam，并已由 app RPC/stdio 默认绑定到真实 provider registry；semantic single-shot 不进入 legacy driver。

`productionRunResume` 只处理 `generation.single-shot`，读取 projection 不触发恢复写；重启后根据 envelope/WAL 进入 poll/reconcile/attention。对 legacy playbook 保留原行为，P3 测试证明 `productionRunDriverOps` 的 arrange/export 未被调用；app RPC/stdio 默认 reconcile 在 terminal poll 后尝试一次 provider-owned materialization。

- [ ] **Step 6: 红→绿并提交**

```bash
pnpm exec vitest run electron/capabilityCore/generationRuntimeAdapter.test.ts electron/capabilityCore/generationSingleShot.test.ts electron/productionRun/productionRunRuntimeEnvelope.test.ts electron/productionRun/productionRunResume.test.ts electron/productionRun/submissionOutbox.test.ts --reporter=dot
pnpm run typecheck
pnpm exec eslint electron/capabilityCore/generationRuntimeAdapter.ts electron/capabilityCore/generationSingleShot.ts electron/productionRun/productionRunRuntimeEnvelope.ts electron/productionRun/productionRunResume.ts electron/productionRun/productionRunIntentLog.ts electron/productionRun/submissionOutbox.ts electron/productionRun/productionRunService.ts electron/productionRun/productionRunLock.ts electron/tasks/taskResultQuery.ts
git diff --check
```

Expected: crash matrix PASS，fake raw submit exactly 1，providerCalls=0 in preview/approval-before-submit。

```bash
git add electron/capabilityCore electron/productionRun electron/tasks/taskResultQuery.ts
git commit -m "feat: add durable single-shot runtime submission and recovery"
```

## Task 5：P3 真实 MCP/UI 用户旅程与可见体验验收

**Files:**
- Modify: `tests/ux/mcp-generation-single-shot.e2e.mjs`
- Create: `tests/ux/mcp-generation-editability.e2e.mjs`
- Create: `docs/audit/2026-08-23-p1-p3-evidence.md`
- Reference: `docs/superpowers/specs/2026-08-23-mcp-client-first-authorization-design.md`

- [x] **Step 1: 写可执行的真实用户任务矩阵**

旅程必须按用户任务而非 API 列表编写：

1. MCP 客户端支持可验证 attestation：展示预览后，用户在当前客户端点一次标准确认；Nomi 不再弹第二次确认。
2. MCP 客户端不支持标准 elicitation：只显示一个简短 GUI fallback card；用户点一次后回到当前客户端继续。
3. 用户切换模型/供应商/模式、改任意参数、添加/删除/替换/重排参考素材，再预览；所有改动可见且合同 hash 更新。
4. 用户在封存前取消并重规划；封存后再改动，收到“新草稿”而不是原任务被偷偷改写。
5. 生成中看到文字+图标进度，可取消；断线/重启后看到明确的继续核账或重试（仅 definitely_not_submitted），不出现重复扣费。
6. provider unknown 时，界面直接说明“已提交但回执丢失，需要核账”，只有一个下一步；不要求用户猜内部状态名。

已实现并通过可验证 attestation 的一次确认旅程与 JSON-RPC 可变输入矩阵（`mcpSemanticGenerationConfirmation.test.ts`、`nomiMcpGenerationPlanning.test.ts`）。共享确认链的真实 Electron 入口和 `generation.single-shot` 精确 challenge 的 GUI fallback 均已走查通过；断线、重启、unknown/reconcile 由 Run-owned submission/recovery 与真实 loopback 旅程覆盖。

- [x] **Step 2: 实现并运行旅程（已完成零额度子集）**

```bash
pnpm exec vitest run electron/capabilityCore/nomiMcpGenerationPlanning.test.ts electron/capabilityCore/mcpSemanticGenerationConfirmation.test.ts electron/capabilityCore/moduleCatalogBootstrap.test.ts --reporter=dot
pnpm run test:e2e -- tests/ux/mcp-generation-single-shot.e2e.mjs tests/ux/mcp-generation-editability.e2e.mjs
```

已通过：standard-client one-click、共享确认链 GUI fallback、editability matrix、`generation.single-shot` 精确 challenge GUI fallback、reconnect/restart/unknown/reconcile；均为零额度，不把 legacy 走查冒充 semantic 全链路。

- [x] **Step 3: 做人眼 UX 对账（共享确认链）**

共享确认链与 semantic 精确 challenge 已逐项检查：主操作只有一个且目标足够大；摘要使用项目/模型/产物等用户语言；客户端确认时 Nomi 不重复弹卡；GUI fallback 卡片有明确“忽略/确认生成”；完成后回到正常创作界面；真实截图已写入 evidence。

- [x] **Step 4: 提交 P3 零额度证据**

```bash
pnpm run test:mcp-journey
pnpm run gates
```

已通过：MCP zero-credit assertions 全绿；fake provider raw submit=1；全量 gates 通过；审计文档已写明测试数量、截图入口、provider/spend 计数、恢复矩阵与剩余决策门。

```bash
git add tests/ux docs/audit/2026-08-23-p1-p3-evidence.md
git commit -m "test: verify editable MCP generation user journeys"
```

## Task 6：阶段复盘、交付与唯一决策点

**Files:**
- Modify: `docs/audit/2026-08-23-p1-p3-evidence.md`
- Reference: `docs/superpowers/plans/2026-08-22-nomi-unified-editor-runtime.md`

- [x] **Step 1: 生成可复核的阶段表**

文档必须按 P1/P2/P3 分开写：用户任务、已验证行为、provider/spend 计数、失败与恢复、截图路径、未完成项。未完成项只能是 P4+（多镜连续性、Timeline adopt、动态模块、Agent parity），不能把 P1/P2/P3 缺口藏进“后续优化”。

- [x] **Step 2: 跑交付前五门**

```bash
pnpm run check:filesize
pnpm run check:tokens
pnpm run check:i18n
pnpm run lint:ci
pnpm run typecheck
pnpm run test
pnpm run build
```

已通过：五门全绿；用户可见共享确认变更已做真实截图与旅程走查；代码只在本隔离分支产生提交。

- [ ] **Step 3: 在真实 provider 前停下并向用户汇报决策**

只汇报一个产品决策包：

```text
已完成：P1 边界、P2 可编辑合同、P3 零额度单镜/恢复/UX/Artifact 证据
需要你决定：是否开启真实 provider 付费 smoke，以及具体凭证、模型和预算上限
推荐：保留已确认的降级原则——缺少原生能力不阻塞一次明确提交；unknown 只核账不盲重提
```

没有用户明确的真实凭证/模型/预算，不运行 `tests/ux/mcp-generation-single-shot.real-provider.mjs`，也不产生真实付费请求。

## 回滚与停止规则

- 任一阶段的 provider/spend counter 在“预览、编辑、未确认”路径非零：立即停止该阶段，保留失败测试和日志，修复入口后再继续。
- WAL 校验、CAS/fencing、receipt replay 或 asset lease 失败时 fail closed；不通过删除记录或重放旧 driver“修复”。
- 真实 provider 仅在 Task 6 的用户决策后启用；真实 smoke 失败不回退到 legacy provider path，而是回到 adapter/capability/reconcile 根因。
- P3 不自动写 Canvas/Timeline；Artifact 只做 proposal-ready，后续 P5 再由用户明确 adopt。
