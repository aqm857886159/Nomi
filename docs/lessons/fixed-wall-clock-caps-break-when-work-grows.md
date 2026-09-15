# 写死的墙钟上限会在工作量长大时把 CI 砍在半路

> 状态：✅ 已交付

**钩子**：CI 报 `exceeded <N>ms and was terminated` / `Canvas Performance` 红但每条场景的 verdict 都出来了 / 「我只是加了几条场景，怎么整个 job 红了」。

## 现场

2026-09-15 合并列车跑 #763（画布性能门岗补场景）：`Canvas Performance (Linux)` 红，
但 `canvas-validation-gate.json` 里**每条预算断言都有结果**，没有一条越线。真正那行是：

```
[canvas] medium-canvas-performance exceeded 1200000ms and was terminated
```

——整个 benchmark 子进程被 `canvas-real-suite.mjs` 里写死的 `20 * 60_000` 砍掉了。
那一轮跑完 20 条场景、死在第 21 条 `video-hover` 的采样里（均值约 60 s/场景）。

## 为什么会踩到

**上限是常数，工作量是变量，而两者住在不同文件里。**
加场景的人改 `canvas-performance-benchmark.e2e.mjs` 里的 `allScenarios` 数组；
砍进程的那个常数住在 `canvas-real-suite.mjs`。两处互不知情，所以每次有人把清单加长
就会再踩一次——这不是谁手滑，是机制必然。

## 别这么修

把 `20` 改成 `40`。那是 P2 的症状修法：下一次再加场景照样红，而且改常量的人手上没有
「多少才够」的依据，只能拍一个更大的数（`docs/lessons/no-magic-number-fixes-verify-with-real-runs.md`
是同一条的另一次显形）。

## 修法

清单单独住一个模块当唯一真相源，**上限由它的长度派生**：

- `tests/ux/canvas-perf/gateScenarios.mjs` 导出 `CANVAS_PERF_GATE_SCENARIOS` +
  `canvasPerfGateTimeoutMs()`；benchmark 和 suite 都从这里读。
- 每条场景的预算来自实测而不是拍脑袋：run 34899530314 的均值 60 s × 1.5 = 90 s
  （CI 软渲染比 macOS 慢 1.3–2×，`cold-open`/`reload-heavy` 明显高于均值）；
  固定开销（起 Electron、建夹具、写报告）单列 2 分钟。
- `canvas-real-suite.test.mjs` 钉两条：上限 = 固定开销 + 单条预算 × 条数；
  **清单多一条、上限必须多出正好一条的预算**。把它改回写死的常数即报红（已实跑验证）。

## 一句话

**被砍掉的那一轮既不是绿也不是红，只是没跑完。**
任何「跑多久」的硬顶，都要从「有多少活」派生，别从一个数字来。
同族要查的地方：任何 `timeout`/`deadline` 常数旁边有一张会变长的清单。
