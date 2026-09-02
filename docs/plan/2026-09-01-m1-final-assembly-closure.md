# M1 final assembly closure

> 状态：✅ 已交付

## Scope

- Keep the shipped ProductionRun legacy-playbook generation route active and restore its main-branch driver contract.
- Move the retired-route assertions to the M2 red-light record without deleting the retirement behavior under test.
- Repair the shared Project Agent renderer projection boundary so an older enqueue snapshot cannot overwrite newer host patches.
- Remove the CommonJS host's direct import of the private Pi NodeNext island while preserving the static wiring gate.
- Reduce existing ESLint warnings to the repository ratchet of 82 or fewer.

## Explicitly out of scope

- Implementing the M2 replacement generation pipeline or completing legacy-route retirement.
- Weakening or deleting static wiring, lifecycle, or regression assertions.
- Merging the task branch or changing `origin/main`.

## Rollback

Revert the scoped commits in reverse order. The M2 document remains an explicit red-light record; no user data migration or destructive cleanup is required.

## Acceptance gates

- ProductionRun shipped driver tests and the original red-light command pass.
- The unchanged RL2 captured-snapshot flow passes, plus a projection-store class regression.
- The unchanged agent-runtime wiring gate passes with the host/island boundary intact.
- `pnpm run check:root-cause-contracts`, lint at `--max-warnings=82`, typecheck, full Vitest, and `pnpm run gates` pass.
- Full Vitest failure count matches the recorded `origin/main` baseline: 9095 passed, 0 failed; delta 0.
- Task branch is pushed and a non-merged PR is opened with the required title and closure evidence.
