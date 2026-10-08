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
