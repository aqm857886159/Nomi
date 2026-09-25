# pi history read-side repair

> 📋 方案待拍板 · 状态由 docs-autosync 自动登记，作者请按实修改

Status: implementation; no paid model or real project access.

## Scope and invariant
Activity snapshots are model working sets, never the complete UI transcript. Use the existing Session owner and current Branch query with bounded pages; retain pi watch/reducer for operations. UI pages are disposable read caches, not persisted or fed back into model context. Stable entry IDs survive compaction and page expansion. Reconnect events must belong to the acknowledged workspace epoch.

## 先查别人
pi-agent-core 0.85.1 installed exports and implementation: harness/session/session.js StorageBackedBranch.findEntries (cursor, start, limit); harness/runtime/reducer.js entry_added intentionally cuts at compaction; harness/events.js BufferedEventWatcher serializes asynchronous listeners and resnapshot boundaries. Keep the installed runtime; watchSession is stubbed. The upstream API is the implementation prior art, not a second host.

- Branch queries: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/session.ts
- Upstream reducer: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/runtime/reducer.ts
- Buffered watch: https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/events.ts

## Changes
Share current-branch paging between read-only and active lanes. Separate history entries parameter from runtime snapshot projection. Recover bounded input intent from public operation metadata plus current branch originals during transform_context; never reactivate historical payment or surface authority. Reject stale IPC during reopen. Scroll to older records via the existing panel.

## Non-goals and rollback
No payment/ProductionRun changes, no retry/send UI actions, no SDK upgrade or second session DB. Revert this task commit to remove the adapter. Existing JSONL remains untouched.

## Acceptance
R02 actual SDK lifecycle red: original inputs 2, visible inputs 0. Run compaction twice, page/reopen with stable IDs, no duplicate assistants; test input scope and stale open events. Focused native and renderer checks under the shared test lock. Real Electron visual/model/platform evidence remains unverified until root acceptance.

- pi Branch paging: [session.ts](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/session/session.ts), installed dist/harness/session/session.js:127.
- pi runtime working set: [reducer.ts](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/runtime/reducer.ts), installed dist/harness/runtime/reducer.js:150.
- pi subscription serialization: [events.ts](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/agent/src/harness/events.ts), installed dist/harness/events.js:142.

Prior-art report: docs/research/2026-09-19-pi-history-read-side/prior-art.md.
