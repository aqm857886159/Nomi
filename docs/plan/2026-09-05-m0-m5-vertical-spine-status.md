# Nomi M0-M5 Agent vertical-spine status ledger

> 唯一状态台账：本文件是本交付的持久化状态真源。后续每个未完成项必须拆成独立 PR，并在对应单元格补入命令、SHA、PR 或明确的 blocked reason；状态不得只留在对话中。

## Goal

完成 Nomi 当前主线收敛：以 Agent 的 M0-M5 真实端到端闭环为最高优先级，贯通真实 Electron 用户任务、MCP 调用、最新版分镜表、画布写入、approval、receipt、项目持久化、关闭重启恢复、视觉走查和 packaged 验证。持续盘点并安全收敛所有 PR/分支/worktree/计划；当前 red-stage 只是本总目标的第一阶段，不缩小、不替代总目标。

第一代表任务固定为：新建隔离项目 → 选择分镜行 → 选择 Skill 与模型 → Agent 读取上下文 → `nomi_canvas_plan` → `patch_shots` → 批准/拒绝 → 真实写入项目 → durable receipt/revision → Agent/分镜表/画布一致 → 关闭重启回读/reconcile → packaged 重复。

## Non-goals

本阶段不做 UI redesign，也不修改生产实现。TikHub、APIMart、视频解析、字幕、视频分镜后置；provider spend 只允许在受控 canary 中发生，凭据只走本机环境变量。静态检查、fixture、loopback、CI green 或预写项目不能单独证明真实用户任务完成；不得调用 fake store、生产 handler 或 legacy bare `patch_shots` 作为最终证据。

## Current phase

`red-stage / M1-B first real seam recorded / production untouched`

| Field | Value |
|---|---|
| Base | `origin/main@163bddf157b613bde1d8291098b8813cea2bc80b` |
| Branch | `codex/agent-vertical-spine-m0-m5-red-20260905` |
| Worktree | `/Users/aoqimin/Desktop/Nomi-agent-vertical-spine-m0-m5-red-20260905` |
| First representative task | real Electron isolated project → storyboard row 2 → Skill/model identity → right Agent context → `nomi_canvas_plan(operation=patch_shots)` → approval/decline → durable write/receipt/revision → three projections → cold restart/reconcile → same-SHA packaged repeat |
| Current first failure | `M1.select-storyboard-row`, dimension `B`: new real project exposes only `新建分镜方案`; `[data-storyboard-editor="true"]` never becomes visible |
| Evidence contract | `tests/system/agent-vertical-spine-m0-m5.contract.json` |
| Red runner | `tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs` |
| Evidence report | `docs/qa/2026-09-05-agent-vertical-spine-m0-m5-red.md` |
| Conflict boundary | No existing total-plan link was changed; this disjoint ledger avoids the active #476 change surface. |

## Definition of done

代表任务必须模拟真实用户的连续多轮 Agent 协作，而非一次性请求；覆盖从零开始、补充/否定/改口、只改一镜、先预览后确认、分步生成、部分生成、生成后微调、关闭重启后继续追问；每轮记录自然用户话术、Agent 上下文、M0-M5 断言、approval/receipt/revision/persistence 状态，并按未开始→红测→实现→绿测→真实 Electron→持久化/重启→视觉→packaged→合入 main 追踪。

完成 Nomi 当前主线的 Definition of Done：每个 M0-M5 与其对应 PR 都必须记录状态、SHA、证据命令、阻塞原因和下一步；每阶段依次完成红测 → 最小实现 → 同断言绿测 → 真实用户任务 → 持久化/重启 → 视觉走查 → packaged → 合入 main。全量目标完成前，不能把静态/fixture/CI green 当作真实完成。

The total goal is done only when every M0-M5 row reaches every stage below with evidence from the same real user task: visible Electron actions, preload/public MCP production call shape, durable project/receipt/revision readback, approval and decline semantics, Agent/storyboard/canvas projection agreement, cold restart/reconcile, and a repeat from the packaged app built from the current SHA. `main 合入` requires a reviewed PR and explicit merge evidence; this red-stage branch must not be merged or described as production completion.

Stage vocabulary is fixed and ordered: `未开始 → 红测 → 实现 → 绿测 → 真实用户任务 → 持久化/重启 → 视觉走查 → packaged → main 合入`.

## M0-M5 status

Every cell is an evidence pointer or a blocked reason. `absorbed` means existing coverage was retained as context but does not satisfy this same-task completion gate.

### Natural multi-round transcript and internal ledger

The canonical transcript is stored in `tests/system/agent-vertical-spine-m0-m5.contract.json` under `multiRoundProtocol.transcript`; the runner must enter each turn through the visible Agent composer. User-facing text contains no operation/tool/id/fixture/API parameter. The internal record for every turn has M0-M5 assertion, status, receipt, revision, and context fields. The current red run stops before R1 at M1/B, so each downstream turn is explicitly blocked rather than presented as complete.

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
| **M0** real Electron isolated project | N/A — current delivery has entered red stage; SHA `163bddf157b613bde1d8291098b8813cea2bc80b` | PASS — `pnpm run build && node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs`; real Electron created project and disk `.nomi/project.json`; SHA `163bddf157b613bde1d8291098b8813cea2bc80b` | BLOCKED — no production implementation is in scope for this red-stage PR | BLOCKED — M1 first failure stops the same-task green gate; rerun command above required | PASS for M0 slice only — visible `新建空白项目` click plus preload route/read; not full M0-M5 completion; evidence in `docs/qa/2026-09-05-agent-vertical-spine-m0-m5-red.md` | BLOCKED — full durable revision/restart proof belongs to M5 and was not reached | BLOCKED — no visual acceptance claim in red stage; UI redesign excluded | PASS for M0 slice only — `pnpm run dist:mac:dir` + packaged red runner opened packaged Electron and created isolated project; no full packaged closure claim; report linked above | BLOCKED — no PR merged; user explicitly requires no merge |
| **M1** storyboard row 2 selection | N/A — red contract is active; SHA `163bddf157b613bde1d8291098b8813cea2bc80b` | FAILED — `pnpm run build && node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs`; first failure `M1.select-storyboard-row`, `locator.waitFor: Timeout 10000ms exceeded` on `[data-storyboard-editor="true"]`; body had only `新建分镜方案`; dimension `B`; report linked above | BLOCKED — no production implementation in this delivery | BLOCKED — editor/row seam must be repaired before green rerun; command above is the gate | BLOCKED — visible row selection was not reached in the real newly-created project | BLOCKED — no selection revision could be persisted or restarted | BLOCKED — visual walk requires reachable existing storyboard table, not a redesign | FAILED — `pnpm run dist:mac:dir` + packaged runner opened packaged Electron, then failed at the same `M1.select-storyboard-row` / `B` assertion; evidence linked above | BLOCKED — no PR merged; red-stage only |
| **M2** canonical `nomi_canvas_plan` / `patch_shots` | N/A — red contract is active; SHA `163bddf157b613bde1d8291098b8813cea2bc80b` | BLOCKED — runner stops at M1/B before canonical call; existing `tests/ux/storyboard-agent-canonical-patch.e2e.mjs` is absorbed, not this journey | BLOCKED — no production implementation in this delivery | BLOCKED — requires M1 green then canonical public MCP call with `operation=patch_shots` | BLOCKED — no same-task proposal for row 2; static/fixture/loopback evidence is insufficient | BLOCKED — untouched fields, revision, receipt and restart not reached | BLOCKED — projection visual gate not reached | BLOCKED — packaged canonical call is downstream of M1/B | BLOCKED — no PR merged; a separate M2 repair PR is required |
| **M3** Skill/model identity + Agent context | N/A — red contract is active; SHA `163bddf157b613bde1d8291098b8813cea2bc80b` | BLOCKED — runner stops before Skill/model/context; existing `tests/ux/mcp-skills-integration.e2e.mjs` and resident tests are absorbed, not same-task proof | BLOCKED — no production implementation in this delivery | BLOCKED — requires M1 and M2 seams first | BLOCKED — no visible Skill/model selection or right Agent read reached | BLOCKED — request identity/revision cannot be read back yet | BLOCKED — no visual acceptance claim in red stage | BLOCKED — packaged repeat is downstream of M3 identity/context | BLOCKED — no PR merged; a separate M3 repair PR is required |
| **M4** approval/decline + durable write | N/A — red contract is active; SHA `163bddf157b613bde1d8291098b8813cea2bc80b` | BLOCKED — runner stops before approval; existing canonical approval/receipt coverage is absorbed but lacks this UI approve/decline pair | BLOCKED — no production implementation in this delivery | BLOCKED — requires canonical proposal and real elicitation accept/decline | BLOCKED — no one-approve/one-decline same-task evidence | BLOCKED — no write-once, no-op decline, receipt or revision evidence reached | BLOCKED — approval UI was not traversed | BLOCKED — packaged approval/decline is downstream of M4 | BLOCKED — no PR merged; a separate M4 repair PR is required |
| **M5** projections + cold restart/reconcile + packaged | N/A — red contract is active; SHA `163bddf157b613bde1d8291098b8813cea2bc80b` | BLOCKED — runner stops before projection, restart and packaged assertions | BLOCKED — no production implementation in this delivery | BLOCKED — requires M0-M4 green evidence in order | BLOCKED — Agent/storyboard/canvas agreement was not reached | BLOCKED — cold restart/reconcile and duplicate-write checks were not reached | BLOCKED — real visual walk and projection comparison were not reached | BLOCKED — required command: `pnpm run dist:mac:dir && NOMI_VERTICAL_SPINE_PACKAGED_APP=release/mac-arm64/Nomi.app node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs --packaged`; no current packaged certification | BLOCKED — no PR merged; packaged evidence and a reviewed PR are required before any main merge |

## Evidence and next PR split

- M0-M1 current repair boundary: make the existing storyboard editor reachable after a real new project and bind row 2 to the canonical Agent context. This is the next repair PR; it must rerun the unchanged red runner and update this ledger.
- M2: canonical public `nomi_canvas_plan` proposal must prove selected-row-only patch and untouched fields.
- M3: visible Skill/model/vendor identity must travel with the same project, selection, and revision into the right Agent request.
- M4: one real approval writes once; one real decline leaves project, receipt, and revision unchanged.
- M5: Agent/storyboard/canvas projections, durable readback, cold restart/reconcile, and current-SHA packaged repeat must all be evidenced; each unfinished item remains a separate PR.
- Retained evidence: MCP boundary, new storyboard table boundary, and canvas/receipt tests are recorded as `absorbed` where they overlap, but they do not substitute for this vertical spine.
- Deferred scope: TikHub and video remain explicitly post-M5.
