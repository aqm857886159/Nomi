# CI 门岗拿两个时间点比较，别人刚合的改动会算到你头上

> 📎 教训 · 首次记录 2026-09-26 · 状态：现行（根治排在 `docs/roadmap/TODO.md` T-QA-33）
> **触发场景**：PR 的 Contracts 红了，红的却是你没碰过的文件（别人的根因合同、别人的词表债、别人几千行的 src 改动）；或者你刚 `gh run rerun`、刚替外部 fork 点了「批准运行」。

**结论**：先看红的文件在不在你的 diff 里。不在，就是「比较基准」和「检出的树」不是同一时刻的：把 origin/main 合进分支、推一次，就会恢复正常。这种情况别去改门岗预算，也别抬基线。

**为什么会踩**：

- **形状一：事件里的基准旧、检出的树新。** `quality-gate.yml` 用 `github.event.pull_request.base.sha` 当 diff 基准，但 checkout 拿的是 GitHub 按**最新** main 重算的 merge ref。只要 main 在事件之后前进过，别人合进 main 的文件就会出现在你的 diff 里。
  - #878（纯文档）的 `check:door-map` 红在 #875 的根因合同上。#875 在它的 CI 启动前 38 秒刚合进 main。
- **形状二：检出的树旧、基线新。** 外部 fork 的运行要等人批准才开跑。#868 的运行是 09-24 建的，09-25 才批准，检出的是 09-24 的树，`check:vocabularies` 却按运行时的 `origin/main:scripts/vocabularies-baseline.json` 比较。main 已经删掉的文件，于是被当成「新增欠账」。
- `gh run rerun` 复用旧事件，却重新检出新的 merge ref，两种形状都会触发。

**怎么用**：

- 看红的是哪个文件：`gh pr diff <n> --name-only | grep <文件>`。不在你的 diff 里，就在分支上 `git merge origin/main` 后重推；fork PR 用 `gh api -X PUT repos/<o>/<r>/pulls/<n>/update-branch`。推完再批准新一次运行。
- 别对「main 前进过」的 PR 用 rerun 去验证门岗类的红。

**出处**：PR #878、#868（2026-09-25/26）；根治任务 T-QA-33。
