# 「文档门岗自动修复」往受保护的 main 直接 push 必败：这类红不是内容问题

> 📎 教训 · 首次记录 2026-09-05 · 状态：现行（工作流修法已派工：改开 PR）
> **触发场景**：main 上 `Docs Gate Autosync` 工作流红，日志里是 `GH006: Protected branch update failed` 三连。

**结论**：这个工作流的最后一步是把索引/状态修复 commit 直接 push 回 main，而 main 受保护，所以它一旦有东西要修就必红。红的信号只说明「有新文档没进 `docs/plan/INDEX.md` 或开头 12 行没状态标记」，修法是在任意分支补上（`pnpm run check:docs-index` / `check:doc-status` 本地就能验），不要去动工作流的 push。

**为什么会踩**：#507 带进 `docs/plan/2026-09-05-resident-composer-receipt-fix.md` 没收录、没状态，触发自动修复 → push 被拒 → 红；本地 `pnpm run gates` 里这两项是 advisory，真正阻断的是 `check:claude-hooks`（`.claude/hooks` 与 `scripts/claude-hooks` 漂移，`node scripts/install-claude-hooks.cjs` 重装即好）。

**怎么用**：
1. 新增 `docs/plan/*.md` 时顺手在 `INDEX.md` 对应主题下加一行，并在文件前 12 行写 `> 状态：…`。
2. 看到 Autosync 红，先 `gh run view --log-failed | grep GH006`，命中就按上面补文档，不要重跑工作流。
