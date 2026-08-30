# Focused Validation Policy

> 状态：📎 历史基线；`fast/full` 两档已由 [2026-08-30-risk-scoped-validation-evidence.md](2026-08-30-risk-scoped-validation-evidence.md) 的独立风险面取代

## Goal

Keep pull-request feedback fast without weakening the release boundary. A small,
isolated change should run the contracts gate and only the tests directly related
to its changed files. Changes that can affect persistence, security, provider
execution, Electron packaging, or the validation workflow must still run the
complete validation profile.

Work is delivered as one batch: finish the classifier, runner, tests, audit, and
rules first; run focused verification once; then run the full gate once before
the single push. A small local blocker must not restart the entire suite.

## Policy

- `fast` is the default lane for an ordinary pull request.
- `fast` runs `gates:contracts` and a changed/related test selection. It does not
  run the full Vitest suite, desktop journey, or package job.
- `full` is selected automatically for high-risk paths, dependency/build/CI
  changes, deletes/renames, empty or unresolvable diffs, pushes to `main`, and
  explicit manual full validation.
- The classifier is fail-closed: it can promote a PR from fast to full, never
  demote a high-risk change to fast.
- `Quality Gate` remains the single required aggregate check. Skipped full-lane
  jobs in fast mode are accepted only after the classifier and contracts/unit
  jobs succeed.
- This policy affects iteration feedback only. A release candidate and every
  merge to `main` retain the complete validation profile.

## Files

- `scripts/select-quality-gate-profile.mjs`: deterministic changed-file
  classifier and GitHub output writer.
- `scripts/test-focused.mjs`: bounded Vitest/Node test selection for the fast
  lane.
- `.github/workflows/quality-gate.yml`: classifier job and conditional lanes.
- `scripts/check-quality-gate-workflow.node-test.mjs`: contract tests for the
  workflow and policy.
- `docs/audit/2026-08-29-test-surface-audit.md`: evidence-backed keep,
  simplify, and missing-coverage decisions.

## Acceptance

1. A docs-only or isolated source PR selects `fast` and never starts desktop or
   package jobs.
2. Provider, credential, ComfyUI, network, Electron entrypoint, dependency,
   workflow, test-system, and deletion/rename changes select `full`.
3. The focused runner executes changed tests and nearby related tests, passes
   with no test target for documentation-only changes, and never invokes the
   full `pnpm run test` profile.
4. Full mode preserves the existing contracts, unit, desktop, and macOS package
   coverage and the aggregate fails closed.
5. The rule is documented in `CLAUDE.md`, mirrored to `AGENTS.md`, and included
   in the project delivery ledger through the normal gates.

## Rollback

Revert the policy commit. The existing full workflow remains the only required
release behavior; no application data or user state is changed by this policy.
