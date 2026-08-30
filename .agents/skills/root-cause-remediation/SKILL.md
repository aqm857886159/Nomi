---
name: root-cause-remediation
description: "Mandatory for every Nomi corrective change: user-reported bugs, regressions, CI-only failures, flaky tests, performance or security defects, review/audit findings, and compatibility failures in any production path. Classify one_off versus recurring before implementation. Recurring and high-risk repairs require a schema-v3 contract, shared enforcement boundary, structural prevention, dependency lifecycle decision, and changed regression evidence."
---

# Root Cause Remediation

## Mission

Act as an investigator and system owner, not a patch author. Restore the missing invariant at the earliest shared boundary so the reported failure and every equivalent entry fail safely or succeed consistently. A green example is not success if another vendor, version, caller, platform, or stored value can reproduce the same class.

This skill is the detailed operating source for P2/R21. `CLAUDE.md` and generated `AGENTS.md` only carry the trigger; `scripts/root-cause-contracts.mjs` is the merge-time enforcement authority.

## Success Bar

A remediation is complete only when evidence connects all of these:

- the exact user-visible symptom and deterministic reproduction;
- the direct mechanism that failed;
- the class-wide missing invariant;
- every equivalent entry point found by repository search;
- one or more shared boundaries that enforce the invariant without exceptions;
- changed tests for both the reported case and the class boundary;
- removal or explicit non-applicability of obsolete paths;
- an explicit dependency upgrade/retention decision with exit criteria when a third-party runtime is involved;
- verification on the platform or build boundary that originally exposed the defect.

## Required Workflow

1. Reproduce the symptom with the smallest deterministic fixture. Preserve the failing output before editing production code.
2. Trace the complete path from user input through parsing, state/persistence, shared services, and the final request/write/decode boundary.
3. Separate `symptom`, `direct_cause`, and `class_root`. The class root is the missing invariant that explains why equivalent inputs or callers can fail, not the line that happened to throw.
4. Classify recurrence before implementation: `one_off` requires repository-wide evidence that no other user, input, entry, machine, or future run can reach the mechanism and no reusable invariant can prevent it; observed once is not evidence. Otherwise classify `recurring`.
5. Search the repository by data shape, contract, producer, and consumer. Record at least two independently checked same-class entry points; do not search only for the reported provider, version, model, or fixture name.
6. Identify the earliest shared boundary that can own the invariant. If callers do not converge, first consolidate ownership or define multiple explicit shared boundaries.
7. For third-party behavior, inspect current official documentation, source, installed versions, and platform/package drift. Choose `upgrade-now`, `retain-with-exit`, or `not-applicable`; retention requires a target and testable exit criteria.
8. Read `references/contract-v3.template.json`, then create or update a schema-v3 `docs/fixes/*.root-cause.json` before a recurring or high-risk production fix. Preserve the template's exact field names, object shapes, and enums; every changed high-risk production file must be covered by `scope_paths`.
9. Add the failing reported-case test and at least one class-level test. Run only this red slice before implementation.
10. For recurring repairs, enforce the invariant at the shared boundary and list changed structural code in `prevention.artifacts`. Delete obsolete behavior in the same change; tests, documentation, and fallback paths are not structural prevention.
11. Run the changed class tests and `pnpm run check:root-cause-contracts`. After the logical batch is stable, run the risk-selected repository validation once.

## Decision Rules

- Prefer schema/type/parser/normalization/persistence boundaries over caller-side conditionals.
- A platform or dependency version may explain the symptom, but it is not automatically the class root. Bind the application-level contract explicitly, then decide whether the dependency also needs an upgrade.
- Upgrade now when a supported target-aware package can replace the old runtime without weakening packaging, security, or cross-architecture guarantees.
- Retain with exit only when an application invariant safely spans current versions and the upgrade has concrete prerequisites, owner paths, and verification criteria.
- If migration cannot distinguish legacy user-authored behavior from generated behavior, fail visibly or require explicit regeneration; do not guess and silently rewrite.
- If the same class truly has one technical caller, enumerate different input populations or downstream consumers. A one-example scan does not establish generality.

## Forbidden Patch Shapes

- A vendor/model/version/platform branch when a shared role, type, schema, byte, lifecycle, or persistence boundary can own the rule.
- Swallowing an error, broadening a regex, increasing a timeout/retry count, or weakening validation without proving the underlying invariant.
- Changing only the failing fixture or mocking away the production boundary.
- Adding a new path while leaving the old path callable as a fallback.
- Calling a dependency old but neither upgrading it nor recording a target-aware exit plan.
- Listing vague entry points, nonexistent paths, unchanged tests, or prose that cannot be tied back to code.

## Contract v3 Review

Before implementation, confirm the contract contains:

- `generality_proof` explaining why the solution spans the class;
- `shared_boundaries` with real path, symbol, and responsibility;
- `same_class_entry_points` with path, entry, disposition, and evidence;
- `recurrence` with `one_off`/`recurring`, reason, and concrete repository scan evidence;
- recurring `prevention` with a supported mechanism, shared enforcement path, invariant, fail behavior, no exception policy, strategy, and changed structural artifacts;
- `class_regression_tests` that are also changed `regression_tests`;
- `legacy_paths` as `removed` or justified `not-applicable`;
- `dependency_lifecycle` as `not-applicable`, `upgrade-now`, or `retain-with-exit`.

The exact machine contract is `references/contract-v3.template.json`. In particular, use `same_class_entry_points[].entry_point`, disposition `enforced` or `not-affected`, the exact `recurrence` and `prevention` keys, and an object-shaped `legacy_paths`; do not paraphrase schema keys in a contract outline. `prevention.kind` is one of `centralized-boundary`, `schema-validation`, `type-system`, `runtime-assertion`, `static-gate`, `migration`, or `dependency-upgrade`. Each external source is `{kind: official-doc|source-code, url, checked_at: YYYY-MM-DD, purpose}`; otherwise use a truthful `internal_only_reason`. Run the checker immediately after drafting so field-shape errors are resolved before production work.

Schema v1 and v2 contracts are immutable history. Any modification must migrate that contract to v3; new legacy contracts fail CI.

## Final Review

Do not call the issue solved until every answer has code or test evidence:

1. Can the same class still enter through another caller, provider, version, platform, or old stored value?
2. Does every equivalent entry converge on a declared enforcement boundary?
3. Does the boundary fail closed without a compatibility exception or fallback?
4. Did the reported case fail before the fix and pass after it?
5. Does a separate class-level test prove the invariant rather than the example?
6. Are dependency and migration decisions explicit, bounded, and testable?

Unknowns belong in `residual_risks`; they are not permission to claim completion.

## Reference

- `references/contract-v3.template.json` - exact schema-v3 authoring template; always read it before drafting a contract.
