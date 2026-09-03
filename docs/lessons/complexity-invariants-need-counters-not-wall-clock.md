# 有界性/复杂度不变量要用「计数」证，别用墙钟跑量

> 📎 教训 · 首次记录 2026-09-03 · 状态：✅ 已固化（由 `check:test-waits` 第三条规则 `wallclock-budget-assertion` 接管，棘轮只减不增）
> **触发场景**：你在写或在修一个「跑 N 次然后看结果」的测试（N 是 1000 这种大数），或者本地 `pnpm run gates` 红在一个耗时贴着 `testTimeout` 的测试上。

**结论**：「快照有界」「稳态不重扫」「每条命令是常数成本」这类不变量**和机器有多忙无关**，所以判据里就不该出现墙钟。正确形状是：**热身跨过窗口 → 跑两批等长样本 → 断言两批的计数完全相等**。两个不相交窗口成本相同 = 每条命令是常数 = 再跑 1000 条也是同一条水平线（归纳法）。跑 1000 次只是在同一条线上多采点，多花的是墙钟，不是证明力。

结构面已由门岗接管：`scripts/check-test-waits.mjs` 现有三条规则，第三条 `wallclock-budget-assertion` 专抓「拿墙钟耗时给单测判分」，带只减不增的棘轮。完整根因分析见合同 [`docs/fixes/2026-09-03-wallclock-as-unit-test-oracle.root-cause.json`](../fixes/2026-09-03-wallclock-as-unit-test-oracle.root-cause.json)。**本条只留门岗抓不到、但换个人还会再踩的那部分。**

## 门岗抓不到的那半：spy 参数形状不对，断言会恒真

`electron/projectAgentHost/projectAgentHost.test.ts` 那条用例，标题写着「without steady-state ledger rescans」，而它验这件事的代码是：

```js
const ledgerReads = spy.mock.calls.filter(([filePath]) => String(filePath) === paths.ledger);
expect(ledgerReads).toHaveLength(0);   // 恒真
```

真正读账本的地方（`projectAgentCommandLedger.ts` 的 `readRegular`）传的是**数字 fd** 不是路径：`fs.readFileSync(fd)`。`String(11) === "/.../commands-v1.jsonl"` 永远 false，filter 永远筛出空数组。

**阳性对照**（别靠推理下这种结论）：把账本缓存关掉、让每条命令都真的回头重扫 —— 实测发生 **597 次真实重扫**，那句断言照样报 0、照样绿。所以它付出了全部墙钟代价（1000 次真实落盘往返，每条命令 7 次 `openSync` + 4 次 `readFileSync` + 2 次 `writeFileSync`），却换不到标题上那半件事的任何保护。

这是 [`dead-selector-lies-both-ways`](dead-selector-lies-both-ways.md) 的 fs 版：**spy 的参数形状和生产传的对不上，断言就永远为真**，而且它不报红、能活很久。

## 怎么用

- **上 fs spy 之前先确认参数形状**：`readFileSync` / `writeSync` 既能收路径也能收 fd，`openSync` 的 flags 是位掩码。想数「有没有重新读某文件」，要么让生产侧导出测试计数器（本仓惯例，如 `__projectAgentCommandLedgerScanCountForTests`、`__projectAgentFullValidationCountForTests`），要么数**只读方式打开它**（`(flags & (O_RDONLY|O_WRONLY|O_RDWR)) === O_RDONLY`）——比按路径过滤 `readFileSync` 可靠。
- **计数断言要防退化成空断言**：写「两窗相等」时必须同时断言**窗内计数 > 0**，否则 fs 入口被改名 / spy 挂空时它会变成 `0 === 0` 恒真。落地版就是这么钉的（`for (const op of FS_COMMIT_OPS) expect(firstWindow[op]).toBeGreaterThan(0)`）。
- **别把派生值手抄进断言**：写「两窗相等」而不是抄下「每条命令 7 次 open」。次数被重构改动时，正确反应是它仍然相等，而不是让人来改断言里的数字（见 [`gate-assertions-must-not-copy-derived-values`](gate-assertions-must-not-copy-derived-values.md)）。
- **新断言必须先验它会红**（R17）。两个负对照：关掉账本缓存 → 计数从 0 变正；把窗口改成无界 → 快照增长量从几十字节跳到两万多。健康时快照每窗只长 90 字节，账本长 10845 字节——阈值要卡在这两个量级之间，不是勉强擦边。
- **窗口大小从真相源 derive**，别手抄 `64`（用 `PROJECT_AGENT_RECENT_COMMAND_LIMIT`）。

## 附：这条病曾经从另一半复发过

本仓 2026-08-25 已为它的孪生形态立过门岗——用墙钟**等**（私有 `waitFor` / `Date.now()` 截止轮询），即 R18 的 `check:test-waits`。但那道门只管「等」不管「判分」，于是同一个病从「判分」那一半复发。第三条规则补上后两半才都被收住。**看到一个门岗时，先问它守的是这个病的哪一半。**
