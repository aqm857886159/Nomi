# Production budget guard UX

## Goal

When a production contract cannot be approved because the hard spend ceiling is
missing, make the next action obvious and take the user directly to the field
that unblocks the run.

## Scope

- Detect the missing-budget error in the production approval flow.
- Make the contract confirmation surface show that the hard ceiling is unset.
- Offer a direct `去设置预算` action that opens `设置 → AI 与模型` and focuses
  `制作硬预算上限（CNY）`.
- Keep the safety invariant: no budget is inferred and no paid job is submitted
  until the user explicitly enters a ceiling and approves the contract.

## Non-goals

- Choosing a default budget for the user.
- Changing production authorization or spend policy semantics.
- Adding a second settings page or another budget source of truth.

## Acceptance gates

- Missing-budget contract approval never submits a paid generation.
- The confirmation surface names the missing setting and can open its exact
  settings field.
- Generic approval errors keep their existing recovery behavior.
- Unit, typecheck, build, and focused UX structure tests pass.

## Rollback

Revert the single UX commit; persisted automation policy data is unchanged.
