# Nomi workflow repair — direction check and design card

Status: user-approved by the pasted sequential unpaid repair instruction dated2026-10-30; implementation and acceptance evidence are recorded below. This is a task-specific plan, not a rule, hook, permission setting, or blocking script.

## વપરાશકર્તા માટેનો ચોક્કસ નિર્ણય

ભલામણ: Nomiના હાલના model/input contracts, સાચવેલા provider task IDs, review અને timeline/exportના ownersમાં જ repair કરવું. Reviewનો પુરાવો ન હોય તો તેને PASS ન ગણવો. નવો automatic generation/review engine, પોતાની રીતે provider fallback, નિયમો, hooks અથવા permission ફેરફાર ન કરવા. 23 audit મુદ્દામાંથી ખામી, હાલની product-design મર્યાદા અને missing setupને અલગ રાખીને ચકાસવા.

આખી app ફરી લખવાની જરૂર દર્શાવતો પુરાવો મળ્યો નથી. હાલના shared boundariesનું સત્ય અને consistency પુનઃસ્થાપિત કરવું એ ભલામણ છે. વપરાશકર્તાના નવા સંપૂર્ણ unpaid repair instructionમાં આ structural directionની સ્પષ્ટ મંજૂરી છે; તેના આધારે existing ownersમાં repairs કરવામાં આવ્યા છે.

## 0. Root cause in one sentence

Declared intent, executable model inputs, durable provider receipts and actual review evidence do not consistently retain one identity across their existing projections; repeated local patches have hidden the differences rather than restoring those existing boundaries.

## 1. Symptom → mechanism → class

| Audit findings | Mechanism | Class / disposition |
| --- | --- | --- |
| F01, F11, F18 | Two checkouts and incomplete delivery; redacted save exceptions | Consolidate reviewed changes, reproduce persistence failure; never reset valid project content to defaults merely to suppress an error |
| F02–F05, F09 | Defaults, graph parameters and reference bindings disagree with the declared model contract | Use the existing capability/parameter owners for all callers; preserve explicit reference bindings |
| F06–F08 | Empty deviation arrays represent both successful and unavailable review | Replace that ambiguous internal result with explicit per-shot evidence in the existing review chain; unavailable is not pass |
| F10, F21, F22 | Real regressions mixed with missing tools and Windows fixture assumptions | Reproduce and classify each failure; do not weaken tests or label missing browser execution as UI success |
| F12–F15, F17 | Custom bridge/discovery claims exceed supported native capabilities | Follow official model admission/MCP/connection paths; do not fabricate usage, image support or provider identity |
| F16, F19 | Incompatible optional dependencies and asynchronous certification deadlines | Retain declared runtime versions until compatible requirements and real receipt evidence identify the necessary change; no blanket upgrades |
| F20, F23 | Canvas completion, result localization and timeline assembly are distinct facts | Reconcile exact saved task/provider identity; use existing native timeline/export after acceptance; never regenerate just to retrieve |

The 23 audit findings are not 23 proven app bugs. Notably, optional review and absence of a finished timeline are existing workflow states, not authorization to add a new automatic paid workflow. The renderer review, first-frame evaluation and explicit approval policy must follow the repository's current design.

## 2. Why recurrence requires a direction decision

`node scripts/fix-churn.mjs src/workbench/generationCanvas/agent/shotVerifyRunner.ts` reports 9 fixes in the same concept directory within 14 days, making another change the tenth. The generated AGENTS P1 and `docs/engineering/direction-check-template.md` require a direction review and user decision before more patching. No exception is assumed: typed review coverage may change several existing consumers.

The existing review chain is runner → shotVerifyStore → capabilityApplyHandler → ProductionRun QA. A bare `[]` cannot identify whether any requested shot was actually assessed. Both a valid high score and four independent failure populations currently return the same value. This is an evidence/representation boundary, not a MiniMax-specific condition.

Experience invariants: intent equals request parameters (⑩); model-declared controls/slots are available consistently (⑪); a completed provider task and a passed review must mean what their consumer expects (⑫).

## 3. Predictions if structure is unchanged

- Another model without vision or invalid judge output can again appear to pass: exercise the four baseline cases below.
- A renamed imported model or a second ComfyUI instance can again lose capability/duration identity: existing imported-workflow and submitted-provider regression suites must cover these populations.
- A long-running provider job can finish while the saved node remains recoverable: compare the exact stored task ID with GET history and assert single localization without another submit.

## 4. Independent target / evidence

Baseline characterization: `src/workbench/generationCanvas/agent/shotVerifyEvidence.characterization.test.ts`. It deliberately records current faulty equivalence; passing this baseline is NOT a fix. After direction approval, replace it with regressions requiring explicit assessment evidence and integration coverage through the production consumer.

Existing runner/store tests currently expect swallowed failures. These assertions must be reconciled with their original nonblocking-generation intent, not simply changed to make tests green. A review failure must not turn an already successful generation into a failed generation, but also must not certify a visual pass.

Independent acceptance is recorded in the task ledger and scoped reports. It identified a null-body bridge crash that was reproduced and repaired; protected Windows host failures remain explicitly blocked.

## 5. Existing solutions and prior art (design card ★0 / ★3)

1. `src/workbench/generationCanvas/components/batchPlanPreview.ts` explicitly records the 2026-09-26 decision: generating a batch must not automatically spend on text-model review. Confirms that no unconditional canvas QA hook or new setting is authorized by this repair.
2. `electron/productionRun/productionQaVerdict.ts` already supports skipped review and bounded retry from authorized budgets. Confirms reuse of this owner rather than a second scheduler, judge service or unlimited rerender loop.
3. `docs/plan/2026-06-28-storyboard-closed-loop-verify.md` documents first-frame scope and missing-evidence limitations. Confirms the difference between repairing truthful review results and adding a new temporal/face-analysis feature.
4. `src/workbench/generationCanvas/runner/recoverTaskActions.ts` already uses stored attempts and production-owned retrieval. Confirms exact receipt recovery instead of resubmission or private provider API bypasses.

The immediate invariants are internal domain state and receipts. No new dependency is proposed; dependency upgrades require official source/package compatibility evidence in their own schema-v3 remediation contract.

## 6. Options and recommended structure

| Option | Concrete behavior | Cost / risk | Recommendation |
| --- | --- | --- | --- |
| Reuse and repair existing owners | Explicit model/input identity; exact receipt recovery; explicit reviewed/unavailable evidence; existing native timeline/export | Touches shared consumers and requires regression/integration proof | Recommended |
| More per-provider patches | Special-case MiniMax/LTX/CLI names and increase timeouts | Another provider/version or stored project can repeat the class | Reject |
| New automatic film engine | Review and rerender every canvas result with a new scheduler | Changes product/approval/spend semantics; outside requested repo-conforming repair | Reject |
| Remove review entirely | Never claim review, but lose the existing feature | Removes intended functionality | Reject |

## 7. User decision / tradeoff

Approve reuse of existing Nomi owners, with truthful partial/unavailable states instead of automatic paid actions or guessed compatibility. The consequence is that some operations will honestly remain unavailable until their real model/runtime is configured; no fallback model will silently answer in its place.

### Design card ★1 — task and measures

User tasks: recover already-created Diwali clips without resubmission; generate an approved image-to-video shot with its exact duration/reference/model; assemble accepted existing clips and export through native Nomi. Measures: requested-vs-bound parameter assertions, provider-submit call count, localized-result identity, QA assessed-shot coverage, ffprobe duration/decode. The current instruction excludes all real model inference, including local/free text, vision, speech, certification and generation. Existing prior sample receipts are historical evidence only. Missing real resources remain unverified.

### Design card ★2 — ownership

Model declarations own capabilities; parameter-reference contracts own input slots; captured execution contexts own project identity; saved attempts/ProductionRun own submitted identity; the existing review runner owns assessment evidence; native timeline/export owns assembly. No new parallel owners.

Door scans completed before proposing implementation:

- `node scripts/door-map.mjs verifyGeneratedShots`: one writer, `src/workbench/generationCanvas/agent/shotVerifyStore.ts#verifyGeneratedShots`.
- `node scripts/door-map.mjs verifyShotsForProduction`: one writer, `src/workbench/capability/capabilityApplyHandler.ts#verifyShotsForProduction`.
- A further hop: `verifyShotsAndReport` is consumed by the production capability adapter; test and wrapper expectations require inventory before changing its return shape.

Each logical repair still needs its own schema-v3 contract and complete generated door list before production code changes. Earlier contracts remain evidence, not a waiver.

### Design card ★4 — states and related surfaces

Keep existing UI and approval policy. Use current queued/running/recoverable/error/success states for generation. A failed or partial review must use the existing skipped/summary projection with no false pass; do not add a new banner, editor, settings toggle or unconditional charge. Existing generated assets remain available even if review cannot run. No new layout/board is proposed.

### Design card 5 — interruption

Cancel, project switch, restart and concurrent requests must retain captured project identity. Late responses must not overwrite another project or newer review. Receipt lookup must not submit again. Pending provider work remains pending rather than being force-stopped to install a build.

### Design card 6 — external failure

Only declared provider adapters and official Nomi APIs are used. Unreachable endpoints, absent assets, unsupported Windows routes and unknown task IDs fail visibly with their true state. No credential contents in diagnostics. No Python/node dependency installation is inferred from a conflict count alone.

### Design card ★7 / 8 — performance and real conditions

No new user operation or autonomous generation loop. Reuse repository performance scenarios for any implementation that changes canvas/queue paths. Baseline timing is unverified until the concrete repair slice exists. Platform: Windows; locales zh/en acceptance must use existing runners. Current active app/queue must be checked before any build activation; no whole-PC control.

### Design card ★9 — acceptance and counterexamples (before implementation)

- Valid review, no vision, extraction rejection, invalid JSON and judge rejection produce distinguishable evidence; no unavailable shot gets a passing verdict.
- Partial/missing shot IDs and concurrent project switches cannot create blanket success or cross-project writes.
- Approved generic duration reaches the declared imported workflow parameter; unsupported durations fail before submission rather than silently truncating.
- A completed original provider task localizes once without another generation; selected model edits cannot redirect retrieval.
- Existing batch generation does not acquire an unapproved automatic review charge.
- Project persistence preserves valid documents/assets; do not replace malformed meaningful content with defaults to hide errors.
- Test/setup failures are classified and resolved without removing coverage; no mock-only evidence substitutes for a real final export.
- Fresh source/build identity, required gates, independent review and merged verification are necessary for the final 'resolved' claim.

Rollback: preserve the current dirty task diff, then revert only reviewed repair commits after they exist. No reset, destructive cleanup, permission/rule/hook changes, blanket dependency upgrades or direct push to main.

## Preparation limitations

The first `pnpm run delivery:preflight` could not resolve pnpm metadata because registry DNS was unavailable in the restricted command environment. Direct execution of its repository script failed writing FETCH_HEAD under the read-only Git directory. These are execution-environment failures, not proof of a clean/latest task branch. Escalated execution may resolve them; no authorization or automatic-review rejection has yet been inferred from these ordinary command failures.

No production code has been changed for this proposed direction. All earlier repair changes remain preserved.

## Preparation results — 2026-10-30

- Baseline characterization executed successfully: 1 file, 4 tests passed. It confirms the current missing-evidence equivalence, not a repaired QA verdict. Initial restricted execution failed in a temporary-cache rename; the same repository test passed under the approved execution environment.
- Official delivery preflight was retried with approved Git metadata/network access. Fetch completed, then the repository correctly refused `dirty_worktree` because the prior repair diff is still uncommitted. The dirty source was not reset or overwritten. This is separate from the direction-review decision.
- Read-only runtime snapshot at 07:44:20 UTC (13:14:20 India): ComfyUI queue running=0, pending=0. Nomi PID 121200 runs from the repair worktree; MCP launcher processes also use that worktree. No app or provider process was stopped/restarted.
- No production implementation, rule/hook edit, permission change, generation or dependency installation occurred in this preparation step.

## Default mode repair acceptance (T024–T026, before implementation)

The new defaultGenerationModelOptions regression slice failed 8 of 9 tests before the production edit. Existing settings storage deliberately validates identity format only; that contract remains unchanged. The real defect is the selector projection. Reuse rowServesMode, require the picker task in encode/decode, preserve exact vendor identity and show incompatible saved defaults as unavailable. Both settings and resident selectors must pass their task; no automatic selection or settings rewrite is introduced. Acceptance: all four modes isolate their supported rows; t2i-only/image-edit and I2V-only/T2V fail closed; absent publication evidence fails closed; separators in identities roundtrip. Existing Agent row fixtures must include the publication evidence of their real DTO. No layout redesign, new control, dependency upgrade or paid call. Performance: same linear pass over the small existing catalog; no new IPC/network calls. Real visual acceptance remains unverified until isolated build tests.

## Model-list summary acceptance (T027, before production edit)

Three new cases failed on the old summary: both locales counted a key-ok unusable row, and missing usable evidence was inferred from key status. Replace the summary partition, row markers and textual selection instruction with the canonical usable fact. Keep structured rows unchanged. Credential readiness remains independently visible; it does not become endpoint health. Existing credential-missing guidance remains; platform/publication-only failures point to model inspection instead of claiming an API key will fix them. Same owner, no new probe, no provider-specific branch, no settings rewrite or paid call. Acceptance: exact count/row parity and no selectable mark for blocked or unevidenced models.

## Declared duration projection acceptance (T049–T052, before implementation)

Both real imported graphs explicitly bind comfy_duration; the importer defines the comfy_ scalar namespace. Reuse paramConstraints for canonical and namespaced duration roles. Map semantic intent before defaults, refuse conflicting explicit values, and reuse the role in recommendation/range checks. Never infer unnamed graph values, labels or model-specific node IDs. Preserve existing native invalid-value policies and approval/spend semantics. Counterexamples: 6/7/8 seconds, equal explicit values, conflicts, ambiguous controls, absent duration, and unchanged canonical model behavior. No user graph/project migration, new UI, dependency or engine. Complexity is linear in existing controls with no extra IPC. Verify request fidelity through production builders; new inference timing remains excluded.

Duration caller follow-up before implementation: resolveGenerationPlan and split/merge proposal acceptance are additional consumers. Bounded and unbounded declared numeric duration controls must preserve requested values; unbounded means no published maximum, not no duration control. Split/merge pieces must not inherit a stale original duration override. Added three reported/class regressions for those cases before their production edits.


## Review-evidence repair acceptance (before implementation, T071–T082)
Recurring class: missing, rejected, malformed or unassessable review evidence currently collapses into the same empty deviation list as a true pass. Production then manufactures per-shot passes from requested IDs, and empty results refill the correction budget.

Keep the existing review/ProductionRun engine. Replace the ambiguous return with one report carrying deviations plus per-requested-shot assessment evidence. The pure judge parser retains explicit scored-dimension provenance; zero/missing/invalid dimensions are not assessment. The store retains project/request ownership and only refills budget on fully covered assessed convergence. The renderer projects only actual evidence. Host QA requires explicit assessment for passes and retries, fills missing IDs as unreviewed, and never retries unknown/nonfinite scores. Existing semantic multi-shot QA attention behavior remains; optional review cannot fail successful generation. No automatic review is added to ordinary batch generation.

Acceptance: unavailable vision; unavailable/empty video frame; rejected judge; invalid JSON; JSON with missing or zero dimensions; partially assessable frame; omitted requested IDs; concurrent latest-wins; project switch; no budget reset on unreviewed; no retry for unknown evidence; bounded/deduplicated retries for genuine low scores; successful optional generation unaffected. Evidence scope stays single-frame plus text context, never full temporal/face/audio/lip-sync verification. All judge responses are local fixtures; no real inference.

Independent QA acceptance refinement (before implementation): retain canonical dimension + numeric score from content verdict through reconciliation/IPC; do not parse translated display text. A flag for an unassessed or unknown dimension cannot schedule a retry. Exact contradictory partial-evidence case reproduced in review-dimension-red.log.

Independent lifecycle acceptance refinement (before implementation): freeze reviewed node result/run plus gathered prompt/reference context; reject stale media evidence after await. Freeze Run generation jobs/artifacts and require current running QA lifecycle before late verdict/retry writes or assembly. Deferred tests reproduce changed same-node media and user pause/cancel during QA.

T083–T085 acceptance before implementation: current compileShotOutbound and reference-slot owners already require explicit visible referenceBindings and never inject anchorIds content. Remove contradictory automatic-wiring/text-injection claims from both built-in cinematic skill prompts and stale PlanShot field comment. Preserve exact tool fields and author language. Native-tool fixture must accept declared URL bindings and prompt must not promise anchorIds auto-wiring. No new rules/hooks/gates or hidden reference synthesis.

T094–T104 existing-customization acceptance before implementation: preserve the existing Desktop local-cli-bridge.cjs as a clearly identified customization, not a new/native Nomi bridge. Repair exact selected CLI routing (no fallback), reject non-text input rather than claim vision, preserve Gujarati/Hindi/system/user content, separate generation prompt language from chat, omit fabricated usage, and stop future raw request/reply retention without deleting prior files. Keep official MCP and native integrations unchanged. Use VM/local HTTP handler test doubles; no CLI inference, quota, real agent spawn or app/settings changes. Discovery lists all existing route identities without asserting authentication/platform/vision readiness.

T110/T112/T127 verification prerequisite: installer tests cannot reach real member/hash validation on Windows because their ZIP writer shells to unavailable zip. Use already-declared fflate0.8.3 to create fixture bytes; production still extracts using its supported system tar and validates all members. Packaging assertions use path.resolve/os.tmpdir/path.join and restore only test environment stubs. No production installer validation or platform assertion is weakened. Baseline10failures retained in speech-install-baseline.log.

### Process cleanup class acceptance
Windows red evidence: cancelled imports and timeout/output-limit probes report process_cleanup_failed. Shared owner must serialize pending asynchronous tree teardown, distinguish positively observed child exit from a live unkillable process, and retain existing fail-closed behavior. Acceptance includes deferred cleanup overlap, exitCode and signalCode populations, existing taskkill failure counterexample, and actual import cancellation/quit fixtures. No service processes are stopped.

### T113–T116 support entry acceptance
Before changes: synthetic-oracle fails on a retired feature flag import; DS converter barrel lists three removed modules; old lab commands target a removed onboarding engine. Preserve current MCP onboarding and the release-tree injected probe. Use the canonical public design barrel plus its converter-only preview host; remove retired lab cables, not restore a parallel onboarding engine. Acceptance: bundle converter entry, run a nonempty synthetic-oracle card without inference, classify private .ds-sync setup separately. Windows fixtures must use native path expectations, requested chmod evidence on Windows and POSIX mode assertions only where supported; fake Node Antigravity protocol fixtures explicitly select their existing supported-platform seam while Windows native refusal remains tested.

### Poll deadline acceptance
The unpaid shared-budget fixture reproduces a new fetch at zero remaining wait time. The existing shared polling owner must recheck elapsed time after sleep, before any read. Equal and oversized intervals must time out with the accepted task ID and no extra fetch; the submit/wait forty-second fixture must pass without longer caps.

### Windows gates queue acceptance
Five FIFO workers finish but leave all ticket files because deletion precedes handle close. Existing owner must close before unlink at dead-ticket, handoff and final cleanup paths; main lock inode is never removed. Real native-handle regression checks deletion ordering, dead ticket removal, and live ticket preservation. Signal fixture must respect Windows TerminateProcess versus Python raised-signal semantics; no hooks or validation policies change.

### Worker budget projection acceptance
Concurrent wrapper plus explicit maxWorkers reproduced duplicate singleton CLI failure before tests. Existing invocation owner must serialize one effective minimum of caller and peer budgets, retain exclusive behavior, support split/equal numeric and percentage forms matching pinned Vitest source, and reject malformed/duplicate shared-mode options. No validation rule or fairness budget is relaxed.

### Existing owner size and temporary workspace acceptance
Integrated gates reject growth beyond frozen mcpToolResults and productionRunDriverOps limits. Extract the complete model-list projection and QA stage into focused domain modules, deleting their old bodies in the same change, preserving public call behavior and class regressions. Do not increase size baselines. Existing custom CLI workspace and support fixture must use the existing script temporary-directory owner; no new cleanup implementation or bypass allowance.

### Native speech archive executable acceptance
Full default lane under Git Bash PATH reproduces five extract failures: GNU tar parses C: as a remote archive. Bind the existing extractor to Windows System32 bsdtar and macOS /usr/bin/tar; retain existing verified ZIP/member/weight/VAD and atomic publication boundaries. Supported native paths and unsupported/missing configuration are checked; real Windows installer class must pass with Git tar earlier in PATH. No transcription inference, new archiver, permission changes or silent fallback.

### Review fact representation
Use assessed:boolean for the new unreleased fact that judging actually occurred. This is evidence, not another workflow state machine. Missing/false evidence cannot pass or schedule a retry; dimensions, requested-shot identity, frame scope and lifecycle ownership remain mandatory. No vocabulary rule or baseline edits.

### Script process teardown evidence
Native Windows missing/nonzero taskkill must fail closed at existing killProcessTree owner; observed exited child returns false. Test native failure without invoking any user process; retain POSIX process groups and verify real owned descendants on Windows. No new cleanup engine or permission changes.
