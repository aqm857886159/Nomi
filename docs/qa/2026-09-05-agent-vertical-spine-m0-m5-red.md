# M0-M5 Agent vertical-spine red-stage evidence

状态：`red / first seam recorded / production implementation intentionally untouched`

## Scope

本交付只验证一条真实用户任务的生产调用形状；代表任务必须是连续多轮 Agent 协作，不是一次性 prompt：

`Electron 新建隔离项目 → 选择分镜行 → 选择 Skill 与模型身份 → 右侧 Agent 读取上下文 → nomi_canvas_plan(operation=patch_shots) → approval/decline → 真实项目写入 → durable receipt/revision → Agent/分镜/画布一致 → 关闭重启并回读/reconcile → 当前 SHA packaged 重复`

明确不含视频、TikHub、Skill Hub、UI redesign 或 provider spend。此次只新增合同、runner 和证据文档；不修改生产实现，也不把 loopback 结果当最终证据。

自然用户 transcript（R1–R6）从零开始覆盖补充/否定/改口、只改第三镜、先预览后确认、分步/部分生成、生成后微调、关闭重启后继续追问。用户话术不出现 operation/tool/id/fixture/API 参数；canonical tool/id 只在内部 assertion、MCP trace、receipt 和 revision evidence 中记录。完整视频生成仍保留在总目标；当前核心 spine 只推进到可验证的生成提案/真实项目写入边界，后续再用 APIMart/TikHub 做受控真实媒体 canary。

## Base and isolation

```text
fetch: git fetch origin main
base: origin/main@163bddf157b613bde1d8291098b8813cea2bc80b
branch: codex/agent-vertical-spine-m0-m5-red-20260905
worktree: /Users/aoqimin/Desktop/Nomi-agent-vertical-spine-m0-m5-red-20260905
preflight: passed; clean; same-commit with origin/main
```

Runner:

- Contract: `tests/system/agent-vertical-spine-m0-m5.contract.json`
- Real Electron red journey: `tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs`
- Command: `pnpm run build && node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs`
- Packaged repeat: `NOMI_VERTICAL_SPINE_PACKAGED_APP=release/mac-arm64/Nomi.app node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs --packaged`

The runner creates the project by clicking the visible `新建空白项目` action and verifies the resulting project through the real preload read and isolated `.nomi/project.json`. It does not seed a project payload, inject Zustand/store state, invoke a production handler, call a legacy bare `patch_shots` tool, or start a loopback provider.

## Absorbed existing coverage

The following mainline coverage was inspected and registered as absorbed rather than duplicated:

| Existing evidence | Absorbed boundary | Not sufficient for this spine |
|---|---|---|
| `tests/ux/storyboard-agent-canonical-patch.e2e.mjs` | Real Electron + MCP stdio + `nomi_canvas_plan(operation=patch_shots)` + disk receipt + cold restart | Starts from a prewritten storyboard project; no UI row selection, visible Skill/model identity, right Agent context, approve/decline pair, or Agent/table/canvas agreement |
| `tests/ux/mcp-skills-integration.e2e.mjs` | MCP Skill resource/list/read boundary | No same-project storyboard selection or durable canvas write |
| `tests/ux/agent-runtime-provider.walk.mjs` and Agent shell structure tests | Resident Agent/runtime and visible menu seams | No canonical storyboard write and no persistence/restart chain |
| `src/workbench/ai/resident/residentReferences.test.ts` | Pure storyboard reference and canonical selection-injection shape | No real Electron UI selection or production Host/MCP execution |
| `tests/ux/real-user-long-video.e2e.mjs` | Real Electron project creation and explicit blocked-live honesty | Out of scope video/TikHub task and not the requested canonical storyboard vertical spine |

## First real failure

The first runner setup error (assuming the project directory basename was the project id) was corrected before treating product output as evidence. The following is the exact fresh real-Electron result after that correction. The first failure is the first unmet seam, not a fabricated unit red test; later steps remain `not-reached` until this seam is repaired.

```text
command: pnpm run build && node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs
firstFailure.phase: development
firstFailure.step: M1.select-storyboard-row
firstFailure.dimension: B
firstFailure.message: locator.waitFor: Timeout 10000ms exceeded; waiting for locator('[data-storyboard-editor="true"]').first() to be visible
firstFailure.url: file:///Users/aoqimin/Desktop/Nomi-agent-vertical-spine-m0-m5-red-20260905/dist/index.html?step=create#/studio?projectId=project-1788546985278-4m25d8
firstFailure.bodyText: Nomi / 项目库 / › / 未命名项目 09/05 02:36 / 创作 / 生成 / 预览 / 0/4 / 创作内容 / 原稿 · 1 篇 / 未命名项目 / 新建分镜方案
firstFailure.observation: storyboardEditorCount=0; storyboardRow2Count=0
evidenceRoot: /var/folders/f4/vz86j5nd0_sf56qdhzrmbbvw0000gn/T/nomi-agent-vertical-spine-red-3JfqRu
```

The current-SHA packaged repeat was also executed after normalizing the `.app` input to its executable. Packaged Electron opened and created an isolated project, then stopped at the same first product seam:

```text
command: pnpm run dist:mac:dir && NOMI_VERTICAL_SPINE_PACKAGED_APP=release/mac-arm64/Nomi.app node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs --packaged
packaged firstFailure.step: M1.select-storyboard-row
packaged firstFailure.dimension: B
packaged firstFailure.message: locator.waitFor: Timeout 10000ms exceeded; waiting for locator('[data-storyboard-editor="true"]').first() to be visible
packaged firstFailure.url: file:///Users/aoqimin/Desktop/Nomi-agent-vertical-spine-m0-m5-red-20260905/release/mac-arm64/Nomi.app/Contents/Resources/app.asar/dist/index.html?step=create#/studio?projectId=project-1788547326987-j7otsj
packaged firstFailure.observation: storyboardEditorCount=0; storyboardRow2Count=0; body had only 新建分镜方案
packaged evidenceRoot: /var/folders/f4/vz86j5nd0_sf56qdhzrmbbvw0000gn/T/nomi-agent-vertical-spine-red-ZAjLWf
```

The earlier packaged `spawn ... Nomi.app EACCES` was a runner input-shape error and was corrected; it is not counted as product evidence. `pnpm run dist:mac:dir` completed, including the repository packaged MCP smoke (`24 tools`, `34 resources`, unsigned generic writes rejected).

After adding the six-turn natural-language contract and transcript assertions, the development runner was rerun. It preserved the same first failure (fresh project and temp paths for this run):

```text
command: node tests/ux/agent-vertical-spine-m0-m5.red.e2e.mjs
firstFailure.phase: development
firstFailure.step: M1.select-storyboard-row
firstFailure.dimension: B
firstFailure.message: locator.waitFor: Timeout 10000ms exceeded; waiting for locator('[data-storyboard-editor="true"]').first() to be visible
firstFailure.url: file:///Users/aoqimin/Desktop/Nomi-agent-vertical-spine-m0-m5-red-20260905/dist/index.html?step=create#/studio?projectId=project-1788547646495-91af3e
firstFailure.observation: storyboardEditorCount=0; storyboardRow2Count=0; body had only 新建分镜方案
evidenceRoot: /var/folders/f4/vz86j5nd0_sf56qdhzrmbbvw0000gn/T/nomi-agent-vertical-spine-red-jUVtnC
```

Expected classification at this red stage is the M1/B boundary if the blank-project UI cannot expose a `data-storyboard-editor="true"` with a selectable `data-storyboard-row="2"`. If the current build fails earlier, preserve the earlier observed failure and do not relabel it.

## H/B/E/T/N gap ledger

| Dimension | Red-stage status | Gap to next layer |
|---|---|---|
| H | not reached or first failure | Real user-visible storyboard row selection and later Skill/model/approval actions are not yet traversed by one task |
| B | not reached or first failure | Bind row selection to Agent context and canonical `select.indexes`, then assert only row 2 changes |
| E | not reached | Need project payload, revision, approval/decline outcome, durable receipt, and duplicate-write count from disk |
| T | not reached | Need renderer → preload → Host/public MCP → owner store → persistence → fresh process → packaged path evidence |
| N | not reached | Need stale revision, wrong project, empty selection, decline, duplicate confirmation, and reconcile mismatch fail-closed cases |

## Next-layer repair recommendation

Repair the earliest shared boundary exposed by the first failure: make the existing storyboard editor reachable from a real newly-created project and make row selection produce the canonical storyboard reference/context handle consumed by the resident Agent. Then rerun this same runner before touching any later M2-M5 implementation. Once M1 is green, the next red assertion should be the first missing link among Skill/model identity, Host context, public `nomi_canvas_plan`, approval/decline, receipt/revision, projection agreement, restart/reconcile, and packaged repeat.

This branch intentionally stops at the red contract. It is not a production completion claim and must not be merged as feature delivery.

## Persistent status ledger

The durable single source of milestone status is [`docs/plan/2026-09-05-m0-m5-vertical-spine-status.md`](../plan/2026-09-05-m0-m5-vertical-spine-status.md). It keeps the full goal intact—全量盘点与安全收敛、Agent 核心 M0-M5 真实 `patch_shots` 闭环、MCP/新版分镜表/画布证据保留、TikHub/视频后置—even though this branch only records the first red seam.
