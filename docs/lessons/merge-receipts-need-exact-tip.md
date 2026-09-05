# 合并收据只认 main 的 tip：连合两个 PR 就丢第一个的收据

> 📎 教训 · 首次记录 2026-09-05 · 状态：现行（工具修法已派工：接受祖先 SHA）
> **触发场景**：`pnpm run delivery:verify-merged -- --expected-sha <SHA>` 报 `unexpected_head` / `remote_main_moved` / `required_checks_failed`；或一天要合多个 PR。

**结论**：`scripts/git-delivery.mjs verify-merged` 要求 HEAD == expected SHA == origin/main 的 tip，且它的 checks 已完成。第一个 PR 合入后 CI 要跑十几分钟，这期间再合第二个，第一个的收据就永远记不上了。在工具修好前：**合一个、等它 CI 完、在分离 worktree 上记完收据，再合下一个**；或者接受丢收据并在路线记忆里明写。

**为什么会踩**：2026-09-05 一天丢了 #492、#490、#507 三份收据，都是「等不及、先合下一个」。另外它要在 HEAD 就是那个 SHA 的 checkout 上跑（本 worktree 在任务分支上会报 `unexpected_head`），实操是用一个分离 HEAD 的 probe worktree：`git checkout --detach <sha> && node scripts/git-delivery.mjs verify-merged -- --expected-sha <sha>`。

**怎么用**：
1. 合并后立刻挂一个后台等待：`until gh run list --branch main --workflow "Quality Gate" --limit 1 --json headSha,status --jq '.[0]|select(.headSha|startswith("<sha8>"))|.status' 显示 completed`，完成就记收据。
2. 收据 `required_checks_failed` 时先看是不是已知假红（画布性能门在 Linux 假红一族），假红也要如实记，别改 SHA 再跑。
