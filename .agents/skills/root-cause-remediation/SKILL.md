---
name: root-cause-remediation
description: Use for every reproducible bug or regression in Nomi. Classify one_off versus recurring before implementation; every recurring repair and every high-risk production repair requires a class-level root cause contract, changed structural prevention, and regression tests.
---

# Root Cause Remediation

Use this skill whenever a user reports a failure or a regression is found. Do not narrow the workflow to high-risk paths; high-risk paths are where CI additionally mandates the contract even when the incident is classified `one_off`.

## Required sequence

1. Reproduce the exact user-visible symptom with the smallest deterministic test or fixture.
2. Trace the full path from user input through state/persistence to the final request, write, or decode boundary.
3. Separate symptom, direct cause, and class root. The class root is the shared missing invariant that lets every equivalent entry fail.
4. Classify recurrence before implementation:
   - `one_off` only when repository-wide evidence shows no other user, input, or entry can reach the mechanism and no repository invariant can prevent it. “Observed once” is not evidence.
   - `recurring` whenever the same mechanism can affect another user, input, entry point, machine, or future run—even if only one report exists today.
5. Enumerate all entry points into that invariant. Search by data shape, contract, and consumer—not only by the reported model/vendor name. Record the concrete scan in `recurrence.same_class_scan`.
6. Before changing third-party behavior, read current official docs and primary source code. Record URLs, purpose, and check date. If the issue is purely internal, state why external material cannot decide it.
7. Write or update `docs/fixes/*.root-cause.json` before the production fix for every `recurring` repair and every high-risk production repair. The contract must cover every changed high-risk production file.
8. Add a failing regression test for the reported case and at least one class-level boundary when they differ.
9. For `recurring`, fix the earliest shared boundary and list the changed enforcement code, runtime assertion, static gate, migration, or deletion in `prevention.artifacts`. Tests and documentation alone are not structural prevention.
10. Do not add retry, skip, fallback, manual recovery, or vendor/model branches when a role, type, schema, upload, transport, or persistence boundary can solve the class.
11. Define migration behavior for old stored bindings/scripts/data. Delete obsolete behavior in the same change; do not leave a permanent fallback.
12. Run focused red/green tests, `pnpm run check:root-cause-contracts`, then the repository gates.

## Completion test

Do not call a bug solved until you can answer all of these with code/test evidence:

- Why did it happen?
- Which users and inputs were affected?
- What shared invariant was missing?
- Why is this `one_off` or `recurring`, and what repository-wide evidence supports that classification?
- Which equivalent entry points were scanned?
- What prevents the same class from returning through another model/vendor/path?
- Which changed `prevention.artifacts` enforce that prevention outside tests and prose?
- How are old stored values handled?
- Which changed tests prove the reported case and the class boundary?

If any answer is unknown, mark it as a residual risk in the contract instead of guessing.
