# Project Agent Phase 3B: Reversible Document Write

> 状态：✅ 已交付。`document.write` focused closure、冻结 target admission 与独立评审已通过并推送；最终包级旅程仍归总路线图的 Phase 6 出口。

## Objective

Move the three creation-document write aliases (`insert_at_cursor`,
`replace_selection`, and `append_to_end`) behind the Project Agent Host while
keeping the editor, persistence, and Undo history owned by the existing
document domain. The Host owns the invocation, approval, and frozen target;
the renderer only supplies the bound domain port.

## Process Contract

- Work in vertical slices: contract -> verified invocation -> Host executor ->
  Surface transport -> editor adapter -> UI projection -> delete the old
  renderer writer.
- Run only the focused matrix for the current slice. A focused green result is
  immediately committed and pushed as a recovery checkpoint.
- Do not chase every `main` commit. Refresh and integrate `main` once at the
  Phase 3/4 exit, then once at the final Phase 6 integration gate.
- Before Phase 5 MCP/Skill/Registry projection or Phase 6 UI work, review both
  historical PR evidence ledgers:
  `docs/audit/2026-08-29-project-agent-pr-evidence.md` and
  `docs/audit/2026-08-29-project-agent-pr-coverage-index.md`. Historical PRs
  are problem/design input, not mechanical cherry-pick material; preserve
  their serious findings even when their branch is behind `main`.
- Keep the current design system and existing creation UI as the visual
  baseline. Phase 6 may adjust layout and presentation, but it must not invent
  a second capability or domain state owner.

## Slice Order

1. **Contract and target capture**: define canonical `document.write`, derive
   aliases from the Registry, and capture document revision, anchor, content
   hash, and cursor/range neighbor hashes at proposal time.
2. **Verified execution**: add the write invocation factory and a main
   executor that accepts only a verified reversible-write invocation, rechecks
   binding and preconditions, and projects a safe result.
3. **Surface port**: add owner-bound write request/reply channels with abort,
   rotation, malformed-reply, and stale-binding handling identical to reads.
4. **Domain adapter**: extend the editor adapter with an atomic, precondition-
   checked operation that uses the existing Tiptap transaction and Undo path.
5. **Host/UI cutover**: route approved write calls through the Host adapter;
   remove `CreationAiPanel.applyWriteTool` as an execution owner while keeping
   the existing proposal card and result projection.

## Acceptance Matrix

- Canonical contract and aliases have one Registry owner; duplicate owner
  checks remain green.
- A write with a stale document revision, target document id, range, cursor,
  or neighbor hash is rejected before mutation.
- Surface replies are accepted only from the captured owner and exact binding;
  cancellation, rotation, disposal, malformed replies, and project switches
  fail closed.
- A successful write returns only `{ applied, revision, contentHash }` (no
  editor/provider/private state), and the existing editor Undo transaction is
  preserved.
- No direct document mutation remains in `CreationAiPanel`; focused tests cover
  the Host route and the adapter boundary.
- Electron TypeScript, scoped tests, owner gate, and `git diff --check` pass.

## Checkpoint and Rollback

Commit and push the Phase 3B closure to the task branch. Keep PR #223 open and
unmerged. Roll back by reverting only the Phase 3B checkpoint commit; do not
rewrite the default branch or remote history.

## Verification Cadence

Use the focused document-write and Host matrices after each slice. Expand to
the Phase 3/4 exit matrix only after all Phase 3B slices are green. Full
repository tests and package/build gates belong to the final integration gate,
not to the implementation loop.
