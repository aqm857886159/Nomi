# Markdown first-use runtime and local failure containment

PR1172 continuation; implementation owner `/root`, independent read-only reviewer `/root/harness_review`. This is the bounded runtime acceptance requested for the existing four Markdown surfaces.

| Design card | Decision |
|---|---|
| ★1 User action | Open Agent message, Skill detail, Prompt preview or Markdown Artifact; see the current rendering label, then newest content. A missing module shows the existing localized regional failure and reload action while the parent remains present. |
| ★1b Related UI | Reuse current compact/full rendering typography, dialogs/portal/Artifact body, and chunkBoundary error/reload controls. No new labels or layout. |
| ★2 Owner | LazyNomiMarkdown owns shared resource admission; NomiMarkdown owns parsing/rendering; chunkBoundary owns retry/error/reload. Four consumers retain their current lifecycle. |
| ★3 Reuse | Replace plain React.lazy with existing lazyWithChunkBoundary. Preserve fully inferred props and current Suspense fallback; no parallel parser or error state. |
| ★4 States | Not requested before use; held import displays rendering; newest suspended props render after release; failed real resource stays in regional error; fresh context can recover restored resource. |
| 5 Interruptions | Close unmounts the surface; reopen retains current props. Cached rejected module retains explicit local failure until existing fresh-context recovery. Agent streaming updates and completion stay on the same renderer. |
| 6 Failures | Eight Electron component/locale cells reproduced root-page failure before correction. Controlled missing module checks error containment, not native file/provider permissions. |
| 7 Performance | Module remains absent before input; no eager Markdown preload or new dependency. This matrix produces correctness evidence, not performance percentiles. |
| 8 Real conditions | Actual production components/providers in Electron, zh-CN/en, held/503 loopback resource and host prop/unmount ports. Native navigation, user data, provider tasks and real display/Mac remain separate unverified entries. |
| ★9 Verification | Preserve eight-cell RED receipt and raw PID network guard; rerun same class after shared-boundary correction; graph/consumer tests, syntax/type/contracts and independent review. Revert the bounded correction for rollback. |

No design board is required because the production layout and existing regional error component are reused. This component matrix does not mark the full functional checklist accepted.
