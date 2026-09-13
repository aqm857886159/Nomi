# 写在规则里的分档，没人把它接到本机入口上——全机一把锁被全量测试堵死

> 📎 教训 · 首次记录 2026-09-12 · 状态：✅ 已固化（`scripts/run-gates-tests.mjs` + `scripts/run-gates-tests.node-test.mjs` 接管）
> **触发场景**：`pnpm run gates` 排队十几分钟才开跑；`with-gates-lock.py` 反复打印「另一棵 worktree 在跑 gates … 已跑 N 分钟；排队等待」；或者你正准备为了赶时间用 `--no-verify` / 手工盖戳绕过五门。

**结论**：**一条规则只要还得靠人记得去照做，它在高负载下就等于不存在。**R22 从 2026-08-30 就写着「普通隔离改动用 focused」，CI 也确实照做了整整两周——而本机 `pnpm run gates` 那一行里一直写死 `pnpm run test`（全量）。没有任何门岗会为此报红：分档策略在，判据在，CI 在用，**只有本机入口没接**。判据是不是存在，和判据是不是被调用，是两件事；查的时候要查后者。

**为什么会踩**：`package.json` 的 `gates` 是一条 `&&` 长链，2026-08-30 那次升级改的是 `scripts/validation-policy.mjs` 和 `.github/workflows/quality-gate.yml`——两边各自都「对」，没人把手伸到 `gates` 这一行。它也不可能自己暴露：全量跑出来是**绿**的，只是慢。绿灯从来不会提醒你它多花了 25 分钟。

放大它的是**共享资源**：全机 20+ 棵 worktree 共用 `/tmp/nomi-gates.lock`（`scripts/with-gates-lock.py:128`）。2026-09-11 22:00–09-12 03:30 实测：8 棵 worktree 轮流持锁、每次 10–25 分钟、队列峰值 18；写本条时 `ps` 一眼看到 9 个 `with-gates-lock.py --command "… pnpm run test …"` 同时排队。**每棵树都在为别人那棵树跑一遍与自己无关的一万两千多个用例付墙钟**，而排队时长又直接喂养了「绕过五门」的动机（R25 的绕口留痕账本就是这么来的）。

**怎么用**：
- 本机默认跑 `pnpm run gates`（contracts 全部 + 改动相关测试 + build），**别再手动挑测试**；显式全量用 `pnpm run gates:full`（`full-local` / `release` profile 走的也是它）。
- 档位由 `classifyValidationPolicy(...).unit` 判，本机**没有降档开关**——碰 `electron/`、`tests/ux/_*.mjs` 共享 harness、`.github/workflows/`、删除/重命名、空 diff 一律自动升全量，跑之前会把原因打印出来。看到 `full` 先读那行原因，别急着怀疑脚本。
- 五门戳里多了一行 `tier=focused|full|manual`，事后翻账用；**push 闸的判据没变**（仍只认 `sha` / `worktree`）。
- 更一般的一条：**改验证策略时，先 `git grep` 一遍「谁在调用这份判据」**，把每个调用点都列出来再动手。本次的调用点有三个（CI workflow、`tests/system/profiles.mjs`、本机 `gates`），当时只改了前两个。

**出处**：`docs/plan/2026-09-12-gates-risk-tier.md`（方案与先查别人）、`scripts/run-gates-tests.mjs`（调度点）、`scripts/run-gates-tests.node-test.mjs`（含「改 `tests/ux/_launchApp.mjs` 必须升全量」的先红后绿用例）、R22（`docs/engineering-rules.md`）。相关：[在满载机器上用墙钟做一次性 A/B，不算性能证据](wallclock-bisect-on-a-busy-machine-is-not-evidence.md)、[判测试翻红前先查别的 worktree](flaky-test-check-other-worktrees-first.md)。
