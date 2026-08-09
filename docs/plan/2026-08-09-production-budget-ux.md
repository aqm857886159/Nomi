# Production policy recovery UX

## Goal

When a production contract cannot be approved because its spend policy is
incomplete, show every missing prerequisite at once and take the user to one
settings block that can unblock the run.

## Scope

- Derive hard-budget, provider-allowlist, and model-allowlist readiness from the
  actual jobs covered by the contract.
- Make the contract confirmation surface list every missing prerequisite before
  approval is attempted.
- Offer one `完善制作策略` action that opens `设置 → AI 与模型 → 默认模型策略`,
  identifies the exact provider/model required by this Run, and focuses the
  first missing field.
- Make the service fallback report all policy gaps in one error rather than
  revealing them one request at a time.
- Keep the safety invariant: no budget is inferred and no paid job is submitted
  until the user explicitly enters a ceiling, selects both allowlists, and
  approves the contract.

## Non-goals

- Choosing a default budget for the user.
- Changing production authorization or spend policy semantics.
- Adding a second settings page or another policy source of truth.
- Automatically selecting a budget, provider, or model for the user.

## Acceptance gates

- Incomplete-policy contract approval never submits a paid generation.
- The confirmation surface names all missing settings and can open their exact
  shared settings block.
- The settings block marks the exact provider/model required by the active Run.
- A full Electron journey covers all-missing → explicit settings → ready
  contract → approval, with zero authorization before the final approval.
- Generic approval errors keep their existing recovery behavior.
- Unit, typecheck, build, and focused UX structure tests pass.

## Rollback

Revert the single UX commit; persisted automation policy data is unchanged.
