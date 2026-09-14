# 「没装」有四种相，别让读通道只认一个 null

> 📎 教训 · 首次记录 2026-09-14 · 状态：✅ 已固化（owner：`electron/capabilityCore/residentSurfaceLifecycle.ts`；契约：`docs/fixes/2026-09-14-resident-generation-adapter-install.root-cause.json`）
> **触发场景**：某条 CI 门岗（尤其 Canvas Performance）红在 `console error: [missing-intervention-card] … spend-surface-unavailable` 而预算全过；或 Agent 回「生成服务暂时不可用」而你想去 catch 里找那个被吞的异常。

**结论**：先看 harness 是不是**按配置**不起能力核（`tests/ux/canvas-performance-benchmark.e2e.mjs` 传 `NOMI_DISABLE_CAPABILITY_CORE=1`，隔离实例本就不该起本地 RPC / 碰 `~/.codex`）。那种情况下主进程日志里**一行 ERROR 都没有**——不是异常被吞了，是「从没起过」和「装配抛了」共用了一个 `null`。修法不是过滤 console error，也不是在渲染层把那个错吞回去，而是给「装没装、没装是为什么」找一个 owner，把 disabled / starting / install-failed / stopped 各说各的。

**当时为什么会踩**：
- #764（09-12）把付费卡读通道从 `?? []` 改成「没装就抛」——对「装配抛了」是对的，但它认不出「按配置关掉」，于是每个禁用能力核的真实画布场景每 1.5s 一条 console error，#763 / #776 的性能门恒红。
- 09-13 的合同（`spend-surface-unavailable-error-boundary`）在渲染层加了一个吞错的 guard——五个 commit 之后那个函数仍是死导出，`refresh` 的 catch 从没调过它；而且就算接上了，它会把**真的**装配失败也一起吞掉。
- 两头各修一次都不对：读侧与渲染侧都不是这份状态的 owner。任务书本身也带着「去把 catch 里的异常打出来」的前提——实跑隔离实例、读它自己的 `user-data/logs/nomi-<日期>.log` 只用了两分钟就证伪。

**下次怎么避**：
1. 看到「surface unavailable」类症状，先读那次运行**自己的**主进程日志（隔离实例在 `<tempRoot>/user-data/logs/`），有没有 ERROR 决定你在修哪一类问题。
2. 一份「能力装没装」的状态如果是 nullable，就问它塌了几种现实；≥2 种就要 owner + 离散相，不许靠调用方各自解释 `undefined`。
3. 门岗红了先分「预算红」还是「可靠性红」（`hardFailures`）；后者的修法永远不是降 console.error 成 warn。
