# S0 Main 收敛现场冻结

> 快照时间：2026-09-04（Asia/Shanghai）
> 目的：冻结当前现场，后续盘点/合并/捞取都以这份快照为起点；本阶段不删除、不覆盖、不合并产品代码。

## 基线

```text
worktree: /Users/aoqimin/Documents/Codex/2026-09-02/shu-l/nomi-convergence-execution-plan-20260904
branch: codex/convergence-execution-plan-20260904
head: c0e499b5e7653603db829187bfe25ddd4f1bc61d
remote: origin/main
remote_main: 45912ae01a155a3f6592f65368d0ce3d12fc034e
remote_base_is_ancestor: true
working_tree: clean
delivery_preflight: PASS
```

`pnpm run delivery:preflight` 的实际结果确认：当前分支不是 `main`，`origin/main` 是祖先，工作树干净。

## PR 快照

以下是 S0 时刻所有 open PR；标题、分支和状态后续必须重新刷新，不能把本表当作永久状态：

| PR | base ← head | 标题 | 初步处理 |
|---|---|---|---|
| [#456](https://github.com/aqm857886159/Nomi/pull/456) | `main` ← `codex/main-typecheck-repair-20260904` | fix(canvas): use hydrated metadata for provider switch notice | S1 审计 |
| [#455](https://github.com/aqm857886159/Nomi/pull/455) | `main` ← `codex/ci-recovery-20260904` | test: repair MCP lease and canvas media fixtures | S1 审计 |
| [#454](https://github.com/aqm857886159/Nomi/pull/454) | `main` ← `fix/storyboard-entry-and-vendor-identity-20260903` | 分镜表：Agent 工具面 + 模型身份修复 + 锚行样张（换人交接） | 部分完成；见 [#454 审计](./2026-09-04-pr454-storyboard-agent-audit.md) |
| [#453](https://github.com/aqm857886159/Nomi/pull/453) | `main` ← `codex/convergence-execution-plan-20260904` | docs: define main convergence and rebaseline execution plan | 当前方案 PR |
| [#452](https://github.com/aqm857886159/Nomi/pull/452) | `main` ← `codex/agent-usage-ledger-followup-20260904` | feat(agent): persist resident turn usage in Host state | 待 receipt/Host 审计 |
| [#435](https://github.com/aqm857886159/Nomi/pull/435) | `main` ← `codex/3d-research-workflow-20260903` | feat: 固化竞品与开源能力研究工作流 | S1 审计 |
| [#419](https://github.com/aqm857886159/Nomi/pull/419) | `m5/packaged-graduation-20260903` ← `m5/packaged-graduation-c-20260903` | docs(m5): add agent graduation release runbook | stacked，先确认 base |
| [#412](https://github.com/aqm857886159/Nomi/pull/412) | `main` ← `refactor/shell-debt-to-main-20260903` | refactor(shells): split three long-standing main-branch shells off the filesize allowlist | 架构/范围审计 |
| [#403](https://github.com/aqm857886159/Nomi/pull/403) | `main` ← `codex/seo-open-seo-alignment-20260903` | fix(seo): align community destination with Discussions | S1 审计 |
| [#399](https://github.com/aqm857886159/Nomi/pull/399) | `main` ← `docs/rule-enforcement-audit-20260903` | audit(rules): 家规执行力分诊 + push 绕口留痕机器化 | 规则/钩子审计 |
| [#384](https://github.com/aqm857886159/Nomi/pull/384) | `main` ← `fix/dangling-tailwind-classes-20260903` | feat(gates): check:dangling-tailwind | gate 审计 |
| [#328](https://github.com/aqm857886159/Nomi/pull/328) | `main` ← `codex/cross-device-continuation-v2` | feat: make cross-device continuation actionable | 外部会话，仅读取 |
| [#314](https://github.com/aqm857886159/Nomi/pull/314) | `main` ← `fix/library-language-walk-anchors-20260902` | fix: 治「不报」这一类——走查假绿修复 + CI 执行者 + P6 | S1 审计 |
| [#313](https://github.com/aqm857886159/Nomi/pull/313) | `main` ← `codex/experience-learning-loop-20260902` | feat: add verified experience learning loop | 外部会话，仅读取 |

S0 时刻 #454 可见 check 只有 Workers Build；#453 在更新后重新触发验证，状态以 GitHub 当前页面为准。

## Worktree 快照

`git worktree list --porcelain` 共发现：

```text
worktrees: 80
dirty: 37
clean: 41
prunable: 2
```

### 必须保留的 dirty worktree

以下路径有 tracked 或 untracked 改动，全部只登记、不清理、不覆盖：

```text
/Users/aoqimin/Desktop/Nomi
/Users/aoqimin/.codex/worktrees/14c8/Nomi
/Users/aoqimin/.codex/worktrees/60fb/Nomi
/Users/aoqimin/.codex/worktrees/a37d/Nomi
/Users/aoqimin/.codex/worktrees/b517/Nomi
/Users/aoqimin/.codex/worktrees/f72a/Nomi
/Users/aoqimin/.codex/worktrees/fe51/Nomi
/Users/aoqimin/Desktop/Nomi-cross-device-repair
/Users/aoqimin/Desktop/nomi-meta-guard
/Users/aoqimin/Desktop/Nomi-pr243-merge
/Users/aoqimin/Desktop/Nomi-red-328
/Users/aoqimin/Desktop/nomi-row-select
/Users/aoqimin/Desktop/nomi-s4-accept
/Users/aoqimin/Desktop/nomi-s5-final
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/bold-meitner-ba7296
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/busy-wiles-80c7d0
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/elastic-zhukovsky-95c87b
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/exciting-nobel-fb3910
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/funny-torvalds-06775d
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/gallant-black-946f06
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/great-tharp-87f7d1
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/hungry-bose-842c94
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/intelligent-engelbart-ff0100
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/keen-jang-f03728
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/laughing-aryabhata-504663
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/musing-brattain-bf0f5f
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/optimistic-hamilton-9df735
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/optimistic-leavitt-2b2c68
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/pedantic-mccarthy-5700ec
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/pensive-lewin-0d4d88
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/practical-fermat-514235
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/thirsty-haslett-76c6e7
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/upbeat-aryabhata-b03004
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/vigorous-chatelet-ce5ddf
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/youthful-buck-fe0def
/Users/aoqimin/Desktop/Nomi/.claude/worktrees/zen-torvalds-43d065
/Users/aoqimin/Documents/Codex/2026-07-13/docs-test-2026-07-13-browser-2/work/Nomi
```

其中 `.claude/worktrees/bold-meitner-ba7296` 等属于并行会话目录；`Nomi` 主工作区也有未提交研究/测试文件，不能当作可回收目录。

### prunable worktree

```text
/private/tmp/nomi-issue-237.bBdypr
/private/tmp/nomi-runway-seedance-20260830
```

这两个目录的 worktree gitdir 已不存在。它们只是进入 S1 的“可回收候选”，本阶段不执行 `git worktree prune` 或目录删除；删除前仍需确认没有外部会话、未保存文件或恢复需要。

## S0 红 / 绿收据

```text
red_proof:
  未冻结前无法安全判断哪些分支/worktree可处理；工作树/PR/远端状态是动态的。
  当前已执行 git status、git worktree list、PR snapshot 和 preflight，建立可回放基线。

green_proof:
  pnpm run delivery:preflight
  observed: PASS; remoteBaseIsAncestor=true; clean=true
  git diff --check
  observed: PASS for the S0 documentation changes

persistence_proof:
  S0 inventory file committed in c0e499b5 and pushed on PR #453.

visual_proof:
  S0 is a repository-state stage; no product visual claim is made.

remaining:
  S1 must refresh all PR checks, compute branch deltas/patch-ids, classify every plan and worktree,
  and separately audit the canonical storyboard Agent path.
```
