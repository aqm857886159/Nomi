# 有界性/复杂度不变量要用「计数」证，别用墙钟跑量

> 📎 教训 · 首次记录 2026-09-03 · 状态：现行
> **触发场景**：你在写或在修一个「跑 N 次然后看结果」的测试（N 是 1000 这种大数），或者本地 `pnpm run gates` 红在一个耗时贴着 `testTimeout` 的测试上。

**结论**：「快照有界」「稳态不重扫」「每条命令是常数成本」这类不变量**和机器有多忙无关**，所以判据里就不该出现墙钟。正确形状是：**热身填满窗口 → 跑两批等长样本 → 断言两批的计数完全相等**。两个不相交窗口成本相同 = 每条命令是常数 = 再跑 1000 条也是同一条水平线（归纳法）。跑 1000 次只是在同一条线上多采点，多花的是墙钟，不是证明力。

## 为什么会踩（两条腿，都来自同一次事故）

`electron/projectAgentHost/projectAgentHost.test.ts` 那条 `keeps a 1,000-command same-entity snapshot bounded without steady-state ledger rescans`：

**第一条腿：用墙钟证一件与墙钟无关的事。**
实测 125/250/500/1000 四档耗时 6.9s / 12.1s / 20.5s / 37.3s —— **线性，没有 O(n²)**，每条命令恒定 7 次 `open`、54 次 `lstat`、2 次约 50KB 的快照读+写。也就是说这 1000 次循环没触发任何坏算法，只是**老实做了 1000 遍同样的重活**。同一个 commit，机器闲时 13.8s、忙时 37s，而 `vitest.config.ts` 的 `testTimeout` 是 30s —— 红不红取决于那一刻邻居 worktree 在干嘛。（`vitest.config.ts` 自己写着「30s = 最重测试的 ~100× 余量」，那是按最重 ~300ms 估的；一个 31s 的测试把这条注释的前提整个推翻了，却没人回头改它。）

**第二条腿（更隐蔽）：那句「不重扫」的断言是死的。**

```js
const ledgerReads = spy.mock.calls.filter(([filePath]) => String(filePath) === paths.ledger);
expect(ledgerReads).toHaveLength(0);   // 恒真
```

真正读账本的地方（`electron/projectAgentHost/projectAgentCommandLedger.ts:183`）传的是**数字 fd**不是路径：`fs.readFileSync(fd)`。`String(11) === "/.../commands-v1.jsonl"` 永远 false，filter 永远筛出空数组。

**阳性对照**（别靠推理下这种结论）：把账本缓存整个关掉、让每条命令都真的回头重扫 —— 实测发生 **597 次真实重扫**，那句断言照样报 0、照样绿。所以那 30 多秒买到的只有「快照没变胖」半件事，标题里另外半件**压根没在验**。

这是 [`dead-selector-lies-both-ways`](dead-selector-lies-both-ways.md) 的 fs 版：**spy 的参数形状和生产传的对不上，断言就永远为真**，而且它不报红、能活很久（这条从 2026-09-01 引入活到 09-03）。

## 怎么用

- **写「跑 N 次」的测试前先问**：我到底在证什么？如果是有界性/常数成本，就改成两批等长样本比计数，N 只需覆盖到窗口填满（本例窗口 64，128 条足够，1.7–3.8s；原来 1000 条要 13.8–37s）。
- **判据里别放 `performance.now()` 阈值**，除非你在抓的是数量级回归（线性→立方那种）。那种情况要像 `projectAgentReducerPerformance.test.ts` 一样把「为什么是这个预算、慢多少倍才算真回归」写进注释。
- **上 fs spy 之前先确认参数形状**：`readFileSync`/`writeSync` 既能收路径也能收 fd，`openSync` 的 flags 是位掩码。想数「有没有重新读某文件」，数**只读方式打开它**（`(flags & (O_RDONLY|O_WRONLY|O_RDWR)) === O_RDONLY`）比按路径过滤 `readFileSync` 可靠。
- **新断言必须先验它会红**（R17）。本例两个负对照：关掉账本缓存 → `expected 256 to be +0`；把窗口改成无界 → `expected 244740 to be less than 10845`。健康时 `snapshotGrowth=90`、阈值 1084、坏掉 24474 —— 阈值卡在两者中间，不是勉强擦边。
- **顺带带上阳性对照**：断言「稳态 0 次重扫」的同时，断言**账本确实在长**（本例每批 10845 字节）。否则哪天写盘逻辑被删光，「0 次重扫」会因为「什么都没干」而恒真。
- **窗口大小从真相源 derive**，别手抄。本例用 `PROJECT_AGENT_RECENT_COMMAND_LIMIT` 而不是字面量 `64`/`63`（见 [`gate-assertions-must-not-copy-derived-values`](gate-assertions-must-not-copy-derived-values.md)）。

## 同类入口（P2 实扫，尚未处理）

同一族「墙钟当判据」还活着，重负载下会一起红，别误判成代码坏：

- `electron/ai/antigravityProcess.test.ts` — `initTimeoutMs: 500`，机器忙时进程起不来，抛 `ANTIGRAVITY_INIT_TIMEOUT` 而不是被测的 `PROFILE_UNVERIFIED`。
- `electron/providerAdapter/service.test.ts` — `keeps the event loop responsive while a duplicate waits for canonical materialization`。
- `electron/projectAgentHost/projectAgentReducerPerformance.test.ts` — 8s 预算 / 10s 超时，**这条是有意为之**（抓线性→立方，注释已写清余量），属于「真在验墙钟」的合法用法，别顺手改掉。
