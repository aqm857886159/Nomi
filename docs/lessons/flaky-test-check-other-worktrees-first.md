# 判测试翻红前先查别的 worktree

> 📎 教训 · 首次记录 2026-08-24 · 状态：现行（含一条**已核实推翻**的旧记录，保留在下面）
> **触发场景**：测试随机超时、同一份代码「跑三次挂一次」、或者刚修完 flake 想验证却拿到不稳定的结果。

**结论**：诊断随机失败前**先量机器负载**，再下结论。

```bash
pgrep -fl vitest    # 别的 worktree 在跑 suite？（路径里能看出是哪个 worktree）
uptime              # load average
```

这台开发机常有 20+ worktree、多个 agent 会话并行。另一个 worktree 跑 `vitest run` 时 load average 能到 **22**，本 worktree 的同一份测试耗时被放大 **~40x**（闲机 0.15s 的用例撞穿 5s 超时）。**这和真 flake 在输出上完全无法区分**——都是 `Test timed out in 5000ms`。

**为什么会踩**：

2026-08-24 修 `productionQaVerify` 超时时踩过：根因修完后跑 3 次验证，run 1 挂了 8 条、run 2/3 全绿，差点判定「修复无效」回去重做。一查是 sibling worktree 正在跑自己的全量 suite。**run 1 用了 84s，run 2/3 只用 29s——同一棵树、同一份代码，3x 的墙钟差就是外部负载。**

**⛔ 本条原先写过一段错的，已核实推翻（保留误判过程本身）**

原文曾写「已修并固化在仓库里，见 `scripts/check-heavy-path.mjs` 的 `slow-test-real-fsync` 规则 / `productionRunTestHelpers.ts` 的 `createTestProductionRunRepository`」。2026-08-25 把 70 个 remote 分支全 grep 了一遍：**这两个符号哪儿都不存在**——那次的修复从没 commit 过，只活在一个后来被丢掉的工作树里。所以 flake 在 `origin/main` 上原封不动地活到了 08-25，用户当天又报了一次「`pnpm run gates` 谁都跑不过」。

同一个陷阱当天又栽第二次：改口说「已 commit」，结果那份修复躺在**未合并**的 PR #139 里，三个文件在 `origin/main` 上一个都不存在。第一次是修复只活在被丢掉的工作树里，第二次是躺在没人合的 PR 里。

> 教训（比 fsync 本身更值钱）：**「我改完了」≠「commit 了」≠「在 main 上」**。写「已固化 / 已修复」之前一律先 `git cat-file -e origin/main:<file>` 或 `git grep <symbol> origin/main`，否则下一个 session 会读着这条以为没事干。

**那次真正的代码根因（这部分判断是对的）**：production run 仓库每条命令 3 次真 fsync。最终修复走的是「开关放 harness 层而不是每个测试自己传」：`electron/durability.ts` + `tests/setup/durability.ts` + `vitest.config.ts` 的 `setupFiles`。根因与实测数据见 `docs/plan/2026-08-25-production-run-test-flake-fsync.md`。**三个文件现已确认在 `origin/main` 上。**

**怎么用**：

- 验证 flake 修复前，先确认没有别的 vitest 在跑；跑完的结论要**连 load 一起记**（把 `uptime` 塞进日志）。
- 杀掉自己的后台 suite 后 **worker 不会立刻退**——下一轮会和残留进程重叠。要么等干净，要么承认这轮数据脏了，别拿它当结论。
- 反过来：如果有人报 `pnpm run gates` 偶发红，**先查当时是不是有并行 worktree 在跑**，别一上来就假定代码有竞态。
- 另注意一条**无关**的干扰项：并行全量 suite 偶发一条 unhandled EPIPE（`capabilityCore/mcpVerify.test.ts`，3047 全过但 exit 1）——spawn 探针写死管道，属另一族，别混进 flake 的验证结论里。

**出处**：`docs/plan/2026-08-25-production-run-test-flake-fsync.md`；`electron/durability.ts`、`tests/setup/durability.ts`、`vitest.config.ts`。相关：[`production-run-tests-are-flaky`](production-run-tests-are-flaky.md)、[`check-open-prs-before-fixing-reported-bugs`](check-open-prs-before-fixing-reported-bugs.md)、[`race-repro-needs-positive-control`](race-repro-needs-positive-control.md)。
