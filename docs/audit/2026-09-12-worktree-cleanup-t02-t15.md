# T02/T15 Worktree Cleanup Census — 2026-09-12

## Scope and method

Ran `git fetch --all --prune`, then enumerated `git worktree list --porcelain`. For each worktree we recorded path, branch/HEAD, clean state, commits ahead of `origin/main`, and remote refs containing HEAD. Candidate branches were checked with `gh pr list --state all --head <branch>`. `git worktree prune -n` reported no stale metadata.

## Raw census

| Path | Branch | HEAD | Clean | Unique vs origin/main | Remote containing HEAD |
|---|---|---|---:|---:|---|
| `/Users/aoqimin/Desktop/Nomi` | `fix/mcp-handoff-builtin-clients-20260911` | `a13cf82` | yes | 1 | none |
| `/Users/aoqimin/.codex/worktrees/8b70/Nomi` | `fix/remove-node-camera-controls-20260912` | `c1b1c9e` | yes | 1 | origin/fix/remove-node-camera-controls-20260912 |
| `/Users/aoqimin/.codex/worktrees/ticket13-registry` | `codex/ticket13-registry-fix` | `2d8a1c3` | yes | 2 | origin/codex/ticket13-registry-fix |
| `/Users/aoqimin/Desktop/Nomi-audio-ref` | `fix/audio-first-class-reference-20260911` | `2f23cba` | yes | 6 | origin/fix/audio-first-class-reference-20260911 |
| `/Users/aoqimin/Desktop/Nomi-canvas-perf-fix` | `fix/canvas-perf-s3-s6-gate-20260912` | `2650fd2` | yes | 7 | origin/fix/canvas-perf-s3-s6-gate-20260912 |
| `/Users/aoqimin/Desktop/Nomi-canvas-perf-s5` | `fix/canvas-lod-screen-size-20260912` | `67a8b95` | no | 1 | none |
| `/Users/aoqimin/Desktop/Nomi-canvas-perf-scale` | `research/canvas-perf-at-scale-20260912` | `b781092` | yes | 6 | origin/research/canvas-perf-at-scale-20260912 |
| `/Users/aoqimin/Desktop/Nomi-cardstack-fix` | `fix/card-stack-walk-wait-20260911` | `54b7012` | yes | 1 | none; merged PR #746 |
| `/Users/aoqimin/Desktop/Nomi-close-doors` | `plan/close-agent-doors-20260911` | `3f02277` | yes | 1 | origin/plan/close-agent-doors-20260911 |
| `/Users/aoqimin/Desktop/Nomi-deconstruct-diag` | `diag/deconstruct-all-fail-20260912` | `4747204` | yes | 4 | origin/diag/deconstruct-all-fail-20260912 |
| `/Users/aoqimin/Desktop/Nomi-deconstruct-fix` | `fix/deconstruct-spend-grant-class-20260912` | `d7f82b1` | no | 0 | remote refs include origin/main |
| `/Users/aoqimin/Desktop/Nomi-docs-0911` | `docs/agent-tool-face-research-20260911` | `b902224` | yes | 22 | none; PR query [] |
| `/Users/aoqimin/Desktop/Nomi-door-map` | `rule/door-map-root-cause-20260911` | `80906d7` | yes | 14 | origin/rule/door-map-root-cause-20260911 |
| `/Users/aoqimin/Desktop/Nomi-feedback-plan` | `plan/feedback-landing-20260912` | `e92576b` | yes | 8 | origin/plan/feedback-landing-20260912 |
| `/Users/aoqimin/Desktop/Nomi-mcp-onboard-design` | `design/mcp-onboarding-tool-face-20260911` | `63a6395` | yes | 1 | origin/design/mcp-onboarding-tool-face-20260911 |
| `/Users/aoqimin/Desktop/Nomi-migration-audit` | detached | `af3652e` | no | 0 | shared ancestry; dirty |
| `/Users/aoqimin/Desktop/Nomi-model-availability` | `fix/model-availability-single-owner-20260912` | `3fefc03` | yes | 12 | origin/fix/model-availability-single-owner-20260912 |
| `/Users/aoqimin/Desktop/Nomi-onboard-tools` | `feat/mcp-onboarding-tool-face-20260911` | `b688717` | yes | 23 | origin/feat/mcp-onboarding-tool-face-20260911 |
| `/Users/aoqimin/Desktop/Nomi-onboarding-diag` | `plan/model-onboarding-flow-20260911` | `82fde17` | yes | 1 | origin/plan/model-onboarding-flow-20260911 |
| `/Users/aoqimin/Desktop/Nomi-onboarding-discovery` | `feat/model-onboarding-discovery-20260912` | `42284a1` | yes | 32 | origin/feat/model-onboarding-discovery-20260912 |
| `/Users/aoqimin/Desktop/Nomi-onboarding-impl` | `feat/model-onboarding-two-paths-20260911` | `22cdd25` | yes | 28 | remote refs include origin/feat/model-onboarding-two-paths-20260911 |
| `/Users/aoqimin/Desktop/Nomi-p11b` | `feat/permission-p11b-reprice-writeback-20260911` | `7a29627` | yes | 1 | none; merged PR #757 |
| `/Users/aoqimin/Desktop/Nomi-param-panel-flat` | `fix/param-panel-flat-options-20260911` | `a78dda0` | yes | 9 | none; PR query [] |
| `/Users/aoqimin/Desktop/Nomi-perf-bench` | detached | `2650fd2` | no | 7 | shared with canvas-perf remote |
| `/Users/aoqimin/Desktop/Nomi-pr764-clean-delivery` | `codex/pr764-clean-delivery-20260912` | `b198768` | yes | 8 | origin/codex/pr764-clean-delivery-20260912 |
| `/Users/aoqimin/Desktop/Nomi-rc-smallfix` | `fix/rc-small-fix-cluster-20260912` | `82a359a` | yes | 16 | origin/fix/rc-small-fix-cluster-20260912 |
| `/Users/aoqimin/Desktop/Nomi-real-onboard` | `test/real-onboarding-acceptance-20260912` | `9dfb091` | yes | 30 | none; PR query [] |
| `/Users/aoqimin/Desktop/Nomi-resolve-mcp` | detached | `e351e69` | yes | 2 | shared with origin/research/agent-tool-face-prior-art-20260911 |
| `/Users/aoqimin/Desktop/Nomi-sandbox-packaging` | `fix/sandbox-runtime-packaging-20260912` | `4f3baf2` | yes | 6 | origin/fix/sandbox-runtime-packaging-20260912 |
| `/Users/aoqimin/Desktop/Nomi-silent-census` | `audit/silent-branch-census-20260911` | `4c4bc38` | yes | 5 | origin/audit/silent-branch-census-20260911 |
| `/Users/aoqimin/Desktop/Nomi-skill-trigger-research` | `research/skill-trigger-mechanism-20260912` | `41b9102` | yes | 1 | origin/research/skill-trigger-mechanism-20260912 |
| `/Users/aoqimin/Desktop/Nomi-spend-card-modes` | `fix/spend-card-full-auto-and-loud-missing-card-20260912` | `8bfa50b` | yes | 10 | none |
| `/Users/aoqimin/Desktop/Nomi-tool-audit` | `audit/model-tool-face-20260911` | `9e77ff4` | yes | 6 | origin/audit/model-tool-face-20260911 |
| `/Users/aoqimin/Desktop/Nomi-tool-design` | `design/agent-tool-face-first-principles-20260911` | `c1a763f` | yes | 1 | origin/design/agent-tool-face-first-principles-20260911 |
| `/Users/aoqimin/Desktop/Nomi-tool-face-b` | `feat/agent-tool-face-20-verbs-20260911` | `81e56a3` | yes | 11 | none; PR query [] |
| `/Users/aoqimin/Desktop/Nomi-tool-prior-art` | `research/agent-tool-face-prior-art-20260911` | `b29c5ed` | yes | 1 | origin/research/agent-tool-face-prior-art-20260911 |
| `/Users/aoqimin/Desktop/Nomi/.claude/worktrees/agent-architecture-issues-fd31e8` | `claude/agent-architecture-issues-fd31e8` | `9809892` | no | 0 | shared ancestry; dirty |

## Decision

No worktree was deleted. Every clean, untracked candidate still has unique commits and may carry research or implementation evidence; two candidates map to merged PRs (#746 and #757), and the primary Desktop worktree is active. Dirty/detached/remote-mapped worktrees are protected by definition. The four clean no-PR candidates (`Nomi-docs-0911`, `Nomi-param-panel-flat`, `Nomi-real-onboard`, `Nomi-tool-face-b`) remain explicit future review candidates only after evidence-retention confirmation.

Disk check: `du -sh` reported 2.2G for each sampled candidate (shared Git objects mean this is not reclaimable-space accounting).
