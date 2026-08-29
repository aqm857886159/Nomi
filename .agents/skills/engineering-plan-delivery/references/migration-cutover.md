# Migration Versus Archive-Only Cutover

Read this reference only when work changes runtime/session/storage ownership or
includes migration, cutover, replay, recovery, or downgrade behavior.

Require full Agent-session migration when conversation/context continuity is a
promised user asset or when a contract, audit, or compliance rule explicitly
requires that history. The existence of paid work alone does not require full
session migration; it always requires domain-level reconciliation. Otherwise
prefer a safe archive-only cutover:

- preserve documents, canvas state, media, generated results, and other work;
- preserve paid, submitted, or `submission_unknown` work in its domain owner and
  reconcile it; never retry or resubmit until definitely-not-submitted is proven;
- archive old conversations/context as read-only or exportable;
- invalidate pending approvals and never replay uncertain approved work;
- mark only legacy Agent work with no external side effect as interrupted and
  require explicit resubmission;
- back up old state, write one cutover marker, and allow only the new writer;
- state downgrade limitations after the new writer has produced data.

Do not build lossless session migration merely to avoid making this decision.
Do not use a simplified cutover to discard user work or create dual writes.
