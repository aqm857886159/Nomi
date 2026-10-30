# Unpaid workflow repair — independent acceptance

Implementation line: /root
Independent acceptance line: /root/pipeline_independent_audit
No model inference, CUA, user process changes or source edits by acceptance line.

## independent-acceptance-T024-T082.txt

Independent read-only source acceptance: T024-T082
Reviewer: pipeline_independent_audit
Checkout: C:/Users/CG16/.codex/worktrees/unpaid-workflow-repair/Nomi
Date: 2026-10-30

Scope and method
Read the acceptance card, task ledger and production source for task-aware defaults, model-list usability, duration roles/planner split-merge, and shot-review evidence from parser through runner/store/renderer/ProductionRun QA/retries. No application activation, generation, inference, network probing, source/settings/hook changes, or independent test execution. Only this report was written. Reported green test counts are implementation-line evidence, not independently reproduced here. Git status/diff could not be obtained: Git reported that this operation must be run in a work tree; source review proceeded without altering Git configuration.

Material findings

1. QA retry flags were not bound to their assessed dimension (identified; implementation changed during review).
   electron/productionRun/productionQaVerdict.ts buildQaRetryPlans initially admitted any positive finite low flag after checking that at least one dimension was assessed. A composition-low flag could consume budget even when assessment explicitly listed composition as unassessed. Renderer had projected only translated dimensionName and parsed score from display text.
   Implementation-line response: carry canonical dimension/numeric score, remove display-text score parsing, require flag.dimension to belong to assessment.dimensions. Re-read confirmed that membership check exists in the host at approximately line106. New regression results remain to be independently accepted after implementation finishes.

2. Review evidence is not bound to the media/result version it examined (open at initial review).
   src/workbench/generationCanvas/agent/shotVerifyStore.ts:176 checks project context and requestId, and :194 awaits a review of gathered inputs. It does not check that each node still has the same result/run/version when the judge completes. A replacement result on the same node does not itself start another review request. The returned old assessment can therefore be applied to current media; productionQaVerdict.ts latestJobForShot selects the current highest attempt when deciding a retry, potentially targeting a different execution from the reviewed one.
   Required evidence: defer judge, replace same-node result without starting another review, resolve judge, assert no old pass, budget refill or retry for the replacement result. Reject stale evidence or bind it to exact immutable result/execution identity at the shared review boundary and at host admission.

3. Late QA response may schedule retries after the Run is stopped/paused (requires lifecycle regression).
   electron/productionRun/productionRunDriverOps.ts:156 awaits renderer; :176 re-reads the Run but does not reject stopped/paused state before building/scheduling retries. productionRunReducer.ts:417 qa.retry.schedule checks duplicate job ID and budget but no Run lifecycle. Provider dispatch may be stopped independently, yet late QA can still reserve new retry budget/create authorized jobs. Verify with a deferred renderer response plus stop/pause; enforce intended no-new-retry behavior at the durable owner. This is not a claim that an immediate provider request was observed.

Reviewed behavior without additional defects found
- src/workbench/settings/defaultGenerationModelOptions.ts uses rowServesMode per task, exact vendor/model identities, task-scoped encode/decode, and preserves incompatible saved settings as unavailable. No setting rewriting added.
- electron/capabilityCore/mcpToolResults.ts partitions summary/count/row selection using usable===true rather than credential readiness. Credential state remains separately visible.
- electron/shared/videoCapabilities/paramConstraints.ts centralizes duration/comfy_duration mapping, conflicts and ambiguity; recommendation and planner use the same role. Declared unbounded numeric duration remains usable. Split/merge removes stale duration overrides while retaining other params. Actual graph frame quantization remains outside this code's claim.
- shotVerify parser records only actually valid scored dimensions; zero/missing/invalid axes do not become scored evidence in the runner. Missing vision/frame/judge/JSON produce explicit unreviewed reports. Ordinary generation is not turned into a failure by optional review errors.
- shotVerifyStore preserves latest-request/project ownership and does not reset correction budget on absent/partial assessment or direct empty-deviation writes. Full assessed convergence alone refills it. Media-version ownership is the remaining gap described above.
- Host requested-ID normalization rejects absent/mismatched/duplicate assessment rows; unknown/nonfinite/zero scores do not establish retry eligibility. Existing attempt/budget/deduplication machinery is reused.

Acceptance limits
No live visual acceptance, no paid/local-GPU generation, no duration inference run, no real judge run, and no end-to-end generation/export was performed by this reviewer. Single-frame plus text evidence does not establish temporal continuity, face fidelity across time, audio, or lip-sync correctness. Final integrated type/build/test verification remains owned by the implementation line.

Follow-up disposition: QA findings 1-3
Date: 2026-10-30

Re-read only the reported fixes and their targeted regression sources. No additional source changes, tests, inference, or app activation performed.

1. Dimension admission: CLOSED BY SOURCE REVIEW. ReconcileDeviation now carries canonical dimension and numeric score; renderer forwards them directly. Host low-flag admission requires membership in the explicitly assessed dimensions plus finite positive low score. Display-string score parsing has been removed. Contradictory/unknown dimension regression sources were inspected; test execution remains implementation-line evidence.

2. Media ownership: CLOSED BY SOURCE REVIEW. Renderer captures gathered review inputs together with result identity, URL, type, versionNo and latest run/task IDs, then compares current inputs after judge completion. Changed media becomes unreviewed and its deviations are removed; stale project returns unreviewed. The deferred same-node media replacement test checks no budget refill. Host independently freezes generation jobs and generation artifacts before awaiting the renderer and rejects a changed snapshot afterward. The additional artifact-version deferred regression was still being added at review time; its final result was not independently verified.

3. Late lifecycle response: CLOSED BY SOURCE REVIEW. After the await, the host requires the Run still be running in QA with identical reviewed inputs before accepting evidence, scheduling retries or writing completion. runQaStage returns accepted:false otherwise; its caller exits without assembly. Deferred pause/cancel regression sources explicitly check no retry reservation and no assembly. No further actionable omission found in the three focused fixes.

Disposition is source-level acceptance with the runtime/evidence limits above. The implementation line reports 41 targeted tests passed; this reviewer did not execute them or equate fixture tests with real inference.


## independent-acceptance-cleanup-support.txt

Independent scoped acceptance: cleanup, polling, canonical patch and support entrypoints
Date: 2026-10-30
Reviewer: pipeline_independent_audit
Checkout: C:/Users/CG16/.codex/worktrees/unpaid-workflow-repair/Nomi

Method and limits
Read-only source and regression-source inspection. No inference, GPU jobs, application activation, CUA, process termination, settings/source/hook changes, or independent test execution. Only this evidence report was written. Final overall validation remains in progress on the implementation line.

Material finding: deferred teardown can permanently miss escalation
electron/export/mediaProbe.ts:213-228 counts asynchronous teardown and prevents overlap. However, the one-shot force timer only escalates when cleanupPending is zero at that exact time. If graceful teardown is pending when the grace expires and later settles with the child still live, cleanup settlement only calls finish(); it never consumes a deferred force request. An otherwise force-killable child remains live until process_cleanup_failed at the final deadline. The new pending-overlap test kills inside the first callback and does not initially cover this population.
Implementation line acknowledged the finding and is adding a failing deferred-graceful-settlement/live-child test before preserving a force request for sequential consumption at settlement. No acceptance of that follow-up is implied until its source is re-reviewed.

Other scoped findings
- mediaProbe finish waits for child close and all started cleanup operations; cleanup rejection remains process_cleanup_failed. Windows fallback distinguishes positively observed exitCode/signalCode from a live unkillable child. Source supports the targeted direct-child exit-evidence behavior; whole descendant-tree liveness was not independently exercised.
- pollTaskToTerminal.ts checks the total deadline again after bounded sleep and before invoking fetch. Existing result/timeout semantics and query-only behavior remain intact. Regression sources use virtual timers for timeout-equal and timeout-longer intervals. No late provider query is initiated by that cutover path.
- Canonical patch dispatch retains nomi_canvas_plan across canvasWriteTarget -> proposal transaction -> applyCanvasToolCall. The operation discriminator remains patch_shots in arguments; bare retired patch tool names no longer open the public write branch. Renderer ownership, snapshot admission, project assertions and persistence checks remain in the existing canonical owner.
- scripts/with-gates-lock.py closes native ticket handles before unlink at dead-ticket reclamation, queue handoff and finally cleanup. Main lock inode is preserved. Dead-ticket reclamation is guarded, ticket numbers are monotonic, deletion failure is best effort and later cleanup can retry. The regression source verifies native handle-close ordering and live-ticket preservation.
- .design-sync/support/ds-entry.mjs reexports the canonical src/design/index.ts and the standalone previewHost only; no retired design modules are restored. Current provider/name configuration matches NomiPreviewHost. Support regression source builds the real converter entry in memory and runs a nonempty synthetic oracle fixture without inference. Private converter environment and actual visual rendering are not independently validated here.
- Inspected ownership records register existing media bounded-process, duration projection and review-assessment boundaries, pointing to their current source and parity tests. They do not implement alternate runtime owners or broaden runtime permissions. This review makes no claim that all structural gates have passed.

Disposition
The deferred-force finding requires follow-up acceptance. No further actionable correctness regression was identified in the remaining scoped changes by source inspection. Broad build/type/fixture validation and final delivery remain unfinished and are not certified by this report.

Deferred-force follow-up review
The forceAfterPending/cleanupSettled change now services a grace-expired force request exactly once after prior asynchronous cleanup settles. The inspected real-child regression demonstrates sequential [false,true] teardown and cancellation outcome. Synchronous rejection retains cleanup failure; a close observed before cleanup settlement suppresses force and allows finish only once pending work is settled. The implementation-line deferred-force-and-import-green.log reports 47 passed tests in two files; no tests were executed by this reviewer.

Additional terminal-state issue identified in that exact fix: cleanupSettled does not check settled. If prior asynchronous cleanup remains pending beyond the final cleanup deadline, the final timer rejects and marks settled. Later cleanup settlement can still consume forceAfterPending and start a new forced termination. The child close handler also returns early once settled, so an exit observed after the final rejection does not update closeSeen; delayed cleanup settlement can then force an already-exited child/PID. Required counterexample: graceful pending -> grace expires -> final deadline -> child close -> graceful settles; assert no new force after terminal settlement. Original missing-escalation population is corrected, but final source acceptance remains pending this terminal-state guard.

Final cleanup follow-up disposition
Both cleanup findings are CLOSED BY SOURCE REVIEW. cleanupSettled now requires !settled before consuming deferred force. The final deadline clears the pending force request and timer. The child close handler records closeSeen before returning on terminal state. Pending teardown remains serialized, real teardown rejection remains failure, and no new force operation is launched after terminal settlement. The new late-settlement regression source was inspected; terminal-cleanup-and-import-green.log records 48 passed tests across mediaProbe and import lifecycle. This reviewer did not run those tests.

Additional fair-share review
Inspected buildVitestInvocation and its node regression sources. Under concurrent admission, existing numeric/percentage max-worker options are removed and replaced with one effective limit no larger than the share or caller limit. Both flag spellings and split/equal forms are handled; arguments following -- are preserved; duplicate/missing/invalid options reject before spawn. Singleton admission preserves caller arguments unchanged. No actionable correctness regression found in this scoped change. worker-budget-green.log records 11 passed tests; not independently executed here.

Native export evidence boundary
Read native-export-acceptance/acceptance.json: noInference=true; native owners are planExport, compileFfmpegFiltergraph and renderFiltergraphToMp4; first/repeated exports have distinct paths and nonzero identical file sizes. Recorded probe metadata identifies H.264 video, 640x360, 30fps and 4 seconds. This supports the implementation line's unpaid fixture export/repeatability claim only. The reviewer did not decode/view the MP4 or run a new export. It does not establish actual model generation or end-to-end creator workflow acceptance.

Current scoped disposition: no remaining actionable blocker found in the reviewed cleanup, polling, canonical patch, support entry, ownership-registration or worker-argument changes. Broad validation and final delivery remain implementation-owned and are not declared complete here.


## independent-acceptance-extractions-native-fixtures.txt

Independent scoped review: assessment metadata, extracted owners, native speech and node fixtures
Date: 2026-10-30
Checkout: C:/Users/CG16/.codex/worktrees/unpaid-workflow-repair/Nomi
Reviewer: pipeline_independent_audit

No source/settings/ACL mutations, inference, CUA or user-process changes. Only this report was written. One read-only native PowerShell API availability probe ran against package.json; no ACL contents were printed or modified. Test suites were not independently executed.

Source acceptance
- ShotReviewAssessment now uses assessed:boolean. Inspected producer, shared admission, unreviewed helper, renderer and host consumers agree; true alone is insufficient without canonical dimensions and single-frame scope. Searches found no remaining production assessment.status consumers in inspected TS/MTS sources.
- Extracted productionQaStage.ts retains current running-QA, exact job/artifact snapshot, assessed-ID normalization, dimension-bound retry, budget and accepted:false safeguards. The driver calls the extracted owner and checks its returned acceptance before assembly. No second QA engine was added.
- Extracted mcpModelListOutcome.ts retains canonical usable row partition/count and separate credential display. mcpToolResults delegates to it; type-only return-shape import does not create another runtime projector.
- Native speech extractor now resolves /usr/bin/tar on macOS or an absolute System32/tar.exe on Windows, refusing unsupported/missing platform configuration instead of selecting an ambient GNU tar. Existing verified archive/member size/hash and staged-install checks remain. No actual speech download, extraction or transcription was run by this reviewer.

Node fixture failures observed
node-native-fixtures-green.log is not green: it records 64 tests, 58 passed and 4 failed (remaining cases skipped). Two failures are Get-Acl module autoload; one is an unreadable-skill population mismatch; one is elapsed-time tree teardown assertion.

Read-only ACL replacement
The existing helper explicitly runs System32/WindowsPowerShell/v1.0/powershell.exe. In that same executable, [System.IO.File]::GetAccessControl(absolutePath) successfully returned System.Security.AccessControl.FileSecurity without importing Microsoft.PowerShell.Security. Replace the single Get-Acl statement with [System.IO.File]::GetAccessControl($env:NOMI_TEST_ACL_TARGET), retaining all existing SID/owner/access-rule assertions. This is native read-only evidence, not permission mutation. The probe only printed the returned .NET type.

Unreadable skill fixture
Replacing SKILL.md with a directory does not establish a read failure: the upstream discoverer can intentionally skip non-regular files before reading them. Keep the file regular. A Windows fixture may hold it through an owned hidden .NET FileStream with FileShare.None, use a ready handshake, then discover while the handle remains held and release it in finally. This produces an actual Windows sharing/read failure without changing ACLs. Assert the good skill still loads and the bad regular file produces read_failed/warning. Do not change production directory handling merely to satisfy this fixture.

Timeout tree fixture and owner finding
The fixed <1200ms assertion conflates query timeout with native Windows taskkill completion. Preserve the real descendant-no-marker property. Use descendant-ready/PID handshake and a fixture-controlled release trigger instead of having the child self-write after 1.5 seconds: after timeout cleanup, trigger release and assert the owned descendant has exited and no marker appears. Avoid making a larger wallclock cap the new success oracle.

Material owner issue: scripts/lib/processTree.mjs Windows branch calls spawnSync(taskkill) but never checks result.error/status/signal and unconditionally returns true. spawnSync normally returns ENOENT or nonzero status rather than throwing, so failed tree cleanup is reported successful. Fix the existing owner to check the native result, distinguish positively observed child exit, and fail closed when termination is unproved. Add local failure/positive-exit regressions without touching user processes.

Disposition
No actionable regression found in the assessed:boolean migration, QA/model-list extraction or native speech executable resolution by scoped source review. The shared script process-tree status issue and invalid native fixture assumptions remain actionable. Broad validation and actual model-generation acceptance are not certified.


## final-independent-closure.txt

Final independent source closure
Date: 2026-10-30
Reviewer: pipeline_independent_audit
Checkout: C:/Users/CG16/.codex/worktrees/unpaid-workflow-repair/Nomi

Disposition
No critical introduced source defect found in this final focused review. This is acceptance of the inspected source repairs with explicit host/runtime exclusions below, not an assertion that every repository test or actual creator generation workflow is green.

Closed findings confirmed against current source
- Bridge POST parsing rejects null, arrays and primitive JSON before body.model access/CLI dispatch. Five actual handler regression sources cover null/array/string/number/boolean. Invalid JSON syntax remains a controlled400. Earlier unhandled null-body finding is CLOSED.
- loadCliProcessTree imports the existing checked process-tree owner. All three CLI runners receive that owner; each cancellation path and Claude's timeout calls it and propagates a thrown cleanup error. The private raw taskkill spawning paths are removed. No alternate-provider fallback exists: exact selected CLI only; unknown route rejects400. Cancellation now shares the fail-closed owner rather than interpreting a termination invocation as proof of success.
- Shared processTree checks native taskkill error/nonzero status, distinguishes positively observed exit, and otherwise fails closed. The previously reported unchecked-status issue is CLOSED by source inspection.
- Previously accepted mediaProbe serialization, deferred escalation and terminal-state guards remain the reviewed cleanup contract. Canonical public patch dispatch, task-aware/default usability projection, duration role ownership, exact imported graph capabilities, QA evidence provenance/lifecycle guards, and canonical DS/standalone preview export retain their earlier source acceptance.
- storyboardPlan.ts comments were not counted as behavioral implementation.

Evidence reviewed versus reported
Read bridge-body-owner-green.log:25 tests,22passed,0failed,3platform skips. Inspected body handler and shared-termination seam regression sources. These are fake-process/handler evidence; no actual CLI inference or user process termination was performed by the reviewer.
Implementation line reports full default25654passed/0failed/33pending and agent514total/507passed/3Windowsblocked/4skipped; these totals were not independently rerun. It reports en/zh native preview acceptance against source3656df04; screenshots were inspected by implementation line, not by this reviewer. Earlier native fixture MP4 metadata supports unpaid native export only, never actual model-generation acceptance.

Protected host/inference exclusions remain
- Strict native session/transcript/trace ACL checks establish extra non-user read grants and remain blocked; no permission/settings edits were authorized or performed in this audit. Source acceptance does not waive these assertions.
- Windows bash descendant timeout/cleanup acceptance remains blocked with its original strict assertion. Using the checked shared owner does not certify real Windows descendant cleanup or unsupported POSIX bridge process behavior.
- No new model inference, local GPU generation, paid generation, actual image-to-video production loop or complete final creator export was run by this reviewer. Do not label those scenarios verified from mocks or fixture exports.
- Preservation evidence is reported as78/78 original repair and55/55 Desktop source files unchanged, with3/4project hashes unchanged. One project changed while the user's original app remained active. Do not claim all project hashes were identical or infer this reviewer modified that project.

Audit activity
No source/settings/rules/hooks/ACL changes, inference, CUA, app activation, user-process changes or additional agents. Only independent evidence reports were written; the earlier native ACL API availability probe was read-only. Broad delivery/merge/activation remains owned by the coordinating implementation session.
