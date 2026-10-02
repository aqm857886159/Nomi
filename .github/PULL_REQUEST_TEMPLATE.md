## Goal contract

- Contract path (`evals/contracts/...` or a linked existing contract):
- User goal:
- Success experience:
- Metrics and P0 thresholds (mark each `targetOnly` or `measured`):
- Non-goals:

## Verification evidence

- Automated checks and exact commands/output:
- Real-user journey/protocol path:
- Evidence report path (run ID + commit SHA):
- Screenshots/video/logs:
- Failure, rollback, or blocker (write `none` only when checked):

## Decision

- [ ] `pass` — contract thresholds are measured and required evidence is attached.
- [ ] `fail` — a product requirement is observed to fail; include the failure reason.
- [ ] `blocked` — a required environment/resource is unavailable; include the exact blocker.
- [ ] `unverified` — code checks ran, but the real-user or human evidence is not available.

## Scope guard

- [ ] Existing Runtime/Lane/Skill/Tool/MCP owners were reused.
- [ ] No parallel runtime, generic Agent Builder, new provider, or replacement registry was added.
- [ ] Targets are not presented as measured results.

## Ponytail

<!-- For every finding from `pnpm run review:branch`, write 已改 or 不改 because … -->
