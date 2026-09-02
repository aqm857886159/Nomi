# 三点 diff 会掩盖过期分支的大回滚

> 📎 教训 · 首次记录 2026-08-28 · 状态：现行
> **触发场景**：被要求「把这个分支/这个 PR 合上去」，而该分支落后 `main` 很多个 commit；或看到某分支的 diff 小得可疑、正好和「这就是个小改动」的预期吻合。

**结论**：判断一个落后很多的分支能不能合进 `main`，**必须用两点 diff `git diff origin/main <branch>`**，不能用三点 `git diff origin/main...<branch>`。两点 diff 才是「真合并进去会变成什么样」。

**为什么会踩**：三点 diff 是「从 merge-base 到分支尖端」，只显示**这个分支自己改了什么**；分支落后 40+ 个 commit 时，`main` 上后来的所有工作在三点 diff 里**完全不可见**。而三点给出的「只改了几行」在直觉上极有说服力，又和「这是个小改动」的预期完全吻合，所以不会触发怀疑。

2026-08-28 实例（分支 `claude/amazing-fermat-62afe9`）：

- 三点 diff：`9 files changed, 391 insertions(+), 25 deletions(-)` —— 看起来就是一个 marketing hero CTA 小改动，随手就能合。
- 两点 diff：`122 files changed, 2093 insertions(+), 11026 deletions(-)` —— 合进去会**删掉 20 个 `scripts/check-*.mjs` 门岗**（check-vocabularies 全家、check-doc-status、check-docs-index、root-cause-contracts…）、删 `skills/release-media-pack/`、回滚 `quality-gate.yml` / `CLAUDE.md` / `AGENTS.md` / `engineering-rules.md`，还把 `tests/ux/at-mention-edge.walk.mjs` 退回没有真断言的 console.log 版本。
- 而那个 hero CTA 改动**早就在 main 上了**，byte-identical（`git diff origin/main <branch> -- marketing/ scripts/marketing/` 输出为空）——同样的功能已经经另一条 PR 落地。

**怎么用**：动手合之前先跑三件事。

1. `git diff origin/main <branch> --shortstat` —— 删除行数异常大就是危险信号。
2. `git diff origin/main <branch> --diff-filter=D --name-only -- scripts/ .github/` —— 会不会删掉门岗 / CI。
3. `git diff origin/main <branch> -- <那个功能的目录>` —— **输出为空就说明功能已经在 main 上了，这个分支纯属过期，该弃不该合。**

**出处**：2026-08-28 对 `claude/amazing-fermat-62afe9` 的合并评审。同类陷阱见 [下否定式结论前先证明你在哪个 checkout](prove-which-checkout-before-negative-claims.md)、[接到「修 X」先查在途 PR](check-open-prs-before-fixing-reported-bugs.md)（同一个功能已由别的 PR 落地）。
