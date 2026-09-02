# 下否定式结论前，先证明你在哪个 checkout

> 📎 教训 · 首次记录 2026-08-26 · 状态：现行
> **触发场景**：准备说「仓库里没有 X」「这个组件没人用 / 是孤儿」「这段死代码还没删」「这个功能不存在」——任何**否定式**结论。也适用于 grep 结果为空、准备据此下判断的那一刻。

**结论**：否定式结论**不要问工作区，直接问 `origin/main`**：

```bash
git cat-file -e origin/main:<path>      # 文件在不在
git cat-file -p origin/main:<path>      # 读它在 main 上的真实内容
git grep <pattern> origin/main          # 在 main 的树上搜
```

下结论前先证明自己站在哪里：

```bash
git branch --show-current
git rev-list --count HEAD..origin/main   # 落后多少
git rev-list --count origin/main..HEAD   # 领先多少
```

不是 `main` + 0/0，就别用工作区的 grep 结果下否定式结论。

**为什么会踩**：本仓常态是多个 worktree 并行，任一 checkout 都可能停在一个陈旧的、领先的、或正卡在冲突中的分支上。停错 checkout 的危害**不是报错，而是静默给出过期答案**——grep 读到的是另一条分支的代码，得出的结论看起来完全合理，没有任何信号提示你搜错了树。

而否定式结论有个特性：**在错误的树上永远成立**。文件还没被合进这个分支 → 「不存在」；文件已经在这个分支上被删了 → 也是「不存在」。两种情况长得一模一样，你无从分辨。

2026-08-26 一天踩两次：判「某组件是孤儿」，实际它正被 import；判「这段死代码没删」，实际早在 commit `95f5b262` 就删了、`origin/main` 上根本不存在，还为此开了个「删除一个不存在的文件」的任务。

**怎么用**：

- grep / 读码 / 判断仓库现状前，先跑上面那两条 `rev-list` 确认位置。
- 需要看历史改动时用 `git log --oneline -- <file>` 或 `gh pr diff <n>`，**不要把一个停着的 checkout 当参考资料**。「开着不合当书签」是这类烂摊子的根因：分支 / PR 开着的理由只该是「还没定 / 还没做完」。
- 要跑某个分支的代码就开临时 worktree，用完 `git worktree remove`，别让某个 checkout 长期停在非 main 状态。

**出处**：2026-08-26 的两次误判（孤儿组件、已删死代码 `95f5b262`）。相关：[断言前先证明你在你以为的现场](assert-you-are-in-the-situation-you-claim.md)、[判测试翻红前先查别的 worktree](flaky-test-check-other-worktrees-first.md)、[一个死选择器同时造假红和假绿](dead-selector-lies-both-ways.md)。
