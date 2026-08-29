# Project Agent Phase 3A Closure

> 状态：✅ 已交付。`document.read` canonical Host 垂直切片已形成远端 checkpoint；最终包级旅程仍归总路线图的 Phase 6 出口。

## Objective

Close the `document.read` vertical slice through the Project Agent Host. The
canonical capability contract, verified invocation, main executor, renderer
Surface transport, editor adapter, and Host projection must form one path.

## Scope

- Keep `document.read` as the only semantic contract for full and selection
  reads; `read_full_text` and `read_selection` remain surface aliases only.
- Capture the exact document target and Surface binding in main, then revalidate
  the binding before and after the renderer reply.
- Execute read aliases silently in the Host. A missing, stale, rotated, or
  disposed adapter returns a typed failure and never falls through to a pending
  confirmation or a renderer-owned executor.
- Project tool history as canonical `document.read`, not a legacy alias.
- Extend the capability owner check so duplicate document schema/id owners are
  rejected without creating a second baseline or executor owner.

## Explicitly Not In Scope

- Document writes, proposal receipts, paid ProductionRun operations, Skill/MCP
  public exposure, and the Phase 6 resident UI.
- Chasing intermediate `main` commits. Mainline integration is a phase-exit
  operation only.
- Full repository gates during this slice; those belong to the final phase
  exit after focused matrices are green.

## Historical PR Input

Before Phase 5/6 MCP, Skill, Registry, or UI work, review the problem evidence
and design decisions in:

- `docs/audit/2026-08-29-project-agent-pr-evidence.md`
- `docs/audit/2026-08-29-project-agent-pr-coverage-index.md`

These records are design input, not cherry-pick instructions. Existing UI and
`docs/design/nomi-design-system.md` remain the visual baseline.

## Acceptance Matrix

- Focused tests cover canonical alias routing, safe output, exact document id,
  binding/frame ownership, malformed or cross-channel replies, cancellation,
  Surface rotation, project suspension, adapter disposal, and Host auto-read.
- Electron TypeScript passes.
- `node scripts/check-capability-owners.mjs` passes with one canonical owner
  for every registered capability and no migration debt.
- `git diff --check` passes.
- A scoped commit is pushed to the task branch as a recovery checkpoint. The
  PR remains open and unmerged.

## Rollback

Revert the Phase 3A checkpoint commit. No default branch or remote history is
rewritten. The prior checkpoint keeps the canonical Registry contract and
leaves the transport slice absent.

## Verification Cadence

Run the focused matrix after each vertical slice. Expand verification only at
the Phase 3 exit, then once at the final mainline integration. Do not use a
full test run as a substitute for checking the slice's lifecycle contract.
