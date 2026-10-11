# Required renderer imports during project hydration

Implementation line: delegated PR1172 continuation. Review line: `/root/harness_review` (read-only). Direction check: `2026-10-11-nomi-opening-direction-check.md`.

| Design card | Decision and evidence |
|---|---|
| ★1 User action | Click existing small project; see immediate existing opening mark; await real migration; see full generation workbench; operate matching project menu. Current new-fixture baseline337.20/781.04ms versus unchanged100/500ms. Native user datasets/real display are unverified. |
| ★1b Related UI | Existing generation loading label, unchanged project errors, Agent/receipts and notifications. No new wording or permanent controls. |
| ★2 Owner | hydrateProjectView owns sequence/visibility; Surface owns suspend/commit; main owns lane/migration; original chunk factories own module loading. Generated20-door map (17 production plus3 test references) includes private renderer hydration, required preload factories and unchanged same-named persistence/export ports. |
| ★3 Reuse | Existing GenerationCanvasLoading, lazyWithChunkBoundary and native import cache; no loader framework, mirrored domain state or migration bypass. |
| ★4 States | Library when idle; loading while current hydration waits; studio only after lane/recovery; failure returns library with existing localized error. Superseded operation cannot clear newer progress. Missing external resources retain current errors. |
| 5 Interruptions | New hydration supersedes old Surface epoch; old finalizer cannot remove current loading. Close uses existing project lifecycle. Restart reopens original disk data. Repeated input cannot mount stale studio. No model request or permission change. |
| 6 Failures | Disk/identity/migration failures follow existing recovery; failed optional code preload is logged and normal local lazy retry/error domain remains authoritative. React.lazy official rejection semantics and native ESM cache checked2026-10-11. |
| 7 Performance | Same1280×933 Linux/Xvfb/Electron43.4.1, small scale contents/fixture hash,1warmup+5actions cold/hot; trace separate. Main import/actual migration cost is diagnostic, not inferred CPU percentages. |
| 8 Real conditions | Linux actual Electron and controlled four-component browser matrix planned. zh/en screenshots planned. Real Mac/Windows/GPU/user private data and providers unverified. |
| ★9 Verification | RED ordering/ownership class checks before code, GREEN Surface/lane/migration regressions, new production build and matching after baseline. Independent source/receipt review. Revert this bounded correction commit for rollback. No merge/release. |

## Functional classification

- [x] Existing interaction correction
- [x] Interruptible project lifecycle
- [x] Canvas/performance
- [ ] Paid behavior (no change)

No design board is required: reuse the current production loading component without redesign/layout changes. Bounded runtime fixtures supplement native entry evidence and cannot close the full functional-checklist by themselves.
