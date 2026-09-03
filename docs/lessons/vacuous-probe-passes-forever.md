# 探针测不到它命名的那件事：断言恒真，而你为这个零付了全额代价

> 📎 教训 · 首次记录 2026-09-03 · 状态：✅ 已固化（`check:test-waits` 的 `fs-read-spy-path-filter` 规则接管）
> **触发场景**：你正要写「这事永远不发生」的计数断言（`toHaveLength(0)` / `toBe(0)`）；或你 spy 住 `fs` 的读接口再按路径过滤 `mock.calls`；或某条测试反复超时、你正准备判它「并行负载 flake」。

**结论**：`toBe(0)` 只有在**同一个 run 里证明过这个计数器会涨**之后才有意义。没有阳性对照的零，和仪器坏掉长得一模一样——而且它永远不会自己暴露。

## 为什么会踩

`projectAgentHost.test.ts` 那条招牌断言这么写：

```ts
const ledgerReadSpy = vi.spyOn(fs, "readFileSync");
const ledgerReads = ledgerReadSpy.mock.calls.filter(([filePath]) => String(filePath) === paths.ledger);
expect(ledgerReads).toHaveLength(0);   // 「稳态不许重扫账本」
```

可生产读账本走的是 `readRegular()`：**按路径 `open`、按 fd `read`**（`projectAgentCommandLedger.ts` 里 `fs.readFileSync(fd)`）。所以 `readFileSync` 的第一个参数永远是数字 fd，永远不等于路径串——**过滤器恒空，断言恒真**。

实测（变异测试）：把 `validate()` 的缓存关掉、让它每条命令都全量重扫账本，那条断言照样绿，2045 次 `readFileSync` 调用里它「看到」0 次。它保护的东西，一次都没保护过。

**代价却是真的**：它挂在 1000 条命令的真实落盘循环上，无外部负载就已吃掉 30s `testTimeout` 的 85%（实测 25,446ms @ load 36），于是在四个分支上超时——被四个会话分别判成「并行负载 flake」。**花全款买了个空盒子，还因为盒子太重反复翻车。**

同一天在 `projectAgentRepository.test.ts:622` 扫出**第二份一模一样的写法**。第一份由 PR #410 修掉时没连带扫同类，第二份留到 #411 才补——所以这条的重点不只是「别这么写」，还有「扫出一处就 grep 全仓同形状」。

## 怎么用

- **别用 fs spy 的调用记录当行为探针**。生产「按路径 open、按 fd 读」是常态，按路径过滤必然落空。要么用**生产侧计数器**（`__projectAgentCommandLedgerScanCountForTests` / `__projectAgentFullValidationCountForTests` 这一套，不经过 fs 间接层），要么按 **open 意图**数（读打开 vs 写打开用 flag 区分）。
- **每条「永远不发生」的断言配一条阳性对照**：同一个 run 里让它发生一次，断言计数器确实变成 1。`projectAgentHost.test.ts` 的「counts a real cold-cache ledger rescan」就是这个用途——它存在的唯一理由是让上一条不能悄悄变死。
- **同一条测试超时 ≥ 2 次就别再判负载**，去做变异测试：手动破坏被测的不变量，**不红 = 断言是死的**。这个判据跟机器快慢无关，是这类问题唯一可靠的分辨法。
- **扫出一处就 grep 全仓同形状**（`.mock.calls` + `.filter(` + `===`），别只修报到你面前的那一处。

## 出处

- PR #410（修第一处 + 换成生产侧计数器 + 加阳性对照用例）、PR #411（修第二处 + 立本门岗）
- 变异测试：关掉 `validate()` 缓存 → 旧断言绿、新断言红
- 相关：[[dead-selector-lies-both-ways]]、[[race-repro-needs-positive-control]]、[[assert-you-are-in-the-situation-you-claim]]、[[flaky-test-check-other-worktrees-first]]
