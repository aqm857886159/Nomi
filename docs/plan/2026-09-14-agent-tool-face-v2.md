# Agent 工具面 v2 · 20 动词重切（取代 PR #777）

> 状态：🚧 实施中（2026-09-14）· 分支 `feat/agent-tool-face-20-verbs-v2-20260914`（从 `origin/main` 155f660ce 重切）
> 设计正本：`docs/design/2026-09-11-agent-tool-face-first-principles.md`（含 09-11 拍板记录：一个工具 = 状态×效果；同格合并 `action`；跨格必拆；不许兼容旧名）· 实施方案：`docs/plan/2026-09-11-agent-tool-face-implementation.md`（PR A 已合，本文档是 PR B）· 评审：PR #777 深度评审（scratchpad `review-777.md`，方案 B）· 根因合同：`docs/fixes/2026-09-11-agent-generation-second-door.root-cause.json`
> 证据：`docs/plan/agent-tool-face-v2-evidence/`（R17 先验会红日志、R30 题库 42 句、真实模型结果与逐句表）

## 0. 一页读懂（D6）

**真实摩擦**：用户对 Agent 说「生成一张开场图」，#777 上模型选对了 `draft_shots`，但每一次都拿回 `generation_surface_unavailable`——翻译层把动词翻成 `nomi_generation_plan`，生成适配器手写的白名单里没有这个名字，`return null` 被 lane 写成「生成面不可用」。作者把它误诊成隔离 profile 的凭据问题，还写进了 PR 正文当安全证据。同一条分支上为了让红变绿又长出了 8 处旧名兼容层（拍板明令禁止）。

**这次要权衡的一个东西**：**从 main 重切、只搬承重文件，其余按设计重做**，代价是要重写一批跟着旧名走的测试与走查；收益是每一刀都能对应到设计的一行、能过 #759 的数门门岗、正文能诚实写出 R30 数字。

## 先查别人

1. **设计正本 §2「先查别人」**（[`docs/design/2026-09-11-agent-tool-face-first-principles.md`](../design/2026-09-11-agent-tool-face-first-principles.md)）——逐条抄了 Anthropic define-tools / writing-tools-for-agents（[platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)、[anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)）、Claude Code `sdk-tools.d.ts`、pi SDK 0.85.1、Codex `codex-rs`、Cline、Cursor、Gemini CLI、MCP 2025-06-18；本文档不重新调研，直接沿用它的 20 动词与返回信封。
2. **GitHub MCP `issue_write` 的「弹表单即 isError + STOP」**（[`docs/research/2026-09-11-agent-tool-face-prior-art/github.md`](../research/2026-09-11-agent-tool-face-prior-art/README.md)）——`generate` 的返回值照抄：`isError:true` + "STOP. Do not call any other tools and do not claim generation has started"，模型读到的是错误结果，所以它说不出「已经生成」。
3. **达芬奇社区版 MCP 的 `SECURITY.md`**（[`docs/research/2026-09-11-agent-tool-face-prior-art/davinci-resolve.md:240-242`](../research/2026-09-11-agent-tool-face-prior-art/README.md)）——"Compound tools group multiple actions behind an `action` parameter, so their annotation is conservative when any action in the group can mutate state"：审批粒度是工具名，所以后果粒度也必须是工具名。这是拒绝第 21 个 `nomi_canvas_edit` 声明的依据。
4. **Codex `intercept_apply_patch`**（[github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/apply_patch.rs#L499](https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/apply_patch.rs#L499)）——第二扇门接回同一个处理器、同一份身份；本刀「方法名只在 `GENERATION_METHODS` 声明一次，三处派生」照它的形状。
5. **pi SDK 工具注册**（`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.ts:500-510`）——只有 first-registration-wins 的 Map，无效果去重、无冲突检测；所以「一个工具一种后果」的判据必须建在我们自己的注册表装配期（`assembleVerbDeclarations`），不改上游。

## 1. 从 #777 挑走的承重文件（评审 §1）

`verbs/readVerbs.ts`、`verbs/writeVerbs.ts`（去掉第 21 个 `nomi_canvas_edit`）、`electron/shared/canvas/nodeExecutionKinds.ts` + 渲染层对账测试、`modelSetup.ts` + `mcpHostSurfaceOps.ts` 分支、`laneVerbTransport.ts`、契约别名 `pi → method` 搬迁（generation / export / productionRun / timelineWrite / documentWrite / assetRead / skillRead / skillWrite / canvasDelete）、`scripts/tool-face-baseline.json` 收缩、`tests/system/agent-tool-face-usecases.json`、根因合同正文、`verbDeclaration.ts` 的 `alsoCovers`（`check_job` / `cancel_job` 替导出契约说话）。

**没带**：`artifacts/real-target-branch/`（`-f` 加进 gitignore 目录的截断 trace）、三份 09-13 合同（把本分支自己的中间态当根因）、`docs/audit/2026-09-13-…structure-review.md`、8 处兼容层（下 §3）。

## 2. 根因修法：方法名单一真相源（R28 三层）

| 层 | 落点 | 先验会红 |
|---|---|---|
| 编译器 | `generation.ts` 的 `GENERATION_METHODS`（唯一声明）→ `GenerationMethodName` 字面量类型；`laneVerbTransport.generationCall()` 只收这个类型 | 手写一个不在表里的方法名 → tsc 红 |
| 单一真相源（P1） | 契约 `method` surface 与 `generationTransportAdapters.GENERATION_TOOL_NAMES` 都从 `GENERATION_METHOD_NAMES` 派生；手抄的九元素数组与 `MODEL_GENERATION_TOOL_NAMES` 投影同 commit 删 | — |
| 门岗 | `electron/agentLane/laneVerbTransport.test.ts`：遍历延迟目录，每个动词翻出的方法名必须被目标 lane 适配器认（+ 阳性对照：动词名本身不被认） | 对着手写数组跑：draft_shots / generate / check_job / cancel_job 四条红（`…-evidence/r17-verb-transport-red.txt`） |

同一份「动词参数 → 契约语义输入」翻译（`verbs/verbSemanticInput.ts`）挂在声明上（`VerbDeclaration.semanticInputOf`），`toSemanticInput` 是唯一调用点：内部 lane 的 prepare/execute 与对外 MCP 的 `parseDerivedCall` 都从它拿契约输入——#777 只给 lane 翻，于是对外 `nomi_document_edit` 收到 `where` 就 `capability_input_invalid`。

## 3. P1：相对 main 的 legacy/compat 增量 = 0

删掉的 8 处：`laneCanvasTools.canvasWriteInputOf` 的 `legacy_semantic` 分支与 5 个旧名、同文件重新 push 的 `nomi_canvas_write/plan` + `storyboardAliasSchema`、`registry.ts` 的 `legacyCanvasFace`、`laneToolCatalog.LANE_RUNTIME_COMPAT_TOOL_NAMES`、`check-mcp-tool-references*` 教门岗认旧名、`writeVerbs.ts` 的第 21 个 `nomi_canvas_edit`、`modelFacingToolRegistry.specsForCapability` 里再造 5 个旧名 spec、`laneDesktopTools.test.ts` 的 `it.skip`。证明：`git grep -iE 'legacy|retired|compat' origin/main -- <dir>` 与工作树逐行比对，`electron/agentLane` / `electron/shared/agentCapabilities` / `electron/capabilityCore` 三目录新增 0 行。旧转录里的旧名调用重放只得到「没有这个工具」。

## 4. `generate` 的可见性：durable 的 `cardHidden`

拍板 2「`generate` 独立成动词、一个动词一种 nextAction」要求 `draft_shots` **不出卡**、`generate` 出卡。#777 在翻译层写了 `cardHidden: true` 与 `operation: 'present'`，但 planning 层根本没有这两样（`.strict()` 会拒、`present` 不在 union 里）。本刀把它做成 durable 状态：`ProductionGenerationPlan.cardHidden`（类型 / 仓库 / reducer `generation.present` / store `present()` / planning `present` / `projectPendingSpendConfirm` 过滤 / 适配器在 present 时刻替全自动档决门）。旧 Run 没有这个字段 = 卡可见，行为逐字不变；外部 MCP 宿主与面板自己的路径不传 `cardHidden`，也逐字不变。

## 5. 设计对账表（20 行）

| 动词 | 状态×效果 | nextAction | 状态 |
|---|---|---|---|
| look_at_canvas | S3–S8 read | none | ✓ |
| read_script | S2 read | none | ✓（`scope`；MCP 传输字段 `documentId`） |
| read_timeline | S12 read | none | ✓（范围 → `inspect_timeline_range` 由声明翻译） |
| look_at_media | S13 read | none | ✓ 五合一（方法由参数形状派生；#777 声明了却没绑执行，本刀经媒体 lane 绑） |
| list_models | S11+S10 read | none | ✓（原生绑定，`models` 组） |
| check_job | S9+S14 read | none | ✓ 生成域→导出域两跳（#777 未绑执行，本刀入 generation 组） |
| read_skill | S15 read | none | ✓ |
| write_script | S2 reversible_local | none | ✓ `where` 三合一；对外 `nomi_document_edit` 同一份声明（破坏性：`operation` → `where`） |
| draft_shots | S3/S4 reversible_local | none | ✓ 唯一造生成类节点；`cardHidden` 落 durable |
| generate | S8 reversible_local | user_sees_spend_card | ✓ `present` 清 `cardHidden`；isError + STOP |
| arrange_canvas | S5 reversible_local | none | ✓ links / tidy；group/retitle 无契约 operation（残余风险） |
| make_artifact | S6 reversible_local | none | ✓ |
| stage_shot | S7 reversible_local | none | ✓ |
| edit_timeline | S12 reversible_local + review | user_sees_review_card | ✓ |
| undo | 上一次改动 reversible_local | none | ⚠️ 只撤时间轴（见 §7 未做） |
| delete_from_canvas | S3/S5/S6/S7 irreversible | user_sees_confirm_card | ✓（无 undoEvidence → 落 irreversible，拍板 4） |
| export_video | S14 irreversible | job_running | ✓ 确认卡由 `effect: irreversible` 派生（硬闸在执行前，与 delete 同一机制；`CONSEQUENCE_BY[irreversible][job_running]` = "After the user confirms, the job runs"） |
| cancel_job | S9/S14 irreversible | user_sees_confirm_card | ✓ 导出域先答，不认再生成域 |
| save_skill | S15 reversible_local | none | ✓ |
| start_model_setup | S11 reversible_local | user_sees_panel | ✓ 只开面板不碰 key |

装配期：`modelFacingToolSpecs("internal")` 恰好 20 个（`check:agent-tool-face-usecases` 从注册表数，不再正则扫源码、没有跳过分支）。

## 6. 对外 MCP 面的裁决（T8）

`profileReason: mcpHandwrittenTransport` 14 个（main 23 → 14；#777 11 但把三个画布写动词写成了 `headlessHost`，那不是它们只投内部面的真实原因）。**为什么不在本刀归零**：对外 MCP 投影是契约粒度（一契约一工具，`projectMcpTool`），画布写的对外工具 `nomi_canvas_edit` 的 `operation` 分支含分镜写入（`propose_storyboard_plan` / `patch_shots`），它们在内部面归 `draft_shots`（generation.plan）——而 MCP 侧的生成面（`nomi_operation_*`）还没收编成派生。此刻把对外画布面切成三个动词，外部宿主就没有地方写分镜。外部面按动词拆名与 #754（接模型 4 工具，`codex/pr754-clean`）同一刀定。

| 动词 | 为什么还是过渡值 | 到期 |
|---|---|---|
| draft_shots / generate / check_job / cancel_job / list_models | 对外生成面是 `nomi_operation_*` 手写目录 | 与 #754 同刀（外部面重切） |
| arrange_canvas / make_artifact / stage_shot | 对外画布写是 `nomi_canvas_edit`（含分镜 operation） | 同上 |
| edit_timeline / undo / export_video / delete_from_canvas | 对外 `nomi_timeline_edit` / `nomi_export_job` / `nomi_canvas_maintenance` 手写传输 | 同上 |
| read_skill / save_skill | 对外没有技能读写工具 | 同上 |

`mcp-transport-catalog` 棘轮 main 20 → 19（`nomi_layout_read/write` 退役，`nomi_canvas_edit` 从「派生」变「手写」——描述仍从三个画布写动词派生）。

## 7. 未做（诚实交付）

- **`undo` 跨状态**：设计要求任一写动词返回 `changeId`、`undo(changeId)` 回退。今天只有 `timeline.write` 有撤销令牌；画布写与文稿写的撤销在渲染层（Cmd+Z / #630 撤销点），没有主进程可调的撤销契约。实施 = 给 canvas.write / document.write 加撤销契约 + 收据关联，超出一天。**影响**：模型对「刚才那步撤销」只能回退时间轴改动，描述里明说（真实模型 R22/R36 的回复也如实说了）。改名 `undo_timeline` 要回设计拍，本刀不擅改。
- **走查按新流程重录**：`golden-path.e2e.mjs`、`tests/ux/g1/c0-fixture.mjs`、`sweep-surfaces.mjs` 编码的是「方案先审阅 → 批准 → 落画布」旅程；20 动词下分镜是草稿直接落画布、卡在 `generate`。31 处调用点已按新动词与参数形状迁移（`check:mcp-tool-refs` 绿），付费卡走查改成 `draft_shots` → 释放 `generate`（draftId 由夹具从工具结果读回）；但这些 Electron 走查未在本机重跑，CI E2E 分类跑到的部分以 CI 为准。
- `arrange_canvas` 的 group / retitle / reposition：`canvas.write` 没有这几个 operation；真实模型 R13/R32 都如实告诉用户「不能建组」。

## 8. 与 #754 的边界

两边都碰：`electron/shared/agentCapabilities/registry.ts`（本刀注册 `MODEL_SETUP_OPEN_CAPABILITY`）、`modelSetup.ts`（本刀新建）、`src/workbench/capability/mcpHostSurfaceOps.ts`（`settings.open-model-provider` 分支）、`scripts/tool-face-baseline.json`。#754 只裁**对外**接模型面（4 个 `nomi_*` 工具），本刀只裁**内部**面（`start_model_setup` 只开面板）。先合本刀；#754 rebase 时保留 `MODEL_SETUP_OPEN_CAPABILITY`，把它的对外工具的描述从同一份 `start_model_setup` 声明派生。

## 9. 不动项 / 回滚 / 验收

不动：契约层 `effect` / `effectClass` / `operationEffectClasses`；对外 MCP 手写目录；画布门 B（`applyCanvasToolCall.ts`）；pi SDK。回滚：单 PR 单 revert；无数据迁移。验收：`pnpm run gates` 全绿；`laneVerbTransport.test.ts` 先红后绿；loopback R30 8/8 · 8/8（`lane-tool-accuracy` 与 MCP 臂）；真实模型 42 句数字在 PR 正文与 `…-evidence/r30-summary.md`。
