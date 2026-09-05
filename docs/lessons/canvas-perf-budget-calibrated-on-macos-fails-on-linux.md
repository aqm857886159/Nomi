# 性能预算在 macOS 校准却在 Linux CI 执行 → 假回归

> 📎 教训 · 首次记录 2026-08-31 · 状态：✅ 已固化（`NON_DARWIN_TIMING_CALIBRATION` 平台感知预算已落地，见下）
> **触发场景**：CI 的「Canvas performance budget」红了，而你本地跑同一份代码是绿的；或者你正打算「让 PR 代码更快一点」来挤进阈值。

> ⚠️ **先读**（2026-09-05 补）：本文只覆盖「红的是**预算**」那一种。`Canvas Performance` 的 `pass=false` 还有第二个来源——
> 顶层 `warmupFailures` 与各 scenario 的**正确性**判据，它们不在预算表里。那天 main 930db4cd 的红就属于后者
> （预算全绿，真凶是框选手势的自动平移），照本文去调预算会**修错东西**。定性步骤见
> [Canvas Performance 红了：先看它红在哪一条判据](canvas-perf-red-read-which-assertion-failed.md)。

**结论**：**别改预算、也别为了挤进阈值去优化 PR 代码**——先证明有没有真回归。当年 #243/#239 两个 PR 的 CI 红**都不是真回归**，是「预算在 macOS 校准、却在 Linux CI 上执行」的量具错配。诊断路径是：本地同机 A/B 跑 `main` vs 分支，如果 `分支 ≤ main` 且 `main` 自己都贴着阈值，那红的是量具不是被测物。

**现状（已核实，2026-09-02）**：正解已实施为**平台感知预算**（当初两个候选里的 ①）。`tests/ux/canvas-performance-benchmark.e2e.mjs:1170-1179`：

```js
const NON_DARWIN_TIMING_CALIBRATION = 1.6
function timingBudget(baseMax) {
  return os.platform() === 'darwin' ? baseMax : Math.round(baseMax * NON_DARWIN_TIMING_CALIBRATION)
}
const PERFORMANCE_BUDGETS = [
  { metric: 'frameGapP95Ms', max: timingBudget(33) },
  { metric: 'maxFrameGapMs', max: timingBudget(100) },
  { metric: 'longTaskP95Ms', max: timingBudget(80) },
  …
]
```

关键设计约束（照抄自源码注释，改这块前先读）：**只有延迟类预算缩放；语义激活计数和 heap-leak 预算跨平台固定不变**——把那些也放宽会掩盖真回归。同一文件里还多了一条相关姿态：dev-server 腿和 CPU 节流腿的阈值从未校准，所以在那两条腿上预算检查是 **ADVISORY**（照算照记照打印，但不 force `pass=false`），只有 prod 腿对预算 gating；正确性硬失败（错误、锚点/步骤漂移、选择完整性）在每条腿上都仍然 gating。

**为什么会踩 —— 四个事实叠在一起**：

- **门岗** = `pnpm run test:canvas:performance` → `tests/ux/canvas-real-suite.mjs performance` → `canvas-performance-benchmark.e2e.mjs`，跑 14 scenario × (1 warmup + 1 sample) = **28 次冷启 Electron，天生 ~10 分钟**（不是回归）。CI 里 `spawnSync` 缓冲，日志会出现「开始」到第一条结果之间 10min 空档，**是缓冲假象不是卡住**。
- **预算原本扁平、无平台感知**：`frameGapP95Ms<=33`（=30fps 硬底）、`maxFrameGapMs<=100`、`longTaskP95Ms<=80`。代码记了 `process.platform` 却从不用它调阈值。33 这个数是 `765bd534`（2026-08-09）设的。
- **校准平台是 macOS**：仓库里 committed 的参考 `tests/ux/perf-results/canvas-pr216-acceptance.json` 是 `platform=darwin`，resize=16.4 / node-drag-video=18，绰绰有余。
- **CI 跑在 Linux + xvfb 软件渲染**（workflow `xvfb-run -a`），比那台 macOS 慢 ~1.3-2x。CI 报的是 38–44。

**本地实测（同机 macOS，M scale，2 runs）—— 三者同档，全过**：

| scenario | main (5dd5b9c0) | #243 | #239 | budget |
|---|---|---|---|---|
| node-drag-image | 19.3 | 16.9 | 18.7 | 33 |
| node-drag-video | 28.5 | 27.9 | 24.8 | 33 |
| resize | **30.8** | 28.1 | 19.2 | 33 |

`main` 自己 resize 就贴着 30.8（离 33 只差 2ms），分支 ≤ main → **没有回归**。

**为什么只有那两个 PR 红、main 绿**（这条最反直觉）：perf step 的 `if: needs.scope.outputs.performance=='true'` 由 `scripts/validation-policy.mjs` 的 `PERFORMANCE_PATTERNS` 决定，**主要只有改 `src/workbench/generationCanvas/reactFlow/**`（以及少数几个节点媒体文件、benchmark 自身）才触发**。`main` 的 merge commit 很少单独动 `reactFlow/`，所以 perf step 在 main 上**恒 skip（0s）**——「main 4 分钟 vs PR 16 分钟」其实是 **step 被跳过 vs 真跑**，不是 per-scenario 变慢。#243/#239 都动了 `GenerationCanvasReactFlow.tsx` 才第一次点亮这道门岗。

**真机制（CI CDP delta，#243 失败段）**：node-drag / resize 每帧对全部 ~96 个挂载节点做 style recalc + layout：layoutCount 130-157、recalcStyle 370-428、scriptDuration 1.2-1.5s（对比 blank-pan 27/177、wheel-zoom 9/77）。**这是 main 既有特性**，不是 PR 引入的。要真优化得做节点树 memo / CSS containment 大改，风险高、且不属于那两个 feature PR 的范围。

**怎么用**：

- CI perf 红、本地绿 → **先做同机 A/B（main vs 分支）**，别先信 CI 的绝对数。分支 ≤ main 就是「无真回归」。
- 别用「让 PR 代码更快」挤进阈值——那是**修症状（P2）**，而且 main 自己都过不了 Linux 版这道门岗。
- 「禁止改预算」的初衷是防止有人用改阈值掩盖真回归。**先证明无真回归**，改的就是「量具」而不是「被测物」，与初衷不冲突——但改量具时必须守住上面那条边界：**只缩放延迟类，计数与内存类保持跨平台固定**。
- 看到 perf step 在某个分支上「快得可疑」，先查它是不是被 `PERFORMANCE_PATTERNS` skip 了。

**出处**：`tests/ux/canvas-performance-benchmark.e2e.mjs`（`NON_DARWIN_TIMING_CALIBRATION` / `PERFORMANCE_BUDGETS` / advisory 腿注释）、`scripts/validation-policy.mjs` 的 `PERFORMANCE_PATTERNS`、`tests/ux/perf-results/canvas-pr216-acceptance.json`；PR #243 / #239（均已合并）、commit `765bd534`。
