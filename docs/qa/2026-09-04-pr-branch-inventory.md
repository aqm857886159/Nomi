# S1 PR / branch / worktree inventory

> Snapshot: 2026-09-04 11:49 Asia/Shanghai. This is a read-only repository inventory: no product code was changed, no file was deleted, and no PR was merged or pushed to `main`.

## Baseline

| Item | Value |
|---|---|
| Repository | `aqm857886159/Nomi` |
| Baseline | `origin/main = 45912ae01a155a3f6592f65368d0ce3d12fc034e` |
| Local audit checkout | `/Users/aoqimin/Desktop/Nomi` on local `main`; dirty, 204 commits behind; protected |
| Report checkout | `codex/convergence-execution-plan-20260904`; clean before this report |
| Ref counts | 206 local branches; 111 `origin/*` refs |

`behind/ahead` below is `git rev-list --left-right --count base...head`. File scope is `file count; insertions/deletions`.

## 14 open PRs

| PR / URL | base ← head | head SHA | merge-base | behind/ahead | scope | merge/check state | classification / next action |
|---|---|---|---|---:|---|---|---|
| [#456](https://github.com/aqm857886159/Nomi/pull/456) | main ← codex/main-typecheck-repair-20260904 | `9ab34aafcefd3c52e5809a337a9124797e410d3a` | `45912ae` | 0/1 | 1; 2/-2 | MERGEABLE/BLOCKED; E2E, Quality fail | blocked; repair checks |
| [#455](https://github.com/aqm857886159/Nomi/pull/455) | main ← codex/ci-recovery-20260904 | `7baf3bcfa135093a53f14f5c6fd3549d9e757c31` | `45912ae` | 0/3 | 3; 69/-49 | MERGEABLE/BLOCKED; Canvas Performance, Quality fail | blocked; diagnose performance |
| [#454](https://github.com/aqm857886159/Nomi/pull/454) | main ← fix/storyboard-entry-and-vendor-identity-20260903 | `feb392525b8bbd75205890e8099ba1aff72cbba7` | `4f012f9` | 48/49 | 91; 4783/-310 | CONFLICTING/DIRTY; Workers only visible and passed | needs design decision; do not merge monolith |
| [#453](https://github.com/aqm857886159/Nomi/pull/453) | main ← codex/convergence-execution-plan-20260904 | `2aee87e873627f14d232d8fee0a601fdeb1529ab` | `45912ae` | 0/5 | 4; 517/-0 | MERGEABLE/BLOCKED; Contracts, Workers fail | blocked; repair/recheck |
| [#452](https://github.com/aqm857886159/Nomi/pull/452) | main ← codex/agent-usage-ledger-followup-20260904 | `75f8e4148ee6d539d2e54250e3c7bb5b75497f5a` | `c74b843` | 0/2 | 7; 80/-9 | MERGEABLE/BLOCKED; E2E, Quality fail | blocked; receipt/Host follow-up |
| [#435](https://github.com/aqm857886159/Nomi/pull/435) | main ← codex/3d-research-workflow-20260903 | `5f1f5719b7b6c3be4cffeb4ca083b0a8a7df110d` | `246f394` | 0/2 | 16; 931/-0 | MERGEABLE/BLOCKED; Contracts, Quality fail | blocked; contract first |
| [#419](https://github.com/aqm857886159/Nomi/pull/419) | m5/packaged-graduation-20260903 ← m5/packaged-graduation-c-20260903 | `7b67877af662546f435ec5deea53bf71cff81baa` | `d8bbf8b` | 1/90 | 100; 8628/-1547 | CONFLICTING/DIRTY; Workers only visible and passed | stacked; owner must rebase |
| [#412](https://github.com/aqm857886159/Nomi/pull/412) | main ← refactor/shell-debt-to-main-20260903 | `8fdc576d2d57b7e9ef6e92147d6b7bb666e73db7` | `b12fdee` | 0/8 | 14; 1813/-1580 | CONFLICTING/DIRTY; visible checks pass | rebase/review large scope |
| [#403](https://github.com/aqm857886159/Nomi/pull/403) | main ← codex/seo-open-seo-alignment-20260903 | `7ef61f5b059601c1c590f15f22ff883b3ce8ba5d` | `beeb3bb` | 0/4 | 17; 688/-39 | MERGEABLE/BLOCKED; Contracts, Quality fail | blocked; contract first |
| [#399](https://github.com/aqm857886159/Nomi/pull/399) | main ← docs/rule-enforcement-audit-20260903 | `0ec176771d6b15feaf93d95d93ac5a2b381df772` | `0f844df` | 0/4 | 6; 606/-1 | CONFLICTING/DIRTY; visible checks pass | rebase; preserve dirty worktree |
| [#384](https://github.com/aqm857886159/Nomi/pull/384) | main ← fix/dangling-tailwind-classes-20260903 | `b377cf9bc2a9d921033e6d10fafd2ecdb76ef923` | `16b1e6b` | 0/4 | 4; 190/-2 | CONFLICTING/DIRTY; visible checks pass | rebase; check absorption |
| [#328](https://github.com/aqm857886159/Nomi/pull/328) | main ← codex/cross-device-continuation-v2 | `fee6d56f40890dce7361bb55c9ba1fbd11ba9a05` | `c2c8c9e` | 0/15 | 35; 1264/-47 | MERGEABLE/BLOCKED; E2E, Performance, Quality fail | external owner; read-only here |
| [#314](https://github.com/aqm857886159/Nomi/pull/314) | main ← fix/library-language-walk-anchors-20260902 | `1d6701751b4fa0dcdb85e8de8743f17c0d2cf9305` | `da41562` | 0/14 | 25; 913/-40 | CONFLICTING/DIRTY; Contracts, Quality fail | owner rebase; preserve |
| [#313](https://github.com/aqm857886159/Nomi/pull/313) | main ← codex/experience-learning-loop-20260902 | `b1787e07a7c4e7ad43243526a60d513f8e2b7ac2` | `87bc55c` | 0/5 | 19; 1179/-2 | MERGEABLE/CLEAN; visible required checks pass, platform skipped | external owner; do not touch |

No open PR is authorized for merge by this inventory. `MERGEABLE` is GitHub's mergeability signal, not a product-completion or check-green signal. #313 and #328 remain owned by the other session.

## Key refs without a new open PR

| ref | SHA | merge-base | behind/ahead | scope | duplicate/stack evidence | classification / next action |
|---|---|---|---:|---|---|---|
| `origin/perf/canvas-click-select-20260903` | `fa2c483a1e3359b6630fcc01d6f34a58859c1988` | `f8e9e468` | 332/4 | 11; 338/-52 | 4 non-merge patches; IDs `1e2e2b7`, `4a1207d`, `90dce17`, `b5fa8cf` | unique candidate; first prove current-main red gap, then small PR |
| `origin/fix/mcp-remaining-holes-20260903` | `99396b86416db8e514a8c55aedbae013460178a3` | `dfec836c` | 168/2 | 1; 344/-0 | first patch ID `70888bd`; tip is merge commit; overlaps merged #426 | unknown / possible duplicate; file-compare before PR |
| `origin/m5/packaged-graduation-20260903` | `d6a8b5a4ec467f9591542dc8e08284e3eb989c89` | `d8bbf8b0` | 225/2 | 8; 116/-42 | declared M5 stack base | stacked/old base; evaluate only with #419 |
| `m5/packaged-graduation-a-20260903` | `c8f187c24a89168624e8bdf74aaf5124d7cc8676` | same | 153/0 | 0 | tip is already an ancestor of origin/main | duplicate/absorbed; no PR |
| `origin/m5/packaged-graduation-c-20260903` | `7b67877af662546f435ec5deea53bf71cff81baa` | `87bc55c9` | 138/4 | 2; 38/-5 | exact #419 head; stacked and conflicting | stacked/open #419; owner rebase |
| `origin/m2/slice-2-editing-a` | `c3313178c0d78259b8a1b3cb35df5d3a58565b84` | `4f6a3fec` | 455/6 | 2; 54/-1 | exact tree equals local m2/slice-2-editing-b | duplicate pair; choose one owner |
| `m2/slice-2-editing-b` local | `40422533f286286f70b2370276634895138ac9b1` | `4f6a3fec` | 455/5 | 2; 54/-1 | exact tree equals origin m2/slice-2-editing-a | local duplicate/owner unknown |
| `origin/m2/slice-2-editing-b` | `82ebc4d78f074752bf730e7e3fb49239d2233875` | `4f6a3fec` | 455/11 | 13; 105/-822 | exact tree equals origin m2/slice-2-editing-vertical | duplicate pair; no parallel PR |
| `origin/m2/slice-2-editing-vertical` | `a752402dfcf03196fbdfa560f0097f28e157421c` | `4f6a3fec` | 455/10 | 13; 105/-822 | exact tree equals origin m2/slice-2-editing-b | duplicate pair; preserve until owner confirms |

## Worktree status and unknowns

Fresh `git worktree list --porcelain` plus per-path `git status --porcelain --untracked-files=all` found:

| category | count |
|---|---:|
| total worktrees | 85 |
| dirty | 37 |
| clean | 46 |
| detached | 12 |
| prunable | 2 |

Dirty content is protected. Critical dirty locations include the local `/Users/aoqimin/Desktop/Nomi`, `/Users/aoqimin/.codex/worktrees/{14c8,60fb,a37d,b517,f72a,fe51}/Nomi`, `/Users/aoqimin/Desktop/Nomi-cross-device-repair`, `/Users/aoqimin/Desktop/Nomi-pr243-merge`, `/Users/aoqimin/Desktop/Nomi-red-328`, `/Users/aoqimin/Desktop/nomi-row-select`, `/Users/aoqimin/Desktop/nomi-s4-accept`, `/Users/aoqimin/Desktop/nomi-s5-final`, and the dirty `.claude/worktrees/*` listed by the same command. No dirty path was reset, cleaned, moved or deleted.

Prunable records, not removed:

    /private/tmp/nomi-issue-237.bBdypr (HEAD ac9129b; codex/feedback-237-gpt-image-size)
    /private/tmp/nomi-runway-seedance-20260830 (HEAD c397992; codex/runway-seedance25-onboarding)

Active-session status is explicitly unknown. The attempted process scan `ps -ax | rg -i 'claude|codex|electron|pnpm|vite'` was denied by macOS with `operation not permitted`; therefore no clean/detached worktree is certified inactive. This is the only environment blocker recorded here.

## Historical source classification

| source | observed status | next action |
|---|---|---|
| `docs/plan/INDEX.md` and 2026-09-03 ledger | historical snapshot; known status drift | update only after current evidence |
| Agent #438/#440/#445/#447 chain | design, normal state, conformance and P0 runtime slices merged | rebaseline full Agent/recovery/visual closure |
| Storyboard #368/#392/#414 | v5 predecessors merged | audit #454 separately |
| MCP #381/#382/#387/#406/#413/#426/#442/#448 | multiple slices merged | rerun current contracts/L2/packaged evidence |
| M4/M5 #407/#408/#418/#420/#421/#422/#419 | partial source slices; M5 remains stacked/conflicting | rebase and rerun packaged gates |
| Canvas #393 + perf ref | S6 hygiene merged; click-select ref has unique patches | red-test real interaction before PR |
| TikHub/video deconstruction/resource chain | code/plan sources exist, but this inventory does not certify live connector or full downstream journey | rebaseline in S4; #388 only establishes resource P0-1 |

## Reproduction commands

    git fetch origin main --prune
    gh pr list --state open --limit 100 --json number,title,url,baseRefName,headRefName,baseRefOid,headRefOid,isDraft,mergeStateStatus,mergeable,reviewDecision,statusCheckRollup
    gh pr list --state merged --search 'merged:2026-09-03' --limit 100 --json number,title,url,baseRefName,headRefName,baseRefOid,headRefOid,mergedAt,mergeCommit,files
    git for-each-ref --format='%(refname:short) %(objectname)' refs/heads refs/remotes/origin
    git worktree list --porcelain
    git merge-base <base-sha> <head-sha>
    git rev-list --left-right --count <base-sha>...<head-sha>
    git diff --shortstat <base-sha>...<head-sha>
    git diff --quiet <ref-a> <ref-b>
    git show <commit> | git patch-id --stable
    git diff --check

## S1 disposition

The repository classification report is delivered with the process-scan limitation above. Next action is not merge or cleanup: preserve dirty/unknown worktrees, let the owners of #313/#328 finish, and use the classifications above to create small, independently verified follow-up PRs.
