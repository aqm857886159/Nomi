# Submitted task recovery repair

Classification: recurring bug. No new rules, hooks, permission settings, scheduling engine or provider graph.

1. User task and measures: retrieve an already submitted result after switching model selection. Test wrong-provider queries before/after using recoverTaskActions.projectIdentity.test.ts (two provider populations); live Test project retrieval remains unverified.
1b. Related UI: existing Retrieve again, success and recoverable/error states stay unchanged; no new copy.
2. Owner: saved GenerationNodeRunRecord.attempt owns submitted vendor/model; node selection owns the next run only. Door map: buildRecoverPayload has one production entry.
3. Reuse: existing recovery query and immutable attempt; production-owned nodes continue through retryProductionRetrievalForNode.
4. States: missing identity errors; pending and failed retrieval retain existing behavior; success delivery retains project binding; unavailable provider remains recoverable. No state UI changes.
5. Interruption: existing timeout, cancellation and project-switch delivery remain unchanged; no new task submission during recovery.
6. External data: ComfyUI/cloud query routes are selected from the saved attempt. No protocol or parser change.
7. Performance: no new user interaction or provider request. The repaired submit boundary adds a project-save flush and a bound disk read before submission. Timing budget is unverified; this is required durability work, not provider polling or a new scheduling engine.
8. Real conditions: Windows; 311 changed-slice regression tests passed; isolated English and Chinese empty-profile UI checks passed 4/4 each, screenshots inspected. Native hidden Electron 0.24.0 startup verified visible=false/focused=false. Two existing real generated clips produced a fully decoded 10-second H264/AAC export using the official compiler. Fresh inference-to-export and live restart recovery remain unverified. No additional generation spend.
9. Acceptance written before production edit: both provider-identity regression cases fail on official source; both pass after repair; old missing-attempt record still works; cross-project refusal and project-switch delivery still pass; stale selected mode omitted after provider/model change; renderer and Electron builds pass. Independent audit line verifies source/test scope. Rollback: preserve the isolated task diff, then revert only this repair after commit. The original user checkout and its projects are untouched by these isolated source changes.

Independent pre-delivery review found that transport kind/mode also belong to submitted identity. Expanded acceptance before production expansion: save exact built request query kind/mode before provider submission; failed identity persistence must block submission; snapshot survives schema roundtrip; callback reaches image/video executor; later model/mode/reference edits do not change recovery query. Historical records without snapshots retain existing best-effort inference and cannot guarantee reconstruction of missing original inputs.

Independent acceptance: pipeline_independent_audit reviewed final durable snapshot, changed retry refusal and receipt preservation. No further actionable defect found in the reviewed scope; the reviewer did not independently rerun tests.
