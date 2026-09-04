# Agent UI computable conformance

> 状态：🚧 进行中

## Scope

This PR upgrades the existing PR #315/#438 Agent UI design chain into an executable contract. The only design inputs are the four PR #315 files and the two PR #438 exception-state files named in the task. The generated spec remains derived from the approved PR #315 mockup; PR #438 intent remains the source for exception-state structure and copy rules.

The contract records a fixed 1440x900 viewport at DPR 1, source locator, state, severity, and property tolerance for each rule. The Electron walk reads production DOM, `getBoundingClientRect()`, computed styles, accessibility attributes, ordering, visibility, and resident-surface ownership, then writes a structured mismatch report. Screenshots remain auxiliary evidence.

## M0–M5 主轴边界

本 PR 是横切的 Agent UI 设计→运行时可计算合同，不是 M0–M5 毕业 PR。现有主轴重基线以 `docs/qa/2026-09-04-epics-rebaseline-audit.md` 为准；#469 只覆盖 M0/M1 已验证的部分，不能外推为 M0–M5 全部完成。

| 主轴 | 目标 | 现有证据与未完成证据 | 本 PR 的关系 |
|---|---|---|---|
| M0 | 冻结 Agent owner、工具/状态边界和红灯口径 | #272/#275 的 M0 文档已合入；本 PR 新增设计来源、挂点和 mismatch 合同，但不重做 M0 owner 结论 | 复用 M0 的单 owner 约束，确保右侧 Agent Dock 不产生第二 owner |
| M1 | Host 装配、生命周期、settlement、projection 与持久化边界 | #469 仅覆盖 M0/M1 已验证部分；M1 remediation、真实 Host 启用、全量持久化/重启证据仍未闭环 | 测量真实 renderer DOM 与 Resident surface；不宣称 Host 生命周期毕业 |
| M2 | generation/editing/canvas/document 的语义闭环与工具面 | 语义切片已合入，但完整 tool chain、manifest/lease/scope/graph、ProductionRun parity、legacy writer retirement 和 fresh Electron 证据未完成 | 固定结果卡、Storyboard Dock、receipt projection 作为 UI 合同入口；不替代 M2 功能闭环 |
| M3 | context、prompt pipe、skill、session audit 的真实投影 | context/skill 代码与单测存在；真实 Host 七层 context、provider cache、完整 ledger projection 和 Electron journey 未证明 | 只记录状态/挂点/词汇规则；不引入 provider 或声称 M3 context 已验证 |
| M4 | provenance/taint、approval/spend、action guard 与 receipt | guard/helper 已有；独立 taint UI、Host taint→action→spend、批准/拒绝/持久化证据仍缺 | 将审批/失败等 P0 状态列为可测合同；不执行 live provider 或 spend canary |
| M5 | packaged parity、安装/签名、packaged L2 与 graduation | #420 packaged MCP 基础已合入；#419/#421/#422 及 packaged L2、full Host/persistence 的当前 main 证据不足，M5 未毕业 | 仅运行源代码/真实 Electron UI 合同与现有异常态 walk；不宣称 packaged graduation |

## Red cases from the audit

1. The generation resident has no `data-agent-pinned-card` / pinned head despite the approved fixed result-card area.
2. Storyboard has no in-flow right Agent Dock target; browser takeover has no machine-checked resident coverage boundary.
3. The P0 queue fold row uses `data-agent-queue-more` instead of the approved `[data-queue-more-row]` hook and does not expose a separately measurable dynamic count.

## Implementation boundary

- Reuse and extend `scripts/extract-design-spec.mjs`, `docs/design/agent-ui-spec.generated.json`, the generated auto contract, and `tests/ux/agent-ui-conformance.walk.mjs`.
- Add one shared measurement/reporting module for runtime DOM and computed-style observations.
- Add the missing pinned result projection from the durable committed-proposal receipt; do not create another persistence truth source.
- Mount the existing resident shell into Storyboard's right column and keep the same resident owner.
- Replace the stale queue fold selector with the PR #438 selector and expose its computed hidden count.
- Do not change the rejected #454 anchor/parameter rail, call a live provider, or add image2 assets.

## Explicit blocked rules

- Exact selected-shot wording in the pinned card is blocked until the durable receipt contains a selected-shot count; the implementation must not infer it from category counts.
- Browser WebContentsView pixel coverage cannot be proven from renderer DOM because the native view is outside the DOM; the walk can prove the browser takeover boundary and resident ownership, while native occlusion remains a platform/manual check.
- Any mockup value without a stable selector or numeric CSS value is reported as `blocked/spec-missing`, not guessed.

## Verification

- Run the contract node test red on current `origin/main`, then green after the generated spec and implementation changes.
- Run `CONFORMANCE_TARGET=app node tests/ux/agent-ui-conformance.walk.mjs` and existing UI runtime walks with no live provider.
- Verify storyboard, generation normal/collapsed, P0 loading/failure/approval/queue states, and receipt persistence/restart where the existing walks own those functional states.
- Run focused structure/projection tests, typecheck, build, mockup-contract and root-cause gates; report exact branch, commit, report path, screenshots, and remaining blocked rules.
