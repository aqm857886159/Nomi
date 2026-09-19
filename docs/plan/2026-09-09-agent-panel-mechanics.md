# Agent panel mechanics B2a

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

> 状态：已实现并验证，待 PR 合入

## Scope and invariant
Restore the approved panel mechanics for C25/C21/C24/C02/C33/C05/C44/C57/C35. User answers stay readable, work folds without thinking splitting runs, controls retain one semantic owner, and preview affects only its covered subtree. No process redesign (B2b), no changes under electron/agentLane, src/workbench/ai/lane, or reactFlow.

## 先查别人
- `src/workbench/generationCanvas/nodes/composerObstaclePlacement.ts:28`: existing #658 geometry owner; reuse for context.
- `electron/shared/agentCapabilities/registry.ts:104`: existing per-operation policy; undo presentation must not relax mandatory approval.
- `src/workbench/ai/resident/residentExceptionProjections.ts:39`: existing canvas/semantic shot projection; share with storyboard.

The supplied ledger and 024-agent-wait-150.png are the accepted evidence. Existing owners are agentPanelV4Collapse.ts (work), AgentPanelV4Markdown.tsx (height folding), composerObstaclePlacement.ts (viewport geometry, #658), agentCapabilities/registry.ts (operation effect), residentExceptionProjections.ts (approval shots). Reuse these boundaries rather than adding a framework. This is internal presentation restoration; no external format or dependency changes.

## Execution and acceptance
Add deterministic regression fixtures and preserve red output before production edits. Cover interleaved thinking, ambiguous answers, long user input, left-edge context, model identity, queue cancellation, shot title/metadata, operation labels and scoped preview. Inspect real component and application screenshots. Run root-cause contracts and complete locked gates to exit 0 before commit/push and PR. Keep screenshot paths in PR and PANEL-LAST.md.

## Rollback
Revert the scoped task commit through a PR; no persisted data migration. Preserve unrelated work and frozen paths.

## Evidence notes

The supplied storage transcript contains assistant shapes at lines 325/1672 (`thinking`, `text`, `toolCall`) and 1700/1722 (`thinking`, `toolCall`), all with `stopReason=toolUse`; this is the interleaving reproduced by the C25 fixtures. Auto-granted host notes are omitted before V4 by the existing host projections, so they cannot divide a work segment.

`RuntimeUsage.costUsd` is explicitly USD-normalized by the runtime; the panel preserves that unit and labels it USD, rather than relabeling the same amount as CNY. Supplier-native billing currency/amount is not available in this contract. C57 removes whole-answer height folding, so next steps are never hidden by a pixel cutoff. B2b process shape is unchanged.

First full gates attempt ran all 76 contracts and reported two blockers: fixed station timeout in the new browser fixture, and missing vendor identity in the new shot presentation input. Both were corrected without baseline increases. Existing advisory documentation warnings remain advisory.

The final 340px panel probe reproduced footer overflow (controlsInside=false) after the first green gates. Shared footer spacing now preserves the full DeepSeek V4 Pro label and keeps every control within both 340px and 390px panels; both probes pass. Real DeepSeek/APIMart tasks read the canvas and created one node: tool success 2/2, write success 1/1, turn success 2/2. Reported prompt tokens 54,200, completion 772 (cached input 38,400; reasoning 506); provider returned no monetary cost. No media generation was requested.

Final locked gates exited 0 on baseline 2baa00d5e6ed: 1304 test files passed, 1 skipped; 12127 tests passed, 2 skipped; contracts, agent runtime and build passed. Final Electron reopening confirmed modelReadable=true and controlsInside=true. Evidence index: [agent-panel-mechanics-evidence/README.md](agent-panel-mechanics-evidence/README.md).

Ponytail follow-up removed the orphan preview data attribute, obsolete answer-height prop forwarding, and duplicate browser-result text. Structured browser-result.json remains the evidence owner. Full locked gates are repeated after this cleanup.

Post-Ponytail cleanup: complete locked gates exited 0, again 1304 passed test files and 12127 passed tests, 2 skipped tests. All eight browser screenshots are byte-identical to the inspected evidence after removing dead attributes/props.
