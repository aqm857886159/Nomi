# 更正：`2026-09-03-wallclock-as-unit-test-oracle` 的一条 residual_risk 引用了被证伪的证据

> 📎 2026-09-03 · 针对 `2026-09-03-wallclock-as-unit-test-oracle.root-cause.json`
>
> **为什么是单独一个文件而不是直接改契约**：根因契约门岗（`scripts/check-root-cause-contracts.mjs`）要求任何**被改动的**契约必须由本次 diff 完整背书——回归测试、prevention 执行体、artifacts 都得在同一个 diff 里改过。这是刻意的：契约是「某次修复的凭证」，不是活文档。所以已合入的契约事实上不可回头编辑，更正只能挂在旁边。本文件不以 `.root-cause.json` 结尾，因此不会被当成契约解析。

## 被证伪的是哪一句

原契约 `residual_risks` 里那条以「换判据后，**常数因子**的 CPU 退化…」开头的条目，用了这个证据：

> 已知案例：把 projectAgentState.ts 的断言层拆成独立模块曾让该用例 9.1s → 47s，算法完全没变。

**这个证据不成立。** 它来自一次**墙钟一次性 A/B**，跑在一台常年 20+ worktree 并行、load average 在 12–264 之间摆的机器上。同一 PR 自己就实测过：**同一条未改动的测试**空闲时 9.1s、load 76 时 **29,668ms**。47s 完全落在未改动代码自己的漂移区间内。

## 重测结果

用带阳性对照的量具（`scripts/bench-agent-host.ts`，量 CPU 时间而非墙钟）交错 A/B 重建同一个拆分：

| | 微基准 cpuMs（4 轮交错，中位） | 真实 vitest 套件 user CPU（3 轮交错） |
|---|---|---|
| 未拆分 | 1393 | 10.881 / 10.530 / 10.194 |
| 拆分后 | 1369 | 10.769 / 10.526 / 9.803 |

两臂完全重叠，拆分后甚至略快。同一把尺子对一个**已知 2x** 的注入分离得干干净净（base 上界 1690 < variant 下界 2324，3/3 轮），所以这不是「尺子不够灵敏」。

## 准确的表述应该是

- 「常数因子 CPU 退化没有自动守卫」——**仍然成立**（计数器看不见这类退化）。
- 「这类退化在本仓已经发生过、并且被 testTimeout 意外守住过」——**不成立**。那次拆分从未真的变慢，testTimeout 也从未对它报警；testTimeout 报的是邻居进程的负载。
- 因此这类风险目前是「理论存在、本仓无已证实发生记录」。

## 据此做的决定（2026-09-03 用户拍板）

**不新建 CI 性能风险面**——不为一个从未发生过、且唯一引用案例是量具错误的风险付永久 CI 代价。改为提供按需量具：

```
pnpm run bench:agent-host
```

量 CPU 时间 + 同进程固定对照负载归一化（故可跨机器/跨平台比较），带 `controlSane` 自检防止对照负载被 V8 优化掉。用法、交错 A/B 纪律与判读规则见 [`../lessons/wallclock-bisect-on-a-busy-machine-is-not-evidence.md`](../lessons/wallclock-bisect-on-a-busy-machine-is-not-evidence.md)。
