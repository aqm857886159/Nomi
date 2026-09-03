# 合并后不立刻录交付收据，窗口就永久关闭

> 📎 教训 · 首次记录 2026-09-03 · 状态：现行
> **触发场景**：PR 合并后想补 `delivery:verify-merged` 收据，却报错说 SHA 对不上；或者你正打算「等会儿再补收据」。

**结论**：**PR 合并成功的下一个动作就是录收据**，别隔夜、别等 CI 闲、别先去干下一件事。`main` 只要向前走一个 commit，那个 merge SHA 的收据就**永远录不成了**——不是难录，是工具按设计拒绝录。

## 机制（读过源码，不是猜的）

`scripts/git-delivery.mjs` 的 `verify-merged` 有两道相等断言：

```js
if (state.headCommit !== expectedSha) { …拒绝… }   // :251
if (state.remoteCommit !== expectedSha) { …拒绝… } // :258
```

即要求 **当前 HEAD == `origin/main` == 目标 SHA** 三者相等。这是刻意的严格设计：收据要证明「CI 是在这棵真实的 merged tree 上绿的」，所以不允许在别的树上、也不允许在 main 已前进后追认。

后果：`main` 一旦被别人的 PR 推进，你那个 merge SHA 就不再是 `origin/main` 了，**任何 worktree 都无法让三者相等**，收据窗口永久关闭。CI 事实上可能是绿的（`gh run rerun` 也能让它变绿），但标准化收据文件录不出来。

## 怎么踩的（2026-09-02 画布性能战役）

`main` 当天是高速路，多个会话在连环合并。S3 的 merge SHA `777c9be0` 合入后：
- 第一次录收据 → 撞上 `gh api` 网络瞬断（`EOF`）；
- 重试 → 那趟 CI 被后续 push **supersede-cancel**，checks 显示 cancelled；
- 等 CI 重跑 → 期间 `main` 已经前进；
- 再录 → 三者不相等，**永久错过**。

同一天 S4 的 `a056b4ed` 因为合并后**立刻**录，一次就成（中间同样撞了两次 `transport_failed`，重试即可）。差别只在「立刻」。

## 下次怎么做

1. `gh pr merge` 返回后，**同一轮**就取 merge SHA 并起收据命令，中间不要插别的活。
2. 收据命令用后台哨兵 + **自带重试**（网络抖动是常态，一次失败不代表真失败）：
   ```bash
   rm -f /tmp/vm<pr>.exit
   (for a in 1 2 3; do pnpm run delivery:verify-merged -- --expected-sha <SHA> > /tmp/vm<pr>.log 2>&1 && break; sleep 20; done; echo $? > /tmp/vm<pr>.exit)
   ```
   只认哨兵里的退出码（管道/后台通知里的退出码是假的，见 [`piped-test-runs-mask-exit-codes.md`](piped-test-runs-mask-exit-codes.md)）。
3. 日志里出现 `"error": "transport_failed"` = 网络层，**重试**；出现 `pending` / `cancelled` = CI 还没定案或被取代，**尽快** rerun 后重录（此时正在和 main 的前进赛跑）。
4. 真错过了：**如实记录「CI 已绿但收据未录 + 原因」**，别伪造、别改断言绕过。收据的价值就在于它不可伪造。
