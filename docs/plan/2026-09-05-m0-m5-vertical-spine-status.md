# Nomi M0-M5 Agent vertical-spine status ledger

状态：🚧 进行中

> 唯一状态台账：本文件是本交付的持久化状态真源。后续每个未完成项必须拆成独立 PR，并在对应单元格补入命令、SHA、PR 或明确的 blocked reason；状态不得只留在对话中。

## Goal

完成 Nomi 当前主线收敛：以 Agent 的 M0-M5 真实端到端闭环为最高优先级，贯通真实 Electron 用户任务、MCP 调用、最新版分镜表、画布写入、approval、receipt、项目持久化、关闭重启恢复、视觉走查和 packaged 验证。持续盘点并安全收敛所有 PR/分支/worktree/计划；当前 red-stage 只是本总目标的第一阶段，不缩小、不替代总目标。

第一代表任务固定为：新建隔离项目 → 选择分镜行 → 选择 Skill 与模型 → Agent 读取上下文 → `nomi_canvas_plan` → `patch_shots` → 批准/拒绝 → 真实写入项目 → durable receipt/revision → Agent/分镜表/画布一致 → 关闭重启回读/reconcile → packaged 重复。

## Non-goals

本阶段不做 UI redesign，也不修改生产实现。TikHub、APIMart、视频解析、字幕、视频分镜后置；provider spend 只允许在受控 canary 中发生，凭据只走本机环境变量。静态检查、fixture、loopback、CI green 或预写项目不能单独证明真实用户任务完成；不得调用 fake store、生产 handler 或 legacy bare `patch_shots` 作为最终证据。

## Current phase

`M0-M5 development real-user + persistence passed / visual, packaged, main blocked`

The current runner additionally records `M2.public-mcp-session-open` as
`PARTIAL_PROOF`: it is a custom stdio diagnostic that opens a real
`nomi_session_open` lease after row selection, not a Codex-host acceptance.
The latest real APIMart development run reports `status=passed` and
`firstFailure=null`: M0/M1 project and row-2 flow, M2 canonical patch,
M3 Skill/model/Agent context, M4 approve+decline (revision 1), and M5 cold
restart plus R6 continuation all passed with durable readback. The earlier
`capability_receipt_unresolved` result is retained below as historical failure
evidence; it is no longer the current blocker. Visual acceptance, packaged
repeat, main merge, and the full natural-user Codex Host M0-M5 journey remain
unproven. A minimal explicit-selection Codex Host → Nomi MCP semantic
write/read proof exists and remains `PARTIAL_PROOF`.

The APIMart picker repair is now recorded in
`docs/fixes/2026-09-05-unverified-model-picker-eligibility.root-cause.json`:
the shared existing-connection projection admits only `enabled && published &&
adapterState=verified` rows as already added, leaving unverified seeds selectable
for canonical certification.

| Field | Value |
|---|---|
| Base | `origin/main@163bddf157b613bde1d8291098b8813cea2bc80b` |
| Branch | `codex/nomi-m0-m5-convergence-20260905` |
| Worktree | `/Users/aoqimin/.codex/worktrees/e7a6/Nomi` |
| First representative task | real Electron isolated project → storyboard row 2 → Skill/model identity → right Agent context → `nomi_canvas_plan(operation=patch_shots)` → approval/decline → durable write/receipt/revision → three projections → cold restart/reconcile → same-SHA packaged repeat |
| Latest blocking failure | Development APIMart run has `status=passed`, `firstFailure=null`; next gates are visual acceptance, packaged repeat, main merge, and the full natural-user Codex Host M0-M5 journey |
| Evidence contract | `tests/system/agent-vertical-spine-m0-m5.contract.json` |
| Red runner | `tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs` |
| Evidence report | `docs/qa/2026-09-05-agent-vertical-spine-m0-m5-red.md` |
| Conflict boundary | No existing total-plan link was changed; this ledger records the current branch and keeps the active #476 receipt work separate. |

The historical red run in `docs/qa/2026-09-05-agent-vertical-spine-m0-m5-red.md` remains the proof of the original M1 reachability failure. The current branch contains the minimal entry repair and the unchanged real Electron runner has since passed the new-project → storyboard editor → row 2 selection seam (M1). This does not certify the downstream Agent, MCP, receipt, restart, or packaged stages.

### 双入口与证据边界（2026-09-05）

| 入口 | 当前状态 | 已有证据 | 仍缺什么 |
|---|---|---|---|
| **A：真实 Codex Host → Nomi MCP** | `PARTIAL_PROOF` | 当前 Codex desktop Host 原生 `mcp__nomi__nomi_list_projects({})` 已成功；另以真实 `codex exec --json` 驱动当前 worktree，显式 project selection → `nomi_session_open` → `nomi_canvas_edit` → `nomi_read(canvas)` 全部成功（RC=0）。旧安装包的 `create_project`→`session_open` 失败属于版本/无 GUI selection 边界，与仓库内自定义 `NOMI_MCP_STDIO` 诊断链不同 | 真实自然语言多轮 M0-M5、provider/key 接入、receipt/revision、approval/deny、持久化/重启、视觉、packaged 和独立审查证据；旧安装包升级后仍需复核 `current_project` bootstrap |
| **B：Nomi 内部 Agent UI** | `PARTIAL_PROOF` | 真实 Electron 已通过新项目 → 分镜编辑器 → 第 2 行选择；M3 runner 已接入现有 Settings → 通用 → 项目常驻 AI 助手可见开关 | Skill/模型/模式、Agent 多轮修改、canonical effect、approval/deny、持久化/重启、视觉和 packaged 全链路 |

生产默认仍由 `src/utils/agentHostPreference.ts` 保持关闭；测试只能在隔离 profile 中通过真实 Settings UI 显式开启。自定义 stdio、fixture、loopback 和静态合同只能记录为诊断或较低层证据，不能替代入口 A。

### M0-M5 证据成熟度补充

下表把每阶段必须具备的红测、绿测、真实 Electron、持久化/重启、视觉、packaged 和独立审查单独标出来；`PARTIAL_PROOF` 不等于完成，`BLOCKED_ENVIRONMENT` 只表示当前环境或入口尚未可执行。

| 阶段 | 红测 / 绿测 | 真实 Electron | 持久化 / 重启 | 视觉走查 | packaged | 独立审查 | 总状态 |
|---|---|---|---|---|---|---|---|
| M0 | 有合同与 MCP handshake | PASS — 最新 development APIMart run 完成项目创建、路由和磁盘初读 | PASS — 同一任务的项目在 M5 冷重启/R6 读回 | 未做 | 未做 | 未做 | `PARTIAL_PROOF` |
| M1 | 原始 M1/B 红证据保留；当前单测与 runner 入口已绿 | PASS — 最新 development APIMart run 分镜编辑器可见、行 2 可选 | PASS — 行 2 选择在冷重启/R6 后保留 | 未做完整任务走查 | 未做 | 未做 | `PARTIAL_PROOF` |
| M2 | PASS — canonical `nomi_canvas_plan(operation=patch_shots)` 合同与回归通过 | PASS — 同一真实用户任务完成 canonical patch | PASS — canonical durable receipt/revision 读回通过；历史 `capability_receipt_unresolved` 已修复并保留为失败证据 | 未做 | 未做 | 未做 | `PARTIAL_PROOF` |
| M3 | PASS — context/runtime 合同与回归通过 | PASS — Settings APIMart certification 的 Skill/model/mode 与 Agent context 通过 | PASS — 同一项目上下文/身份贯穿后续 R6 | 未做 | 未做 | 未做 | `PARTIAL_PROOF` |
| M4 | PASS — trust/approval 合同与回归通过 | PASS — 同一任务完成 approve + decline | PASS — approve 后 revision=1，decline 为 no-op，receipt 状态读回通过 | 未做 | 未做 | 未做 | `PARTIAL_PROOF` |
| M5 | PASS — cold restart/reconcile 合同与回归通过 | PASS — 同一任务完成冷重启与 R6 继续对话 | PASS — 项目、分镜、画布、receipt/revision 投影读回通过且无重复写入 | 未做 | 未做 | 未做 | `PARTIAL_PROOF` |

### MCP 与内部 Agent 全能力盘点状态

- `tests/system/capabilities.json` 当前登记 23 个能力域，`tests/system/agent-m0-m5.json` 登记 M0-M5 命令和 happy/boundary/error/timeout/network 维度；这些是盘点索引，状态仍为 `PARTIAL_PROOF`，不是“所有工具已可用”的结论。
- MCP 工具仍需按真实 Codex Host、真实生产调用者、主任务覆盖、参数错误、网络失败、超时、重试/幂等、持久化/重启逐项补证；未覆盖项必须继续标记 `MISSING_CALLER`、`CONTRACT_MISMATCH`、`BLOCKED_ENVIRONMENT` 或对应失败状态。
- 内部 Agent 工具需与 capability manifest、Host 注册表和 Nomi Agent UI 逐项对账，补 loading/success/failure/retry/cancel、多轮修改、真实项目写入、receipt/revision、冷启动和中文文案证据；当前仅有局部单测、结构测试和局部 Electron journey，结论为 `PARTIAL_PROOF`。

### PR / 分支状态（2026-09-05）

| PR | 状态与 head | 台账判断 | 当前动作 |
|---|---|---|---|
| #476 | `OPEN / BLOCKED` · `c212093159cdcba100829cbd51f5692f43f43eb1` | receipt 持久化局部实现；双重 receipt 所有权、取消后真实写入、`effect_unknown` 恢复和 requestId/指纹问题仍未收口 | 独立复核和真实任务证据完成前不合入 |
| #484 | `OPEN / BLOCKED` · `acd7939b2af4aaef9ce0e11517db32118c7667c5` | M0-M5 红测/诊断合同；自定义 stdio 不是入口 A 的 Codex 验收 | 保留为红测证据，不升级为完成 |
| #485 | `OPEN / BLOCKED` · `00022921b9aa1ee6e948f3caa0222a107aac8191` | 正式方案/状态台账候选；需继续补双入口、全工具、视觉和后续阶段证据 | 当前唯一台账继续维护，不能以文档状态代替实现 |
| #454 | `OPEN / DIRTY` · `feb392525b8bbd75205890e8099ba1aff72cbba7` | 旧分镜入口/身份和视觉工作；含未确认或已否定方向，不能整体吸收 | 仅在当前入口边界确有需要时逐项复核 |

所有上述 PR 的独立审查、required checks、真实用户任务、视觉和 packaged 证据均未形成当前 M0-M5 的完整 `VERIFIED` 收据。

### M0-M5 后续阶段清单

主线稳定后仍需持续追踪：

1. MCP 全工具生产可用性与真实 Codex 调用覆盖；
2. 内部 Agent 全工具生产可用性与 UI/Host 对账；
3. 多供应商、图片模型和视频模型验证；
4. TikHub；
5. 长视频获取、视频理解、字幕提取和视频分镜表；
6. 关键帧、对白、字幕、时间码和表格编辑；
7. 动效节点与 Agent/HyperFrames 联动；
8. 画布性能、并发生成和大项目恢复；
9. 权限、敏感信息、日志和隐私；
10. 中文化和多语言状态；
11. UI 全面设计收敛；
12. packaged、升级、失败恢复和跨设备验证；
13. Skill 收集区的复制、下载、导出、收藏、分类和版权来源机制；
14. 数据收集的用户同意与隐私边界。

### Fresh inventory and deduplication (2026-09-05)

- `origin/main@163bddf157b613bde1d8291098b8813cea2bc80b` is the active baseline. The checked-out local `main@bcd2e900119e642be46388abb700be1322a4ae38` is its ancestor (328 commits behind) and is not an additional implementation source.
- The M1 Host/runtime core (`d270d34e`) and the M0-M5 test, semantic-MCP, experience-loop, and usage-ledger commits listed in older branches are already ancestors or patch-equivalents of `origin/main`; they must not be reimplemented. Historical branches with unique commits remain review references only until rebased and revalidated.
- `PR #454` (`fix/storyboard-entry-and-vendor-identity-20260903`) and `feat/storyboard-row-select-unify` contain older storyboard interaction work, including an uncommitted row-selection WIP and recovery object `84ac27c8`. They are based on an older merge-base and include a rejected visual direction, so only a narrowly required semantic patch may be considered after comparison with the current M1 repair.
- `PR #476` remote head is `c2120931`. Local branch `codex/mcp-canvas-write-effect-20260904` has an additional unpushed `1a5ccca5`, but it is not included here: its patch assumes the #476 context and the canonical `patch_shots` dual-receipt-owner issue remains unresolved. Revalidate it as a separate receipt slice before any adoption.
- Uncommitted worktrees remain preserved for audit. The most relevant are `/Users/aoqimin/Desktop/Nomi-agent-canvas-real-user-20260904` (canvas maintenance-delete transport test/fix) and `/Users/aoqimin/Desktop/nomi-row-select` (row-selection semantics); neither is treated as merged evidence or copied wholesale.

## Definition of done

代表任务必须模拟真实用户的连续多轮 Agent 协作，而非一次性请求；覆盖从零开始、补充/否定/改口、只改一镜、先预览后确认、分步生成、部分生成、生成后微调、关闭重启后继续追问；每轮记录自然用户话术、Agent 上下文、M0-M5 断言、approval/receipt/revision/persistence 状态，并按未开始→红测→实现→绿测→真实 Electron→持久化/重启→视觉→packaged→合入 main 追踪。

完成 Nomi 当前主线的 Definition of Done：每个 M0-M5 与其对应 PR 都必须记录状态、SHA、证据命令、阻塞原因和下一步；每阶段依次完成红测 → 最小实现 → 同断言绿测 → 真实用户任务 → 持久化/重启 → 视觉走查 → packaged → 合入 main。全量目标完成前，不能把静态/fixture/CI green 当作真实完成。

The total goal is done only when every M0-M5 row reaches every stage below with evidence from the same real user task: visible Electron actions, preload/public MCP production call shape, durable project/receipt/revision readback, approval and decline semantics, Agent/storyboard/canvas projection agreement, cold restart/reconcile, and a repeat from the packaged app built from the current SHA. `main 合入` requires a reviewed PR and explicit merge evidence; the historical red-stage evidence must not be described as production completion.

Stage vocabulary is fixed and ordered: `未开始 → 红测 → 实现 → 绿测 → 真实用户任务 → 持久化/重启 → 视觉走查 → packaged → main 合入`.

## M0-M5 status

Every cell is an evidence pointer or a blocked reason. `absorbed` means existing coverage was retained as context but does not satisfy this same-task completion gate.

### Natural multi-round transcript and internal ledger

The canonical transcript is stored in `tests/system/agent-vertical-spine-m0-m5.contract.json` under `multiRoundProtocol.transcript`; the runner must enter each turn through the visible Agent composer. User-facing text contains no operation/tool/id/fixture/API parameter. The internal record for every turn has M0-M5 assertion, status, receipt, revision, and context fields. The historical red run stopped before R1 at M1/B; the latest development APIMart run completed R1-R6 with `status=passed` and `firstFailure=null`. Visual, packaged, and independent review gates remain open.

| Round | Natural user turn | Required internal status/evidence in this red stage |
|---|---|---|
| R1 | “我想做一个30秒竖屏短片，先理顺故事和分镜，不要一上来生成。” | M0 project route/disk read is passed; M1-M5 are blocked by `M1.select-storyboard-row` / `B`; no approval, receipt, or revision advance. |
| R2 | “先不要生成，只改第三个镜头：让人物站在门口犹豫两秒，其他镜头和内容都不要动。” | Must preserve same project and map natural “第三个镜头” to row 2; current status blocked before selection; receipt/revision remain unchanged. |
| R3 | “我改主意了，先告诉我具体会改哪些，再让我确认；现在不要生成，也不要碰其他镜头。” | Must produce a readable preview without mutation; current status not reached; approval remains pending and no receipt is allowed. |
| R4 | “确认这次修改。先执行这一个镜头的改动，但只生成前三个镜头，后面的先别动。” | Must record one approval, one scoped write and a durable revision/receipt; current status not reached and no write is claimed. |
| R5 | “刚才第三个镜头的犹豫再短一点，门外的雨声保留，其他已经完成的镜头不要改；先预览这个小改动。” | Must carry prior context/receipt/revision into a second proposal and keep it reversible; current status not reached. |
| R6 | “我重新打开项目了，刚才做到哪里？请接着之前的工作，先告诉我现在的状态和下一步，不要直接生成。” | Must reconcile fresh-process project, Agent, storyboard and canvas projections without duplicate write, then await confirmation; current status not reached. |

| Milestone | 未开始 | 红测 | 实现 | 绿测 | 真实用户任务 | 持久化/重启 | 视觉走查 | packaged | main 合入 |
|---|---|---|---|---|---|---|---|---|---|
| **M0** real Electron isolated project | N/A — historical red evidence is retained; current convergence continues on `codex/nomi-m0-m5-convergence-20260905` | PASS — latest development APIMart runner created an isolated project and read the real project file | PASS — project route/read path remains production behavior | PASS — same development run completed M0 as part of the representative task | PASS — visible new-project flow and project readback passed | PASS — project remained available through M5 cold restart/R6 readback | BLOCKED — no visual acceptance claim yet | BLOCKED — packaged full-task repeat remains | `PARTIAL_PROOF` — visual, packaged, and main gates remain |
| **M1** storyboard row 2 selection | N/A — historical red contract is retained as the original failure evidence | PASS — latest development APIMart run reached the storyboard editor and selected row 2 | PASS — row-reference binding repair is in the current branch | PASS — M1 seam passed in the same representative task | PASS — visible row 2 selection passed | PASS — row 2 selection was read back after cold restart/R6 | BLOCKED — visual acceptance requires the complete task | BLOCKED — packaged repeat remains | `PARTIAL_PROOF` — visual, packaged, and main gates remain |
| **M2** canonical `nomi_canvas_plan` / `patch_shots` | N/A — historical red contract is retained as failure evidence | PASS — latest development APIMart run completed the canonical public `patch_shots` call on the selected row | PASS — canonical owner and durable save barrier are implemented and covered by focused regression | PASS — canonical proposal/effect passed in the same real-user run; the earlier `capability_receipt_unresolved` result is historical | PASS — selected-row patch and untouched-field assertions passed | PASS — receipt/revision durable readback passed through cold restart/R6 | BLOCKED — projection visual gate not reached | BLOCKED — packaged canonical call remains | `PARTIAL_PROOF` — visual, packaged, and main gates remain |
| **M3** Skill/model identity + Agent context | N/A — M1 entry is now green; M3 gate is active | PASS — latest development APIMart run completed visible Skill/model/mode selection and right Agent context | PASS — shared context/identity path is implemented | PASS — M3 Skill/model/context assertions passed in the same representative task | PASS — visible selection and Agent context passed | PASS — context identity remained available for M5/R6 continuation | BLOCKED — visual acceptance follows a real Agent turn | BLOCKED — packaged repeat remains | `PARTIAL_PROOF` — visual, packaged, and main gates remain |
| **M4** approval/decline + durable write | N/A — historical red contract is retained as failure evidence | PASS — latest development APIMart run completed one approve and one decline | PASS — canonical approval/decline writer and receipt boundary are implemented | PASS — approve+decline passed in the same representative task | PASS — one approval wrote and one decline was a no-op | PASS — durable revision remained `1` after approve+decline and receipt state read back | BLOCKED — approval UI visual acceptance not run | BLOCKED — packaged approval/decline remains | `PARTIAL_PROOF` — visual, packaged, and main gates remain |
| **M5** projections + cold restart/reconcile + packaged | N/A — historical red contract is retained as failure evidence | PASS — latest development APIMart run completed cold restart and R6 continuation; `step=storyboard`, `editorCount=1`, `row2=1` | PASS — active-slot hydration and workspace URL projection repairs are in the current branch | PASS — project, storyboard, canvas, receipt/revision projections and R6 continuation passed in development | PASS — same real-user task resumed after restart and reported the next step without generating | PASS — durable project/storyboard/canvas/receipt/revision readback passed; no duplicate write observed | BLOCKED — real visual walk and projection comparison remain | BLOCKED — required packaged command has not run | `PARTIAL_PROOF` — packaged and main gates remain |

## Evidence and next PR split

- M0-M1 current repair boundary: make the existing storyboard editor reachable after a real new project and bind row 2 to the canonical Agent context. This is the next repair PR; it must rerun the unchanged red runner and update this ledger.
- M2: canonical public `nomi_canvas_plan` proposal must prove selected-row-only patch and untouched fields.
- M3: visible Skill/model/vendor identity must travel with the same project, selection, and revision into the right Agent request.
- M4: one real approval writes once; one real decline leaves project, receipt, and revision unchanged.
- M5: Agent/storyboard/canvas projections, durable readback, cold restart/reconcile, and current-SHA packaged repeat must all be evidenced; each unfinished item remains a separate PR.
- Retained evidence: MCP boundary, new storyboard table boundary, and canvas/receipt tests are recorded as `absorbed` where they overlap, but they do not substitute for this vertical spine.
- Deferred scope: TikHub and video remain explicitly post-M5.

## 交付状态（2026-09-05）

当前验证清单：

- `pnpm run check:root-cause-contracts`：PASS。
- `pnpm run build`：PASS。
- `node tests/ux/mcp-l1-handshake.e2e.mjs`：PASS（stdio catalog/transport declaration；不代表生产 Agent/MCP 效果闭环）。
- 无 key 的 `node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs`：M0、M1、Settings 显式启用路径通过；M2 仅进入自定义 stdio 诊断链，记为 `PARTIAL_PROOF`；该无 key 内部路径随后在 M3 为 `BLOCKED_ENVIRONMENT`，不能覆盖最新真实 APIMart run 中 M3/M4 已通过的证据。
- 有 key 的真实 Electron runner：已进入 APIMart 可见密钥接入页和“添加模型” picker；在 M3 模型配置处暴露 `UI_PRODUCTION` 缺陷——`existingModels` 将尚未验证的 seed 模型误判为 `already-added`，阻断继续选择/验证。该运行不能写成完成证据，也不能通过直接 `upsertVendor enabled:true` 绕过。
- 最新 M4→M5 真实 Electron 重启尝试：M4 canonical patch 后冷重启、从项目库重新打开项目，正文已恢复；但 Creation 仅显示“分镜方案/新建分镜方案”，`[data-storyboard-editor]` 未出现，说明已有 storyboard design 的 hydration active selection 仍未形成可见 editor reentry。该失败已定位到 `workbenchDocumentSlice` 的共享 hydration 边界；本轮已补 production 修复与 focused regression，尚未把修复后的结果写成真实 Electron 绿证据。
- 后续真实 Electron 重跑已证明 M5 editor reentry 修复可继续推进，但在 M4 canonical `nomi_canvas_plan`/`patch_shots` 后 durable project revision 未前进；该运行已 fail-closed，不能把 MCP 返回当作持久化成功。需继续核对 canonical owner → project repository persist → revision/readback，并以真实项目文件 revision 与回归测试作为收据。
- 2026-09-05 持久化根因已确认：`setStoryboardPlan` 只 bump `persistRevision`，而 `subscribeWorkbenchProjectPersistence` 的 700ms debounce 可能晚于 `applyProposalBatch` receipt commit；`executeCanonicalCanvasPlanPatch` 原先直接返回内存结果，造成真实 `project.json` revision=1、receipt revision=2。现已在 canonical renderer owner 返回前复用 `persistActiveWorkbenchProjectNow()`，对缺失/错项目/失败保存 fail-closed，并以 `src/workbench/capability/canonicalCanvasPlanPatch.test.ts` 覆盖 null-save 与未 resolve save 的回归。该修复尚未形成新的真实 Electron 绿证据，M4/M5 仍保持阻塞。
- 2026-09-05 真实 Agent 多轮在 R2 发现：编辑提案会按 step approval 正确停在可见 pending card，因而 turn 不会自然进入 assistant terminal；R3 的“我改主意了、先预览”要求先通过可见拒绝动作收束 R2，再发送下一轮。runner 已加入 `waitForAgentTurnTerminalOrPendingProposal` 与 `denyPendingProposalForRevision`，仅允许 R2 这条改口路径，拒绝后等待 `declined/failed` 终态；不自动批准，也不把 pending proposal 记作执行成功。结构回归 19/19、node check 通过，真实 Electron 重跑仍待进行。
- 2026-09-05 最新 decline 失败进一步收敛到同一持久化族：canonical barrier 的即时保存只写了 rev1，但 mutation 前已排队/已在飞的 debounce save 仍在约 47ms 后写出相同 storyboard payload 为 rev2；事件日志只有一次 commit，说明 decline 本身未执行写入，`project.json` 的“变化”是陈旧队列重复保存。`workbenchProjectSession` 现以 `beforeImmediateSave` 取消 timer/pending，并等待 save queue idle 后再做 canonical 即时保存；session persistence 回归证明同一 mutation 不会再追加 revision。decline 的字节级真实 Electron 重跑尚未完成，M4/M5 继续保持证据边界。
- 2026-09-05 此前真实 APIMart run（历史失败）的 M2 `capability_receipt_unresolved` 已定位到 hydration-to-surface owner race：项目/Storyboard 已可见时，React persistence effect 仍可能尚未安装 active save target，canonical patch 遂在内存 receipt commit 后读到空 durable owner。共享 session 新增 `waitForActiveWorkbenchProjectSaveTarget` owner signal，canonical renderer barrier 在保存前等待既有单一 owner；不新增 writer、不改 runner sleep。后续 development run 已通过 M2；该条仅保留根因与修复证据。
- 2026-09-05 最新真实 R1 失败：可见 Agent 先出现 assistant 内容，随后 composer 显示“发送失败，请检查后重试”。现有收据只有 UI 症状，未包含脱敏后的 Host `execution-error` code、provider HTTP status/category 或 network cause，因此暂不能把它归类为 APIMart 认证/限流/网络或 Agent 生命周期竞态；按 fail-closed 原则未加入盲目重试。下一步需在不记录凭据的前提下取得 failure item/Host error 的结构化分类，再决定是否允许一次自然 R1 重试；M2-M5 仍未因该次失败升级为通过。
- 2026-09-05 R1 诊断补强：`ProjectAgentResidentShell` 现将 failure item 的 code 规范化为严格 identifier，并把内部 message 映射为白名单 `auth|quota|network|provider|lifecycle|capability|unknown`，仅以 `data-agent-error-code`/`data-agent-error-message-category` 暴露；runner `failureContext` 只读取这些字段和经 redaction/长度上限处理的可见短文，绝不写入原始 provider message 或 credential。结构回归与 root-cause contract 已通过，下一次真实失败可据此分类；在分类前不自动重试。
- 2026-09-05 最新 M5 重启阻断：项目库可见 storyboard card（2 shots、Open storyboard），点击后仍停在 URL `step=create`，且 `[data-storyboard-editor]` 未出现；project.json 已确认 `storyboardPlans`/`storyboardDesignsByDocumentId` 按 active document 持久化。根因收敛到 Workspace mode 的双投影：`StoryboardPlanCard` 直接调用 `setWorkspaceMode('storyboard')`，但 `WorkbenchShell` 只在 app-bar callback/初次挂载写 step URL，导致卡片入口切换未留下可恢复的 URL projection。现已在 `WorkbenchShell` 增加从共享 `workspaceMode` 到 step 的统一 effect，并补 schema-v3 合同与结构回归；修复后的真实冷重启/editor 绿证据待重跑。
- 2026-09-05 M5 locator 复核：上述重跑中 `openedStoryboard=false`，而 body 文本仍含方案卡，说明 runner 的全局 locator 命中了隐藏 WorkspaceSlot 内容或把隐藏副本当作唯一候选；并非项目 plans/designs 缺失。reopen helper 现先锁定 `.workbench-shell__workspace:not([hidden])` 当前可见 slot，再遍历其 `[data-storyboard-card]` 和可见打开按钮；editor 断言同样限于 active slot。结构回归通过，等待 build 后真实重启验证。
- 2026-09-05 此前真实 APIMart run（历史失败）：M0、M1、M3、M4 通过；M2 仅达到 `PARTIAL_PROOF`，不能升级为完整 canonical effect/receipt 证据。M5 在重启后的 active-slot locator 仍找不到 storyboard editor 时诚实失败，未把方案卡或隐藏 slot 误判为成功。该 run 的证据根以本机隔离 runner 收据为准，凭据不写入台账。
- 2026-09-05 APIMart follow-up（历史失败）：M5 重启后的 active workspace 已到 URL `step=storyboard`，`editorCount=1` 且 row 2 选中（`row2=1`）；但当时 M2 canonical `patch_shots` 因 `capability_receipt_unresolved` fail-closed，未形成 durable receipt/revision。该失败已由后续 development run 修复并通过；原始证据根以本机隔离 runner 收据为准，凭据不写入台账。
- 2026-09-05 最新 APIMart development run：`status=passed`、`firstFailure=null`；M0/M1/M2 canonical/M3/M4 approve+decline/M5 cold restart+R6 均通过，M4 durable revision=1 且 decline no-op。M5 active workspace 到达 URL `step=storyboard`，`editorCount=1`、`row2=1`；视觉、packaged 和 main 合入仍未执行。
- 2026-09-05 真实产物审计：上述 M0-M5 development runner 证明的是项目/分镜行选择、canonical patch、Agent 上下文、approval/decline、receipt/revision 和冷重启/R6；当前收据**没有真实生成的 script artifact 或 storyboard artifact**，也没有同一任务的“上传参考素材 → live image/video 生成 → timeline 编辑 → preview → MP4 导出”产物链。因此 M0-M5 仍是 `PARTIAL_PROOF`，不能把 canonical patch 或 runner PASS 写成真实可播放视频完成。
- 2026-09-05 用户反馈后续修复项（均保持 `PARTIAL_PROOF`）：① 分镜表的 reference-media/model picker 是否可见、可选且真正绑定到行；② anchor image 的选择、持久化和生成输入；③ script editor 的可见入口、编辑/回读；④ Agent UI 在真实用户模式下的可用性、loading/success/failure/retry/cancel 与自然多轮连续性。每项都需补真实 Electron 走查、持久化/重启和视觉证据；不得用 fixture、静态合同或 custom stdio 代替。
- 2026-09-05 Seedance APIMart canary：使用 `APIMART_E2E=1 ... node tests/ux/seedance-apimart.e2e.mjs` 触发真实 `tasks.run`，在供应商未启用时明确失败 `Vendor is not enabled: apimart`；分类为 `BLOCKED_ENVIRONMENT/CONFIGURATION`，不能写成真实生成成功或媒体产物证据。Seedance wire 19/19 仅证明参数契约映射，不证明供应商可用、真实任务提交或视频生成。
- 入口 A（真实 Codex Host → Nomi MCP）：`PARTIAL_PROOF`。当前 Codex desktop 安装包的原生只读调用 `mcp__nomi__nomi_list_projects({})` 已成功返回本机项目；其随后 `create_project`→`session_open` 失败来自旧安装包/无 current GUI selection，不能代表当前 worktree 契约。已用真实 `codex exec --json`（Codex 模型作为 MCP Host，临时隔离 Electron 进程与目录；不是自定义 stdio client）驱动当前 worktree，真实自然语言调用链 `nomi_project_create`→`nomi_session_open`（显式 projectSelectionHandle）→`nomi_canvas_edit`（恰好创建 1 个 text node）→`nomi_read(target=canvas)` 全部成功，进程返回码 0，canvas readback 含该节点。该证据证明当前 Host→selection/lease→semantic write/read 入口可用，但仍不能替代 M0-M5 同一自然用户多轮任务、provider/key 接入、Agent 多轮、receipt/revision、approval/deny、持久化/重启、视觉、packaged 和独立审查收据；旧安装包的 `session_open` 错误仍需随发布包升级后复核。
- 入口 B（Nomi 内部 Agent UI）：`PARTIAL_PROOF`。M1 与 Settings 可见开关路径已有真实 Electron 证据；Skill/模型/模式、Agent 多轮 effect、approval/deny、receipt/revision、重启、视觉和 packaged 仍未形成完整收据。

交付边界：PR #486 当前本地任务分支 HEAD 为 `16c20f50`（包含合法 Tailwind warning token 修复与结构回归；前置文档状态门岗 `5c9b95d1`、Agent Host 走查 follow-up `5b0a81e1`）；远端分支仍为 `5b0a81e1`，等待统一 push。上述 `PARTIAL_PROOF`/`BLOCKED_ENVIRONMENT`/`UI_PRODUCTION` 状态不允许升级为 `VERIFIED`，PR/worktree 盘点与后续阶段清单见本台账上文。
