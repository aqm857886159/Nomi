# Agent worktree lifecycle

Nomi creates isolated checkouts for parallel agent work. The repository now includes a shared, fail-closed cleanup policy so each machine can reclaim stopped worktree dependencies without deleting user code or unpushed branches.

## Install once per machine

From a Nomi checkout, run:

```bash
pnpm run install:agent-worktree-janitor
```

The installer adds an idempotent Claude `Stop` hook to the user's `~/.claude/settings.json`. The hook first checks that the current checkout contains the Nomi script, then resolves it through `$CLAUDE_PROJECT_DIR`; it does not contain a machine-specific Nomi path and stays quiet for unrelated projects. Re-run it after cloning a newer Nomi version if the script contract changes.

## Policy

The Stop hook writes `.claude/agent-worktree-stop.json`, waits through a 15-minute grace period, checks activity, and then applies one shared decision:

- inactive, clean, branch-backed linked worktrees may be removed; their Git branch remains;
- dirty linked worktrees keep all code and only rebuildable `node_modules` directories may be pruned;
- detached worktrees keep their commit and may only have dependencies pruned;
- full clones are never removed, even when clean or apparently stale; only dependencies may be pruned;
- missing, malformed, fresh, or active leases fail closed and are skipped.

The same policy is available for a read-only preview or explicit cleanup:

```bash
node scripts/agent-worktree-janitor.mjs reap /absolute/path/to/Nomi
node scripts/agent-worktree-janitor.mjs reap --apply /absolute/path/to/Nomi
```

Existing worktrees without a lease marker are intentionally not retroactively deleted. This prevents a new policy from guessing whether an old branch or detached commit is still valuable.

## Why this belongs in the repository

The recurring failure was not one oversized directory. Worktree creation and dependency installation were enforced, while task stop had no shared ownership or expiry signal. Versioning the classifier, installer, tests, and policy makes the invariant portable across team machines; installation remains local because Claude settings are machine-specific.
