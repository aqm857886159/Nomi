# Direction check: storyboard batch implementation evidence

## 0. Root cause
The repeated churn is caused by a moving storyboard row contract: production removed row actions and changed selection semantics, while design-lab fixtures continued to pass retired props and represented the old result-removal path. Evidence was therefore detached from the current component boundary.

## 1. Classification
| Change | Direct cause | Class root cause |
|---|---|---|
| stale design-lab props | fixture copied an older row contract | no single shared prop boundary for production and lab |
| obsolete result-removal state | state registry outlived the product action | retired states were not removed with the action |
| footer hand-built in lab | lab duplicated production footer markup | production footer was not exported as a reusable component |

## 2. Structural conclusion
The shared row and footer components are now the only render boundaries used by the batch evidence. The state registry no longer contains the removed result action. The row menu owns lock, scene movement, and canvas location; the selection toolbar does not expose those row-only actions.

## 3. Prevention
- Design-lab TypeScript compilation now catches retired props at the shared component boundary.
- Evidence README links every bilingual screenshot and the expected-red mutation outputs.
- Mutation checks pin cancellation, checklist filtering, reference dependency failure, and legacy migration behavior.

## 4. Independent acceptance
The implementation line is separate from acceptance line storyboard-batch-select-acceptance-2026-10-07; this work only refreshes implementation evidence and its boundary checks.

## 5. User tradeoff
The row menu remains denser because row-only actions stay available there; the multi-select toolbar stays focused on operations that apply to the selection.

## 6. Gate-family review
The `gate-family` self-written registry entry is the repeated generic-capability hotspot reported by `fix-churn`. The current change cannot replace it with a library: the gate family composes Nomi's domain-specific source, control, token, vocabulary, and design-lab checks over repository history, staged files, and project-local contracts; no existing package owns that cross-gate policy or the required ratchet semantics. The current registry entry remains under review, with the next replacement assessment due 2026-11-07; that review must evaluate a standard policy engine or repository-analysis framework before another gate-family fix is accepted.

## 7. Feature tests that pin the current boundary
- `src/workbench/capability/storyboardPresent.test.ts` asserts zero canvas nodes before consent, explicit checklist consent/cancellation, and the original materializer's post-consent nodes and dispatch waves.
- `src/workbench/creation/storyboard/exec/storyboardFirstFrameApproval.test.ts` and `shotOutbound.parity.test.ts` assert that confirmation gates dispatch while cancellation and unchecked rows do not.
- `scripts/check-source-nul-bytes.test.ts` and `scripts/check-control-contract.test.mjs` pin the repository-wide encoding and control-copy contracts.

## 8. Adversarial review follow-up
The review found that single-row and Agent anchor creation still wrote through
`applyCreate` before their spend confirmation. The shared `confirmAndRunNode`
and `confirmAndRunPlan` boundaries now accept deferred materialization, so the
draft is used for the card and the canvas write happens only after acceptance;
existing nodes retain the direct regeneration path. `door-map.mjs` was run for
`generateShotRow`, `generateAnchorCard`, `materializeShotRow`, and `applyCreate`,
and the contract records all 20 affected doors. The selection toolbar now hides
the inline model field and renders the existing `BulkModelPicker` once per
model-kind group. The red-before-fix slice covered single cancellation, Agent
anchor cancellation, and the strong single-picker structure gate; the same
tests pass after the shared-boundary fix.

## 9. Coordinator review: mojibake in design-lab state names
The shared-`PlanRows` commit added three design-lab states whose `name` and
`source` strings were UTF-8 Chinese read back as GBK (for example `鈶?浠嬪叆妲?`).
Symptom: garbled lab catalog labels. Direct cause: a Windows write path that
re-encoded the file. Class root cause: nothing in the repository rejects GBK
mojibake in source text; `check-source-nul-bytes` only covers NUL bytes, and
`origin/main` already carries the same pattern in comments of
`useCharacterPlacement.ts`. This commit only restores the three strings. The
class fix (a source-text mojibake gate plus repair of the existing occurrences)
is tracked as a separate task so it is not hidden inside this feature PR.

## 10. 第 4 轮：恢复页脚交给 Agent
- 直接原因：实现时删了方案 Q9 写明「先不动」的入口（页脚「选中 N 镜 · 交给 Agent 改」；f07824de5 删按钮、8ffd4e67d 清配套状态），提交信息没有拍板依据。
- 类：改动超出拍板范围。门岗只看代码和改动量，不对账方案里「不动」的项。
- 这次的补法：`tests/ux/storyboard-agent-handoff.test.mjs`，三入口真路径测试，少一个就红。
- 更强的补法（待协调会话立项，不在本 PR 做）：把方案 Q 表里的「不动」项登记成机器可读合同。
