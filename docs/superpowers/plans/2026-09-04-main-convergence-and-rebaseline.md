# Main Convergence and Rebaseline Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不重复实现已经合入的功能、不破坏仍在工作的 worktree、也不把“CI 绿”误当成产品完成的前提下，把 Nomi 当前所有可追踪的 PR、分支、worktree、计划文档和视觉证据收敛到一个可验证的 `main` 基线；随后用这份真实基线重新判断 M0–M5、Agent、TikHub/视频拆解、画布性能、MCP 和资源链的完成度，并把真正未完成的工作拆成可继续交付的后续 PR。

> 状态：⏳ 已拍板·未开工；S1 盘点报告已入账；S4 史诗重基线待执行（本文件定义执行方案；执行产物和后续 PR 另行记录）

## Current audit report registry

本轮主计划只引用审计报告，不复制或改写报告内容。三份报告是后续 S1/S4 判断的入口：

| 报告 | 当前状态 | 用途 |
|---|---|---|
| [`docs/qa/2026-09-04-pr-branch-inventory.md`](../../qa/2026-09-04-pr-branch-inventory.md) | 已提交 | PR、branch、merge-base、patch-id、worktree 和未知项基线 |
| [`docs/qa/2026-09-04-mcp-rebaseline-audit.md`](../../qa/2026-09-04-mcp-rebaseline-audit.md) | 已提交 | MCP 工具面、合同、L2/打包证据与当前缺口 |
| [`docs/qa/2026-09-04-epics-rebaseline-audit.md`](../../qa/2026-09-04-epics-rebaseline-audit.md) | 工作区已存在，待其所属会话提交 | M0–M5、Agent、TikHub、视频拆解、画布、资源链等史诗状态重基线 |

史诗报告当前仍是未跟踪文件，本次不代替其所属会话提交；因此本计划只引用其路径，并保留“待提交”状态，不把它误写成已合入主分支的证据。

## Task Dependencies and Re-entry Gates

以下输入不是背景信息，而是 S2–S7 的前置依赖。任何依赖项没有刷新、归属不清或证据不完整时，相关任务只能保持 `blocked` / `waiting owner`，不得用本计划的文档提交绕过它。

| 依赖 | 当前证据 | 依赖边界 | 重新进入条件 |
|---|---|---|---|
| PR [#457](https://github.com/aqm857886159/Nomi/pull/457) | `main ← codex/cross-device-continuation-repair-20260904`，head `e54aa4d447d81c0e9013b90b39f4c02884d30525`；Contracts failure，分类 `blocked / needs repair` | 任何 cross-device continuation、workspace sync、恢复或依赖该分支行为的重基线/合并任务 | 刷新 PR head/base/owner/dirty 状态和 checks；在最新 main 上取得可复现红测，修复后以同一断言绿测，并补齐 Electron/打包真实任务证据后，才可转 `open-ready` |
| 前会话释放的 PR [#313](https://github.com/aqm857886159/Nomi/pull/313) / [#328](https://github.com/aqm857886159/Nomi/pull/328) | 两者均为 `previous-session-released / convergence-queue-pending`；#328 的 E2E/Performance/Quality 失败；相关 dirty/unknown worktree 受保护 | experience learning loop、cross-device continuation 及任何会接管其 branch/worktree 或复用其结论的任务 | 先刷新 owner、branch head、最终 merge SHA、dirty/clean 状态和当前 checks；不得抢合、改分支或把旧 checks 当完成证据。接管后重新走本计划的覆盖、红→绿、真实 Electron/打包和视觉门 |
| orphan/prunable worktree 审计（若已有） | [S0 main inventory](../../qa/2026-09-04-main-convergence-inventory.md) 与 [S1 PR/branch/worktree inventory](../../qa/2026-09-04-pr-branch-inventory.md) 已记录 2 个 prunable 候选：`/private/tmp/nomi-issue-237.bBdypr`（`ac9129b`）和 `/private/tmp/nomi-runway-seedance-20260830`（`c397992`）；活跃会话状态 `unknown` | 所有清理、捞取、分支归属判断、PR 重建和可能读取这些路径的任务 | 先逐路径记录 owner/contact、HEAD/branch、tracked/untracked/dirty 状态、gitdir 是否存在、恢复需求和处理决定；确认无外部会话且无需恢复后，才可按生命周期规则处理。没有这份审计或审计未刷新时，禁止 prune、删除、覆盖或据此宣称来源已收敛 |

依赖收据必须同时写入：依赖名称、刷新时间、精确 SHA、命令/PR URL、观察到的阻塞、owner/下一动作。依赖只影响相应能力域，不得用 unrelated check 或“文件已经在工作树”替代。

**Architecture:** 本计划是“收敛与重基线”工作，不新增产品功能。执行顺序固定为：冻结现场 → 盘点证据 → 安全收敛 → 捞取唯一提交 → 建立 M0–M5/功能/视觉矩阵 → 真实 Electron/打包走查 → 生成新的优先级和后续任务。所有产品修复都必须另开小范围任务和 PR，不能借盘点任务顺手扩大范围。

**Tech Stack:** Git/GitHub PR、Git worktree、pnpm、Vitest、Electron/Playwright walkthrough、现有 `tests/ux` 和 `tests/system` 证据脚本、`docs/plan` 与 `docs/qa` 文档。

**Spec:** 这是一份执行方案，不是“理想状态”宣言。每一阶段必须有可重跑的红证据和绿证据；绿证据必须包括与风险相称的自动化测试、持久化/重启验证以及真实视觉走查。任何依赖 skip、吞异常、只看截图、不验证落盘、只看 PR 页面状态的结果都不能作为完成证据。

## Global Constraints

- 基线始终从最新 `origin/main` 建立。禁止直接向 `main`、`master` 或远端默认分支 push；每个代码或计划变更使用独立分支、独立 worktree、单独 PR。
- 执行前先检查 `git status`、`git worktree list --porcelain`、远端 refs 和当前 PR 状态。脏、detached、full clone、正在被另一会话使用的 worktree 一律保留原样；不使用 `git clean -fd`、`git reset --hard`、`git checkout --` 或宽范围删除。
- #313 和 #328 标记为 `previous-session-released / convergence-queue-pending`。本方案先只读取状态和最终合并结果；仍保护其 dirty/unknown worktree，只有刷新 owner、分支和 clean 状态后才允许接管，不抢合、不改分支、不在其未完成时声称收敛完成。
- `BLOCKED`、`DIRTY`、有冲突、依赖 stacked base、缺少真实凭据/真实素材或等待用户拍板的 PR 不得强行合并。它们要进入阻塞清单并由后续任务处理。
- 真实付费调用、使用用户私有 API key、真实外部发布、不可逆数据删除和架构三期定案均需要额外授权或评审；本方案不会自行跨过这些门。
- 当前 main 上已经存在的实现必须先通过证据矩阵确认，再决定是否补代码。发现“已合入但文档过期”时，先修订事实和证据，不重新实现同一功能。
- “阶段完成”定义为：阶段红测已在目标基线上真实失败；阶段工作已完成；绿测真实通过；必要的持久化/恢复检查通过；视觉走查通过或明确记录为阻塞；证据文件已写入并包含 SHA、命令、结果和截图路径。

### Gate A — Test Coverage Audit Before Implementation

每个新增或恢复的能力都必须先完成覆盖审计，再决定实现顺序；真实用户任务不能被单元测试、合同测试、静态截图或 CI 状态替代。审计以 `featureId` 为行建立能力矩阵，并在实现前逐项执行：

1. **覆盖面固定：** 每个能力至少列出并验证 Happy Path、Boundary、Error、Timeout、Network failure；Boundary 要写出具体上下界、空值/长文案/重复执行/旧 revision/窄窗口等输入，不能只写“边界情况”。
2. **依赖隔离：** unit/contract/system harness 对 provider、网络、时钟、文件系统、Electron 外部进程和其他外部服务使用可控 mock/fixture；mock 只能证明本层契约，不能冒充真实用户任务、真实 Electron 或真实打包结果。外部真实调用、私钥和付费 canary 仍遵守授权门。
3. **先红后绿：** 先在目标 `origin/main` 或明确的依赖 head 上运行真实生产形状的失败断言并保存命令、失败 SHA、原始输出和日志路径；确认红测不是旧工具名、测试注入、静态探针或被 `skip`/`catch` 吞掉后，才允许实现/恢复；实现后用同一断言绿测，并保留 positive control 证明错误输入仍会失败。
4. **覆盖收据：** 每个能力的绿测收据必须记录 coverage 命令、line/function/branch 结果（或工具实际提供的等价指标）、阈值/基线、未覆盖分支的精确条件、原因、owner 和下一动作。未知 coverage、只报百分比而不列分支、或把“未覆盖”留成空白，均不得勾选完成。
5. **真实任务独立验收：** 与能力相关的真实用户任务必须在真实 Electron 入口执行；涉及发布/安装/bridge/持久化的能力还必须在实际打包应用执行。任务从真实输入开始，经过用户操作、反馈、确认/拒绝、错误/超时/网络失败恢复，到结果可编辑、可继续使用或明确阻塞。测试套件全绿而真实任务缺失时，状态仍为 `已合入但未证明` 或 `被阻塞`。

Gate A 的退出条件是：能力矩阵五类场景都有测试归属，外部依赖 mock 边界已注明，红→绿输出可重跑，coverage 与未覆盖分支已入账，且 Electron/打包真实任务证据独立存在；否则不得进入实现绿测或视觉 sign-off。

### Gate B — User-Confirmed image2 Design Contract Before UI Implementation

所有用户可见或用户可操作的 UI 变更必须引用 [`docs/design/nomi-design-flow-image2-gate.md`](../../design/nomi-design-flow-image2-gate.md)，并严格按以下顺序执行：

```text
Prompt Brief → image2/image_gen → 用户确认 → 冻结 visual direction/design contract
→ 红测（先红）→ 真实组件实现 → 绿测 → Electron/打包视觉走查 → sign-off
```

- Prompt Brief 必须包含真实 user case、外壳/入口、字段、状态、token、组件、断点、约束、`avoid`、版本和唯一 `changedVariable`；生成图标为 `exploration`，记录 prompt、输出路径和版本。
- 只有用户或在明确授权范围内的指定 reviewer 确认后，才能记录 `confirmed`、冻结 design contract 并开始红测；确认范围、不确认范围、确认人、日期和对应合同路径必须留痕。
- 未确认的 image2/HTML 样张不得作为生产 UI 实现依据；image2 不能替代真实组件、交互契约、异常/空态/超时、持久化/重启、真实用户任务或打包验证。
- UI 任务若发现视觉方向与现状冲突，先停在决策门；不得在未确认的旧样张上叠加实现。实现后的 Electron/打包截图必须与已确认方向和 design contract 逐项对账。

Gate B 的退出条件是：确认记录和冻结合同可追溯，红测发生在实现之前，绿测与真实任务证据完成，视觉走查和 reviewer sign-off 单独记录；缺任何一项都不能称 UI 完成。

## Initial Audit Inputs to Recheck

以下是本方案建立时已掌握的入口信息，不是最终结论；S0/S1 必须在最新远端状态上重新验证，防止另一会话已经改变 PR 状态：

- 当前 main 基线曾推进到 `45912ae01a155a3f6592f65368d0ce3d12fc034e`，其中已包含 Agent normal/exception/work-mode、MCP 既有修复、TikHub/视频拆解代码、若干画布性能修复、凭据加密和 M0–M4 相关提交；“代码已在 main”不等于每个用户路径已经毕业。
- #313 与 #328 已释放到收敛队列；只读取状态和最终 merge SHA，接管前必须重新确认 owner、dirty/clean worktree 和分支 head。#452 的 Agent Host usage/receipt 路径曾有 Linux L2 `receipt_invalid`、本地 `lease_invalid` 证据，必须重新验证，不能按 checks 通过的部分宣称完成。
- #457 当前为 `main ← codex/cross-device-continuation-repair-20260904`、head `e54aa4d447d81c0e9013b90b39f4c02884d30525`；Contracts 已失败，Unit/E2E 在运行，分类为 `blocked / 需修复`。#458 当前为 `codex/main-typecheck-repair-20260904 ← codex/pr456-failure-gates-followup-20260904`、head `cd0cc1e9d22bb1abd14462417ffa2ceceda94659`，是 #456 failure-gate diagnosis 的 stacked PR，分类为 `stacked / 待重基线`。详见 [S1 PR/branch/worktree inventory](../../qa/2026-09-04-pr-branch-inventory.md)。
- #419 是 stacked 的 M5 packaged graduation 路线；M5 checklist 仍要求重新确认 packaged parity、真实 Host context、M4 taint/approval spend guard、client confirmation chain 和 packaged L2。
- 已知有 dirty/blocked/stacked PR（包括 #435、#403、#399、#384、#412、#314 等）和 dirty worktree；它们先保留，不能因为硬盘清理目标而删除代码。#452、#419 的状态也必须按最新 PR 页面刷新。
- `origin/perf/canvas-click-select-20260903` 曾存在未开 PR 的唯一代码提交；`origin/fix/mcp-remaining-holes-20260903` 曾主要是 test-only 分支。两者必须通过 patch-id 和当前行为重测后，分别决定开 PR、归类 duplicate，或转后续任务。
- 历史账本和 `docs/plan/INDEX.md` 存在明显状态漂移：TikHub、视频拆解、画布、MCP、凭据和部分 Agent/M 线条目可能已经有代码但仍标旧状态；反向地，资源链 P0-2/3/4、MCP Q8、M5 graduation、Agent 真实创作闭环等可能只有计划或部分实现。最终以当前 SHA 的证据矩阵为准。
- **PR #454 必须作为独立审计输入纳入本轮：** 它有真实分镜表三栏工作区、分镜行引用/选择解耦、`patch_shots` 编辑内核、模型 vendor 修复和若干走查，但锚行/参数条样章已被用户明确否定；右侧 Agent 的生产模型目录使用 `nomi_canvas_plan`，而部分桥接/投影/选中注入仍按旧工具名 `patch_shots` 判断。详见 `docs/qa/2026-09-04-pr454-storyboard-agent-audit.md`。在 canonical Agent 闭环红→绿和新视觉方向确认前，不把 #454 整体合入。

## Exhaustive Feature Discovery: Preventing Memory-Based Omissions

“全量”在本方案中不是把我当前能想起来的功能列长，而是建立一个可审计的功能宇宙。最终清单必须从下面五个来源分别生成，再做去重和交叉校验：

| 来源 | 枚举对象 | 反查要求 |
|---|---|---|
| 产品入口 | `src/workbench` 下所有一级/二级模块、Workbench shell、页面、panel、workspace、editor、dialog、toolbar 和 `data-*` action | 每个用户可触发动作要对应状态/命令和一个测试或明确的“不适用”理由 |
| 领域逻辑 | `src/workbench/ai`、`creation/storyboard`、`generationCanvas`、`generation`、`timeline`、`preview`、`assets`、`library`、`production`、`project`、`settings`、`onboarding`、`taskCenter`、`skillLibrary`、`export`、`player`、`observability` 等模块 | 每个模块要有用户价值、事实源、持久化边界、失败恢复和当前证据 |
| 外部能力 | `src/desktop/*BridgeTypes.ts`、MCP tool mapping、provider/model catalog、skills、IPC/transport 和 `nomi_*` 工具 | 每个 tool/capability 要有 schema/授权/执行/副作用/receipt/恢复测试，不能只登记 UI 名称 |
| 自动化证据 | `tests/agent-runtime`、`tests/agent-system`、`tests/ux`、`src/**/*.test.*`、`package.json` 中的 test/gate/build 脚本 | 每个测试要反向指向能力；通过测试但没有真实用户路径或视觉证据时标为未证明 |
| 计划与历史 | `docs/plan`、`docs/superpowers/plans`、`docs/superpowers/specs`、`docs/architecture`、`docs/qa`、已合并/开放 PR 和所有 Git refs | 每个计划要绑定当前代码/PR/SHA 或明确标为历史、重复、仅设计、阻塞或待决策 |

执行 S1 时必须保存以下“无遗漏检查”：

- 用 `find src/workbench -mindepth 1 -maxdepth 2 -type d | sort` 固定领域模块清单；逐个登记，不允许只围绕 Agent/MCP/分镜表搜索。
- 用 `rg --files src tests electron docs` 枚举实现、测试、设计、计划和 QA 文件；再用 `rg -n 'data-action|aria-label|nomi_|mcp|storyboard|agent|run|export|preview|timeline|asset|library|setting|onboarding'` 生成候选关键词索引。关键词只用于找候选，最终必须人工归并，避免同名重复或漏掉不含关键词的功能。
- 从 `package.json` 的所有 `test:*`、`check:*`、`gates*`、`build*`、`bench:*` 脚本反查能力；每个与产品行为有关的脚本都要落到能力矩阵，纯工具脚本也要标注为工程能力。
- 从 `docs/architecture/agent-m0-tool-mapping.md`、MCP plans/specs、tool registry 和 bridge types 反查 MCP 全量工具；不能只按当前某次 journey 中实际调用的工具统计。
- 从所有 `tests/ux/*.walk.mjs`、`*.e2e.mjs`、`*.test.mjs` 和 `src/**/*.test.*` 反查已经被测试保护的功能，再对照产品入口寻找“有功能无测试”和“有测试无当前入口”。
- 每条候选都生成稳定 `featureId`，推荐格式为 `domain.capability.surface.action`；同一能力在 UI、Agent、MCP、Storyboard、Canvas、Timeline 的不同入口共享 featureId，不得重复计数。
- **全量闭合条件：** 顶层模块 100% 有记录；用户动作 100% 有状态/命令/证据或“不适用”理由；MCP tool 100% 有合同和旅程归属；测试脚本 100% 有能力归属；计划/PR 100% 有当前状态。无法归属的条目进入 `unknown-needs-review`，在闭合前不能删掉。
- **红证据：** 故意从矩阵中删除一条模块、一个 MCP tool 或一个 walkthrough，闭合检查必须失败；这证明盘点系统真的能发现遗漏。
- **绿证据：** 恢复条目后闭合检查通过，且每个 featureId 都能沿“设计/入口 → state/command → effect → persistence → test → visual walkthrough”链路找到证据或明确阻塞。

## Red → Green → Visual Gate

每一个阶段和每一个后续修复都按以下顺序执行，不能只做最后的绿测：

1. **建立红证据。** 在精确的目标 SHA 上运行该阶段的验收断言，或为缺失的行为加入最小测试断言；必须记录真实的 `FAIL`、错误位置和未满足的产品条件。红测不能由“文件不存在”这种无意义条件代替，必须能证明用户可观察的行为尚未成立。
2. **做最小范围的工作。** 只修改该阶段列出的文件和依赖；如果发现需要跨阶段的架构改动、视觉改稿或实时同步，暂停并转成新的决策项。
3. **跑绿证据。** 先跑聚焦测试，再按风险跑 contracts、unit、system、desktop、journey、performance、packaged/release；记录命令和实际输出。不能用 `|| true`、捕获异常后继续、扩大 timeout 或 skip 来制造绿。
4. **做真实走查。** 使用真实 Electron 或打包应用完成用户路径，验证状态、写入、重启/恢复、错误恢复和不收费/不重复执行语义。UI 任务必须截图并与批准的 mockup 或 design contract 对照。
5. **写阶段收据。** 收据记录 base/head/merge SHA、红测、绿测、运行环境、截图、视觉结论、剩余风险和下一步。只有收据完整，阶段才能勾选完成。

推荐的收据字段如下，不能用“已测试”“已看过”这类不可复核描述替代：

```text
stage: Sx
scope:
base_sha:
head_sha:
merge_sha:
red_proof: command + observed failure
green_proof: command + observed pass
persistence_proof: files/state/restart evidence
visual_proof: mockup + screenshot paths + reviewer result
remaining:
decision_needed:
```

## Three Required Evidence Structures: UI/Function, MCP and Storyboard Table

这三部分必须在每个阶段同时出现，不能只测后端、只走 UI 或只看分镜表局部组件。执行人要为每个能力建立一条可追踪链：

```text
设计真源/mockup
  -> UI surface
  -> user action / UI command
  -> projection/state transition
  -> runtime/Host/MCP effect
  -> persisted receipt or recovery state
  -> automated assertion
  -> real Electron/package walkthrough + screenshot
```

### UI and Function Structure

- **Surface 层：** 以 `src/workbench/ai/ProjectAgentResidentShell.tsx` 为 Agent 常驻界面入口；相关 settings surface 为 `src/workbench/settings/AgentHostSection.tsx`；画布 surface 以 `src/workbench/generationCanvas/reactFlow/GenerationCanvasReactFlow.tsx`、`GenerationCanvasReactFlowOverlays.tsx` 和对应 CSS/visual contract 为入口。
- **Intent/command 层：** 检查 `src/workbench/ai/agentIntent.ts`、`projectAgentUiCommands.ts`、`projectAgentTurnCommands.ts` 和 `agentLoopMode.ts`，确认点击、提交、停止、重试、确认、恢复等动作都有明确语义，不让组件直接绕过命令层写状态。
- **Projection/state 层：** 检查 `projectAgentUiProjection.ts`、`projectAgentProjectionStore.ts`、`useProjectAgentThreadMessages.ts`、`agentTurnLifecycle.ts`、`agentUsageStore.ts`；每个可见状态都要能回溯到事实源、session/turn identity 和失败原因。
- **Runtime/effect 层：** 检查 `projectAgentClient.ts`、`workbenchAgentRunner.ts`、`src/desktop/projectAgentBridgeTypes.ts` 和 `src/desktop/mcpBridgeTypes.ts`；确认 UI 状态、Agent Host、MCP effect、confirmation/receipt 和项目落盘之间没有第二套隐式协议。
- **Canvas integration 层：** 需要时沿 `src/workbench/generationCanvas/agent/`、`runner/`、`events/`、`store/` 和 `reactFlow/` 追踪“Agent 提案 → 用户确认 → 画布写入 → undo/recovery → 后续时间线/预览”完整链路。
- **UI 完成判定：** 不是组件存在或截图相似，而是每个状态/操作具备：设计预期、命令入口、projection 事实、持久化结果、自动化断言、真实路径和视觉证据。缺任何一面都标为 `已合入但未证明` 或 `部分完成`。

### MCP Test Structure

MCP 测试按“工具面 → 握手/授权 → 执行 → 副作用 → 收据/恢复 → 打包态”分层，不能只跑一个 happy path：

- **静态与合同层：** `pnpm run check:mcp-payload`、`pnpm run check:mcp-tool-refs`、`pnpm run gates:contracts`；确认 tool name/description/schema/ref、payload、能力声明和边界没有漂移。
- **L1 接入层：** `tests/ux/mcp-l1-handshake.e2e.mjs`、`tests/ux/mcp-client-activation.walk.mjs`、`tests/ux/mcp-skills-integration.e2e.mjs`；验证 MCP client 激活、工具可见性、skill 注入、连接失败和恢复。
- **L2 交互层：** `tests/ux/mcp-l2-journeys.e2e.mjs`、`mcp-generation-elicitation-first.e2e.mjs`、`mcp-generation-single-shot-gui-fallback.e2e.mjs`、`mcp-generation-multishot-confirm.e2e.mjs`、`mcp-generation-provider-degradation.e2e.mjs`、`mcp-draft-loop.e2e.mjs`；验证授权/确认、免费与收费边界、单镜/多镜、GUI fallback、provider degradation、取消/重试和重复执行。
- **应用与真实创作层：** `tests/ux/mcp-apps-host-render.e2e.mjs`、`production-mcp-journey.e2e.mjs`、`agent-runtime-production.walk.mjs`；验证 MCP 结果如何进入 Agent、画布、时间线或预览，并检查用户可编辑性。
- **打包与发布层：** `pnpm run test:mcp-l2:packaged` 及 `tests/ux/packaged-mcp-smoke.e2e.mjs`；必须在实际 `release/mac-arm64/Nomi.app`（或收据中明确的当前打包物）上验证 bridge、安装身份、工具面、授权和持久化。缺少打包物只能记为 blocked，不能用开发态代替。
- **MCP 必查断言：** 工具描述与引用一致；未授权不能产生 provider effect；确认收据绑定正确 project/session/revision；重复提交幂等；失败可分类且不吞异常；取消/重启后不重复扣费、不丢状态；MCP 结果能回到正确项目/画布；每个 skip 都有原因和替代证据。
- **MCP 红绿要求：** 先在当前 main 让目标断言真实失败，记录具体 tool/effect/receipt 缺口；实现或合并后重跑同一断言，并用故意错误的 revision、receipt、tool ref 或 provider response 做 positive control，确认测试确实能阻止回归。

### New Storyboard Table Structure

新版分镜表不是旧分镜方案的一个改名页面，而是“分镜计划/镜头状态/参考绑定/执行结果”的工作面。盘点时必须把旧方案和新版实现按同一条链对齐，明确哪些是迁移后的能力、哪些是新增加的能力、哪些仍只是计划：

- **Design/source 层：** 以 `docs/plan/2026-09-01-storyboard-table-genre-profile.md`、`docs/plan/2026-08-13-video-deconstruction-storyboard-table.md`、`docs/design/mockups/2026-09-01-storyboard-table-image-first.html` 和 `docs/design/mockups/contracts/2026-09-01-storyboard-table-image-first.intent.mjs` 为入口；更早的 storyboard 方案只能作为历史需求来源，不能直接覆盖新版设计。
- **Workspace/UI 层：** 检查 `src/workbench/creation/storyboard/StoryboardWorkspace.tsx`、`StoryboardShotTable.tsx`、`StoryboardPlanEditor.tsx`、`StoryboardPlanCard.tsx`、`StoryboardActionCard.tsx`、`StoryboardBulkBar.tsx`、`StoryboardSelectionToolbar.tsx`、`shotRow/StoryboardShotRow.tsx` 和 `shotRow/StoryboardShotFrame.tsx`。
- **Interaction/exec 层：** 检查 `storyboardDInteractions.ts`、`storyboardActionCardModel.ts`、`exec/storyboardRowActions.ts`、`exec/storyboardExec.ts`、`exec/storyboardNodeBinding.ts` 和 `exec/storyboardRowStatus.ts`，确保单镜生成、批量生成、锁定/等待参考、重试、筛选、折叠、插镜、选择、拖拽/排序、编辑 prompt、设置首帧/参考和回画布都有明确动作与状态。
- **Plan/IR/provenance 层：** 检查 `src/workbench/generationCanvas/agent/storyboardPlan.ts`、`storyboardPlanSchema.ts`、`storyboardPlanEdits.ts`、`storyboardDialogue.ts`、`storyboardTimelinePlan.ts`、`runStoryboardPlanner.ts`、`sendStoryboardToTimeline.ts`、`adoptStoryboardBatch.ts`；验证镜头 ID/order、场分组、对白、prompt skeleton、model/mode/params、参考素材、source/version/hash 和 stale/revision 不会在表格与画布/时间线之间丢失。
- **Storyboard test/evidence 层：** 必须运行 `tests/ux/storyboard-table-exec.walk.mjs`、`storyboard-table-phasec.walk.mjs`、`storyboard-methodology.walk.mjs`、`storyboard-trigger.walk.mjs`、`src/workbench/creation/storyboard/storyboardDInteractions.test.ts`、`storyboardActionCardModel.test.ts`、`exec/storyboardExec.test.ts`、`storyboardPlanLifecycle.test.ts` 及相关 `generationCanvas/agent/storyboard*.test.ts`。
- **Story-to-canvas/timeline 交接：** 证明“生成/编辑分镜表 → 用户审阅/批准 → 产生或更新画布节点 → 绑定参考/执行状态 → 送入时间线 → 可回查/可撤销/重启可恢复”。`shot-table-is-a-projection-of-canvas-nodes` 规则必须作为验收前提，不能另外维护一套与画布脱节的镜头事实源。
- **新版完成判定：** 分镜表完成不等于“表格能显示”。必须同时证明结构化计划可编辑、状态可解释、执行动作有效、错误可恢复、画布/时间线交接正确、项目落盘可恢复，并通过批准 mockup 的视觉走查。缺任何一面，状态写为 `部分完成` 或 `已合入但未证明`。
- **分镜表红绿要求：** 先在当前 main 让一个可观察缺口失败，例如旧计划字段在表格编辑后丢失、批量计数与实际待执行镜头不一致、参考变更未标 stale、落画布后 order/anchor 丢失或重启后状态消失；完成实现/合并后重跑同一断言，并使用故意错序、缺参考、过期 revision 或失败镜头做 positive control。

## Stage Exit Matrix

| 阶段 | 结果 | 必须留下的证据 | 未满足时的动作 |
|---|---|---|---|
| S0 冻结现场 | 当前 main、PR、worktree 和远端快照固定 | `main-convergence-inventory` 初版、基线 SHA、dirty 清单 | 停止清理，先保护现场 |
| S1 全量盘点 | 每个 PR/分支/计划都有唯一身份和状态；未知会话/未提交史诗报告必须显式保留 | [PR/branch/worktree inventory](../../qa/2026-09-04-pr-branch-inventory.md)、[MCP audit](../../qa/2026-09-04-mcp-rebaseline-audit.md)、[epics audit](../../qa/2026-09-04-epics-rebaseline-audit.md) 及其 SHA/重复判断 | 不能凭标题或 CI 状态判断完成度；未知项未解除前不得清理/合并 |
| S2 安全收敛 | 只有可验证、非重复、非阻塞的提交进入 main | 每次合并的 merge SHA、checks、合并后验证 | 冲突或失败转后续修复 PR |
| S3 遗留提交捞取 | 唯一且已提交的 worktree/remote branch 得到归宿 | patch-id/range-diff、来源、目标 PR | dirty/detached 只保留，不自动搬运 |
| S4 真实重基线 | M0–M5、Agent、各 epic 的事实状态被重新证明 | 状态矩阵、当前 main SHA、未证实项 | 文档状态降级为“未证实/阻塞” |
| S5 视觉与交互走查 | 关键路径与设计稿一致，状态和持久化可见 | 截图、差异说明、人工 sign-off | 不一致转 UI 修复，不以自动化代替 |
| S6 新计划与优先级 | 后续工作按价值、风险、依赖排好顺序 | 新的 backlog/计划和决策清单 | 架构/UI/付费门分别等待评审 |
| S7 交付收据 | 本轮文档和证据可被团队复用 | 最终 receipt、PR、检查结果 | 不宣称“全部完成” |

## Task 0 — Freeze the Current Main Baseline

- [x] 在独立 worktree 从最新 `origin/main` 建立本轮工作分支，并保存 `git rev-parse HEAD`、`git status --short --branch`、`git worktree list --porcelain`、`git remote -v` 和远端 refs。
- [x] 运行 `pnpm run delivery:preflight`。若 preflight 失败，先分类为环境、权限、网络、依赖或仓库问题，记录结果，不通过盲目重试伪造基线。
- [x] 建立 `docs/qa/2026-09-04-main-convergence-inventory.md`，先写入基线快照和运行环境；后续所有盘点追加到该文件或同名结构化数据中。
- [x] **红证据：** 在清单尚不存在时，尝试读取本轮清单应得到明确的“尚未建立”结果；随后以当前 SHA 建立清单。这里的红证据只证明收据链尚未建立，不把缺文件当作产品失败。
- [x] **绿证据：** 清单包含当前 SHA、分支、worktree、远端访问结果和 preflight 结果，并通过 `git diff --check`。
- [x] 退出条件：现场已经冻结，且所有后续操作都能回到本轮基线。任何脏 worktree 的路径、所有者和保留原因必须登记。

## Task 1 — Inventory Every PR, Branch, Worktree and Plan

> 当前状态：盘点报告已完成并入账；活跃会话进程扫描受 macOS 权限限制，已在报告中显式标记为 `unknown`。S1 的未知项不是失败隐藏点，后续任何清理/捞取前仍必须重新确认所有权。

- [x] 读取全部 open PR 的 `number/title/head/base/state/checks`，同时读取最近关闭/已合并 PR；详见 [S1 PR/branch/worktree inventory](../../qa/2026-09-04-pr-branch-inventory.md)。
- [x] 扫描本地和远端分支，计算与 `origin/main` 的 merge-base、ahead/behind、变更文件、patch-id 和 exact-tree duplicate；详见同一报告的重点 refs 表。
- [x] 扫描所有 worktree，区分 clean、dirty、detached、prunable 和未知会话风险；只登记，不删除。活跃进程检测的权限阻塞已保留在报告中。
- [x] 把现有 orphan/prunable 审计作为后续任务依赖：记录每个候选的路径、HEAD/branch、gitdir、dirty/untracked、owner 和“保留/待确认/可回收”决定；本轮已有 2 个 prunable 候选，但因会话状态 `unknown` 只登记不处理。
- [x] 读取计划/历史来源并记录文档状态漂移；MCP 与史诗的专项证据分别见 [MCP rebaseline audit](../../qa/2026-09-04-mcp-rebaseline-audit.md) 和 [epics rebaseline audit](../../qa/2026-09-04-epics-rebaseline-audit.md)。
- [x] **红证据：** 报告记录了过期账本与当前 PR/check/ref/worktree 证据的冲突，以及无法证明活跃会话为空的环境阻塞。
- [x] **绿证据：** 当前可确认条目已按 `open-blocked`、`stacked`、`duplicate`、`dirty-preserve`、`previous-session-released`、`convergence-queue-pending`、`needs-decision` 等唯一分类登记，并带 URL/SHA/路径；未确认项保持 `unknown`。
- [x] 退出条件：形成以 `origin/main=45912ae01a155a3f6592f65368d0ce3d12fc034e` 为基线的 PR、branch、worktree、计划来源清单；剩余未知项已显式列出，不作为清理或合并授权。

## Task 2 — Converge Safe PRs Into Main

- [ ] 从 S1 清单中只选 `open-ready` 且 base 可对齐、checks 可复核、owner/clean 状态已刷新且没有 dirty/未知接管风险的 PR。按依赖顺序一次处理一个，处理前再次刷新 `origin/main` 和 PR head。
- [ ] 每次合并前做重复检查：`git diff --cherry-pick`、patch-id/range-diff、涉及文件、是否已经以另一个 merge commit 进入 main。重复实现直接归档为 duplicate，不再合并。
- [ ] **红证据：** 对每个候选 PR 在合并前运行其最小验收/集成断言，记录目标行为在当前 main 或 PR head 上仍未被证明；如果候选已经满足行为，红证据应转为“重复/无需合并”，不能为了形式制造失败。
- [ ] 用 GitHub 的正常 merge 流程合并后，立即刷新本地 `origin/main`，记录 merge SHA；运行 `pnpm run delivery:verify-merged -- --expected-sha <merge-sha>`，并按改动风险补跑 `pnpm run gates:contracts`、`pnpm run test`、`pnpm run build` 或对应的系统 profile。
- [ ] 将 #457 作为 cross-device 相关任务的硬依赖：在最新 main 和当前 PR head 分别刷新 Contracts/Unit/E2E/owner/dirty 状态；Contracts 仍失败时保持 `blocked / needs repair`，不合并、不复用其未证实行为，也不以正在运行的 Unit/E2E 代替失败收据。
- [ ] #313/#328 先保持 `previous-session-released / convergence-queue-pending`，仍保护 dirty/unknown worktree；只有刷新 owner、分支和 clean 状态后才可接管并重新走红测。不得把 #452、#457、#458、#419、#412、#435、#403、#399、#384、#314 等 blocked/dirty/stacked 项伪装成 ready；它们只更新清单并生成后续动作。
- [ ] **绿证据：** 合并后 main 可复现、merge verification 通过、没有新增未解释的 contract/build/test 失败，且合并记录附带 PR URL、merge SHA 和 checks。
- [ ] 退出条件：所有安全可合并项已归位；剩余项都有具体原因和下一步，不再存在“可能已经合了但没人知道”的无主状态。

## Task 3 — Harvest Unique Committed Worktree/Branch Changes

- [ ] 对 clean committed 的 worktree 和远端无 PR 分支做来源审计；优先处理明显唯一且与当前 main 不重复的提交，例如 canvas click-select 分支、test-only MCP remaining-holes 分支和 stacked M5 分支，但先确认所有权、依赖和是否已有新实现。
- [ ] 对每个来源使用 `git merge-tree --write-tree origin/main <head>`、`git range-diff origin/main...<head>`、`git diff --cherry-pick origin/main...<head>` 和文件级审阅；不得直接 cherry-pick 未审计的整条历史。
- [ ] dirty 或 detached worktree 只收集路径、SHA、修改文件和联系人；除非用户明确授权，不移动、清理、覆盖或强制提交它们。untracked 文件也必须登记，不能因为 Git 默认不显示就丢失。
- [ ] 对所有 orphan/prunable/unknown-session 记录先消费 [S0/S1 审计结果](../../qa/2026-09-04-main-convergence-inventory.md)，逐路径补齐 owner、HEAD、branch、gitdir、dirty/untracked 和恢复/回收决定；若审计不存在或无法刷新，任务停在 `blocked`，不得执行 `git worktree prune`、删除或捞取。
- [ ] **红证据：** 每个拟捞取来源在合并前必须有一个可复现的缺口断言，证明该唯一能力尚未在当前 main 中成立；若断言已经绿，则来源归类为 duplicate/已吸收。
- [ ] 将唯一变更拆成最小 PR；test-only 变更与生产代码分开；stacked 变更按依赖从底到顶处理，任何 base 不可重放的分支转为重建任务，不强行合并。
- [ ] **绿证据：** 每个捞取 PR 都有红→绿记录、merge verification、相关系统测试和视觉走查（若触及 UI），来源 commit 与最终 merge SHA 可追溯。
- [ ] 退出条件：所有已提交且唯一的遗留工作都有归宿；未提交内容仍被安全保留并有 owner/下一动作。

## Task 4 — Rebaseline M0–M5, Agent and All Feature Epics

> 当前状态：史诗重基线报告已在工作区生成但尚未由其所属会话提交；在该报告提交并可追溯到当前 `origin/main` 前，Task 4 仍保持未完成。MCP 的专项报告已提交，可作为 Task 4 的输入，但不能替代史诗全量重基线。

- [ ] 以最新 main SHA 重新阅读并汇总 [epics rebaseline audit](../../qa/2026-09-04-epics-rebaseline-audit.md)；同时以 [MCP rebaseline audit](../../qa/2026-09-04-mcp-rebaseline-audit.md) 和 [PR/branch inventory](../../qa/2026-09-04-pr-branch-inventory.md) 校对来源、SHA、PR 状态和阻塞项。史诗报告未提交前，不把 Task 4 标为完成。
- [ ] 建立 `docs/qa/2026-09-04-main-convergence-rebaseline.md`，每一行至少有：目标/用户价值、代码路径、相关 PR/merge SHA、契约证据、单元证据、系统/真实 Electron 证据、持久化/重启证据、视觉证据、当前状态、阻塞原因和下一动作；主表至少分为 MCP、Agent、Storyboard Table 三大能力簇，并记录三者之间的交接。
- [ ] 对每个 `featureId` 增加 Gate A 覆盖矩阵：Happy Path、Boundary、Error、Timeout、Network failure 的测试文件/命令、外部依赖 mock 边界、红测/绿测 SHA、coverage 结果、未覆盖 branch 条件、真实 Electron 任务和实际打包任务（适用时）；缺少真实任务时不能因自动化全绿而升级状态。
- [ ] 状态只能使用：`已合入且已证明`、`已合入但未证明`、`部分完成`、`仅计划/设计`、`未开始`、`被阻塞`、`等待 owner/状态刷新`、`等待用户决策`。`CI green` 只能填某个证据列，不能直接填完成状态。
- [ ] M0–M5 必须按现行 checklist 重跑，尤其确认当前 main 的 packaged parity、真实 Agent Host context、M4 taint/approval spend guard、M5 client confirmation chain 和 packaged L2；旧的 50/50、旧 release 或旧 SHA 证据全部标记为历史证据。
- [ ] TikHub 与视频拆解要区分“代码已合入”“面板存在”“真实连接器/无水印链路可运行”“拆解结果能进入后续创作工作流”；缺真实 key 时只做无密钥契约和模拟证据，不声称 live-certified。
- [ ] 新版分镜表要单独核验，不沿用旧分镜方案的完成结论：确认新版设计、表格编辑、单镜/批量执行、参考绑定、状态/错误、画布与时间线交接和重启恢复；把旧方案仍有效的需求与已被新版替代的需求分开登记。
- [ ] 画布性能要区分 S1–S5、S6 hygiene、S6 click-select 和真实业务路径；性能脚本通过不等于视觉和交互完成。
- [ ] **红证据：** 对每一条声称完成的能力在当前 main 上找出至少一个未覆盖的证据面；如果四面（代码、自动化、真实路径、视觉/持久化）已经全部成立，则该项不再制造红测，直接标为已证明。
- [ ] **绿证据：** 每个状态都有对应可重跑命令、SHA、原始输出或截图，且能解释旧计划为什么需要更新。
- [ ] 退出条件：团队拥有一份以当前 main 为唯一基准的事实账本；“已经有了”和“真正完成了”被明确拆开。

## Task 4A — Audit PR #454 Storyboard Slice Before Any Merge

- [ ] 阅读并引用 `docs/qa/2026-09-04-pr454-storyboard-agent-audit.md`，把 #454 拆成三条独立状态：分镜表功能、锚行/参数条设计、右侧 Agent canonical tool path；不得用 PR 标题或单个 Workers check 代表整体完成。
- [ ] **功能红测：** 在当前 main 和 #454 head 各执行一次生产形状的 Agent 调用：`toolName=nomi_canvas_plan`、`args.operation=patch_shots`。断言选中行注入、确认卡、行内 diff、批准/拒绝、proposal/receipt、落盘和重启恢复；若现有测试只喂 `patch_shots` 或使用 `window.__nomiStoryboardPatchPreview`，该证据只能列为旧名/测试探针证据，不能代替红测。
- [ ] **别名正性对照：** 同一测试用故意将 `operation` 改成未知值、修改错误 revision、遗漏必需 selector 或点名 `durationSec` 但篡改另一个字段；每种错误都必须可靠失败/不落盘。测试必须能证明 `nomi_canvas_plan` 与 `patch_shots` 的工具名/operation 责任边界没有漏接。
- [ ] **功能绿测：** 修正或证明 canonical 边界后，用同一生产形状跑通“右侧 Agent 提议 → 分镜行内预览 → 一次确认 → 一次撤销/拒绝 → receipt → 重启恢复”；至少覆盖 prompt、shot kind、duration、aspect ratio、model/vendor 中的代表性字段，并验证未点名字段逐字保留。
- [ ] **MCP 交接：** 从 `nomi_canvas_plan` 的 MCP/模型目录、schema、授权、执行器和 output receipt 追到分镜表；补跑 `check:mcp-payload`、`check:mcp-tool-refs`、合同/单元和相关 L2 journey。不能只测 legacy `patch_shots` descriptor。
- [ ] **设计红证据：** 将已否定的 `docs/design/mockups/2026-09-03-storyboard-anchor-row-and-param-rail.html` 及交接文档中的用户反馈登记为视觉 FAIL；不把 `storyboard-anchor-model-modes.walk.mjs` 的 8 个静态模式通过写成设计通过。
- [ ] **设计绿门：** 新方向先明确锚/镜头空间组织、信息层级、真实字段和交互状态，再在真实 Electron 隔离原型或真实组件中截图；必须由用户/指定 reviewer 视觉确认后才允许进入实现 PR。新方案仍按红→绿→视觉走查，不继续在未确认的旧样张上叠修。
- [ ] **范围判定：** #454 只算 storyboard + Agent tool slice，不替代 Agent interaction epic、MCP 全量、M0–M5、TikHub/视频拆解或画布性能的重基线；任何未覆盖面进入对应 follow-up。
- [ ] 退出条件：#454 每个文件簇都有 `merged-and-proven`、`duplicate`、`open-ready`、`needs-decision` 或 `merged-but-unproven` 的唯一分类；不存在“功能可能已做、设计不喜欢、Agent 还没验证”混成一个 PR 状态的情况。

## Task 5 — Perform the Required Visual and Interaction Walkthrough

- [ ] 任何 UI 走查对象先引用 [`docs/design/nomi-design-flow-image2-gate.md`](../../design/nomi-design-flow-image2-gate.md)，确认 Prompt Brief → image2 → 用户确认 → 冻结 contract 已完成；未确认对象停在 `waiting user decision`，不得先做红测后的 UI 实现。至少对照 `docs/design/mockups/2026-09-03-agent-ui-p0-exception-states.html`、`docs/design/mockups/2026-09-01-video-deconstruction-v1.html` 以及仓库中对应的 design contract；PR #454 的锚行/参数条样张明确是失败样张，必须标记为 `visual-fail / needs-design-decision`，不能当批准稿。
- [ ] 走查 Agent 正常态、异常态、恢复态、工作中/停止/重试/需确认态；额外走查 storyboard 右侧 Agent 的 canonical `nomi_canvas_plan(operation=patch_shots)` 提议、预览、确认、拒绝、撤销和重启恢复；走查 MCP 工具调用、授权/确认、失败/重试和结果回写；走查 TikHub → 视频拆解 → 新版分镜表 → 后续创作入口；走查画布拖拽/选中/缩放/大量节点；走查 M5 打包应用关键链路。
- [ ] 优先使用现有 walkthrough：`tests/ux/agent-ui-conformance.walk.mjs`、`tests/ux/agent-ui-exception-states-runtime.walk.mjs`、`tests/ux/mcp-l2-journeys.e2e.mjs`、`tests/ux/mcp-generation-elicitation-first.e2e.mjs`、`tests/ux/mcp-skills-integration.e2e.mjs`、`tests/ux/tikhub-connector.walk.mjs`、`tests/ux/storyboard-table-exec.walk.mjs`、`tests/ux/storyboard-table-phasec.walk.mjs`、`tests/ux/canvas-performance-benchmark.e2e.mjs`、`tests/ux/p4-s5-canvas-landing.e2e.mjs`、`tests/ux/p4-s6-rework-version.e2e.mjs`；打包态使用 `tests/ux/mcp-l2-journeys.e2e.mjs --packaged release/mac-arm64/Nomi.app`，并记录是否因缺 release/凭据而阻塞。
- [ ] 每条路径至少保存：进入前状态、关键交互后状态、错误/确认态、落盘或恢复后的状态。截图存入本轮 QA 证据目录，不以一张“看起来对”的截图代替完整走查。
- [ ] 视觉检查维度固定为：布局与间距、信息层级、字体/字号/行高、token 颜色与明暗主题、边界和空状态、按钮/禁用/加载/错误/确认态、交互反馈和恢复路径、无裁切/重叠/重复控件、键盘与可访问性、项目/资源/Agent 身份一致性、折叠/重启后的状态一致性。
- [ ] **红证据：** 每个走查对象先填写一条“预期设计/用户行为”和一条“当前截图或运行结果尚未证明的点”；若发现视觉偏差，先记录差异，不在本收敛 PR 中自行改 UI。
- [ ] **绿证据：** 由人工 reviewer 对每个对象填写 pass/fail、SHA、mockup 路径、截图路径、差异结论和签名；任何 fail 进入独立 UI 修复 PR，并重新走“样张/确认 → 红 → 实现 → 绿 → 视觉”。
- [ ] 退出条件：核心路径的视觉一致性、交互状态和持久化结果均有证据；未有批准设计的部分被清楚标记为决策项。

## Task 6 — Make the Test System Enforce the Process

- [ ] 对照现有 L0 contract、L1 context/harness/effects、L2 deployment、L3 creator journey 分层，确认本轮新增的每个断言属于正确层级，不把生产逻辑塞进测试系统。
- [ ] 为每个后续未完成项定义一个最小可观察断言，并把红测和绿测记录在对应测试文件或独立 evidence test 中；测试 metadata 要含 project snapshot、skill/tool snapshot、model config、seed、Git SHA 和 harness version。
- [ ] 在任何实现/恢复前创建能力覆盖矩阵并按 Gate A 固定顺序落证：Happy Path → Boundary → Error → Timeout → Network failure；为每一类指定真实生产形状、可控外部依赖 mock、红测命令和预期失败，再实现最小改动并以同一命令绿测。真实 Electron/打包用户任务另列，不得由这些 mock 测试替代。
- [ ] 所有 projection/assertion 都要有 positive control：临时改变输入或预期时必须可靠失败；不能用宽泛 selector、空数组、catch 后继续或 skip 把坏路径吞掉。
- [ ] 按风险调用现有命令：`pnpm run gates:contracts`、`pnpm run test`、`pnpm run build`、`pnpm run test:system:full`、`pnpm run test:system:contracts`、`pnpm run test:system:unit`、`pnpm run test:system:desktop`、`pnpm run test:system:journeys`、`pnpm run test:system:canvas:full`、`pnpm run test:system:performance`、`pnpm run test:system:release`、`pnpm run test:mcp-journey`、`pnpm run test:mcp-l2:packaged`、`pnpm run test:canvas-perf`、`pnpm run test:canvas:acceptance`。不需要的 profile 要在收据中说明原因。
- [ ] 每个能力的绿测后运行并保存 coverage 结果；收据必须列出 line/function/branch（或工具等价项）、阈值/基线、未覆盖分支的输入条件、是否有 owner/后续任务，并把 coverage 不足降级为未证明，而不是只记录总百分比。
- [ ] **红证据：** 在真实目标 baseline 上执行每项新增/恢复的验收断言，保存失败输出；若测试在 baseline 就通过，说明缺口判断错误，回到 S4 修正状态，不把它伪装成待实现。
- [ ] **绿证据：** 修复或合并后同一断言通过，且 positive control 仍能失败；系统测试与真实路径结果一致。
- [ ] 退出条件：未来任务可以复制同一套红→绿模板，测试系统能阻止“只改文档/只过 CI/只截一张图”的假完成；每个能力的 coverage 与未覆盖分支均可追溯，Electron/打包真实任务仍单独通过。

## Task 7 — Produce the New Prioritized Execution Backlog

- [ ] 根据 S4/S5 的真实结果生成 `docs/plan/2026-09-04-main-convergence-follow-ups.md`，只保留当前 main 上确实未完成或未证明、且有用户价值的项目；每项写明用户价值、依赖、风险、红测、实现范围、绿测、视觉验收和交付方式。
- [ ] 优先级默认按“阻塞主创作链路 → 影响 Agent 核心闭环 → 影响团队复用/稳定性 → 性能/体验 → 研究/扩展”排序；但必须以证据矩阵为准，不凭历史标题排序。
- [ ] 预期需要单独推进的候选包括：#452 Agent Host usage/receipt 稳定性、M5 packaged graduation、Agent piece 3/真实创作闭环、MCP Q8/B 余项、新版分镜表与旧分镜方案的迁移/补齐、resource chain P0-2/3/4、canvas click-select S6；它们只有在 S4 重新确认后才进入正式顺序。
- [ ] 架构三期（清理硬环并建立中立契约层）必须单列为架构决策任务：先读近邻开源实现，再做六角色评审和迁移边界，不在本收敛任务里直接重构。
- [ ] 所有 UI 变更先产出样张/对照稿并等待确认；所有真实供应商/付费/私钥验证先写无密钥 contract，再请求授权做最小 canary。
- [ ] **红证据：** 每个新 follow-up 在当前 main 上都有可复现的失败断言或明确未证明证据；没有红证据的项只能是研究/决策项，不能冒充实现任务。
- [ ] **绿证据：** 每个 follow-up 都能独立开 branch/worktree、独立 PR、独立验收和独立视觉走查，不依赖“最后一起看”。
- [ ] 退出条件：下一轮工作可以从这份 backlog 直接派发，且不会再次重复已经合入的 TikHub、视频拆解、画布、MCP、凭据或 Agent 工作。

## Task 8 — Close the Delivery Loop

- [ ] 更新 `docs/qa/2026-09-04-main-convergence-receipt.md`，汇总本轮开始/结束 SHA、合并 PR、捞取来源、保留的 dirty worktree、状态矩阵、视觉 reviewer、阻塞项和 follow-up 链接。
- [ ] 仅在事实发生后更新 `docs/plan/INDEX.md` 和过期计划的状态；每个状态变化引用当前证据，不批量把旧 `🚧` 改成完成。
- [ ] 最终 main 合并完成后再次运行 `pnpm run delivery:preflight` 和 `pnpm run delivery:verify-merged -- --expected-sha <actual-main-sha>`；按本轮改动风险补齐 contracts、build、system、journey、packaged 和 visual gates。
- [ ] **红证据：** 在最终收据写入前，检查必填字段/证据路径缺失应失败；检查是否仍有未解释的 dirty/blocked/skip/视觉 fail。
- [ ] **绿证据：** 收据完整、链接可读、SHA 可追溯、结果可重跑；若仍有未完成项，最终结论必须写“本轮收敛完成，产品未全部完成”，并列出确切 follow-up，不写笼统的“全部完成”。
- [ ] 退出条件：团队可以从 main、PR、QA receipt 和新 backlog 还原“现在是什么、做过什么、还缺什么、下一步怎么做”，并能在另一台机器复用同一清理/验证规则。

## Rollback and Stop Criteria

- 任何合并后验证失败，先保留失败现场和 merge SHA，停止继续合并，建立回滚/修复 PR；不通过重写远端历史解决。
- 任何发现来源分支与 main 重复、来源归属不清、base 冲突无法解释或会覆盖 dirty worktree，停止捞取，登记并等待决策。
- 任何视觉样张与现有实现冲突，停止 UI 实现，先把差异和最小选择整理给 reviewer；本计划不自行选择新的视觉方向。
- 任何测试只有在 skip、catch、空数据、非真实 mock 或无法复现的外部环境下通过，均视为未完成；要么补正确 harness，要么明确标记 blocked。
- 任何需要用户私钥、真实付费、外部发布、第二台可访问机器或不可逆清理的步骤，保留无密钥/模拟证据并请求授权，不把模拟结果升级为 live 结论。
- 任何架构三期方案若不能同时说明迁移边界、回滚点、契约兼容性和六角色评审结果，停止实现，只交付决策材料。

## Handoff Format

每个阶段或后续 PR 的交付消息必须包含：

```text
worktree: absolute path
branch: exact branch name
base_sha: exact SHA
head_sha: exact SHA
merge_sha: exact SHA or not merged
pr: URL and state
red_proof: command + observed failure
green_proof: command + observed pass
visual_evidence: mockup/screenshot/reviewer result
remaining: exact unresolved items and owner/next action
```

本计划自身的交付只包含这份方案和必要的 QA 模板，不包含 Agent、MCP、TikHub、视频拆解、新版分镜表、画布或架构代码改动。任何在盘点中发现的产品缺口，都必须按上述红→绿→视觉门拆成后续任务。
