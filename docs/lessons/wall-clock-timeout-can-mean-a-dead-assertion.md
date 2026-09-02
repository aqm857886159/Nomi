# 反复超时的测试，先查它断言的是不是死的

> 📎 教训 · 首次记录 2026-09-03 · 状态：现行
> **触发场景**：同一条测试在**两个以上分支/会话**里超时，而每次都被判成「并行负载 flake」；或你正要给某条超时的测试调大 timeout；或你写了「这事永远不发生」的计数断言（`toHaveLength(0)` / `toBe(0)`）。

## 踩了什么

2026-09-02 夜，`projectAgentHost.test.ts` 里「keeps a 1,000-command same-entity snapshot
bounded without steady-state ledger rescans」在**四个不同分支**上超时（46–51s，testTimeout 30s）。
四个会话分别判为「并行负载墙钟 flake」，都没动它。

四次都判错了。真相是两件事叠在一起：

1. **那条核心断言是死的。** 它这么写：
   ```ts
   const ledgerReadSpy = vi.spyOn(fs, "readFileSync");
   const ledgerReads = ledgerReadSpy.mock.calls.filter(([p]) => String(p) === paths.ledger);
   expect(ledgerReads).toHaveLength(0);
   ```
   但生产代码**按路径 open、按 fd 读**（`projectAgentCommandLedger.ts:183` 是
   `fs.readFileSync(fd)`）。`readFileSync` 的第一个参数永远是数字 fd，永远不等于路径串。
   过滤器恒空 → 断言恒真。实测：把账本缓存关掉、让它**每条命令都全量重扫**，
   这条断言照样绿，2045 次 `readFileSync` 里它「看到」0 次。

2. **它的墙钟成本是真的。** 1000 条命令 × 每条 2 读 2 写快照 ≈ 25s（load 36 实测），
   已经吃掉 30s 超时的 85%；那个 spy 还把 4000 次调用的**返回值**（≈193 MB 文件内容）
   全留在 `mock.results` 里，再加约 50%。所以它平时贴着线，负载一高就翻。

**花钱买了个空盒子**：成本全额付，保护为零。

## 为什么四次都判成 flake

因为超时**长得就像负载**。而且这仓里确实有过一次真的负载 flake
（`vitest.config.ts:22-27` 记着 fsync + 邻居进程那次），所以「又是它」是最省事的解释。
分辨这两者只有一个办法：**去量这条测试到底断言了什么**，而不是量它跑了多久。

## 下次怎么做

- **反复超时 ≥ 2 次 = 别再判 flake，去读断言。** 先问「这条断言，在它该红的时候会红吗」。
- **验证方式是变异测试**：手动把被测的不变量破坏掉（这次是把账本缓存 `if` 前面加 `false &&`），
  跑一次。**不红 = 断言是死的**，跟机器快慢无关。
- **fs spy 按路径过滤前，先确认生产是不是按路径调的。** `open(path)` + `read(fd)` 是常见写法，
  按路径过滤 `readFileSync` 会恒空。改成按 **open 意图**数（读打开 vs 写打开用 flag 区分），
  或者数 open 而不是数 read。
- **「这事永远不发生」的计数断言，同一个 run 里必须配阳性对照**——让它发生一次、断言计数器
  确实变成 1。否则你分不清「没发生」和「仪器坏了」。
- **复杂度不变量别用墙钟表达。** 断言次数/大小有界，跟机器速度解耦；这样规模就不用堆到 1000，
  过了窗口（这里是 64）再多跑只买 I/O 不买覆盖。

## 自己写探针也会犯同一个错

我这次查它，探针连错两次，都是「以为在测 A、其实在测 B」：
- **fd 会被复用**：把「曾经是账本的 fd」存进 Set 不删，关掉后系统把这个号分给快照文件，
  于是把快照的读算成了账本的读 —— 一度得出「193 MB，果然 O(n²)」的假结论。
- **`fs.constants.O_ACCMODE` 在 Node 里是 `undefined`**：`flags & undefined === 0`，
  而 `O_RDONLY` 就是 `0`，所以「只数只读打开」的条件恒真，把 1000 次 append 数成了 1000 次重扫。

两次都是**先有了结论、数字又刚好像**，才没立刻发现。教训同 `assert-you-are-in-the-situation-you-claim`：
量之前先证明你量的是你以为的那个东西——最省事的证明就是阳性对照。

相关：[[assert-you-are-in-the-situation-you-claim]]、[[dead-selector-lies-both-ways]]、
[[race-repro-needs-positive-control]]、[[flaky-test-check-other-worktrees-first]]

根因合同：`docs/fixes/2026-09-03-host-snapshot-complexity-assertion.root-cause.json`
