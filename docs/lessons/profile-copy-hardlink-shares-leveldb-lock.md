# 用硬链接复制 Electron profile，会和正在运行的 app 抢同一把 leveldb 锁，凭空多出 3.5 秒

- **状态**：✅ 有效
- **日期**：2026-09-03
- **触发场景**：B 区（判测试红绿 / 性能测量）。任何"复制一份用户真实 profile 来复现或测启动性能"的活。

## 结论

复制 Electron 的 `userData` profile 用于测量时，**必须 `cp -R` 深拷贝，禁止 `cp -Rl` / `cp -al` / `rsync --link-dest` 这类硬链接复制**。

硬链接让副本的 `Local Storage/leveldb/LOCK` 与原 profile 是**同一个 inode**。用户机器上那个正在运行的 app 正持着这把 `flock`。被测实例首次访问 `localStorage` 时会阻塞在锁上直到放弃——实测**卡 3.6 秒**。

## 症状长什么样（为什么会误诊）

它伪装成一个漂亮的、可复现的产品性能 bug：

```
domInteractive = 185~422ms     ← HTML 解析很快
DCL            = 3882~3903ms   ← 中间 ~3.5 秒
FCP            = ~3960ms
```

看起来完全像"模块脚本执行 / 首次 React 渲染太慢"。而且它**稳定复现**、**跨多次运行一致**，还能被合理故事解释（"老用户渲染完整外壳、新用户只渲染引导页所以快"）。

本次还做了一个 A/B——同一 profile 下 0 个项目 vs 346 个项目，DCL 分别 3903ms / 3882ms——**正确地排除了项目数**，但两臂共用同一份硬链接 profile，混杂因子在两臂里等量存在，A/B 看不见它。

真凶靠 CPU profile 才现形：一个 `localStorage.getItem` 自己占了 3608ms（调用点是 `src/i18n/index.ts` 模块级的 `readStoredLocaleRaw()`）。

## 下次怎么避

**测之前验锁是空的**：

```bash
lsof "<profile>/Local Storage/leveldb/LOCK"   # 必须无输出
stat -f "%i" "<copy>/Local Storage/leveldb/LOCK"
stat -f "%i" "<原 profile>/Local Storage/leveldb/LOCK"   # 两个 inode 必须不同
```

隔离对照（30 秒就能做，比读源码猜快得多）：起一个**只有一行 `getItem`、零业务代码**的空白页，分别指向两份 profile。

```
硬链接副本： {"first":3784,"second":0}
全新空 profile：{"first":0,"second":0}
```

一行代码都没有还慢 3.8 秒 → 慢的不是你的代码。

## 同类推广

不只是 leveldb。**任何靠 inode 持有的 OS 级资源**（flock/fcntl 锁、sqlite WAL、单实例 lockfile）在硬链接副本里都是**共享**的，不是副本。硬链接只对"纯数据、只读、无锁"的目录安全——比如项目素材库（本次 `~/Documents/Nomi Projects` 的 346 个项目用 `cp -Rl` 就完全没问题，因为那里没有任何进程持锁的文件）。

判据：**这个目录里有没有正在运行的进程持着的锁文件？**有 → 深拷贝；没有 → 硬链接省时省空间。

## 另一个同场景陷阱：冷/热文件缓存

同一份代码、同一份 profile，刚 `cp -R` 完 322MB 立刻起 app 是 **10735ms**，静置几秒让盘空下来再起是 **1220ms**。

性能前后对比必须：同条件、拷完 sleep、各测 ≥3 次、报全部结果而不是最好那次。这台机器常有 20+ 并行 worktree 在跑，方差大是常态（另见 [flaky-test-check-other-worktrees-first](flaky-test-check-other-worktrees-first.md)）。

## 相关

- [assert-you-are-in-the-situation-you-claim](assert-you-are-in-the-situation-you-claim.md) — 同一个母题：断言前先证明你在你以为的现场
- [race-repro-needs-positive-control](race-repro-needs-positive-control.md) — 阳性对照的价值；本条里"空白页 getItem"就是那个对照
