# Provider adapter validation history lifecycle

## Feedback and root cause

WeChat users reported that an API configuration error remains visible after the
connection is corrected, deleted, and the app is restarted. The observed
symptom is a stale terminal certification run being presented as current
connection state.

The direct cause is that `provider-adapters.json` persists terminal
certification runs, while the bridge exposes list/get/cancel only. The UI
reloads those runs on startup and the catalog deletion path does not own or
remove certification history. The class root is a missing lifecycle boundary
for persisted terminal run records: active work and historical outcomes have
different retention and user actions, but the store treats both as permanent.

## Scope

### In scope

- Add a store/service/IPC/preload/renderer clear-record path for terminal
  certification runs.
- Enforce at the store/service boundary that active runs cannot be deleted.
- Show a clear-record action for terminal rows and the terminal detail screen.
- Keep promoted revisions and model configuration intact when a run record is
  cleared.
- Add regression tests for persistence, active-run protection, IPC contract,
  bridge usage, and the terminal UI action.

### Explicitly out of scope

- Do not delete vendor/model catalog entries, credentials, or promoted
  revisions.
- Do not hide errors merely because a vendor was deleted.
- Do not change verification, retry, cancellation, or run retention policy for
  active work.
- Do not change any provider adapter request or model capability behavior.

## Design

The earliest shared persistence boundary owns deletion. A terminal run can be
removed by id; an active run returns `RUN_ACTIVE`; an unknown id returns
`RUN_NOT_FOUND`. The service and IPC repeat the state check so a stale renderer
cannot bypass the invariant. The revisions collection is deliberately kept:
the run is historical UI state, while a promoted revision may still be the
catalog's active call configuration.

The renderer calls the same bridge method from both terminal list rows and the
terminal detail footer. On success it removes only that run from local state;
on failure it leaves the record visible and lets the existing error handling
surface the failure. The action is labelled as clearing the record so users do
not infer that their connection or model is being deleted.

## Acceptance

1. A failed terminal record can be cleared from the task list/detail.
2. A new `ProviderAdapterStore` instance no longer returns the cleared run.
3. A queued/testing run cannot be cleared and remains persisted.
4. Clearing a run does not remove its active revision or catalog model.
5. The existing cancel/retry/start/list flows remain unchanged.
6. Focused tests, typecheck, root-cause contract validation, and the affected
   system gates pass.

## Rollback

Revert the single delivery commit. The new IPC method is additive and old
renderers remain compatible; no persisted data migration is needed.
