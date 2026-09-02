# productionRun 这类 flake 的分腿处置：验修复看代码，不看 PR 状态

> 📎 教训 · 首次记录 2026-08-25 · 状态：✅ 已固化（两条腿均已进 main：落盘屏障分级 + `check:test-waits` 门岗 R18）
> **触发场景**：`gates` 红了、failing 全在 `electron/productionRun/`，错误恒为 `Test timed out in 5000ms`；或者你正准备重修这个 flake。

**结论**：**别再重修这个 flake**——两条腿都已在 `origin/main`，重修只会造第三份并行实现。红了先排除邻居负载，再按下面的方法**自己核实**修复在不在树上。

**先别信这份文档里的状态，自己核一遍**（这是本条最耐用的部分）：

```bash
git cat-file -e origin/main:electron/durability.ts        # 耗时腿（落盘屏障分级）
git cat-file -e origin/main:tests/setup/durability.ts     # 同上，harness 层开关
git cat-file -e origin/main:scripts/check-test-waits.mjs  # 赛跑腿（R18 门岗）
```

**一律用 `git cat-file -e origin/main:<file>` 判断「修复到底在不在 main 上」，不看 PR 状态、不看本地 commit。** 这条线上已经栽过两次：第一次修复只活在被丢掉的工作树里，第二次躺在没人合的 PR 里（详见 [`flaky-test-check-other-worktrees-first`](flaky-test-check-other-worktrees-first.md)）。PR 的 OPEN/MERGED 是会变的状态，文件在不在树上才是事实。

**症状**：`electron/productionRun/**`（`productionQaVerify` / `productionGateIdempotency` / `productionRunDriver` / `productionRunPauseSemantics` / `productionSampleGate` / `productionShotGate` / `productionTrustLevel`）曾在 `origin/main` 上间歇性红，失败数随机器负载在 0~10 之间跳，错误恒为 `Test timed out in 5000ms`。

**为什么会踩 —— 两条独立的腿，缺一条都还会红**：

**腿 1 · 耗时（fsync）**：production run 仓库每条命令 3 次真 fsync。修复是**落盘屏障分级**：`electron/durability.ts`（默认恒为 `durable`，生产代码不读任何环境变量来决定要不要 fsync）+ `tests/setup/durability.ts`（**全仓唯一翻 `ephemeral` 处**，经 `vitest.config.ts` 的 `setupFiles` 挂上）。开关放 harness 层而不是每个测试自己传 = 将来新增的测试自动就在 ephemeral 下跑，**不可能忘记**（P2：整类不复发）。`electron/durability.test.ts` 钉住反向保证：`durable` 模式下必须真的调 `fsyncSync`。方案见 `docs/plan/2026-08-25-production-run-test-flake-fsync.md`。

实测数据（A/B 阳性对照，同一 worktree、同一 node_modules，只换 HEAD）—— 8 个 fsync 锤子满载下：

| arm | 结果 |
|---|---|
| 修复前 `d4d327b3` | 10 / 10 / 9 次 timeout，7 文件红，25–31s |
| 修复后 `cc06441b` | 2 / 2 / 3 次 timeout，17–20s |

正常负载下修复后的 `origin/main` 连跑 10 次：**10/10 全绿、0 timeout、225/225**，其中 ambient load 高达 **~50**（Spotlight 重建索引）仍 2–6s 跑完。全量套件 6287 passed / 0 failed。

**腿 2 · 赛跑（私有墙钟）**：上表「修复后仍剩 2–3 个 timeout」那一格就是它。**腿 1 把 fsync 拿掉了，但 5000ms 闹钟对着 ~0.3s 的用例只有 ~16x 余量，邻居把磁盘打满时照样不够。** 根因是十个测试文件各自复制了一份 `waitFor(check, 500ms~5s 硬闹钟)`，拿「调过参的墙钟猜测」赛跑「真实文件锁 + fsync 编排链」。修复 = `check:test-waits` 门岗（R18，**硬零无棘轮基线**）+ 补收第 11 处匿名内联 deadline 循环（`productionStoryboardBinding`）+ `testTimeout` 提到 30s（`vitest.config.ts:27`）/ `WAIT_TIMEOUT_MS` 20s。规矩：等后台编排链一律用 `productionRunTestHelpers` 的 `waitForProduction`（60s 安全网、超时抛带标签错误），不许再手写 `waitFor` / `Date.now()` 截止时间轮询。

**怎么用**：

- `gates` 红了、failing 全在 `electron/productionRun/` → **先 `pgrep -f vitest` + `uptime` 排除邻居负载**（见 [`flaky-test-check-other-worktrees-first`](flaky-test-check-other-worktrees-first.md)），再用上面三条 `git cat-file` 确认两条腿都在。
- 别再重修这个 flake。
- 做这类 flake 验证**必须有阳性对照**（见 [`race-repro-needs-positive-control`](race-repro-needs-positive-control.md)）：先证明干净 main 在你的仪器下真的会红，否则「连跑 10 次全绿」可能只是那天机器闲。

**出处**：`docs/plan/2026-08-25-production-run-test-flake-fsync.md`；`electron/durability.ts`、`tests/setup/durability.ts`、`vitest.config.ts`、`scripts/check-test-waits.mjs`；规则 R18。
